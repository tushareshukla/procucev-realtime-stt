/** Metrics for judging speech-to-text output. No dependencies. */

const norm = (s) =>
  (s || '')
    .toLowerCase()
    .replace(/[।.,!?;:"'`~()\[\]{}<>/\\|@#$%^&*_+=-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Levenshtein over arbitrary token arrays. */
function editDistance(a, b) {
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Word error rate. 0 = perfect, 1 = every word wrong. */
export function wer(reference, hypothesis) {
  const r = norm(reference).split(' ').filter(Boolean);
  const h = norm(hypothesis).split(' ').filter(Boolean);
  if (!r.length) return h.length ? 1 : 0;
  return editDistance(r, h) / r.length;
}

/** Character error rate — fairer than WER for Devanagari, where word breaks vary. */
export function cer(reference, hypothesis) {
  const r = [...norm(reference).replace(/ /g, '')];
  const h = [...norm(hypothesis).replace(/ /g, '')];
  if (!r.length) return h.length ? 1 : 0;
  return editDistance(r, h) / r.length;
}

const DEVANAGARI = /[ऀ-ॿ]/;
const LATIN_WORD = /[a-z]{2,}/i;

/** Which script dominates the output. */
export function script(text) {
  const dev = ([...(text || '')].filter((c) => DEVANAGARI.test(c))).length;
  const lat = ([...(text || '')].filter((c) => /[a-zA-Z]/.test(c))).length;
  if (!dev && !lat) return 'none';
  if (dev && lat) return dev >= lat ? 'devanagari' : 'latin';
  return dev ? 'devanagari' : 'latin';
}

/**
 * Detect the failure where Whisper translated instead of transcribing: Hindi
 * speech comes back as fluent Latin-script English with no Devanagari at all.
 */
export function looksTranslated(text, expectedScript = 'devanagari') {
  if (!text) return false;
  // Only meaningful when we expected a non-Latin script: fluent Latin-script
  // output where Devanagari was expected means Whisper translated instead of
  // transcribing. English output for an English case is not a translation.
  if (expectedScript !== 'devanagari') return false;
  const hasDev = DEVANAGARI.test(text);
  const latinWords = (text.match(/[a-zA-Z]{2,}/g) || []).length;
  return !hasDev && latinWords >= 3;
}

/**
 * Detect repeated-token degeneration ("करुँँँँँ…" / "the the the …").
 * Returns the longest run of an immediately repeating unit.
 */
export function repetitionRun(text) {
  if (!text) return 0;
  let maxChar = 1, run = 1;
  for (let i = 1; i < text.length; i++) {
    run = text[i] === text[i - 1] ? run + 1 : 1;
    if (run > maxChar) maxChar = run;
  }
  const words = norm(text).split(' ').filter(Boolean);
  let maxWord = words.length ? 1 : 0, wrun = 1;
  for (let i = 1; i < words.length; i++) {
    wrun = words[i] === words[i - 1] ? wrun + 1 : 1;
    if (wrun > maxWord) maxWord = wrun;
  }
  return Math.max(maxChar, maxWord * 4);
}

export const REPETITION_THRESHOLD = 12;
