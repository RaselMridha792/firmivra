import type { ClientPortalAccess, PortalInvitation } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { blockText, invitationLine } from './portal-invitation-parts';

const CLIENT = '0199c0f1-a220-7000-8000-000000000001';
const access = (invitation: Partial<PortalInvitation> | null): ClientPortalAccess => ({
  clientId: CLIENT,
  clientName: 'Fake Client',
  recipient: { name: 'Fake Client', email: 'fake@example.test' },
  logins: [],
  blocked: null,
  invitation: invitation && {
    id: '0199c0f1-a221-7000-8000-000000000001',
    sentAt: '2026-10-20T12:00:00.000Z',
    sentBy: 'Fake Member',
    expiresAt: '2026-10-27T12:00:00.000Z',
    delivered: true,
    revokedAt: null,
    state: 'OPEN',
    ...invitation,
  },
});

describe('invitationLine', () => {
  it('says nothing before the first invitation', () => {
    expect(invitationLine(access(null))).toBeNull();
  });

  it('names who sent it and what became of the link', () => {
    expect(invitationLine(access({}))).toEqual({
      text: 'Invitation sent Oct 20, 2026 by Fake Member. The link works until Oct 27, 2026.',
      tone: 'warning',
    });
    expect(invitationLine(access({ state: 'ACCEPTED' }))?.tone).toBe('success');
    expect(invitationLine(access({ state: 'EXPIRED' }))?.text).toContain('expired Oct 27, 2026');
    expect(
      invitationLine(access({ state: 'REVOKED', revokedAt: '2026-10-21T12:00:00.000Z' }))?.text,
    ).toContain('Revoked Oct 21, 2026');
    expect(invitationLine(access({ state: 'NOT_SENT', delivered: false }))).toEqual({
      text: 'Invitation of Oct 20, 2026 could not be emailed. Try again.',
      tone: 'danger',
    });
    expect(invitationLine(access({ sentBy: null }))?.text).toMatch(
      /^Invitation sent Oct 20, 2026\./,
    );
  });
});

describe('blockText', () => {
  it('points to where each block is fixed', () => {
    expect(blockText('NO_EMAIL', CLIENT).link?.href).toBe(`/clients/${CLIENT}`);
    expect(blockText('SIGN_UP_WAITING', CLIENT).link?.href).toBe('/sign-ups');
    for (const block of ['HAS_LOGIN', 'ARCHIVED', 'DAILY_LIMIT'] as const) {
      expect(blockText(block, CLIENT).link).toBeUndefined();
    }
  });
});
