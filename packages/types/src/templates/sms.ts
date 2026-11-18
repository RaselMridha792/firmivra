// Templates Review Two R02: how many text-message parts a message takes, as carriers count it,
// for the template editor, the Communications composer, the mock and the API alike.
//  - A message of only GSM-7 characters is counted in septets: one per character of the basic
//    set, two for an extension character (^ { } \ [ ~ ] | € and form feed, sent as an escape
//    plus the character). 160 septets fit one text; a longer message is split into parts of 153.
//  - Any other character (an accented letter outside the set, Chinese, an emoji) sends the whole
//    message as Unicode (UCS-2), counted in UTF-16 units (an emoji is two): 70 fit one text; a
//    longer message is split into parts of 67.
// Parts fill in order and never split an escape pair or an emoji. No delivery or billing claim:
// a carrier or provider may still count differently.

/** The GSM 03.38 basic set (one septet each). */
const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
/** The GSM 03.38 extension table (two septets each). */
const GSM_EXTENDED = new Set('^{}\\[~]|€\f');

export type SmsEncoding = 'GSM_7' | 'UCS_2';

export interface SmsSegments {
  /** The characters a person counts (an emoji is one). */
  characters: number;
  /** What the carrier counts: septets for GSM-7, UTF-16 units for Unicode. */
  units: number;
  encoding: SmsEncoding;
  /** 0 for an empty message. */
  parts: number;
}

export function smsSegments(text: string): SmsSegments {
  const chars = [...text];
  const gsm = chars.every((c) => GSM_BASIC.has(c) || GSM_EXTENDED.has(c));
  const encoding: SmsEncoding = gsm ? 'GSM_7' : 'UCS_2';
  const cost = (c: string) => (gsm ? (GSM_EXTENDED.has(c) ? 2 : 1) : c.length);
  const units = chars.reduce((n, c) => n + cost(c), 0);
  if (units === 0) return { characters: 0, units: 0, encoding, parts: 0 };
  if (units <= (gsm ? 160 : 70)) return { characters: chars.length, units, encoding, parts: 1 };
  const perPart = gsm ? 153 : 67;
  let parts = 1;
  let used = 0;
  for (const c of chars) {
    const k = cost(c);
    if (used + k > perPart) {
      parts += 1;
      used = 0;
    }
    used += k;
  }
  return { characters: chars.length, units, encoding, parts };
}

/** "160 characters · 1 text part" and the encoding's limits, for the editors' counters. */
export function smsCountText(text: string): string {
  const s = smsSegments(text);
  const parts = Math.max(1, s.parts);
  const limits =
    s.encoding === 'GSM_7'
      ? 'standard characters: 160 per text, 153 per part once split'
      : 'special characters: 70 per text, 67 per part once split';
  return `${s.characters} characters · ${parts} text ${parts === 1 ? 'part' : 'parts'} (${limits})`;
}
