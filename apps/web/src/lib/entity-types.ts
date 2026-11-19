/**
 * The business entity types a client's profile and an advisory plan offer (Business Advisory B6,
 * A-NEW1). Free text in the API: a stored value outside the list is kept, and opens as Other with
 * its text in Specify.
 */
export const ENTITY_TYPES = [
  'Sole Proprietorship',
  'LLC',
  'S Corporation',
  'C Corporation',
  'Partnership',
  'Professional Corporation',
  'Nonprofit',
  'Other',
];

/**
 * Octavia's B6: Other takes a "specify" text, and that text is what is saved. A saved value outside
 * the list opens as Other with its text in the box.
 */
export const splitOther = (list: string[], stored: string | null | undefined) =>
  !stored
    ? { choice: '', other: '' }
    : list.includes(stored) && stored !== 'Other'
      ? { choice: stored, other: '' }
      : { choice: 'Other', other: stored === 'Other' ? '' : stored };

/** The value saved: the choice, or the Specify text for Other. */
export const joinOther = (choice: string, other: string) => (choice === 'Other' ? other : choice);
