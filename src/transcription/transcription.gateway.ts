import { Logger } from '@nestjs/common';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
} from '@nestjs/websockets';
import { randomUUID } from 'crypto';
import type { WebSocket } from 'ws';
import { DEFAULT_LANGUAGE, SttService } from '../stt/stt.service';
import { LocalAgreement } from '../stt/local-agreement';
import { StreamState, SAMPLE_RATE } from '../stt/stream-state';
import { TranscriptionService } from './transcription.service';

const REFRESH_MS = Number(process.env.REFRESH_MS ?? 900);
/** Partials only look at the recent tail, so their cost stays constant. */
const PARTIAL_WINDOW_S = Number(process.env.PARTIAL_WINDOW_S ?? 8);

interface Session {
  id: string;
  state: StreamState;
  bytesSinceRefresh: number;
  busy: boolean;
  /** Whisper needs an explicit language; the client may override the default. */
  language: string;
  /** Stabilises partials so displayed text settles instead of flickering. */
  agreement: LocalAgreement;
}

@WebSocketGateway({ path: '/ws/transcribe' })
export class TranscriptionGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly log = new Logger(TranscriptionGateway.name);
  private readonly sessions = new Map<WebSocket, Session>();
  private readonly refreshBytes = Math.floor((SAMPLE_RATE * 2 * REFRESH_MS) / 1000);

  constructor(
    private readonly stt: SttService,
    private readonly transcriptions: TranscriptionService,
  ) {}

  handleConnection(client: WebSocket): void {
    const session: Session = {
      id: randomUUID().slice(0, 12),
      state: new StreamState(),
      bytesSinceRefresh: 0,
      busy: false,
      language: DEFAULT_LANGUAGE,
      agreement: new LocalAgreement(),
    };
    this.sessions.set(client, session);

    this.send(client, {
      type: 'session',
      sessionId: session.id,
      modelReady: this.stt.ready,
      language: session.language,
    });
    client.on('message', (data: Buffer, isBinary: boolean) =>
      this.onMessage(client, data, isBinary).catch((err) =>
        this.log.error(`session ${session.id}: ${err.message}`),
      ),
    );
  }

  handleDisconnect(client: WebSocket): void {
    const session = this.sessions.get(client);
    if (session) this.log.log(`session ${session.id} closed`);
    this.sessions.delete(client);
  }

  private async onMessage(client: WebSocket, data: Buffer, isBinary: boolean): Promise<void> {
    const session = this.sessions.get(client);
    if (!session) return;

    // Text frames are control messages, not audio.
    if (!isBinary) {
      const raw = data.toString();
      if (raw === 'flush') {
        session.state.forceCommit();
        await this.maybeCommit(client, session);
        return;
      }
      try {
        const msg = JSON.parse(raw);
        if (msg?.type === 'config' && typeof msg.language === 'string') {
          session.language = msg.language;
          this.log.log(`session ${session.id} language -> ${msg.language}`);
        }
      } catch {
        // Non-JSON control frame; nothing to do.
      }
      return;
    }

    session.state.addPcm16(data);
    session.bytesSinceRefresh += data.length;

    if (await this.maybeCommit(client, session)) return;

    // Emit a partial at most once per REFRESH_MS, never stack them
    // (transcription is slower than audio arrives), and never spend an
    // inference call on a window that contains no speech.
    if (
      session.bytesSinceRefresh >= this.refreshBytes &&
      !session.busy &&
      session.state.hasAudibleSpeech
    ) {
      session.bytesSinceRefresh = 0;
      session.busy = true;
      try {
        const { text } = await this.stt.transcribe(
          session.state.tail(PARTIAL_WINDOW_S),
          session.language,
        );
        if (text) {
          // Emit the stable prefix separately from the still-changing tail so
          // the UI can render settled text differently from in-flight text.
          const { committed, tentative } = session.agreement.update(text);
          this.send(client, { type: 'partial', text, committed, tentative });
        }
      } finally {
        session.busy = false;
      }
    }
  }

  private async maybeCommit(client: WebSocket, session: Session): Promise<boolean> {
    if (!session.state.shouldCommit()) return false;

    const durationS = session.state.durationS;
    const audio = session.state.consume();
    session.bytesSinceRefresh = 0;

    const { text, language, confidence } = await this.stt.transcribe(audio, session.language);
    session.agreement.reset();   // each committed segment starts fresh
    if (!text) return true;

    // Deliberately not persisted here. The client decides what to keep and
    // saves it explicitly along with the recording, so nothing lands in the
    // history unless the user asked for it.
    this.send(client, {
      type: 'final',
      item: { sessionId: session.id, text, language, confidence, durationS },
    });
    return true;
  }

  private send(client: WebSocket, payload: unknown): void {
    if (client.readyState === 1) client.send(JSON.stringify(payload));
  }
}
