import type { ClientListItem, RequestTemplate } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import type { RequestPacketDetail } from '@firmivra/types';
import {
  CUSTOM,
  draftFromPacket,
  itemPlan,
  setupBody,
  check,
  defaultMessage,
  EMPTY_DRAFT,
  packetBody,
  type RequestDraft,
  withTemplate,
  withType,
} from './request-draft';

const uuid = (n: number) => `0199d2b0-7e00-7000-8000-${String(n).padStart(12, '0')}`;
const template = (n: number, titles: string[]): RequestTemplate => ({
  id: uuid(n),
  name: `Template ${n}`,
  description: null,
  owner: 'FIRM',
  items: titles.map((title, i) => ({
    id: uuid(n * 100 + i),
    title,
    description: null,
    required: true,
    category: null,
  })),
  updatedAt: '2026-10-01T00:00:00.000Z',
});
const personal = template(1, ['W-2 Forms', '1099 Forms']);
const business = template(2, ['Profit and Loss', '1099 Forms']);
const client = { id: uuid(900), displayName: 'Fake Client' } as ClientListItem;

const ready = (over: Partial<RequestDraft> = {}): RequestDraft => ({
  ...EMPTY_DRAFT,
  client,
  title: 'Fake 2026 Tax Documents',
  ...withType(EMPTY_DRAFT, personal.id, personal),
  dueOn: '2026-11-20',
  subject: 'Action Needed',
  message: 'Fake message',
  ...over,
});

describe('the request type and templates', () => {
  it('swaps the previous type’s documents for the new type’s and keeps the rest', () => {
    const first = { ...EMPTY_DRAFT, ...withType(EMPTY_DRAFT, personal.id, personal) };
    const added = { ...first, items: withTemplate(first.items, business) };
    // "1099 Forms" is on the list already, so only Profit and Loss is added.
    expect(added.items.map((i) => i.title)).toEqual(['W-2 Forms', '1099 Forms', 'Profit and Loss']);
    const swapped = withType(added, business.id, business);
    expect(swapped.items.map((i) => i.title)).toEqual([
      'Profit and Loss',
      '1099 Forms',
      'Profit and Loss',
    ]);
    expect(withType(added, CUSTOM).items.map((i) => i.title)).toEqual(['Profit and Loss']);
  });
});

describe('check', () => {
  it('asks for what each step needs, and a draft needs only a client and a title', () => {
    expect(Object.keys(check(EMPTY_DRAFT, 'draft', '2026-10-25'))).toEqual(['client', 'title']);
    expect(check(ready(), 'send', '2026-10-25')).toEqual({});
    const late = check(ready({ dueOn: '2026-10-24' }), 'details', '2026-10-25');
    expect(late['dueOn']).toBe('Choose today or a later date.');
    const none = ready();
    none.items = none.items.map((i) => ({ ...i, selected: false }));
    expect(check(none, 'documents', '2026-10-25')['items']).toBeDefined();
    const member = check(ready({ recipientKind: 'MEMBER' }), 'details', '2026-10-25');
    expect(member['member']).toBe('Choose the team member to send it to.');
    const expiry = check(ready({ expires: true, expiresOn: '2026-11-20' }), 'send', '2026-10-25');
    expect(expiry['expiresOn']).toBe('Choose a date after the due date.');
  });
});

describe('packetBody', () => {
  it('keeps the type and sends every ticked document as written', () => {
    const draft = ready();
    draft.items = withTemplate(draft.items, business);
    const body = packetBody(draft, { idempotencyKey: uuid(1), send: true, type: personal });
    expect([body.templateId, body.copyTemplateItems]).toEqual([personal.id, false]);
    expect(body.items?.map((i) => i.title)).toEqual(['W-2 Forms', '1099 Forms', 'Profit and Loss']);
    expect(body).toMatchObject({ send: true, dueOn: '2026-11-20', reminderDaysBefore: 3 });
    expect(body.recipient).toEqual({ kind: 'CLIENT' });
  });

  it('keeps the type after its documents changed, and leaves unticked ones out', () => {
    const draft = ready({ recipientKind: 'MEMBER', memberUserId: uuid(7), reminder: false });
    draft.items = draft.items.map((i, n) =>
      n === 0 ? { ...i, required: false } : { ...i, selected: false },
    );
    const body = packetBody(draft, { idempotencyKey: uuid(1), send: false, type: personal });
    expect(body.templateId).toBe(personal.id);
    expect(body.items?.map((i) => [i.title, i.required])).toEqual([['W-2 Forms', false]]);
    expect(body.recipient).toEqual({ kind: 'MEMBER', userId: uuid(7) });
    expect(body.reminderDaysBefore).toBeNull();
  });

  it('sends no type for a custom request', () => {
    const body = packetBody(ready({ typeId: CUSTOM }), { idempotencyKey: uuid(1), send: false });
    expect(body.templateId).toBeNull();
  });
});

it('fills the message with the recipient, due date, sender and firm', () => {
  const text = defaultMessage({
    name: 'Fake Client',
    dueOn: '2026-11-20',
    sender: 'Fake Sender',
    firm: 'Fake Firm',
  });
  expect(text).toContain('Hi Fake Client,');
  expect(text).toContain('by Nov 20, 2026.');
  expect(text.endsWith('Fake Sender\nFake Firm')).toBe(true);
});

describe('Edit Draft', () => {
  const item = (n: number, title: string, required = true) => ({
    id: uuid(500 + n),
    title,
    instructions: null,
    required,
    category: null,
    status: 'REQUESTED' as const,
    statusNote: null,
    sortOrder: n,
    documents: [],
    resolvedAt: null,
  });
  const saved = {
    client: { id: uuid(900), name: 'Fake Client' },
    recipient: { kind: 'CLIENT', userId: null, name: 'Fake Client' },
    service: { id: uuid(800), title: 'Fake service' },
    title: 'Fake draft',
    templateId: null,
    dueOn: '2026-11-20',
    checklist: [
      item(1, 'W-2'),
      item(2, 'Photo ID'),
      { ...item(3, 'Old'), status: 'CANCELLED' as const },
    ],
    messageSubject: 'Fake subject',
    messageBody: null,
    notifyEmail: true,
    notifyPortal: false,
    notifySms: false,
    reminderDaysBefore: null,
    allowMultipleFiles: true,
    allowClientComments: false,
    expiresAt: null,
  } as unknown as RequestPacketDetail;

  it('opens a saved draft as the form, the message as typed', () => {
    const d = draftFromPacket(saved, EMPTY_DRAFT);
    expect(d.items.map((i) => [i.title, i.itemId])).toEqual([
      ['W-2', uuid(501)],
      ['Photo ID', uuid(502)],
    ]);
    expect(d).toMatchObject({
      typeId: CUSTOM,
      subjectEdited: true,
      messageEdited: false,
      reminder: false,
    });
    expect(d.client).toMatchObject({ id: uuid(900), displayName: 'Fake Client' });
    expect(setupBody(d)).toMatchObject({
      title: 'Fake draft',
      messageSubject: 'Fake subject',
      notifyPortal: false,
    });
  });

  it('plans the checklist: remove, change, add, then the order', () => {
    const d = draftFromPacket(saved, EMPTY_DRAFT);
    const [w2, id] = d.items;
    d.items = [
      { ...id!, required: false },
      { ...w2!, selected: false },
      { ...id!, key: 'new', itemId: undefined, title: 'Fake lease', required: true },
    ];
    expect(itemPlan(saved.checklist, d)).toEqual({
      remove: [uuid(501)],
      update: [{ id: uuid(502), body: { required: false } }],
      add: [{ title: 'Fake lease', instructions: null, required: true, categoryId: null }],
      order: [uuid(502), null],
    });
  });
});
