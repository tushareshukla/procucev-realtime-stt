import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let calls = [];
let sessionName = null;
globalThis.fetch = async (url, opts = {}) => {
  calls.push({ url, method: opts.method ?? 'GET' });
  if (opts.method === 'POST') {
    sessionName = JSON.parse(opts.body).name;
    return { ok: true, json: async () => ({ userName: sessionName }) };
  }
  return { ok: true, json: async () => ({ userName: sessionName }) };
};

const { getUser, setUser, loadUser, ensureUser } = await import('./user.js');

describe('user identity via server session', () => {
  beforeEach(() => { calls = []; sessionName = null; });

  test('asks the server rather than reading browser storage', async () => {
    await loadUser();
    assert.equal(calls[0].url, '/api/session');
    assert.equal(calls[0].method, 'GET');
  });

  test('starting a session posts the name and returns it', async () => {
    assert.equal(await setUser('  Tushar  '), 'Tushar');
    assert.equal(getUser(), 'Tushar');
    assert.equal(calls.at(-1).method, 'POST');
  });

  test('an empty name never reaches the server', async () => {
    assert.equal(await setUser('   '), '');
    assert.equal(calls.length, 0);
  });

  test('ensureUser skips the prompt when the server knows us', async () => {
    sessionName = 'Asha';
    let prompted = false;
    assert.equal(await ensureUser({ onPrompt: () => { prompted = true; } }), 'Asha');
    assert.equal(prompted, false);
  });

  // The point of moving off localStorage: a reload re-reads the session, so
  // history survives refresh without the page holding identity itself.
  test('ensureUser prompts when the server has no session', async () => {
    sessionName = null;
    const name = await ensureUser({ onPrompt: (done) => done('Ravi') });
    assert.equal(name, 'Ravi');
    assert.equal(getUser(), 'Ravi');
  });
});
