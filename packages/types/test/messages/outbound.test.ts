import { describe, expect, it } from 'vitest';
import {
  OutboundReviewQuery,
  reviewChannels,
  SaveOutboundRequest,
  ScheduleOutboundRequest,
  SendOutboundRequest,
  UpdateOutboundRequest,
} from '../../src/index.js';

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

// M19 (Messaging Review 2): one New Message to several channels. Send and Schedule may name the
// channels (each once); left out, a request is read exactly as before.
describe('SendOutboundRequest and ScheduleOutboundRequest: channels (M19)', () => {
  const at = '2026-11-20T15:00:00.000Z';

  it('a request without channels is as before', () => {
    expect(SendOutboundRequest.parse({ version })).toEqual({ version });
    expect(SendOutboundRequest.parse({ version, confirmUnresolved: true })).toEqual({
      version,
      confirmUnresolved: true,
    });
    expect(ScheduleOutboundRequest.parse({ version, scheduledFor: at })).toEqual({
      version,
      scheduledFor: at,
    });
    expect(SendOutboundRequest.safeParse({ version, channel: 'EMAIL' }).success).toBe(false);
  });

  it('two or three channels, in the order named', () => {
    expect(SendOutboundRequest.parse({ version, channels: ['PORTAL', 'EMAIL'] }).channels).toEqual([
      'PORTAL',
      'EMAIL',
    ]);
    expect(
      ScheduleOutboundRequest.parse({
        version,
        scheduledFor: at,
        channels: ['SMS', 'PORTAL', 'EMAIL'],
      }).channels,
    ).toEqual(['SMS', 'PORTAL', 'EMAIL']);
  });

  it('each channel once, at least one, and only the three there are', () => {
    expect(
      issues(SendOutboundRequest.safeParse({ version, channels: ['EMAIL', 'EMAIL'] })),
    ).toEqual(['Choose each channel once']);
    expect(issues(SendOutboundRequest.safeParse({ version, channels: [] }))).toEqual([
      'Choose a channel',
    ]);
    expect(SendOutboundRequest.safeParse({ version, channels: ['FAX'] }).success).toBe(false);
  });
});

describe('OutboundReviewQuery: the review for several channels (M19)', () => {
  it('names them as PORTAL,EMAIL,SMS, each once; left out, the draft’s own', () => {
    expect(reviewChannels(OutboundReviewQuery.parse({}))).toBeUndefined();
    expect(reviewChannels(OutboundReviewQuery.parse({ channels: 'PORTAL,EMAIL' }))).toEqual([
      'PORTAL',
      'EMAIL',
    ]);
    expect(issues(OutboundReviewQuery.safeParse({ channels: 'PORTAL,PORTAL' }))).toEqual([
      'Choose each channel once',
    ]);
    expect(issues(OutboundReviewQuery.safeParse({ channels: 'PORTAL,FAX' }))).toEqual([
      'List channels as PORTAL,EMAIL,SMS',
    ]);
    expect(OutboundReviewQuery.safeParse({ channels: 'PORTAL', other: 'x' }).success).toBe(false);
  });
});
