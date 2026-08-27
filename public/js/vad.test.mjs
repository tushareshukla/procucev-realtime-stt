import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceGate } from './vad.js';
import { toPCM16, rms } from './audio.js';

const FRAME = 4096, RATE = 48000;
const gate = (opts) => new VoiceGate(FRAME, RATE, opts);
/** Feed n frames at a constant level. */
const feed = (g, level, n) => { let last; for (let i = 0; i < n; i++) last = g.classify(level); return last; };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe('VoiceGate', () => {
  test('calibrates before classifying anything as speech', () => {
    const g = gate();
    assert.equal(g.classify(0.5), 'calibrating');
  });

  test('derives a threshold from the measured noise floor', () => {
    const g = gate();
    feed(g, 0.004, g.framesToCalibrate);
    near(g.threshold, 0.01);   // 0.004 * 2.5
  });

  // Regression: a fixed 0.012 threshold meant a quiet mic never opened the
  // gate, so nothing was ever sent and the app looked dead.
  test('a quiet microphone still triggers, because the threshold adapts', () => {
    const g = gate();
    feed(g, 0.001, g.framesToCalibrate);        // very quiet room
    assert.equal(g.classify(0.006), 'speech-start');  // quiet voice, well under 0.012
  });

  test('clamps the threshold so a noisy room cannot make it impossibly high', () => {
    const g = gate();
    feed(g, 0.5, g.framesToCalibrate);
    near(g.threshold, 0.03);
  });

  test('clamps the threshold so a silent room cannot make it trip on noise', () => {
    const g = gate();
    feed(g, 0, g.framesToCalibrate);
    near(g.threshold, 0.004);
  });

  test('keeps sending briefly after speech stops, then goes idle', () => {
    const g = gate();
    feed(g, 0.001, g.framesToCalibrate);
    g.classify(0.05);
    assert.equal(g.classify(0.0001), 'tail');
    assert.equal(feed(g, 0.0001, 12), 'tail-end');
    assert.equal(g.classify(0.0001), 'idle');
  });

  test('reports a deaf microphone rather than sitting silent', () => {
    const g = gate();
    feed(g, 0.0001, g.framesToCalibrate + 95);
    assert.equal(g.looksDeaf, true);
  });

  test('does not report deaf once speech has been heard', () => {
    const g = gate();
    feed(g, 0.001, g.framesToCalibrate);
    g.classify(0.05);
    feed(g, 0.0001, 200);
    assert.equal(g.looksDeaf, false);
  });
});

describe('audio', () => {
  test('passes 16kHz through untouched', () => {
    const f = new Float32Array([0, 0.5, -0.5, 1]);
    assert.equal(new Int16Array(toPCM16(f, 16000)).length, 4);
  });

  // Regression: naive decimation aliased content above 8kHz into the speech
  // band, which is what made captured audio sound unclear to the model.
  test('averages when downsampling instead of dropping samples', () => {
    const f = new Float32Array(6).fill(0);
    f[0] = 1; f[1] = -1; f[2] = 1;   // alternating: point-sampling would keep +1
    const out = new Int16Array(toPCM16(f, 48000));
    assert.ok(Math.abs(out[0]) < 0x7fff / 2, 'averaged, not point-sampled');
  });

  test('clips rather than wrapping on out-of-range input', () => {
    const out = new Int16Array(toPCM16(new Float32Array([5, -5]), 16000));
    assert.equal(out[0], 32767);
    assert.equal(out[1], -32768);
  });

  test('rms is zero for silence and positive for a tone', () => {
    assert.equal(rms(new Float32Array(128)), 0);
    assert.ok(rms(new Float32Array(128).fill(0.5)) > 0.4);
  });
});
