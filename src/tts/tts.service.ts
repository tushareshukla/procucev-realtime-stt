import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Readable } from 'node:stream';

const STT_SERVICE_URL = (process.env.STT_SERVICE_URL ?? '').replace(/\/$/, '');
const TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS ?? 60_000);

export interface Voice {
  id: string;
  name: string;
  language: string;
  gender?: string;
  engine: string;
}

/**
 * Proxies to the open-source TTS running in the inference service
 * (Kokoro for English, Piper for everything else). Kept server-side so the
 * browser never needs credentials and playback is identical across devices.
 */
@Injectable()
export class TtsService {
  private readonly log = new Logger(TtsService.name);

  private assertConfigured(): void {
    if (!STT_SERVICE_URL) {
      throw new ServiceUnavailableException('STT_SERVICE_URL is not configured');
    }
  }

  async listVoices(language: string): Promise<{ voices: Voice[]; engine: string }> {
    this.assertConfigured();
    try {
      const res = await fetch(
        `${STT_SERVICE_URL}/voices?language=${encodeURIComponent(language)}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      if (!res.ok) return { voices: [], engine: 'unavailable' };
      return await res.json();
    } catch (err) {
      this.log.warn(`listVoices failed: ${err.message}`);
      return { voices: [], engine: 'unavailable' };
    }
  }

  /**
   * Streaming synthesis. Returns the upstream body so the caller can pipe it
   * straight through — buffering here would defeat the point of streaming.
   */
  async speakStream(body: {
    text: string;
    language?: string;
    voice?: string;
    speed?: number;
  }): Promise<NodeJS.ReadableStream> {
    this.assertConfigured();
    const res = await fetch(`${STT_SERVICE_URL}/speak/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new ServiceUnavailableException(`tts stream failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    // fetch() yields a Web ReadableStream, which has no .pipe(); Express needs
    // a Node stream. Readable.fromWeb bridges the two without buffering.
    return Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  }

  async speak(body: {
    text: string;
    language?: string;
    voice?: string;
    speed?: number;
  }): Promise<Buffer> {
    this.assertConfigured();
    const res = await fetch(`${STT_SERVICE_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ServiceUnavailableException(`tts failed: ${res.status} ${detail.slice(0, 200)}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}
