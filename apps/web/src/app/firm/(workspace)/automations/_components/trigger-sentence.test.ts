// AU-F04 (Octavia's Oct 28 review): the trigger step says in words when a rule runs, with an
// example from now in the firm's time zone, and updates as the timing changes.
import { describe, expect, it } from 'vitest';
import { triggerSentence } from './trigger-sentence';

const due = { anchor: 'the due date', example: 'When an open invoice is past its due date' };
const change = { anchor: 'it happens', example: 'When a client is archived' };
// Thursday, Nov 5, 2026, 19:00 UTC: 2:00 PM in New York.
const now = new Date('2026-11-05T19:00:00Z');
const zone = 'America/New_York';

describe('triggerSentence', () => {
  it('says when the rule runs and gives an example in the firm’s time zone', () => {
    expect(
      triggerSentence(due, { timing: 'AFTER', offsetValue: '3', offsetUnit: 'DAY' }, zone, now),
    ).toBe(
      'Runs 3 days after the due date. For example, if the due date is Nov 5, 2:00 PM, it runs Nov 8, 2:00 PM.',
    );
    expect(
      triggerSentence(due, { timing: 'BEFORE', offsetValue: '1', offsetUnit: 'HOUR' }, zone, now),
    ).toBe(
      'Runs 1 hour before the due date. For example, if the due date is Nov 5, 2:00 PM, it runs Nov 5, 1:00 PM.',
    );
    expect(
      triggerSentence(
        change,
        { timing: 'AFTER', offsetValue: '30', offsetUnit: 'MINUTE' },
        zone,
        now,
      ),
    ).toBe(
      'Runs 30 minutes after it happens. For example, if it happens Nov 5, 2:00 PM, it runs Nov 5, 2:30 PM.',
    );
  });

  it('immediately, at the moment, and an offset that is not a whole number', () => {
    expect(
      triggerSentence(change, { timing: 'IMMEDIATE', offsetValue: '', offsetUnit: 'DAY' }, zone),
    ).toBe('Runs as soon as it happens. When a client is archived.');
    expect(
      triggerSentence(due, { timing: 'AFTER', offsetValue: '0', offsetUnit: 'DAY' }, zone, now),
    ).toMatch(/^Runs at the moment of the due date\./);
    for (const offsetValue of ['', '-1', '1.5']) {
      expect(
        triggerSentence(due, { timing: 'AFTER', offsetValue, offsetUnit: 'DAY' }, zone, now),
      ).toBe('Enter how long before or after to see an example.');
    }
  });
});
