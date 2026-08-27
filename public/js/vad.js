/**
 * Voice-activity gate.
 *
 * Gating matters: an open microphone otherwise streams ~32KB/s of silence and
 * bills a model inference per silent second. But a fixed threshold is wrong —
 * microphone gain varies enormously, and with echoCancellation and
 * noiseSuppression enabled a normal speaking voice can sit below a hardcoded
 * cutoff, so nothing is ever transmitted and the app looks broken.
 *
 * Instead the noise floor is measured for the first second, and the trigger is
 * a multiple of it, clamped into a sane range.
 */
export const VAD_DEFAULTS = {
  calibrationMs: 900,
  triggerMultiple: 2.5,
  minThreshold: 0.004,
  maxThreshold: 0.03,
  tailFrames: 12,     // ~1s kept after speech stops, so the server can commit
  preRollFrames: 8,   // ~700ms kept before speech, so onsets aren't clipped
};

export class VoiceGate {
  constructor(frameSize, sampleRate, opts = {}) {
    this.o = { ...VAD_DEFAULTS, ...opts };
    this.framesToCalibrate = Math.ceil((this.o.calibrationMs / 1000) * sampleRate / frameSize);
    this.noiseFloor = 0;
    this.calibrated = 0;
    this.threshold = this.o.minThreshold;
    this.speaking = false;
    this.quiet = 0;
    this.sawSpeech = false;
    this.frames = 0;
  }

  /**
   * Classify one frame.
   * @returns {'calibrating'|'speech-start'|'speech'|'tail'|'tail-end'|'idle'}
   */
  classify(level) {
    this.frames++;

    if (this.calibrated < this.framesToCalibrate) {
      this.noiseFloor = (this.noiseFloor * this.calibrated + level) / (this.calibrated + 1);
      this.calibrated++;
      if (this.calibrated === this.framesToCalibrate) {
        this.threshold = Math.min(
          this.o.maxThreshold,
          Math.max(this.o.minThreshold, this.noiseFloor * this.o.triggerMultiple),
        );
      }
      return 'calibrating';
    }

    if (level > this.threshold) {
      this.quiet = 0;
      if (!this.speaking) {
        this.speaking = true;
        this.sawSpeech = true;
        return 'speech-start';
      }
      return 'speech';
    }

    if (this.speaking) {
      this.quiet++;
      if (this.quiet > this.o.tailFrames) {
        this.speaking = false;
        this.quiet = 0;
        return 'tail-end';
      }
      return 'tail';
    }

    return 'idle';
  }

  /** True when recording has run a while and nothing ever crossed the gate. */
  get looksDeaf() {
    return !this.sawSpeech && this.frames > this.framesToCalibrate + 90;
  }
}
