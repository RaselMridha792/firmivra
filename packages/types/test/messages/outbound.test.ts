import { describe, expect, it } from 'vitest';
import { SaveOutboundRequest, UpdateOutboundRequest } from '../../src/index.js';

// M22 (Messaging Review 2): New Message's text may be left out on the Portal channel only, for a
// message of files alone; a text that is there is read exactly as before.
const client = '0199b6a0-0000-7000-8000-000000000001';
const version = '2026-11-19T10:00:00.000Z';
const issues = (r: { success: boolean; error?: { issues: { message: string }[] } }) =>
  r.success ? [] : (r.error?.issues.map((i) => i.message) ?? []);

describe('SaveOutboundRequest and UpdateOutboundRequest: the body (M22)', () => {
  it('a Portal message may leave the text out (files alone)', () => {
    const save = SaveOutboundRequest.safeParse({ channel: 'PORTAL', clientIds: [client] });
    expect(save.success).toBe(true);
    expect(save.data?.body).toBeUndefined();
    expect(
      UpdateOutboundRequest.safeParse({ channel: 'PORTAL', clientIds: [client], version }).success,
    ).toBe(true);
  });

  it('email and text still need it, with a clear message', () => {
    for (const channel of ['EMAIL', 'SMS'] as const) {
      const r = SaveOutboundRequest.safeParse({ channel, subject: 'Hi', clientIds: [client] });
      expect(issues(r)).toEqual(['Enter a message. Only a portal message can go with files alone']);
    }
  });

  it('a text that is there works as before: trimmed, never blank, a text at most 1,600', () => {
    expect(
      SaveOutboundRequest.parse({ channel: 'EMAIL', body: '  Hello  ', clientIds: [client] }).body,
    ).toBe('Hello');
    expect(
      issues(SaveOutboundRequest.safeParse({ channel: 'PORTAL', body: '  ', clientIds: [client] })),
    ).toContain('Enter a message');
    expect(
      issues(
        SaveOutboundRequest.safeParse({
          channel: 'SMS',
          body: 'x'.repeat(1601),
          clientIds: [client],
        }),
      ),
    ).toContain('A text message is at most 1,600 characters');
  });
});
