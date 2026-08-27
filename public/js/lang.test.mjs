import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, getLanguage, setLanguage, onLanguageChange } from './lang.js';

describe('detectLanguage', () => {
  test('English text', () => assert.equal(detectLanguage('Hello there'), 'en'));
  test('Hindi text', () => assert.equal(detectLanguage('नमस्ते दुनिया'), 'hi'));

  // The whole point for this product: Hinglish must route to the Hindi model,
  // which reads both scripts, not the English one which reads only Latin.
  test('code-mixed Hinglish resolves to Hindi', () => {
    assert.equal(detectLanguage('मैं कल office जाऊंगा'), 'hi');
  });

  test('other scripts', () => {
    assert.equal(detectLanguage('আমি ভালো আছি'), 'bn');
    assert.equal(detectLanguage('こんにちは'), 'ja');
    assert.equal(detectLanguage('مرحبا بالعالم'), 'ar');
  });

  test('empty or symbol-only text falls back', () => {
    assert.equal(detectLanguage(''), 'en');
    assert.equal(detectLanguage('123 !!!', 'hi'), 'hi');
  });
});

describe('language state', () => {
  test('defaults to English', () => assert.equal(getLanguage(), 'en'));

  test('set and read back', () => {
    setLanguage('hi');
    assert.equal(getLanguage(), 'hi');
    setLanguage('en');
  });

  test('notifies subscribers only on an actual change', () => {
    let calls = 0;
    const off = onLanguageChange(() => calls++);
    setLanguage('ta');
    setLanguage('ta');   // same value — must not re-notify
    assert.equal(calls, 1);
    off();
    setLanguage('en');
    assert.equal(calls, 1, 'unsubscribed listener must stop firing');
  });
});
