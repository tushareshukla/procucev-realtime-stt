import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { SAMPLE_RATE } from './stream-state';

/** Hindi default: the target case is Hinglish, and `en` would translate it away. */
export const DEFAULT_LANGUAGE = process.env.WHISPER_LANGUAGE ?? 'en';

/**
 * Whisper runs in a separate Cloud Run service, not here. That keeps this
 * backend light enough to sit on a shared VM (~200MB, no ONNX runtime, no
 * model weights) while inference scales to zero independently.
 */
const STT_SERVICE_URL = (process.env.STT_SERVICE_URL ?? '').replace(/\/$/, '');
/**
 * Long enough to outlast a cold start. The inference service scales to zero,
 * and loading whisper-large-v3-turbo at fp32 takes ~60s, so a 30s budget
 * aborted every first-request-after-idle and surfaced it as "no speech".
 * Cloud Run's own request timeout is 300s, so this stays inside it.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.STT_TIMEOUT_MS ?? 120_000);

export interface SttResult {
  text: string;
  language: string;
  confidence: number;
  /**
   * Why the text is empty, when it is. Silence and a cold inference service
   * are very different problems and used to be indistinguishable to the
   * caller — both arrived as an empty string.
   */
  status?: 'ok' | 'warming' | 'unavailable';
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
        method: 'POST',
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
   * Transcribe a complete WAV recording (as opposed to a streaming window).
   * Strips the RIFF header and forwards the PCM the service expects.
   */
  async transcribeWav(wav: Buffer, language: string): Promise<SttResult> {
    // Locate the data chunk rather than assuming a 44-byte header: browsers
    // and encoders insert optional chunks before it.
    let offset = 12;
    let dataStart = 44;
    while (offset + 8 <= wav.length) {
      const id = wav.toString('ascii', offset, offset + 4);
      const size = wav.readUInt32LE(offset + 4);
      if (id === 'data') { dataStart = offset + 8; break; }
      offset += 8 + size + (size % 2);
    }

    const pcm = wav.subarray(dataStart);
    const audio = new Float32Array(pcm.length / 2);
    for (let i = 0; i < audio.length; i++) audio[i] = pcm.readInt16LE(i * 2) / 32768;
    return this.transcribe(audio, language);
  }

  /**
   * Live upstream check. Uses POST /transcribe with a 2-byte body rather than
   * a health path: infrastructure in front of Cloud Run intercepts /healthz on
   * some network paths, and this exercises the real code path anyway.
   */
  async health(): Promise<{ reachable: boolean; url: string; engine?: string; model?: string }> {
    if (!STT_SERVICE_URL) return { reachable: false, url: '' };
    try {
      const res = await fetch(`${STT_SERVICE_URL}/transcribe?language=en`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.alloc(2),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json().catch(() => ({}));
      this.reachable = res.ok;
      return { reachable: res.ok, url: STT_SERVICE_URL, engine: body?.engine, model: body?.model };
    } catch {
      this.reachable = false;
      return { reachable: false, url: STT_SERVICE_URL };
    }
  }


  /**
   * Send a mono 16 kHz window for transcription.
   *
   * The language MUST be explicit — the inference service defaults to Hindi,
   * but relying on that would silently translate English sessions.
   */
  async transcribe(audio: Float32Array, language = DEFAULT_LANGUAGE): Promise<SttResult> {
    const empty: SttResult = { text: '', language, confidence: 0, status: 'ok' };
    if (!STT_SERVICE_URL) return { ...empty, status: 'unavailable' };
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
        return { ...empty, status: 'unavailable' };
      }
      this.reachable = true;
      const body = await res.json();
      return {
        text: String(body?.text ?? '').trim(),
        language: body?.language ?? language,
        confidence: Number(body?.confidence ?? 0),
        status: 'ok',
      };
    } catch (err) {
      this.reachable = false;
      this.log.warn(`transcribe failed: ${err.message}`);
      // A timeout here almost always means the service is cold and still
      // loading the model, which is worth retrying; anything else is not.
      const warming = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      return { ...empty, status: warming ? 'warming' : 'unavailable' };
    }
  }
}
