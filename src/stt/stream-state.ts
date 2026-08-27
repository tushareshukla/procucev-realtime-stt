export const SAMPLE_RATE = 16_000;

const MAX_WINDOW_S = Number(process.env.MAX_WINDOW_S ?? 20);
const OVERLAP_S = Number(process.env.OVERLAP_S ?? 1);
const SILENCE_COMMIT_S = Number(process.env.SILENCE_COMMIT_S ?? 0.8);

/** RMS below this counts as silence for the commit heuristic. */
const SILENCE_RMS = Number(process.env.SILENCE_RMS ?? 0.006);

/**
 * Rolling audio window for one WebSocket connection.
 *
 * Whisper is not a streaming model, so we approximate: hold recent audio,
 * re-transcribe it for partials, and commit a final segment once the speaker
 * pauses. Committed audio is dropped except for a short overlap tail, so a word
 * straddling the boundary still has context on the next pass.
 */
export class StreamState {
  private buffer = new Float32Array(0);
  private trailingSilenceS = 0;
  /** Guards against committing a window of pure silence as a bogus segment. */
  private hasSpeech = false;

  addPcm16(chunk: Buffer): void {
    const samples = chunk.length / 2;
    const incoming = new Float32Array(samples);
    for (let i = 0; i < samples; i++) {
      incoming[i] = chunk.readInt16LE(i * 2) / 32768;
    }

    const merged = new Float32Array(this.buffer.length + incoming.length);
    merged.set(this.buffer, 0);
    merged.set(incoming, this.buffer.length);
    this.buffer = merged;

    if (this.isSilent(incoming)) {
      this.trailingSilenceS += incoming.length / SAMPLE_RATE;
    } else {
      this.trailingSilenceS = 0;
      this.hasSpeech = true;
    }
  }

  private isSilent(frame: Float32Array): boolean {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    return Math.sqrt(sum / Math.max(frame.length, 1)) < SILENCE_RMS;
  }

  get durationS(): number {
    return this.buffer.length / SAMPLE_RATE;
  }

  get audio(): Float32Array {
    return this.buffer;
  }

  /** True once the speaker has paused, or the window has grown too long. */
  shouldCommit(): boolean {
    if (!this.hasSpeech) {
      // Nothing but silence so far — drop it rather than emit a phantom segment.
      if (this.durationS > MAX_WINDOW_S) this.reset();
      return false;
    }
    return (
      (this.trailingSilenceS >= SILENCE_COMMIT_S && this.durationS > 0.6) ||
      this.durationS >= MAX_WINDOW_S
    );
  }

  private reset(): void {
    this.buffer = new Float32Array(0);
    this.trailingSilenceS = 0;
    this.hasSpeech = false;
  }

  /** Force a commit on the next check — used when the client sends `flush`. */
  forceCommit(): void {
    this.trailingSilenceS = SILENCE_COMMIT_S * 2;
  }

  /** Drop committed audio, retaining an overlap tail. */
  consume(): Float32Array {
    const committed = this.buffer;
    const keep = Math.floor(OVERLAP_S * SAMPLE_RATE);
    this.buffer = committed.length > keep ? committed.slice(-keep) : new Float32Array(0);
    this.trailingSilenceS = 0;
    this.hasSpeech = false;
    return committed;
  }
}
