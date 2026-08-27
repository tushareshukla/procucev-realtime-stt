const fs = require('fs');
const WebSocket = require('ws');
const HOST = process.argv[3] || 'procucev.prakriya.work';
const pcm = fs.readFileSync(process.argv[2]).subarray(44);
const CHUNK = 16000 * 2 * 0.1;
const ws = new WebSocket(`wss://${HOST}/ws/transcribe`);
ws.on('open', async () => {
  ws.send(JSON.stringify({ type: 'config', language: 'hi' }));
  console.log('connected to', HOST);
  for (let o = 0; o < pcm.length; o += CHUNK) {
    ws.send(pcm.subarray(o, Math.min(o + CHUNK, pcm.length)));
    await new Promise(r => setTimeout(r, 100));
  }
  const sil = Buffer.alloc(CHUNK);
  for (let i = 0; i < 12; i++) { ws.send(sil); await new Promise(r => setTimeout(r, 100)); }
  ws.send('flush');
  setTimeout(() => ws.close(), 90000);
});
ws.on('message', d => {
  const m = JSON.parse(d.toString());
  if (m.type === 'partial') console.log('  [partial]', m.text.slice(0, 90));
  else if (m.type === 'final') { console.log('  [FINAL]', JSON.stringify(m.item.text)); ws.close(); }
  else console.log('  [' + m.type + ']', JSON.stringify(m).slice(0, 120));
});
ws.on('close', () => process.exit(0));
ws.on('error', e => { console.error('ws error:', e.message); process.exit(1); });
