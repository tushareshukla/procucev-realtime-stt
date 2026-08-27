/** Build a WAV blob from accumulated PCM16 chunks (what we streamed to the server). */
export function pcmChunksToWavBlob(chunks, sampleRate = 16000) {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const buf = new ArrayBuffer(44 + total);
  const view = new DataView(buf);
  const ascii = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + total, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 1, true);            // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, total, true);

  let offset = 44;
  for (const c of chunks) {
    new Uint8Array(buf, offset, c.byteLength).set(new Uint8Array(c));
    offset += c.byteLength;
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Read a length-prefixed WAV stream from /speak/stream.
 * Framing: 4-byte big-endian length, then that many bytes of WAV.
 */
export async function* readWavStream(response) {
  const reader = response.body.getReader();
  let buf = new Uint8Array(0);

  const append = (chunk) => {
    const next = new Uint8Array(buf.length + chunk.length);
    next.set(buf, 0);
    next.set(chunk, buf.length);
    buf = next;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (value) append(value);

    // Emit every complete frame currently buffered.
    while (buf.length >= 4) {
      const len = new DataView(buf.buffer, buf.byteOffset, 4).getUint32(0, false);
      if (buf.length < 4 + len) break;
      yield new Blob([buf.slice(4, 4 + len)], { type: 'audio/wav' });
      buf = buf.slice(4 + len);
    }
    if (done) break;
  }
}
