/**
 * Language state.
 *
 * There is no language picker in the UI. For text-to-speech the language is
 * implied by what you type — Devanagari means Hindi, Latin means English — and
 * the example prompts each carry their own. For speech-to-text it is chosen
 * explicitly, because audio carries no script to inspect.
 */
const listeners = new Set();
let current = 'en';

export function getLanguage() {
  return current;
}

export function setLanguage(code) {
  if (!code || code === current) return;
  current = code;
  for (const fn of listeners) fn(current);
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SCRIPTS = [
  [/[ऀ-ॿ]/, 'hi'],   // Devanagari — Hindi, Marathi
  [/[ঀ-৿]/, 'bn'],   // Bengali
  [/[஀-௿]/, 'ta'],   // Tamil
  [/[ఀ-౿]/, 'te'],   // Telugu
  [/[઀-૿]/, 'gu'],   // Gujarati
  [/[؀-ۿ]/, 'ar'],   // Arabic
  [/[一-鿿]/, 'zh'],   // Han
  [/[぀-ヿ]/, 'ja'],   // Kana
];

/**
 * Infer language from the script the text is written in.
 *
 * Code-mixed input (Hinglish) contains both scripts; the non-Latin one wins,
 * because that is the language whose model can read both.
 */
export function detectLanguage(text, fallback = 'en') {
  if (!text) return fallback;
  for (const [re, code] of SCRIPTS) if (re.test(text)) return code;
  return /[a-zA-Z]/.test(text) ? 'en' : fallback;
}
