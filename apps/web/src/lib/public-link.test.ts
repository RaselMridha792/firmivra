import { describe, expect, it } from 'vitest';
import { publicLinkText } from './public-link';

describe('publicLinkText (R56)', () => {
  it('labels each kind for its button', () => {
    expect(publicLinkText('APPOINTMENT_TYPE', 'LIVE')).toMatchObject({
      title: 'Booking Link',
      copyLinkLabel: 'Copy Booking Link',
      copyEmbedLabel: 'Copy Embed Code',
      notice: undefined,
    });
    expect(publicLinkText('INTAKE_FORM', 'LIVE').copyLinkLabel).toBe('Copy Form Link');
    expect(publicLinkText('PACKAGE', 'LIVE').copyLinkLabel).toBe('Copy Booking Link');
  });

  it('says why a link takes no new use, in the item’s words', () => {
    expect(publicLinkText('APPOINTMENT_TYPE', 'ARCHIVED').notice).toBe(
      'This appointment type is archived. The link stays the same, but it takes no new bookings until the appointment type is restored.',
    );
    expect(publicLinkText('PACKAGE', 'INACTIVE').notice).toContain(
      'until the package is active again',
    );
    expect(publicLinkText('INTAKE_FORM', 'DRAFT').notice).toBe(
      'This form is a draft. The link takes no submissions until it is published.',
    );
    expect(publicLinkText('PACKAGE', 'HIDDEN').notice).toContain('hidden from clients');
  });

  it('has a quiet line for an item with no link yet', () => {
    const text = publicLinkText('INTAKE_FORM', null);
    expect(text.notice).toBeUndefined();
    expect(text.emptyText).toBe('The form link appears here once the form is published.');
  });
});
