import type { DocumentShare } from '@firmivra/types';

/** "View · Download · Upload": viewing comes with every grant. */
export function permissionText(s: Pick<DocumentShare, 'canDownload' | 'canUpload' | 'canSign'>) {
  return ['View', s.canDownload && 'Download', s.canUpload && 'Upload', s.canSign && 'Sign']
    .filter(Boolean)
    .join(' · ');
}

/** YYYY-MM-DD, `days` from `from` in the viewer's time zone. */
export function dayAfter(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A share ends at the end of its chosen day. */
export const expiryOf = (day: string) => (day ? new Date(`${day}T23:59:59`).toISOString() : null);

/** The end of a share as a day for the date field. */
export function dayOf(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const sizeText = (bytes: number) =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/** Whether this person already has live access (one grant each: the API's SHARE_EXISTS). */
export const hasAccess = (
  shares: readonly DocumentShare[],
  kind: 'CLIENT' | 'MEMBER',
  id: string,
) => shares.some((s) => s.recipient.kind === kind && s.recipient.id === id);
