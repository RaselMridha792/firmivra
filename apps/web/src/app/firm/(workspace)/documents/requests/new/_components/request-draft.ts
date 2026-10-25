import type {
  ClientListItem,
  CreateRequestItemRequest,
  CreateRequestPacketRequest,
  RequestPacketDetail,
  RequestTemplate,
  UpdateRequestItemRequest,
  UpdateRequestPacketRequest,
} from '@firmivra/types';

/** One document on the request's checklist; unticked rows stay listed but are not requested. */
export interface DraftItem {
  key: string;
  title: string;
  description: string;
  required: boolean;
  categoryId: string | null;
  selected: boolean;
  /** The template it came from (Request Type, "Use a Template" or a saved list). */
  templateId: string | null;
  /** A saved draft's own item (Edit Draft): changed, removed or kept in place. */
  itemId?: string;
}

export interface RequestDraft {
  recipientKind: 'CLIENT' | 'MEMBER';
  client: ClientListItem | null;
  /** The client's open service (engagement); needed only when the client has more than one. */
  serviceId: string;
  /** The team member a MEMBER request goes to; the request is still about `client`. */
  memberUserId: string;
  title: string;
  /** The Request Type: one of the firm's templates, CUSTOM, or '' before one is chosen. */
  typeId: string;
  dueOn: string;
  items: DraftItem[];
  subject: string;
  message: string;
  /** Typed by hand: the defaults no longer follow the recipient, title and due date. */
  subjectEdited: boolean;
  messageEdited: boolean;
  notifyEmail: boolean;
  notifyPortal: boolean;
  notifySms: boolean;
  reminder: boolean;
  reminderDays: number;
  allowMultipleFiles: boolean;
  allowClientComments: boolean;
  expires: boolean;
  expiresOn: string;
}

export const CUSTOM = 'custom';
export const MESSAGE_MAX = 1000;
export const REMINDER_DAYS = [1, 2, 3, 5, 7, 14] as const;

export const EMPTY_DRAFT: RequestDraft = {
  recipientKind: 'CLIENT',
  client: null,
  serviceId: '',
  memberUserId: '',
  title: '',
  typeId: '',
  dueOn: '',
  items: [],
  subject: '',
  message: '',
  subjectEdited: false,
  messageEdited: false,
  notifyEmail: true,
  notifyPortal: true,
  notifySms: false,
  reminder: true,
  reminderDays: 3,
  allowMultipleFiles: true,
  allowClientComments: true,
  expires: false,
  expiresOn: '',
};

let nextKey = 0;
export const itemKey = () => `item-${nextKey++}`;

export function itemsOf(template: RequestTemplate): DraftItem[] {
  return template.items.map((i) => ({
    key: itemKey(),
    title: i.title,
    description: i.description ?? '',
    required: i.required,
    categoryId: i.category?.id ?? null,
    selected: true,
    templateId: template.id,
  }));
}

/**
 * The Request Type changes: the previous type's documents give way to the new type's, at the top;
 * documents added another way stay.
 */
export function withType(draft: RequestDraft, typeId: string, template?: RequestTemplate) {
  const kept = draft.items.filter((i) => !draft.typeId || i.templateId !== draft.typeId);
  return { typeId, items: template ? [...itemsOf(template), ...kept] : kept };
}

/** "Use a Template" or a saved list: its documents not on the list yet are added, ticked. */
export function withTemplate(items: DraftItem[], template: RequestTemplate): DraftItem[] {
  const have = new Set(items.map((i) => i.title.trim().toLowerCase()));
  return [...items, ...itemsOf(template).filter((i) => !have.has(i.title.trim().toLowerCase()))];
}

export const formatDue = (day: string) =>
  day
    ? new Date(`${day}T12:00:00`).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

export const defaultSubject = (title: string) =>
  title.trim() ? `Action Needed: ${title.trim()}` : '';

/** The message as the design words it, with the real names and date filled in. */
export function defaultMessage(to: {
  name: string;
  dueOn: string;
  sender: string;
  firm: string;
}): string {
  const by = to.dueOn ? ` by ${formatDue(to.dueOn)}` : '';
  return [
    `Hi ${to.name || 'there'},`,
    '',
    `To help us with your request, please upload the following documents${by}. You can securely upload your documents through your client portal.`,
    '',
    'If you have any questions, feel free to reply to this email or contact our office.',
    '',
    'Thank you,',
    to.sender,
    to.firm,
  ].join('\n');
}

export const selectedItems = (draft: RequestDraft) =>
  draft.items.filter((i) => i.selected && i.title.trim());

export type DraftErrors = Partial<Record<string, string>>;
export type CheckPoint = 'draft' | 'details' | 'documents' | 'message' | 'send';

/** What still has to be filled in before moving on (the API's REQUEST_INCOMPLETE, said early). */
export function check(draft: RequestDraft, at: CheckPoint, today: string): DraftErrors {
  const e: DraftErrors = {};
  const all = at === 'send';
  if (at === 'draft' || at === 'details' || all) {
    if (!draft.client) e['client'] = 'Choose the client this request is for.';
    if (draft.recipientKind === 'MEMBER' && !draft.memberUserId)
      e['member'] = 'Choose the team member to send it to.';
    if (!draft.title.trim()) e['title'] = 'Enter a request title.';
  }
  if (at === 'details' || all) {
    if (!draft.typeId) e['type'] = 'Choose a request type.';
    if (!draft.dueOn) e['dueOn'] = 'Choose a due date.';
    else if (draft.dueOn < today) e['dueOn'] = 'Choose today or a later date.';
  }
  if (at === 'details' || at === 'documents' || all) {
    if (!selectedItems(draft).length) e['items'] = 'Tick at least one document to request.';
  }
  if (at === 'details' || at === 'message' || all) {
    if (!draft.subject.trim()) e['subject'] = 'Enter a subject line.';
    if (!draft.message.trim()) e['message'] = 'Enter a message.';
    else if (draft.message.length > MESSAGE_MAX)
      e['message'] = `Keep the message to ${MESSAGE_MAX} characters.`;
  }
  if (draft.expires && (at !== 'documents' || all)) {
    if (!draft.expiresOn) e['expiresOn'] = 'Choose when the request expires.';
    else if (draft.dueOn && draft.expiresOn <= draft.dueOn)
      e['expiresOn'] = 'Choose a date after the due date.';
  }
  return e;
}

const same = (a: DraftItem, b: RequestTemplate['items'][number]) =>
  a.title.trim() === b.title &&
  (a.description.trim() || null) === (b.description ?? null) &&
  a.required === b.required &&
  a.categoryId === (b.category?.id ?? null);

/**
 * The API body. The API copies a `templateId`'s documents before `items`, so the type is named
 * only when its documents lead the list unchanged; otherwise every document is sent as written
 * (the request then has no type: the API cannot take a type without copying its documents).
 */
export function packetBody(
  draft: RequestDraft,
  options: { idempotencyKey: string; send: boolean; type?: RequestTemplate },
): CreateRequestPacketRequest {
  const chosen = selectedItems(draft);
  const t = options.type;
  const head = t ? chosen.slice(0, t.items.length) : [];
  const typed = Boolean(
    t &&
    t.items.length &&
    head.length === t.items.length &&
    head.every((i, n) => same(i, t.items[n]!)),
  );
  const rest = typed ? chosen.slice(t!.items.length) : chosen;
  const text = (s: string) => (s.trim() ? s.trim() : null);
  return {
    idempotencyKey: options.idempotencyKey,
    clientId: draft.client!.id,
    ...(draft.serviceId ? { serviceId: draft.serviceId } : {}),
    recipient:
      draft.recipientKind === 'MEMBER'
        ? { kind: 'MEMBER', userId: draft.memberUserId }
        : { kind: 'CLIENT' },
    templateId: typed ? t!.id : null,
    items: rest.map((i) => ({
      title: i.title.trim(),
      instructions: text(i.description),
      required: i.required,
      categoryId: i.categoryId,
    })),
    send: options.send,
    title: draft.title.trim(),
    dueOn: draft.dueOn || null,
    expiresAt: draft.expires && draft.expiresOn ? endOfDay(draft.expiresOn) : null,
    messageSubject: text(draft.subject),
    messageBody: text(draft.message),
    notifyEmail: draft.notifyEmail,
    notifyPortal: draft.notifyPortal,
    notifySms: draft.notifySms,
    reminderDaysBefore: draft.reminder ? draft.reminderDays : null,
    allowMultipleFiles: draft.allowMultipleFiles,
    allowClientComments: draft.allowClientComments,
  };
}

/** The last moment of a day in the viewer's time zone. */
export const endOfDay = (day: string) => new Date(`${day}T23:59:59`).toISOString();

/** Today in the viewer's time zone, as YYYY-MM-DD. */
export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** A saved draft as the form (Edit Draft): what was saved, the message as typed. */
export function draftFromPacket(p: RequestPacketDetail, base: RequestDraft): RequestDraft {
  const day = (iso: string | null) => (iso ? todayIso(new Date(iso)) : '');
  // The saved client by name until the full record (email, phone) loads in its place.
  const client = {
    id: p.client.id,
    displayName: p.client.name,
    email: null,
    phone: null,
  } as unknown as ClientListItem;
  return {
    ...base,
    client: base.client ?? client,
    recipientKind: p.recipient.kind,
    memberUserId: p.recipient.kind === 'MEMBER' ? (p.recipient.userId ?? '') : '',
    serviceId: p.service.id,
    title: p.title,
    typeId: p.templateId ?? CUSTOM,
    dueOn: p.dueOn ?? '',
    items: p.checklist
      .filter((i) => i.status !== 'CANCELLED')
      .map((i) => ({
        key: itemKey(),
        itemId: i.id,
        title: i.title,
        description: i.instructions ?? '',
        required: i.required,
        categoryId: i.category?.id ?? null,
        selected: true,
        templateId: null,
      })),
    subject: p.messageSubject ?? base.subject,
    message: p.messageBody ?? base.message,
    subjectEdited: p.messageSubject !== null,
    messageEdited: p.messageBody !== null,
    notifyEmail: p.notifyEmail,
    notifyPortal: p.notifyPortal,
    notifySms: p.notifySms,
    reminder: p.reminderDaysBefore !== null,
    reminderDays: p.reminderDaysBefore ?? base.reminderDays,
    allowMultipleFiles: p.allowMultipleFiles,
    allowClientComments: p.allowClientComments,
    expires: p.expiresAt !== null,
    expiresOn: day(p.expiresAt),
  };
}

/** The draft's setup for PATCH: everything a draft may change (never its client or type). */
export function setupBody(draft: RequestDraft): UpdateRequestPacketRequest {
  const text = (s: string) => (s.trim() ? s.trim() : null);
  return {
    title: draft.title.trim(),
    dueOn: draft.dueOn || null,
    expiresAt: draft.expires && draft.expiresOn ? endOfDay(draft.expiresOn) : null,
    messageSubject: text(draft.subject),
    messageBody: text(draft.message),
    notifyEmail: draft.notifyEmail,
    notifyPortal: draft.notifyPortal,
    notifySms: draft.notifySms,
    reminderDaysBefore: draft.reminder ? draft.reminderDays : null,
    allowMultipleFiles: draft.allowMultipleFiles,
    allowClientComments: draft.allowClientComments,
  };
}

/**
 * What the saved checklist needs to become the form's: items to take off (unticked or removed),
 * items to change, items to add, and the order afterwards (`null` stands for each added one).
 */
export function itemPlan(
  saved: RequestPacketDetail['checklist'],
  draft: RequestDraft,
): {
  remove: string[];
  update: { id: string; body: UpdateRequestItemRequest }[];
  add: CreateRequestItemRequest[];
  order: (string | null)[];
} {
  const live = saved.filter((i) => i.status !== 'CANCELLED');
  const keep = selectedItems(draft);
  const kept = new Set(keep.flatMap((i) => (i.itemId ? [i.itemId] : [])));
  const text = (s: string) => (s.trim() ? s.trim() : null);
  const update = keep.flatMap((i) => {
    const was = i.itemId ? live.find((x) => x.id === i.itemId) : undefined;
    if (!was) return [];
    const body: UpdateRequestItemRequest = {};
    if (i.title.trim() !== was.title) body.title = i.title.trim();
    if (text(i.description) !== was.instructions) body.instructions = text(i.description);
    if (i.required !== was.required) body.required = i.required;
    if ((i.categoryId ?? null) !== (was.category?.id ?? null)) body.categoryId = i.categoryId;
    return Object.keys(body).length ? [{ id: was.id, body }] : [];
  });
  return {
    remove: live.filter((i) => !kept.has(i.id)).map((i) => i.id),
    update,
    add: keep
      .filter((i) => !i.itemId || !live.some((x) => x.id === i.itemId))
      .map((i) => ({
        title: i.title.trim(),
        instructions: text(i.description),
        required: i.required,
        categoryId: i.categoryId,
      })),
    order: keep.map((i) => (i.itemId && live.some((x) => x.id === i.itemId) ? i.itemId : null)),
  };
}
