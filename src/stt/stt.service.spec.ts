import { SAMPLE_RATE } from './stream-state';

const URL = 'https://stt.example.test';

/** The module reads env at import time, so it must be re-imported per config. */
function loadService() {
  let mod: typeof import('./stt.service');
  jest.isolateModules(() => {
    mod = require('./stt.service');
  });
  return mod!;
}

function speech(seconds = 1): Float32Array {
  const a = new Float32Array(Math.floor(SAMPLE_RATE * seconds));
  for (let i = 0; i < a.length; i++) a[i] = Math.sin((i / SAMPLE_RATE) * 2 * Math.PI * 220) * 0.5;
  return a;
}

describe('SttService', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    process.env.STT_SERVICE_URL = URL;
    jest.restoreAllMocks();
  });
  afterAll(() => {
    global.fetch = realFetch;
  });

  function mockFetch(impl: jest.Mock) {
    global.fetch = impl as unknown as typeof fetch;
    return impl;
  }

  it('sends audio as PCM16 — half the bytes of Float32', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ text: 'ok', language: 'hi', confidence: 1 }),
    }));
    const { SttService } = loadService();
    const audio = speech(1);
    await new SttService().transcribe(audio, 'hi');

    const body = f.mock.calls[0][1].body as Buffer;
    expect(body.length).toBe(audio.length * 2);
  });

  // Regression: leaving the language unset makes Whisper default to English
  // and *translate* Hindi speech instead of transcribing it.
  it('always sends an explicit language in the query string', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ text: 'x', language: 'hi', confidence: 1 }),
    }));
    const { SttService } = loadService();
    await new SttService().transcribe(speech(1));

    expect(String(f.mock.calls[0][0])).toContain('language=');
  });

  it('passes the caller language through rather than the default', async () => {
    const f = mockFetch(jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ text: 'x', language: 'ta', confidence: 1 }),
    }));
    const { SttService } = loadService();
    await new SttService().transcribe(speech(1), 'ta');

    expect(String(f.mock.calls[0][0])).toContain('language=ta');
  });

  it('skips the network entirely for sub-300ms audio', async () => {
    const f = mockFetch(jest.fn());
    const { SttService } = loadService();
    const r = await new SttService().transcribe(speech(0.1), 'hi');

    expect(f).not.toHaveBeenCalled();
    expect(r.text).toBe('');
  });

  it('returns empty instead of throwing when the service errors', async () => {
    mockFetch(jest.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    const { SttService } = loadService();
    const r = await new SttService().transcribe(speech(1), 'hi');

    expect(r).toEqual({ text: '', language: 'hi', confidence: 0, status: 'unavailable' });
  });

  // The inference service scales to zero and takes ~60s to load the model.
  // A timeout used to come back as an empty transcript, which the UI showed
  // as "no speech was recognised" — sending people to debug their microphone
  // when the real answer was "wait and retry".
  it('reports a timeout as warming, not as silence', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    mockFetch(jest.fn().mockRejectedValue(timeout));
    const { SttService } = loadService();
    const r = await new SttService().transcribe(speech(1), 'hi');

    expect(r.status).toBe('warming');
    expect(r.text).toBe('');
  });

  it('distinguishes an unreachable service from a warming one', async () => {
    mockFetch(jest.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { SttService } = loadService();
    const r = await new SttService().transcribe(speech(1), 'hi');

    expect(r.status).toBe('unavailable');
  });

  it('returns empty instead of throwing when the network fails', async () => {
    mockFetch(jest.fn().mockRejectedValue(new Error('ECONNREFUSED')));
    const { SttService } = loadService();
    const r = await new SttService().transcribe(speech(1), 'hi');

    expect(r.text).toBe('');
  });

  it('reports not-ready after a failure so the UI can surface it', async () => {
    mockFetch(jest.fn().mockRejectedValue(new Error('boom')));
    const { SttService } = loadService();
    const svc = new SttService();
    await svc.transcribe(speech(1), 'hi');

    expect(svc.ready).toBe(false);
  });

  it('is a no-op when STT_SERVICE_URL is unset', async () => {
    delete process.env.STT_SERVICE_URL;
    const f = mockFetch(jest.fn());
    const { SttService } = loadService();
    const r = await new SttService().transcribe(speech(1), 'hi');

    expect(f).not.toHaveBeenCalled();
    expect(r.text).toBe('');
  });

  it('trims whitespace Whisper leaves on its output', async () => {
    mockFetch(jest.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ text: '  मैं कल office जाऊंगा  ', language: 'hi', confidence: 1 }),
    }));
    const { SttService } = loadService();
    const r = await new SttService().transcribe(speech(1), 'hi');

    expect(r.text).toBe('मैं कल office जाऊंगा');
  });
});
