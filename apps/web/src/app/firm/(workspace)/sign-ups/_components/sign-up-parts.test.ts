// R55, Clients Review 2 (FC-02): the Sign-ups Waiting tab's empty-state help follows the firm's
// approval mode: Manual Review waits for staff; Automatic Approval approves a verified sign-up
// with no email or phone match at once, and a possible match waits.
import { describe, expect, it } from 'vitest';
import { waitingHelp } from './sign-up-parts';

describe('waitingHelp', () => {
  it('Manual Review: every verified request waits for review', () => {
    expect(waitingHelp('MANUAL')).toMatch(/^Manual Review is on: .*waits here for your review\.$/);
  });

  it('Automatic Approval: no match is approved at once; a possible match waits', () => {
    const text = waitingHelp('AUTOMATIC');
    expect(text).toMatch(/^Automatic Approval is on: /);
    expect(text).toContain('matches no client of your firm by email or phone is approved at once');
    expect(text).toContain('A possible match waits here for your review.');
  });

  it('before the mode loads, it claims neither mode', () => {
    expect(waitingHelp(undefined)).not.toMatch(/Manual Review|Automatic Approval/);
  });
});
