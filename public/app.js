'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ── voice-activity gate ──────────────────────────────────────────────────────
// Without this the mic streams ~32KB/s of silence and the server bills a
// Whisper inference call for every silent second.
const VAD_RMS = 0.012;
const TAIL_FRAMES = 12;     // ~1s of audio kept after speech stops
const PREROLL_FRAMES = 4;   // ~350ms captured before speech is detected

let ws, ctx, node, stream, analyser, rafId, startedAt;
let recording = false, sessionId = null;

// ── recorder ─────────────────────────────────────────────────────────────────
function setStat(text, mode) {
  $('stat').textContent = text;
  const d = $('dot');
  d.className = 'dot' + (mode ? ' ' + mode : '');
}

function toPCM16(f32, inRate) {
  const ratio = inRate / 16000;
  const out = new Int16Array(Math.floor(f32.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[Math.floor(i * ratio)]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

function drawWave() {
  const c = $('wave'), g = c.getContext('2d');
  const w = c.width = c.clientWidth * devicePixelRatio;
  const h = c.height = 62 * devicePixelRatio;
  g.clearRect(0, 0, w, h);

  const css = getComputedStyle(document.documentElement);
  g.fillStyle = css.getPropertyValue('--panel2').trim();
  g.fillRect(0, 0, w, h);

  if (!analyser) {
    g.strokeStyle = css.getPropertyValue('--line').trim();
    g.lineWidth = devicePixelRatio;
    g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
    return;
  }

  const bins = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteTimeDomainData(bins);

  const bars = 96, bw = w / bars, step = Math.floor(bins.length / bars);
  g.fillStyle = css.getPropertyValue('--acc').trim();
  for (let i = 0; i < bars; i++) {
    let peak = 0;
    for (let j = 0; j < step; j++) peak = Math.max(peak, Math.abs(bins[i * step + j] - 128) / 128);
    const bh = Math.max(2 * devicePixelRatio, peak * h * 0.85);
    g.fillRect(i * bw + bw * 0.25, (h - bh) / 2, bw * 0.5, bh);
  }
  rafId = requestAnimationFrame(drawWave);
}

function tick() {
  if (!recording) return;
  const s = Math.floor((Date.now() - startedAt) / 1000);
  $('timer').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  setTimeout(tick, 500);
}

async function start() {
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
  });
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/transcribe`);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === 'session') sessionId = m.sessionId;
    if (m.type === 'partial') $('live').textContent = m.text;
    if (m.type === 'final') { $('live').textContent = ''; load(); }
  };
  ws.onclose = () => { if (recording) stop(); };
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ type: 'config', language: $('lang').value }));

  ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);

  node = ctx.createScriptProcessor(4096, 1, 1);
  const preRoll = [];
  let speaking = false, quiet = 0;

  node.onaudioprocess = (e) => {
    if (ws.readyState !== 1) return;
    const frame = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const loud = Math.sqrt(sum / frame.length) > VAD_RMS;

    if (loud) {
      if (!speaking) {
        speaking = true;
        for (const b of preRoll) ws.send(b);   // don't clip the first syllable
        preRoll.length = 0;
        setStat('Speaking', 'speech');
      }
      quiet = 0;
      ws.send(toPCM16(frame, ctx.sampleRate));
      return;
    }
    if (speaking) {
      quiet++;
      ws.send(toPCM16(frame, ctx.sampleRate));   // let the server VAD commit
      if (quiet > TAIL_FRAMES) { speaking = false; quiet = 0; setStat('Listening', 'live'); }
      return;
    }
    preRoll.push(toPCM16(frame, ctx.sampleRate));
    if (preRoll.length > PREROLL_FRAMES) preRoll.shift();
  };

  src.connect(node);
  // A ScriptProcessor only fires when connected downstream, but wiring it to
  // the speakers feeds the mic back. Sink it through a muted gain node.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink); sink.connect(ctx.destination);

  recording = true; startedAt = Date.now();
  $('rec').classList.add('on'); $('recLabel').textContent = 'Stop';
  setStat('Listening', 'live');
  tick(); drawWave();
}

function stop() {
  recording = false;
  try { ws.send('flush'); } catch {}
  cancelAnimationFrame(rafId);
  node?.disconnect(); analyser = null; ctx?.close();
  stream?.getTracks().forEach((t) => t.stop());
  setTimeout(() => { try { ws.close(); } catch {} load(); }, 1200);
  $('rec').classList.remove('on'); $('recLabel').textContent = 'Record';
  setStat('Idle'); drawWave();
}

$('rec').onclick = () =>
  recording ? stop() : start().catch((e) => { setStat('Mic blocked'); console.error(e); });
$('lang').onchange = () => {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: 'config', language: $('lang').value }));
};

// ── text to speech ───────────────────────────────────────────────────────────
// Uses the browser's speech synthesis: real voices, adjustable rate and pitch,
// nothing extra to deploy.
const synth = window.speechSynthesis;
let voices = [], speakingId = null;

function loadVoices() {
  voices = synth ? synth.getVoices() : [];
  const sel = $('vsel');
  const want = $('lang').value;
  const ranked = [...voices].sort((a, b) => {
    const am = a.lang.toLowerCase().startsWith(want) ? 0 : 1;
    const bm = b.lang.toLowerCase().startsWith(want) ? 0 : 1;
    return am - bm || a.name.localeCompare(b.name);
  });
  sel.innerHTML = ranked.map((v, i) =>
    `<option value="${esc(v.name)}">${esc(v.name)} · ${esc(v.lang)}</option>`).join('');

  const matches = voices.filter((v) => v.lang.toLowerCase().startsWith(want)).length;
  $('vnote').textContent = voices.length
    ? `${voices.length} system voices available · ${matches} match the selected language.`
    : 'No speech-synthesis voices found in this browser.';
  $('voice').classList.toggle('hidden', !voices.length);
}
if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
$('lang').addEventListener('change', loadVoices);

$('vrate').oninput = (e) => ($('vrateV').textContent = (+e.target.value).toFixed(1) + '×');
$('vpitch').oninput = (e) => ($('vpitchV').textContent = (+e.target.value).toFixed(1));
$('vhead').onclick = () => $('voice').classList.toggle('open');

function speak(text, id, btn) {
  if (!synth) return;
  if (speakingId === id) { synth.cancel(); speakingId = null; btn.classList.remove('on'); return; }
  synth.cancel();
  document.querySelectorAll('.ibtn.play.on').forEach((b) => b.classList.remove('on'));

  const u = new SpeechSynthesisUtterance(text);
  const chosen = voices.find((v) => v.name === $('vsel').value);
  if (chosen) { u.voice = chosen; u.lang = chosen.lang; }
  u.rate = +$('vrate').value;
  u.pitch = +$('vpitch').value;
  u.onend = u.onerror = () => { speakingId = null; btn.classList.remove('on'); };

  speakingId = id; btn.classList.add('on');
  synth.speak(u);
}

// ── history + CRUD ───────────────────────────────────────────────────────────
let items = [];

async function load() {
  items = await (await fetch('/api/transcriptions')).json();
  $('count').textContent = items.length;
  $('empty').style.display = items.length ? 'none' : 'block';
  $('rows').innerHTML = items.map((i) => `
    <div class="row" data-id="${i.id}">
      <div class="row-main">
        <div class="row-text" contenteditable data-field="text">${esc(i.text)}</div>
        <div class="row-meta">
          <span>${esc(i.language) || '—'}</span>
          <span>${(i.durationS ?? 0).toFixed(1)}s</span>
          <span>${i.createdAt ? new Date(i.createdAt).toLocaleTimeString() : ''}</span>
        </div>
      </div>
      <div class="row-acts">
        <button class="ibtn play" data-act="play" title="Play with speech synthesis">▶</button>
        <button class="ibtn" data-act="save" title="Save edit">Save</button>
        <button class="ibtn danger" data-act="del" title="Delete">✕</button>
      </div>
    </div>`).join('');
  if (!sessionId && items.length) sessionId = items[0].sessionId;
}

$('rows').addEventListener('click', async (e) => {
  const btn = e.target.closest('button'); if (!btn) return;
  const row = btn.closest('.row'), id = row.dataset.id;
  const text = row.querySelector('[data-field="text"]').innerText.trim();

  if (btn.dataset.act === 'play') return speak(text, id, btn);
  if (btn.dataset.act === 'del') await fetch(`/api/transcriptions/${id}`, { method: 'DELETE' });
  else if (text) await fetch(`/api/transcriptions/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  });
  load();
});

$('refresh').onclick = load;
$('copyAll').onclick = async () => {
  await navigator.clipboard.writeText(items.map((i) => i.text).reverse().join('\n'));
  $('copyAll').textContent = 'Copied';
  setTimeout(() => ($('copyAll').textContent = 'Copy transcript'), 1400);
};

// ── agent widget ─────────────────────────────────────────────────────────────
let agentEnabled = false, sending = false;
const QUICK = [
  ['Clean up', (s) => `Fetch the transcript for session ${s} and return it cleaned up: fix punctuation and obvious mis-hearings only. Preserve the original language mix and script exactly.`],
  ['Summarize', (s) => `Fetch the transcript for session ${s} and summarise it in 3 bullets, in the same language mix the speaker used.`],
  ['Key points', (s) => `Fetch the transcript for session ${s} and list any decisions, dates or action items mentioned.`],
];

function bubble(role, text) {
  const el = document.createElement('div');
  el.className = 'msg ' + (role === 'user' ? 'u' : 'a');
  el.textContent = text;
  $('wbody').appendChild(el);
  $('wbody').scrollTop = $('wbody').scrollHeight;
}

function greet() {
  $('wbody').innerHTML = '';
  if (!agentEnabled) {
    const off = document.createElement('div');
    off.className = 'off';
    off.innerHTML = 'The agent is not configured.<br><br>Set <code>GOOGLE_GENERATIVE_AI_API_KEY</code> and restart the server. Speech-to-text works regardless.';
    $('wbody').appendChild(off);
    $('wfoot').style.display = 'none';
    return;
  }
  bubble('agent', 'I can clean up, summarise, or answer questions about your transcripts. I never translate — if you spoke Hinglish, it stays Hinglish.');
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  QUICK.forEach(([label, build]) => {
    const b = document.createElement('button');
    b.className = 'qchip'; b.textContent = label;
    b.onclick = () => sessionId
      ? ask(build(sessionId), label)
      : bubble('agent', 'Record something first — there is no session yet.');
    wrap.appendChild(b);
  });
  $('wbody').appendChild(wrap);
}

async function ask(prompt, label) {
  if (sending || !agentEnabled) return;
  sending = true; $('asend').disabled = true;
  bubble('user', label || prompt);

  const holder = document.createElement('div'); holder.className = 'msg a';
  const thought = document.createElement('div'); thought.className = 'thought'; thought.textContent = 'Thinking…';
  const body = document.createElement('div');
  holder.append(thought, body); $('wbody').appendChild(holder);

  const t0 = Date.now();
  try {
    const r = await fetch('/api/agent/ask', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
    });
    const j = await r.json();
    thought.textContent = r.ok ? `Thought for ${((Date.now() - t0) / 1000).toFixed(1)}s` : 'Failed';
    body.textContent = j.answer ?? j.message ?? 'No response.';
    if (r.ok) {
      const row = document.createElement('div'); row.className = 'arow';
      const copy = document.createElement('button'); copy.textContent = '⧉ Copy';
      copy.onclick = () => { navigator.clipboard.writeText(body.textContent); copy.textContent = '✓ Copied'; };
      const again = document.createElement('button'); again.textContent = '↻ Retry';
      again.onclick = () => ask(prompt, label);
      row.append(copy, again); holder.appendChild(row);
    }
  } catch (err) {
    thought.textContent = 'Failed'; body.textContent = err.message;
  } finally {
    sending = false; $('asend').disabled = false;
    $('wbody').scrollTop = $('wbody').scrollHeight;
  }
}

$('fab').onclick = () => {
  $('widget').classList.add('open'); $('fab').classList.add('hidden');
  if (!$('wbody').childElementCount) greet();
  $('ain').focus();
};
$('wclose').onclick = () => { $('widget').classList.remove('open'); $('fab').classList.remove('hidden'); };
$('wmin').onclick = () => $('widget').classList.toggle('min');
$('ain').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('asend').click(); }
});
$('asend').onclick = () => {
  const v = $('ain').value.trim(); if (!v) return;
  $('ain').value = ''; ask(v);
};

fetch('/api/agent/status').then((r) => r.json()).then((s) => (agentEnabled = s.enabled));
addEventListener('resize', drawWave);
drawWave();
load();
