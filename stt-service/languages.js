/**
 * UI language codes -> BCP-47 tags for Google Speech-to-Text.
 *
 * Indian locales are chosen deliberately: hi-IN and en-IN handle Indian accents
 * and Hinglish code-switching far better than the generic tags.
 */
export const BCP47 = {
  en: 'en-US', 'en-in': 'en-IN',
  hi: 'hi-IN', bn: 'bn-IN', ta: 'ta-IN', te: 'te-IN',
  mr: 'mr-IN', gu: 'gu-IN', kn: 'kn-IN', ml: 'ml-IN', pa: 'pa-Guru-IN',
  ur: 'ur-PK', es: 'es-US', fr: 'fr-FR', de: 'de-DE',
  zh: 'cmn-Hans-CN', ja: 'ja-JP', ko: 'ko-KR', ar: 'ar-EG',
  pt: 'pt-BR', ru: 'ru-RU', it: 'it-IT', nl: 'nl-NL', tr: 'tr-TR',
};

/**
 * Voice selection note: Piper voices declare a phoneme_type. Only `espeak`
 * voices work without extra phonemizers, so zh uses huayan (espeak) rather
 * than chaowen (pinyin). Japanese has one voice and it needs the [ja] extra,
 * which the image installs.
 */
export function toBcp47(code) {
  if (!code) return BCP47.en;
  const k = String(code).toLowerCase();
  if (BCP47[k]) return BCP47[k];
  // Already a full tag such as "hi-IN".
  return k.includes('-') ? code : BCP47.en;
}
