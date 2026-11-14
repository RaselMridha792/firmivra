// Clients Review 2 (G10): a ZIP code's first three digits name its state (USPS sectional
// centers). A static table, no lookup service: a ZIP that doesn't match the state is a soft
// warning, never a block, and a prefix the table doesn't know is "can't verify", kept apart from
// an invalid ZIP (the API's 5-digit or ZIP+4 rule). Military (AA, AE, AP) and territory prefixes
// are listed so they don't read as wrong.

/** [first prefix, last prefix, state or states]; ranges in order, both ends included. */
const RANGES: [number, number, string][] = [
  [5, 5, 'NY'],
  [6, 7, 'PR'],
  [8, 8, 'VI'],
  [9, 9, 'PR'],
  [10, 27, 'MA'],
  [28, 29, 'RI'],
  [30, 38, 'NH'],
  [39, 49, 'ME'],
  [50, 54, 'VT'],
  [55, 55, 'MA'],
  [56, 59, 'VT'],
  [60, 69, 'CT'],
  [70, 89, 'NJ'],
  [90, 99, 'AE'],
  [100, 149, 'NY'],
  [150, 196, 'PA'],
  [197, 199, 'DE'],
  [200, 200, 'DC'],
  [201, 201, 'VA'],
  [202, 205, 'DC'],
  [206, 219, 'MD'],
  [220, 246, 'VA'],
  [247, 268, 'WV'],
  [270, 289, 'NC'],
  [290, 299, 'SC'],
  [300, 319, 'GA'],
  [320, 339, 'FL'],
  [340, 340, 'AA'],
  [341, 349, 'FL'],
  [350, 369, 'AL'],
  [370, 385, 'TN'],
  [386, 397, 'MS'],
  [398, 399, 'GA'],
  [400, 427, 'KY'],
  [430, 459, 'OH'],
  [460, 479, 'IN'],
  [480, 499, 'MI'],
  [500, 528, 'IA'],
  [530, 549, 'WI'],
  [550, 567, 'MN'],
  [569, 569, 'DC'],
  [570, 577, 'SD'],
  [580, 588, 'ND'],
  [590, 599, 'MT'],
  [600, 629, 'IL'],
  [630, 658, 'MO'],
  [660, 679, 'KS'],
  [680, 693, 'NE'],
  [700, 714, 'LA'],
  [716, 729, 'AR'],
  [730, 732, 'OK'],
  [733, 733, 'TX'],
  [734, 749, 'OK'],
  [750, 799, 'TX'],
  [800, 816, 'CO'],
  [820, 831, 'WY'],
  [832, 838, 'ID'],
  [840, 847, 'UT'],
  [850, 865, 'AZ'],
  [870, 884, 'NM'],
  [885, 885, 'TX'],
  [889, 898, 'NV'],
  [900, 961, 'CA'],
  [962, 966, 'AP'],
  [967, 968, 'HI'],
  [969, 969, 'GU MP AS'],
  [970, 979, 'OR'],
  [980, 994, 'WA'],
  [995, 999, 'AK'],
];

/** The states a ZIP's prefix belongs to; null when the table doesn't know it. */
export function statesForZip(zip: string): string[] | null {
  const prefix = Number(zip.trim().slice(0, 3));
  if (!/^\d{3}/.test(zip.trim()) || Number.isNaN(prefix)) return null;
  const hit = RANGES.find(([from, to]) => prefix >= from && prefix <= to);
  return hit ? hit[2].split(' ') : null;
}

/**
 * The soft warning under the address, or undefined: nothing until the ZIP has the API's shape
 * and a two-letter state is chosen.
 */
export function zipStateWarning(zip: string, state: string): string | undefined {
  const z = zip.trim();
  const s = state.trim().toUpperCase();
  if (!/^\d{5}(-\d{4})?$/.test(z) || !/^[A-Z]{2}$/.test(s)) return undefined;
  const states = statesForZip(z);
  if (!states) return `We can't verify ZIP code ${z}. Check it before saving.`;
  if (states.includes(s)) return undefined;
  return `ZIP code ${z} is usually in ${states.join(' or ')}, not ${s}. Check the state and ZIP code; you can still save.`;
}
