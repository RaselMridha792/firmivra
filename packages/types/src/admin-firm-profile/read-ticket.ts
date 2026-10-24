import {
  PROFILE_CHANGE_FIELDS,
  PROFILE_CHANGE_KIND_LABELS,
  type ProfileChangeField,
  type ProfileChangeKind,
} from '../settings/profile-changes.js';

/** What a Request Change ticket asks, read back from the text R60's API writes. */
export interface RequestedProfileChange {
  kind: ProfileChangeKind;
  /** The fields asked about, in the cards' order. */
  fields: ProfileChangeField[];
  /** As the ticket shows them ("Not on file", "Ending in 6789"). */
  current: Partial<Record<ProfileChangeField, string>>;
  /** The proposed values as written (an EIN as "98-7654321"). */
  proposed: Partial<Record<ProfileChangeField, string>>;
  reason: string | null;
}

const FIELDS = Object.keys(PROFILE_CHANGE_FIELDS) as ProfileChangeField[];
const KINDS = Object.keys(PROFILE_CHANGE_KIND_LABELS) as ProfileChangeKind[];
const prefixOf = (kind: ProfileChangeKind) =>
  `${PROFILE_CHANGE_KIND_LABELS[kind]} change request: `;
const CLOSING = "Nothing on the firm's profile changes until Firmivra applies it.";

/**
 * A Company Profile Request Change (R60, `profile-changes.service.ts`): the subject names the card
 * and the fields ("Company Information change request: Legal Company Name, EIN (Tax ID)"); the
 * description has, per field, its label, then "Current: …" and "Proposed: …", then "Reason:" and
 * the reason. Null for any other ticket. A field whose lines are missing keeps no values, so the
 * Super Admin enters them.
 */
export function readProfileChangeTicket(
  subject: string,
  description: string,
): RequestedProfileChange | null {
  const kind = KINDS.find((k) => subject.startsWith(prefixOf(k)));
  if (!kind) return null;
  const labels = new Set(subject.slice(prefixOf(kind).length).split(', '));
  const fields = FIELDS.filter(
    (f) => PROFILE_CHANGE_FIELDS[f].kind === kind && labels.has(PROFILE_CHANGE_FIELDS[f].label),
  );
  if (!fields.length) return null;

  const lines = description.replace(/\r\n/g, '\n').split('\n');
  const current: RequestedProfileChange['current'] = {};
  const proposed: RequestedProfileChange['proposed'] = {};
  for (const field of fields) {
    const at = lines.indexOf(PROFILE_CHANGE_FIELDS[field].label);
    if (at < 0) continue;
    const now = lines[at + 1];
    const next = lines[at + 2];
    if (now?.startsWith('Current: ')) current[field] = now.slice('Current: '.length);
    if (next?.startsWith('Proposed: ')) proposed[field] = next.slice('Proposed: '.length);
  }
  const start = lines.lastIndexOf('Reason:');
  let reason: string | null = null;
  if (start >= 0) {
    const rest = lines.slice(start + 1);
    const end = rest.lastIndexOf(CLOSING);
    reason = (end >= 0 ? rest.slice(0, end) : rest).join('\n').trim() || null;
  }
  return { kind, fields, current, proposed, reason };
}
