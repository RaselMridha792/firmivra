import { describe, expect, it } from 'vitest';
import { MESSAGE_ERRORS, recipientOf, sendSummary } from './lead-message';

// Octavia's Leads review, item 9: the composer says what happened, never "Something went wrong".
const lead = (id: string, phone: string | null) =>
  recipientOf({ id, firstName: 'Fake', lastName: `Lead ${id}`, email: `${id}@leads.test`, phone });

describe('sendSummary', () => {
  it('counts what went, who had no number and what could not be sent', () => {
    const people = [lead('a', '+15555550101'), lead('b', null), lead('c', '+15555550103')];
    expect(sendSummary({ changed: 2, skipped: 1 }, people, 'SMS')).toBe(
      'Text sent to 2 leads. 1 without a saved phone number was left out.',
    );
    expect(sendSummary({ changed: 1, skipped: 2 }, people, 'SMS')).toBe(
      'Text sent to 1 lead. 1 without a saved phone number was left out. 1 could not be sent (no longer available to you, or the provider refused it); try again later.',
    );
    expect(sendSummary({ changed: 0, skipped: 1 }, [lead('a', '1')], 'EMAIL')).toBe(
      'Email not sent. 1 could not be sent (no longer available to you, or the provider refused it); try again later.',
    );
  });

  it('names the lead and says plainly when texts are not set up', () => {
    expect(lead('x', null).name).toBe('Fake Lead x');
    expect(MESSAGE_ERRORS['SMS_UNAVAILABLE']).toMatch(/not set up for this firm yet/);
  });
});
