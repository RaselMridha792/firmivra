// Request packets in the client portal (R55): the client's view of a packet, its progress, and
// the firm's message with its two variables.
import { describe, expect, it } from 'vitest';
import { packetView, progressOf, resolveMessage } from '../../src/storage/my-packets.service.js';

const item = (required: boolean, status: string) => ({ required, status });
const open = (items: { required: boolean; status: string }[], expiresAt: Date | null = null) => ({
  status: 'OPEN',
  expiresAt,
  items,
});

describe('packetView', () => {
  it('follows the answers of an open packet', () => {
    expect(packetView(open([item(true, 'REQUESTED')]))).toBe('NOT_STARTED');
    // An optional answer is progress, but not ready.
    expect(packetView(open([item(true, 'REQUESTED'), item(false, 'SUBMITTED')]))).toBe(
      'IN_PROGRESS',
    );
    // "I don't have this" and a rejected file: answered, and asked again.
    expect(packetView(open([item(true, 'NOT_AVAILABLE'), item(true, 'ACCEPTED')]))).toBe('READY');
    expect(packetView(open([item(true, 'SUBMITTED'), item(true, 'REJECTED')]))).toBe('IN_PROGRESS');
    // No required items: never ready by itself.
    expect(packetView(open([item(false, 'REQUESTED')]))).toBe('NOT_STARTED');
  });

  it('puts the stored steps and expiry first', () => {
    expect(packetView({ ...open([]), status: 'SUBMITTED' })).toBe('SUBMITTED');
    expect(packetView({ ...open([]), status: 'COMPLETED' })).toBe('COMPLETED');
    expect(packetView(open([item(true, 'SUBMITTED')], new Date(Date.now() - 1000)))).toBe(
      'EXPIRED',
    );
    expect(packetView(open([item(true, 'SUBMITTED')], new Date(Date.now() + 60_000)))).toBe(
      'READY',
    );
  });
});

describe('progressOf', () => {
  it('counts required and all items answered', () => {
    expect(
      progressOf([
        item(true, 'SUBMITTED'),
        item(true, 'REQUESTED'),
        item(false, 'NOT_AVAILABLE'),
        item(true, 'REJECTED'),
      ]),
    ).toEqual({ requiredTotal: 3, requiredAnswered: 1, itemsTotal: 4, itemsAnswered: 2 });
  });
});

describe('resolveMessage', () => {
  it('fills the client name and the due date, every time they appear', () => {
    expect(
      resolveMessage('Hi {Client Name}. Due {Due Date}. Thanks, {Client Name}!', {
        clientName: 'Dana Sample',
        dueOn: new Date('2026-10-20T00:00:00Z'),
      }),
    ).toBe('Hi Dana Sample. Due October 20, 2026. Thanks, Dana Sample!');
  });

  it('leaves other braces alone and has nothing for an empty message', () => {
    expect(resolveMessage('{Firm Name}', { clientName: 'X', dueOn: null })).toBe('{Firm Name}');
    expect(resolveMessage('   ', { clientName: 'X', dueOn: null })).toBeNull();
    expect(resolveMessage(null, { clientName: 'X', dueOn: null })).toBeNull();
  });
});
