/** Audio helpers shared by the recorder. */

export const TARGET_RATE = 16000;

/**
 * Float32 -> 16kHz PCM16.
 *
 * When the AudioContext already runs at 16kHz the browser has resampled with a
 * real filter and this is a straight conversion. Otherwise we average each
 * source window rather than sampling one point: naive decimation aliases
 * everything above 8kHz back into the speech band and measurably degrades
 * recognition.
 */
export function toPCM16(f32, inRate) {
  const clamp = (v) => (v < 0 ? Math.max(-1, v) * 0x8000 : Math.min(1, v) * 0x7fff);

  if (inRate === TARGET_RATE) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) out[i] = clamp(f32[i]);
    return out.buffer;
  }

  const ratio = inRate / TARGET_RATE;
  const out = new Int16Array(Math.floor(f32.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(f32.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += f32[j];
    out[i] = clamp(sum / Math.max(1, end - start));
  }
  return out.buffer;
}

export function rms(frame) {
  let sum = 0;
  for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
  return Math.sqrt(sum / frame.length);
}
