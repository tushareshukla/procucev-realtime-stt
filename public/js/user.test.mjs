import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal localStorage stand-in so the module can be tested outside a browser.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const { getUser, setUser, clearUser, ensureUser } = await import('./user.js');

describe('user', () => {
  beforeEach(() => store.clear());

  test('no name initially', () => assert.equal(getUser(), ''));

  test('stores and returns a trimmed name', () => {
    assert.equal(setUser('  Tushar  '), 'Tushar');
    assert.equal(getUser(), 'Tushar');
  });

  test('ignores an empty name', () => {
    assert.equal(setUser('   '), '');
    assert.equal(getUser(), '');
  });

  test('caps absurdly long names to the column width', () => {
    assert.equal(setUser('x'.repeat(200)).length, 80);
  });

  test('clears', () => {
    setUser('Tushar'); clearUser();
    assert.equal(getUser(), '');
  });

  test('ensureUser skips the prompt when a name is known', async () => {
    setUser('Tushar');
    let prompted = false;
    const name = await ensureUser({ onPrompt: () => { prompted = true; } });
    assert.equal(name, 'Tushar');
    assert.equal(prompted, false);
  });

  test('ensureUser prompts when no name is stored', async () => {
    const name = await ensureUser({ onPrompt: (done) => done('Asha') });
    assert.equal(name, 'Asha');
    assert.equal(getUser(), 'Asha');
  });
});
