import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SAMPLE_RATE } from './stream-state';

/** Hindi default: the target case is Hinglish, and `en` would translate it away. */
export const DEFAULT_LANGUAGE = process.env.WHISPER_LANGUAGE ?? 'hi';

/**
 * Whisper runs in a separate Cloud Run service, not here. That keeps this
 * backend light enough to sit on a shared VM (~200MB, no ONNX runtime, no
 * model weights) while inference scales to zero independently.
 */
const STT_SERVICE_URL = (process.env.STT_SERVICE_URL ?? '').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = Number(process.env.STT_TIMEOUT_MS ?? 30_000);

export interface SttResult {
  text: string;
  language: string;
  confidence: number;
}

@Injectable()
export class SttService implements OnModuleInit {
  private readonly log = new Logger(SttService.name);
  private reachable = false;

  async onModuleInit(): Promise<void> {
    if (!STT_SERVICE_URL) {
      this.log.error('STT_SERVICE_URL is not set — transcription will fail');
      return;
    }
    // Ping on boot so a misconfigured URL surfaces in logs, not mid-stream.
    // This also warms the Cloud Run instance ahead of the first speaker.
    try {
      const res = await fetch(`${STT_SERVICE_URL}/healthz`, {
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json();
      this.reachable = res.ok;
      this.log.log(`stt-service reachable at ${STT_SERVICE_URL} (model: ${body?.model})`);
    } catch (err) {
      this.log.warn(`stt-service unreachable at ${STT_SERVICE_URL}: ${err.message}`);
    }
  }

  get ready(): boolean {
    return this.reachable;
  }

  /**
   * Send a mono 16 kHz window for transcription.
   *
   * The language MUST be explicit — the inference service defaults to Hindi,
   * but relying on that would silently translate English sessions.
   */
  async transcribe(audio: Float32Array, language = DEFAULT_LANGUAGE): Promise<SttResult> {
    const empty: SttResult = { text: '', language, confidence: 0 };
    if (!STT_SERVICE_URL) return empty;
    if (audio.length < SAMPLE_RATE * 0.3) return empty;

    // Back to PCM16 for the wire: half the bytes of Float32, and what the
    // service expects.
    const pcm = Buffer.alloc(audio.length * 2);
    for (let i = 0; i < audio.length; i++) {
      const s = Math.max(-1, Math.min(1, audio[i]));
      pcm.writeInt16LE(s < 0 ? s * 0x8000 : s * 0x7fff, i * 2);
    }

    try {
      const res = await fetch(
        `${STT_SERVICE_URL}/transcribe?language=${encodeURIComponent(language)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: pcm,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );

      if (!res.ok) {
        this.log.warn(`stt-service returned ${res.status}`);
        return empty;
      }
      this.reachable = true;
      const body = await res.json();
      return {
        text: String(body?.text ?? '').trim(),
        language: body?.language ?? language,
        confidence: Number(body?.confidence ?? 0),
      };
    } catch (err) {
      this.reachable = false;
      this.log.warn(`transcribe failed: ${err.message}`);
      return empty;
    }
  }
}
