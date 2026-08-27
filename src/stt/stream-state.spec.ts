import { SAMPLE_RATE, StreamState } from './stream-state';

/** Build a PCM16 buffer of `seconds` at a given amplitude (0 = silence). */
function pcm(seconds: number, amplitude = 0): Buffer {
  const samples = Math.floor(SAMPLE_RATE * seconds);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    // A sine keeps RMS predictable; amplitude 0 gives exact silence.
    const v = amplitude === 0 ? 0 : Math.sin((i / SAMPLE_RATE) * 2 * Math.PI * 220) * amplitude;
    buf.writeInt16LE(Math.round(v * 0x7fff), i * 2);
  }
  return buf;
}

describe('StreamState', () => {
  it('accumulates duration from PCM16 input', () => {
    const s = new StreamState();
    s.addPcm16(pcm(1.0, 0.5));
    expect(s.durationS).toBeCloseTo(1.0, 2);
  });

  it('converts PCM16 to normalised float without clipping', () => {
    const s = new StreamState();
    s.addPcm16(pcm(0.1, 0.5));
    const peak = Math.max(...Array.from(s.audio).map(Math.abs));
    expect(peak).toBeGreaterThan(0.4);
    expect(peak).toBeLessThanOrEqual(1.0);
  });

  describe('speech gating', () => {
    it('reports no speech for pure silence', () => {
      const s = new StreamState();
      s.addPcm16(pcm(2.0, 0));
      expect(s.hasAudibleSpeech).toBe(false);
    });

    it('reports speech once audible input arrives', () => {
      const s = new StreamState();
      s.addPcm16(pcm(0.5, 0.5));
      expect(s.hasAudibleSpeech).toBe(true);
    });

    // Regression: a silent lead-in used to commit as a phantom segment
    // (it produced a spurious "- Okay." final).
    it('never commits a window that contains only silence', () => {
      const s = new StreamState();
      s.addPcm16(pcm(3.0, 0));
      expect(s.shouldCommit()).toBe(false);
    });

    it('discards a silence-only buffer once it grows past the window', () => {
      const s = new StreamState();
      s.addPcm16(pcm(30, 0)); // longer than MAX_WINDOW_S
      expect(s.shouldCommit()).toBe(false);
      expect(s.durationS).toBe(0); // dropped rather than retained
    });
  });

  describe('commit thresholds', () => {
    it('does not commit while the speaker is still talking', () => {
      const s = new StreamState();
      s.addPcm16(pcm(2.0, 0.5));
      expect(s.shouldCommit()).toBe(false);
    });

    it('commits after speech followed by enough trailing silence', () => {
      const s = new StreamState();
      s.addPcm16(pcm(2.0, 0.5));
      s.addPcm16(pcm(1.0, 0)); // > SILENCE_COMMIT_S
      expect(s.shouldCommit()).toBe(true);
    });

    it('does not commit on a short silence gap mid-sentence', () => {
      const s = new StreamState();
      s.addPcm16(pcm(2.0, 0.5));
      s.addPcm16(pcm(0.3, 0)); // < SILENCE_COMMIT_S
      expect(s.shouldCommit()).toBe(false);
    });

    it('force-commits when the client sends flush', () => {
      const s = new StreamState();
      s.addPcm16(pcm(1.0, 0.5));
      expect(s.shouldCommit()).toBe(false);
      s.forceCommit();
      expect(s.shouldCommit()).toBe(true);
    });

    it('commits a long utterance even without a pause', () => {
      const s = new StreamState();
      s.addPcm16(pcm(21, 0.5)); // past MAX_WINDOW_S
      expect(s.shouldCommit()).toBe(true);
    });
  });

  describe('consume', () => {
    it('returns the full window and retains only an overlap tail', () => {
      const s = new StreamState();
      s.addPcm16(pcm(5.0, 0.5));
      const committed = s.consume();
      expect(committed.length / SAMPLE_RATE).toBeCloseTo(5.0, 1);
      // A word split across the boundary needs context on the next pass.
      expect(s.durationS).toBeGreaterThan(0);
      expect(s.durationS).toBeLessThanOrEqual(1.05);
    });

    it('clears the speech flag so the tail alone cannot re-commit', () => {
      const s = new StreamState();
      s.addPcm16(pcm(2.0, 0.5));
      s.addPcm16(pcm(1.0, 0));
      s.consume();
      expect(s.hasAudibleSpeech).toBe(false);
      expect(s.shouldCommit()).toBe(false);
    });
  });
});
