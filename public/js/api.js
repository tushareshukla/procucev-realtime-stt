/** Thin REST client. Every network call to our own backend lives here. */

async function json(url, options) {
  // Same-origin credentials so the session cookie travels with every call.
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  if (!res.ok) throw new Error(`${options?.method ?? 'GET'} ${url} → ${res.status}`);
  return res.status === 204 ? null : res.json();
}

export const api = {
  // No user parameter: the server resolves identity from the session cookie,
  // so a client cannot request someone else's history.
  listTranscriptions: () => json('/api/transcriptions'),
  transcribeRecording: (body) =>
    json('/api/transcriptions/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  createTranscription: (body) =>
    json('/api/transcriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  updateTranscription: (id, text) =>
    json(`/api/transcriptions/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }),
  deleteTranscription: (id) => json(`/api/transcriptions/${id}`, { method: 'DELETE' }),

  agentStatus: () => json('/api/agent/status'),
  agentAsk: (prompt) =>
    json('/api/agent/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
    }),

  /** Streaming synthesis — returns the raw Response for readWavStream(). */
  speakStream: (body) =>
    fetch('/api/tts/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),

  /** Returns a WAV blob synthesised by the open-source TTS models. */
  async speak({ text, language, voice, speed }) {
    const res = await fetch('/api/tts/speak', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language, voice, speed }),
    });
    if (!res.ok) throw new Error(`speak → ${res.status}`);
    return res.blob();
  },
};
