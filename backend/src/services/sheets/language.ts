export type Lang = 'kk' | 'ru';

// Letters that exist in Kazakh Cyrillic but not in Russian.
const KAZAKH_ONLY = /[әғқңөұүһі]/i;

/** Kazakh if any message has a Kazakh-only letter, otherwise Russian (the clinic's default). */
export function detectLang(texts: string[]): Lang {
  return texts.some((t) => KAZAKH_ONLY.test(t)) ? 'kk' : 'ru';
}
