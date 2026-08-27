/** Audio-quality checks for synthesised speech. No dependencies. */

/** Parse a PCM16 WAV into { sampleRate, samples: Float32Array }. */
export function parseWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }

  let offset = 12, sampleRate = 0, bits = 16, channels = 1, dataStart = -1, dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(offset + 10);
      sampleRate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
    } else if (id === 'data') {
      dataStart = offset + 8;
      dataLen = Math.min(size, buf.length - dataStart);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataStart < 0) throw new Error('no data chunk');
  if (bits !== 16) throw new Error(`expected 16-bit PCM, got ${bits}`);

  const n = Math.floor(dataLen / 2);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(dataStart + i * 2) / 32768;
  return { sampleRate, channels, samples, durationS: n / (sampleRate * channels) };
}

export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, samples.length));
}

export function peak(samples) {
  let p = 0;
  for (let i = 0; i < samples.length; i++) p = Math.max(p, Math.abs(samples[i]));
  return p;
}

/** Fraction of the clip that is near-silence — high values mean dead air. */
export function silenceRatio(samples, sampleRate, threshold = 0.01) {
  const win = Math.max(1, Math.floor(sampleRate * 0.02));   // 20ms frames
  let quiet = 0, total = 0;
  for (let i = 0; i + win <= samples.length; i += win) {
    total++;
    if (rms(samples.subarray(i, i + win)) < threshold) quiet++;
  }
  return total ? quiet / total : 1;
}

/** Clipping suggests the encoder overflowed rather than synthesised cleanly. */
export function clippedRatio(samples) {
  let c = 0;
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]) > 0.999) c++;
  return samples.length ? c / samples.length : 0;
}
