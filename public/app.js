import { api } from './js/api.js';

'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => (s || '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// ── voice-activity gate ──────────────────────────────────────────────────────
// Gating matters (an open mic otherwise streams ~32KB/s of silence and bills an
// inference call per silent second) but a fixed threshold is wrong: microphone
// gain varies enormously, and with echoCancellation/noiseSuppression enabled a
// normal voice can sit below a hardcoded cutoff, so nothing is ever sent.
//
// Instead: measure the ambient noise floor for the first second, then trigger
// on a multiple of it, clamped into a sane range.
const NOISE_CALIBRATION_MS = 900;
const TRIGGER_MULTIPLE = 2.5;   // speech is well above room tone
const MIN_THRESHOLD = 0.004;    // never so low that silence trips it
const MAX_THRESHOLD = 0.030;    // never so high that a quiet voice is ignored
const TAIL_FRAMES = 12;         // ~1s of audio kept after speech stops
const PREROLL_FRAMES = 8;       // ~700ms captured before speech is detected

let ws, ctx, node, stream, analyser, rafId, startedAt;
let level = 0;   // live input RMS, surfaced in the UI
let recording = false, sessionId = null;

// ── recorder ─────────────────────────────────────────────────────────────────
function setStat(text, mode) {
  $('stat').textContent = text;
  const d = $('dot');
  d.className = 'dot' + (mode ? ' ' + mode : '');
}

/**
 * Float32 -> 16kHz PCM16.
 *
 * When the AudioContext already runs at 16kHz the browser has resampled
 * properly and this is a straight conversion. Otherwise we average each source
 * window rather than picking one sample: naive decimation aliases everything
 * above 8kHz back down into the speech band, which measurably degrades
 * recognition — it was the cause of "audio is not clear".
 */
function toPCM16(f32, inRate) {
  const clamp = (v) => (v < 0 ? Math.max(-1, v) * 0x8000 : Math.min(1, v) * 0x7fff);

  if (inRate === 16000) {
    const out = new Int16Array(f32.length);
    for (let i = 0; i < f32.length; i++) out[i] = clamp(f32[i]);
    return out.buffer;
  }

  const ratio = inRate / 16000;
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

  // Reflect input level on the meter — a flat bar means the mic is not
  // delivering audio, which is otherwise indistinguishable from "not speaking".
  const fill = $('meterFill');
  if (fill) {
    const pctv = Math.min(100, (level / 0.05) * 100);
    fill.style.width = pctv.toFixed(0) + '%';
    fill.classList.toggle('hot', pctv > 45);
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

  // Request 16kHz directly: the browser resamples far better than we can in a
  // ScriptProcessor. Falls back to averaged decimation if it declines.
  try {
    ctx = new AudioContext({ sampleRate: 16000 });
  } catch {
    ctx = new AudioContext();
  }
  console.info(`[audio] context sampleRate=${ctx.sampleRate}`);
  const src = ctx.createMediaStreamSource(stream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);

  node = ctx.createScriptProcessor(4096, 1, 1);
  const preRoll = [];
  let speaking = false, quiet = 0;
  let noiseFloor = 0, calibrationFrames = 0, threshold = MIN_THRESHOLD;
  const framesToCalibrate = Math.ceil((NOISE_CALIBRATION_MS / 1000) * ctx.sampleRate / 4096);
  let sawSpeech = false, framesSinceStart = 0;

  node.onaudioprocess = (e) => {
    if (ws.readyState !== 1) return;
    const frame = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    framesSinceStart++;

    // Always show the live input level, so a dead mic is visible immediately
    // rather than looking like the app is broken.
    level = rms;

    if (calibrationFrames < framesToCalibrate) {
      noiseFloor = (noiseFloor * calibrationFrames + rms) / (calibrationFrames + 1);
      calibrationFrames++;
      if (calibrationFrames === framesToCalibrate) {
        threshold = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, noiseFloor * TRIGGER_MULTIPLE));
        console.info(`[vad] noise floor ${noiseFloor.toFixed(5)} → threshold ${threshold.toFixed(5)}`);
        setStat('Listening', 'live');
      } else {
        setStat('Calibrating mic…', 'live');
      }
      preRoll.push(toPCM16(frame, ctx.sampleRate));
      if (preRoll.length > PREROLL_FRAMES) preRoll.shift();
      return;
    }

    const loud = rms > threshold;

    if (loud) {
      if (!speaking) {
        speaking = true; sawSpeech = true;
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

    // Nothing has ever tripped the gate — say so instead of sitting silent.
    if (!sawSpeech && framesSinceStart > framesToCalibrate + 90) {
      setStat('No speech detected — check mic input', 'live');
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
  level = 0;
  const f = $('meterFill'); if (f) { f.style.width = '0%'; f.classList.remove('hot'); }
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
// Audio comes from the open-source models running in our own inference
// service: Kokoro-82M (Apache-2.0) for English, Piper (MIT) for Hindi and
// other languages. Deliberately not the browser's built-in voices, which are
// proprietary and vary by operating system.
let voices = [], playingId = null, audioEl = null;

async function loadVoices() {
  const lang = $('lang').value;
  try {
    const { voices: list, engine } = await api.listVoices(lang);
    voices = list || [];
    $('vsel').innerHTML = voices
      .map((v) => `<option value="${esc(v.id)}">${esc(v.name || v.id)}${v.gender ? ' · ' + esc(v.gender) : ''}</option>`)
      .join('');
    $('vnote').textContent = voices.length
      ? `${voices.length} voices via ${engine} (open source), synthesised server-side.`
      : `No voices available for "${lang}" yet.`;
    $('voice').classList.toggle('hidden', !voices.length);
  } catch {
    $('vnote').textContent = 'Voice list unavailable.';
    $('voice').classList.add('hidden');
  }
}

async function speak(text, id, btn) {
  if (playingId === id) return stopSpeaking(btn);
  stopSpeaking();

  playingId = id;
  btn.classList.add('on');
  btn.textContent = '⋯';
  try {
    const blob = await api.speak({
      text,
      language: $('lang').value,
      voice: $('vsel').value || undefined,
      speed: Number($('vrate').value) || 1,
    });
    if (playingId !== id) return;                 // superseded while synthesising
    audioEl = new Audio(URL.createObjectURL(blob));
    audioEl.onended = audioEl.onerror = () => stopSpeaking(btn);
    btn.textContent = '■';
    await audioEl.play();
  } catch (err) {
    console.error('[tts]', err);
    $('vnote').textContent = `Playback failed: ${err.message}`;
    stopSpeaking(btn);
  }
}

function stopSpeaking(btn) {
  if (audioEl) { audioEl.pause(); audioEl = null; }
  playingId = null;
  document.querySelectorAll('.ibtn.play').forEach((b) => {
    b.classList.remove('on');
    b.textContent = '▶';
  });
  if (btn) { btn.classList.remove('on'); btn.textContent = '▶'; }
}

$('vrate').oninput = (e) => ($('vrateV').textContent = (+e.target.value).toFixed(1) + '×');
$('vhead').onclick = () => $('voice').classList.toggle('open');
$('lang').addEventListener('change', loadVoices);
loadVoices();

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


// History reloads automatically after each committed segment; the manual
// Refresh and Copy controls were removed as redundant.
addEventListener('resize', drawWave);
drawWave();
load();
