import type { LeadMessageThread, MessageThread } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import { activeFilters, addressOf, byActivity, inView, readView } from './messages-view';

const THREAD = '0199b6e1-0000-7000-8000-000000000005';
const CLIENT = '0199b6a1-0000-7000-8000-000000000001';
const thread = (over: Partial<MessageThread> = {}): MessageThread => ({
  id: THREAD,
  client: { id: CLIENT, displayName: 'Jamie Sample' },
  engagementId: null,
  subject: 'Hello',
  related: null,
  repliesEnabled: true,
  startedBy: { kind: 'STAFF', userId: CLIENT, name: 'Sam Staff' },
  lastMessage: null,
  unreadCount: 0,
  automated: false,
  archivedAt: null,
  createdAt: '2026-10-20T12:00:00.000Z',
  ...over,
});
const leadThread = (over: Partial<LeadMessageThread> = {}): LeadMessageThread => ({
  id: '0199b6e7-0000-7000-8000-000000000001',
  lead: {
    id: '0199c0c0-0a00-7000-8000-000000000001',
    displayName: 'Avery Lawson',
    email: 'avery.lawson@example.test',
    phone: null,
  },
  subject: 'Your consultation',
  startedBy: { kind: 'STAFF', userId: CLIENT, name: 'Sam Staff' },
  lastMessage: null,
  archivedAt: null,
  createdAt: '2026-10-25T12:00:00.000Z',
  ...over,
});
const NOW = new Date('2026-10-27T12:00:00.000Z');

describe('the Messages address (MSG-F08)', () => {
  it('round-trips the tab, search, open thread, filters and the way back', () => {
    const view = readView({
      tab: 'archived',
      q: 'dana@example.test',
      thread: THREAD,
      clientId: CLIENT,
      service: 'Payroll',
      since: '7d',
      replies: 'closed',
      started: 'client',
      from: '/payroll?tab=PAST_DUE',
    });
    expect(readView(Object.fromEntries(new URL(addressOf(view), 'http://x').searchParams))).toEqual(
      view,
    );
  });

  it('leaves the defaults out and refuses anything unknown or unsafe', () => {
    expect(addressOf(readView({}))).toBe('/messages');
    const view = readView({
      tab: 'nope',
      thread: 'not-an-id',
      since: 'forever',
      from: 'https://evil.example',
    });
    expect(view).toEqual(readView({}));
    expect(readView({ q: 'x'.repeat(101) }).q).toBe('');
  });
});

describe('which threads a view shows (MSG-F03, F05)', () => {
  it("keeps a lead's thread out of a client's view and the client-only filters", () => {
    expect(inView(leadThread(), readView({ clientId: CLIENT }), NOW)).toBe(false);
    expect(inView(leadThread(), readView({ replies: 'open' }), NOW)).toBe(false);
    expect(inView(leadThread(), readView({ started: 'client' }), NOW)).toBe(false);
    expect(inView(leadThread(), readView({ started: 'firm' }), NOW)).toBe(true);
    expect(inView(leadThread(), readView({ since: '7d' }), NOW)).toBe(true);
  });

  it("orders clients' and leads' threads together, newest activity first", () => {
    const older = thread({ createdAt: '2026-10-20T12:00:00.000Z' });
    const lead = leadThread({ createdAt: '2026-10-25T12:00:00.000Z' });
    expect([older, lead].sort(byActivity).map((t) => t.id)).toEqual([lead.id, older.id]);
  });

  it("puts each thread in its tab; a lead's in All Messages and Leads only", () => {
    const at = (tab: string, t: MessageThread | LeadMessageThread) =>
      inView(t, readView({ tab }), NOW);
    expect(at('all', thread())).toBe(true);
    expect(at('clients', thread())).toBe(true);
    expect(at('leads', thread())).toBe(false);
    expect(at('all', leadThread())).toBe(true);
    expect(at('leads', leadThread())).toBe(true);
    for (const tab of ['clients', 'unread', 'automations', 'invoice', 'document_request'])
      expect(at(tab, leadThread())).toBe(false);
    expect(at('unread', thread())).toBe(false);
    expect(at('unread', thread({ unreadCount: 2 }))).toBe(true);
    expect(at('automations', thread())).toBe(false);
    expect(at('automations', thread({ automated: true }))).toBe(true);
    expect(at('invoice', thread({ related: { type: 'invoice', id: THREAD } }))).toBe(true);
    expect(at('appointment', thread({ related: { type: 'invoice', id: THREAD } }))).toBe(false);
  });

  it('applies the filters: last message, replies, who started, the client', () => {
    const recent = thread({
      lastMessage: {
        direction: 'CLIENT_TO_FIRM',
        senderName: 'Jamie',
        excerpt: 'Hi',
        createdAt: '2026-10-27T09:00:00.000Z',
      },
    });
    expect(inView(recent, readView({ since: 'today' }), NOW)).toBe(true);
    expect(inView(thread(), readView({ since: 'today' }), NOW)).toBe(false);
    expect(inView(thread(), readView({ since: '7d' }), NOW)).toBe(true);
    expect(
      inView(thread({ createdAt: '2026-09-01T00:00:00.000Z' }), readView({ since: '30d' }), NOW),
    ).toBe(false);
    expect(inView(thread(), readView({ replies: 'closed' }), NOW)).toBe(false);
    expect(inView(thread({ repliesEnabled: false }), readView({ replies: 'closed' }), NOW)).toBe(
      true,
    );
    expect(inView(thread(), readView({ started: 'client' }), NOW)).toBe(false);
    expect(inView(thread(), readView({ started: 'firm' }), NOW)).toBe(true);
    expect(
      inView(thread(), readView({ clientId: '0199b6a1-0000-7000-8000-000000000003' }), NOW),
    ).toBe(false);
  });

  it('names the applied filters for the chips', () => {
    expect(activeFilters(readView({}))).toEqual([]);
    expect(activeFilters(readView({ since: '7d', started: 'firm' })).map((f) => f.label)).toEqual([
      'Last 7 days',
      'Started by your firm',
    ]);
  });
});
