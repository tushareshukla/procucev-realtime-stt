// Streams a WAV through the gateway the same way the browser does:
// 16kHz mono PCM16 binary frames, ~100ms each, then a `flush`.
const fs = require('fs');
const WebSocket = require('ws');

const wav = fs.readFileSync(process.argv[2] || 'testdata/hinglish.wav');
const pcm = wav.subarray(44); // skip RIFF header
const CHUNK = 16000 * 2 * 0.1; // 100ms

const ws = new WebSocket('ws://localhost:8080/ws/transcribe');
ws.on('open', async () => {
  ws.send(JSON.stringify({ type: 'config', language: process.env.LANG_CODE || 'hi' }));
  console.log('connected, streaming %d bytes (%.2fs)', pcm.length, pcm.length / 32000);
  for (let off = 0; off < pcm.length; off += CHUNK) {
    ws.send(pcm.subarray(off, Math.min(off + CHUNK, pcm.length)));
    await new Promise((r) => setTimeout(r, 100)); // real-time pacing
  }
  // Trailing silence so the VAD commit heuristic fires naturally.
  const silence = Buffer.alloc(CHUNK);
  for (let i = 0; i < 12; i++) {
    ws.send(silence);
    await new Promise((r) => setTimeout(r, 100));
  }
  ws.send('flush');
  setTimeout(() => ws.close(), 8000);
});
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === 'partial') console.log('  [partial]', m.text);
  else if (m.type === 'final') console.log('  [FINAL  ]', JSON.stringify(m.item.text), '| lang:', m.item.language);
  else console.log('  [%s]', m.type, JSON.stringify(m));
});
ws.on('close', () => { console.log('closed'); process.exit(0); });
ws.on('error', (e) => { console.error('ws error:', e.message); process.exit(1); });
