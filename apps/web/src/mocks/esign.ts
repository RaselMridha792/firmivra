import {
  ConfirmEsignUploadBody,
  EsignCorrectRecipientBody,
  CreateEsignRequestBody,
  CreateEsignUploadBody,
  type EsignAction,
  type EsignAccessRole,
  type EsignClient,
  EsignContentType,
  type EsignDocument,
  EsignDocumentId,
  EsignDownloadFile,
  type EsignEvent,
  type EsignEventType,
  type EsignField,
  EsignFromVaultBody,
  type EsignMergeKey,
  type EsignReadiness,
  type EsignRecipient,
  EsignRecipientId,
  EsignRequestDetail,
  EsignRequestId,
  type EsignRequestRow,
  type EsignRequestStatus,
  type EsignSummary,
  ESIGN_CLOSED_STATUSES,
  ESIGN_COUNTERS,
  ESIGN_EXPIRING_SOON_DAYS,
  ESIGN_MAX_PAGES,
  ESIGN_OPEN_STATUSES,
  ESIGN_RECENT_DAYS,
  ListEsignRequestsQuery,
  type MemberRef,
  parseInput,
  EsignPutFieldsBody,
  EsignPutPagePlanBody,
  EsignPutRecipientsBody,
  EsignRemindBody,
  EsignReplaceBody,
  EsignResendCopyBody,
  SendEsignRequestBody,
  UpdateEsignRequestBody,
  EsignVoidBody,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';
import { clientFixtures, firstClientId, type MockFirmRole, mockStaff } from './clients';
import { documentFixtures } from './documents';
import { engagementFixtures } from './engagements';
import {
  copy,
  DAY,
  ESIGN_OFF,
  fail,
  HOUR,
  iso,
  LETTER,
  SAMPLE_PDF_URL,
  SAMPLE_PNG_BASE64,
} from './esign-common';
import { esignAdminMock } from './esign-signing';
import { mockBusiness } from './me';

/**
 * Mock data for `api.esign` (Firm Sign, firm side) and `api.mySignatures(slug)`, R13. Synthetic
 * data only. The dashboard's counters are the mockup's (12 drafts, 3 needing approval, 18 sent, 11
 * viewed, 7 partially signed, 42 completed, 2 declined, 1 expired, 0 voided) and its five Recent
 * Documents rows come first; the other requests are generated to make up the counts. Same input
 * checks, rules and error codes as the API, so a screen built on it works unchanged.
 * - `role: 'STAFF'` is Sam Staff (mocks/clients.ts): he sees requests he sends and those of his
 *   assigned clients (Jamie Sample and Acme Widgets); any other request is 404.
 * - New requests need a client from mocks/clients.ts and one of its open services
 *   (mocks/engagements.ts: Jamie Sample's 2025 Personal Tax or Bookkeeping).
 * - Uploads: a file is PENDING (being checked) for 4 seconds, then CLEAN. A PDF whose name contains
 *   "password" answers 409 PDF_ENCRYPTED, "broken" PDF_UNREADABLE; a PDF has 2 pages, an image 1.
 * - Every file shows the generated 2-page sample PDF (`documentContentUrl` is a data: URL).
 * - Merge values: Jamie Sample has no business name, so BUSINESS_NAME and SPOUSE_NAME are missing.
 * - NEXT_PUBLIC_API_MOCK_ESIGN=off: Firm Sign turned off (`status()` says so, other calls 403).
 */
const SCAN_MS = 4000;
const id = (prefix: string, n: number) =>
  `0199b6e${prefix}-0000-7000-8000-${String(n).padStart(12, '0')}`;
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const invalidState = () => fail(409, 'INVALID_STATE', 'The request is not in a state for this');
const closed = () => fail(409, 'REQUEST_CLOSED', 'The request is closed');
const SHA = (n: number) => (n % 256).toString(16).padStart(2, '0').repeat(32);

type Client = { id: string; displayName: string };
/** Clients of the mockup's rows (not in mocks/clients.ts) and two of mocks/clients.ts. */
const jamie: Client = { id: firstClientId, displayName: 'Jamie Sample' };
const acme: Client = {
  id: '0199b6a1-0000-7000-8000-000000000002',
  displayName: 'Acme Widgets LLC (fake)',
};
const MOCKUP_CLIENTS = {
  johnSmith: { id: id('1', 1), displayName: 'John Smith' },
  greenfield: { id: id('1', 2), displayName: 'Greenfield Co.' },
  mariaLopez: { id: id('1', 3), displayName: 'Maria Lopez' },
  brownFamily: { id: id('1', 4), displayName: 'Brown Family' },
  kevinJackson: { id: id('1', 5), displayName: 'Kevin Jackson' },
};
const OTHER_CLIENTS: Client[] = [
  { id: id('1', 6), displayName: 'Taylor Example' },
  { id: id('1', 7), displayName: 'Morgan Sample' },
  { id: id('1', 8), displayName: 'Casey Placeholder' },
  jamie,
  acme,
  { id: id('1', 9), displayName: 'Northwind Bakery (fake)' },
];
const FILLER_TITLES = [
  'Engagement Letter 2025',
  'Bookkeeping Services Agreement',
  'Payroll Authorization',
  'Fee Agreement',
  'Privacy Notice Acknowledgment',
  'Tax Planning Agreement',
  'New Client Intake Form',
];
/** The firm's members in the mock, with what the merge fields read. */
const STAFF = [
  { ...mockMe, email: 'owner@lvp.test', title: 'Managing Partner', phone: '+1 404 555 0100' },
  { ...mockStaff, email: 'sam.staff@lvp.test', title: 'Tax Preparer', phone: '+1 404 555 0101' },
];
const FIRM = {
  address: '100 Example Way, Atlanta, GA 30301',
  phone: '(404) 555-0100',
  email: 'office@lvp.example.test',
};

interface Seed {
  title: string;
  status: EsignRequestStatus;
  client: Client;
  sender: MemberRef;
  signers: string[];
  /** Signers who signed (PARTIALLY_SIGNED). */
  signed?: number;
  createdAt: number;
  sentAt?: number;
  lastActivityAt: number;
  expiresAt?: number;
}

const DOC_STATUS_OF: Partial<Record<EsignRequestStatus, EsignRecipient['status']>> = {
  SENT: 'SENT',
  DELIVERED: 'DELIVERED',
  VIEWED: 'VIEWED',
  EXPIRED: 'VIEWED',
};

/** One request from a seed: the sample PDF, one signature and date per signer on page 2. */
function seeded(n: number, s: Seed): { detail: EsignRequestDetail; events: EsignEvent[] } {
  const docId = id('2', n);
  const sent = s.sentAt !== undefined;
  const recipients: EsignRecipient[] = s.signers.map((name, i) => {
    let status: EsignRecipient['status'] = 'WAITING';
    if (s.status === 'COMPLETED' || i < (s.signed ?? 0)) status = 'SIGNED';
    else if (s.status === 'DECLINED' && i === 0) status = 'DECLINED';
    else if (i === (s.signed ?? 0))
      status = DOC_STATUS_OF[s.status] ?? (s.status === 'PARTIALLY_SIGNED' ? 'VIEWED' : 'WAITING');
    const at = (done: boolean) => (done && s.sentAt ? iso(s.lastActivityAt) : null);
    return {
      id: id('3', n * 10 + i),
      kind: 'SIGNER',
      role: i === 0 ? 'CLIENT' : 'SPOUSE',
      roleLabel: null,
      routingOrder: i + 1,
      name,
      email: `${name
        .toLowerCase()
        .replace(/[^a-z]+/g, '.')
        .replace(/^\.|\.$/g, '')}@example.test`,
      phone: null,
      link: { type: 'EXTERNAL' },
      delivery: 'EMAIL',
      authMethod: 'EMAIL_CODE',
      hasAccessCode: false,
      colorIndex: i % 8,
      status,
      sentAt: sent && status !== 'WAITING' ? iso(s.sentAt!) : null,
      viewedAt: at(['VIEWED', 'SIGNED', 'DECLINED'].includes(status)),
      signedAt: at(status === 'SIGNED'),
      declinedAt: at(status === 'DECLINED'),
      declineReason: status === 'DECLINED' ? 'The fee is not what we agreed.' : null,
      lastRemindedAt: null,
      reminderCount: 0,
    };
  });
  const fields: EsignField[] = recipients.flatMap((r, i) => [
    field(id('4', n * 100 + i * 2), r.id, 'SIGNATURE', 1, 0.12, 0.2 + i * 0.15),
    field(id('4', n * 100 + i * 2 + 1), r.id, 'DATE_SIGNED', 1, 0.6, 0.2 + i * 0.15),
  ]);
  for (const f of fields)
    f.filled = recipients.find((r) => r.id === f.recipientId)?.status === 'SIGNED';
  const completed = s.status === 'COMPLETED';
  const detail: EsignRequestDetail = {
    id: id('0', n),
    title: s.title,
    status: s.status,
    source: 'TAB',
    client: s.client,
    sender: s.sender,
    signerNames: [],
    signedCount: 0,
    signerCount: 0,
    nextAction: { kind: 'NONE', waitingOn: [] },
    createdAt: iso(s.createdAt),
    sentAt: sent ? iso(s.sentAt!) : null,
    lastActivityAt: iso(s.lastActivityAt),
    expiresAt: sent ? iso(s.expiresAt ?? s.sentAt! + 30 * DAY) : null,
    completedAt: completed ? iso(s.lastActivityAt) : null,
    internalNote: n % 3 === 0 ? 'Synthetic note: staff only.' : null,
    emailSubject: null,
    emailMessage: null,
    routing: 'SEQUENTIAL',
    engagement:
      s.client.id === jamie.id
        ? { id: engagementFixtures()[0]!.id, title: engagementFixtures()[0]!.title }
        : { id: id('5', n), title: '2025 Personal Tax' },
    expiryDays: 30,
    reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
    expiryWarningDays: 2,
    documents: [
      {
        id: docId,
        position: 0,
        fileName: `${s.title}.pdf`,
        contentType: 'application/pdf',
        sizeBytes: 1209,
        pageCount: 2,
        pageSizes: [LETTER, LETTER],
        sourceDocumentId: null,
        scanStatus: 'CLEAN',
        createdAt: iso(s.createdAt),
      },
    ],
    pagePlan: [
      { documentId: docId, page: 0, rotation: 0 },
      { documentId: docId, page: 1, rotation: 0 },
    ],
    recipients,
    fields,
    replacesRequestId: null,
    replacedByRequestId: null,
    declinedAt: s.status === 'DECLINED' ? iso(s.lastActivityAt) : null,
    expiredAt: s.status === 'EXPIRED' ? iso(s.lastActivityAt) : null,
    voidedAt: null,
    voidReason: null,
    voidedBy: null,
    originalSha256: sent ? SHA(n) : null,
    finalSha256: completed ? SHA(n + 100) : null,
    certificateSha256: completed ? SHA(n + 200) : null,
    finalDocumentId: completed ? id('6', n * 2) : null,
    certificateDocumentId: completed ? id('6', n * 2 + 1) : null,
    allowedActions: [],
  };
  derive(detail);
  const events: EsignEvent[] = [event(n * 100, 'CREATED', s.createdAt, s.sender.name, 'STAFF')];
  if (s.status === 'NEEDS_APPROVAL')
    events.push(event(n * 100 + 1, 'APPROVAL_REQUESTED', s.lastActivityAt, s.sender.name, 'STAFF'));
  if (sent) events.push(event(n * 100 + 2, 'SENT', s.sentAt!, s.sender.name, 'STAFF'));
  recipients.forEach((r, i) => {
    const ref = { id: r.id, name: r.name };
    const n2 = n * 100 + 10 + i * 5;
    if (r.viewedAt) events.push(event(n2, 'VIEWED', s.lastActivityAt, r.name, 'SIGNER', ref));
    if (r.signedAt) events.push(event(n2 + 1, 'SIGNED', s.lastActivityAt, r.name, 'SIGNER', ref));
    if (r.declinedAt)
      events.push(
        event(n2 + 2, 'DECLINED', s.lastActivityAt, r.name, 'SIGNER', ref, r.declineReason),
      );
  });
  if (completed)
    events.push(event(n * 100 + 90, 'COMPLETED', s.lastActivityAt, 'Firmivra', 'SYSTEM'));
  if (s.status === 'EXPIRED')
    events.push(event(n * 100 + 91, 'EXPIRED', s.lastActivityAt, 'Firmivra', 'SYSTEM'));
  return { detail: EsignRequestDetail.parse(detail), events };
}

function field(
  fieldId: string,
  recipientId: string | null,
  type: EsignField['type'],
  pageIndex: number,
  x: number,
  y: number,
): EsignField {
  return {
    id: fieldId,
    recipientId,
    type,
    pageIndex,
    x,
    y,
    w: 0.3,
    h: 0.05,
    required: true,
    label: null,
    mergeKey: null,
    options: [],
    groupKey: null,
    value: null,
    filled: false,
  };
}

function event(
  n: number,
  type: EsignEventType,
  at: number,
  actorName: string,
  actorKind: EsignEvent['actorKind'],
  recipient: EsignEvent['recipient'] = null,
  reason: string | null = null,
): EsignEvent {
  const authMethod = ['VIEWED', 'SIGNED', 'DECLINED'].includes(type) ? 'EMAIL_CODE' : null;
  return {
    id: id('7', n),
    type,
    createdAt: iso(at),
    actorKind,
    actorName,
    recipient,
    reason,
    authMethod,
  };
}

const OPEN: readonly EsignRequestStatus[] = ESIGN_OPEN_STATUSES;
const CLOSED: readonly EsignRequestStatus[] = ESIGN_CLOSED_STATUSES;
const DONE: readonly EsignRecipient['status'][] = ['SIGNED', 'APPROVED', 'REJECTED', 'DECLINED'];
const TURN: readonly EsignRecipient['status'][] = ['SENT', 'DELIVERED', 'VIEWED'];

/** Recomputes the row's derived columns from the recipients. */
function derive(r: EsignRequestDetail): void {
  const signers = r.recipients
    .filter((x) => x.kind === 'SIGNER')
    .sort((a, b) => a.routingOrder - b.routingOrder);
  r.signerNames = signers.map((x) => x.name);
  r.signerCount = signers.length;
  r.signedCount = signers.filter((x) => x.status === 'SIGNED').length;
  const approvers = r.recipients.filter((x) => x.kind === 'APPROVER' && x.status !== 'APPROVED');
  r.nextAction =
    r.status === 'DRAFT'
      ? { kind: 'FINISH_DRAFT', waitingOn: [] }
      : r.status === 'NEEDS_APPROVAL'
        ? { kind: 'AWAIT_APPROVAL', waitingOn: approvers.map((x) => x.name) }
        : OPEN.includes(r.status)
          ? {
              kind: 'AWAIT_SIGNATURE',
              waitingOn: signers.filter((x) => TURN.includes(x.status)).map((x) => x.name),
            }
          : { kind: 'NONE', waitingOn: [] };
}

/** The mockup's 5 rows first, then generated requests up to the mockup's counters. */
function buildFixtures(): { details: EsignRequestDetail[]; events: Map<string, EsignEvent[]> } {
  const now = Date.now();
  const oct = (day: number, hour = 15) => Date.UTC(2026, 9, day, hour);
  const c = MOCKUP_CLIENTS;
  const seeds: Seed[] = [
    {
      title: 'Tax Engagement Letter 2026',
      status: 'COMPLETED',
      client: c.johnSmith,
      sender: mockMe,
      signers: ['John Smith'],
      createdAt: oct(1, 12),
      sentAt: oct(1),
      lastActivityAt: oct(3),
    },
    {
      title: 'Bookkeeping Services Agreement',
      status: 'VIEWED',
      client: c.greenfield,
      sender: mockMe,
      signers: ['Dana Greenfield'],
      createdAt: oct(5, 12),
      sentAt: oct(5),
      lastActivityAt: oct(6, 16),
    },
    {
      title: 'New Client Intake Form',
      status: 'SENT',
      client: c.mariaLopez,
      sender: mockStaff,
      signers: ['Maria Lopez'],
      createdAt: oct(6, 10),
      sentAt: oct(6),
      lastActivityAt: oct(6, 15),
    },
    {
      title: 'Payroll Authorization',
      status: 'PARTIALLY_SIGNED',
      client: c.brownFamily,
      sender: mockMe,
      signers: ['Alex Brown', 'Jordan Brown'],
      signed: 1,
      createdAt: oct(4, 10),
      sentAt: oct(4),
      lastActivityAt: oct(6, 14),
    },
    {
      title: 'Terms of Service',
      status: 'NEEDS_APPROVAL',
      client: c.kevinJackson,
      sender: mockStaff,
      signers: ['Kevin Jackson'],
      createdAt: oct(6, 9),
      lastActivityAt: oct(6, 13),
    },
  ];
  // What the five rows leave of the mockup's counters (SENT includes 4 DELIVERED).
  const rest: [EsignRequestStatus, number][] = [
    ['DRAFT', 12],
    ['NEEDS_APPROVAL', 2],
    ['SENT', 13],
    ['DELIVERED', 4],
    ['VIEWED', 10],
    ['PARTIALLY_SIGNED', 6],
    ['COMPLETED', 41],
    ['DECLINED', 2],
    ['EXPIRED', 1],
  ];
  let i = 0;
  for (const [status, count] of rest) {
    for (let k = 0; k < count; k++, i++) {
      const last = oct(1) - (i + 1) * 9 * HOUR;
      const client = OTHER_CLIENTS[i % OTHER_CLIENTS.length]!;
      const two = status === 'PARTIALLY_SIGNED' || i % 5 === 0;
      const isSent = !['DRAFT', 'NEEDS_APPROVAL'].includes(status);
      seeds.push({
        title: FILLER_TITLES[i % FILLER_TITLES.length]!,
        status,
        client,
        sender: i % 3 === 0 ? mockStaff : mockMe,
        signers: two
          ? [`${client.displayName} Signer`, 'Second Signer (fake)']
          : [`${client.displayName} Signer`],
        signed: status === 'PARTIALLY_SIGNED' ? 1 : 0,
        createdAt: last - 2 * DAY,
        sentAt: isSent ? last - DAY : undefined,
        lastActivityAt: last,
        // Open requests expire after today; two within days, for the Expiring Soon filter.
        expiresAt: !OPEN.includes(status)
          ? undefined
          : status === 'SENT' && k < 2
            ? now + (k + 1) * DAY
            : now + (10 + (i % 15)) * DAY,
      });
    }
  }
  const details: EsignRequestDetail[] = [];
  const events = new Map<string, EsignEvent[]>();
  seeds.forEach((s, n) => {
    const built = seeded(n + 1, s);
    details.push(built.detail);
    events.set(built.detail.id, built.events);
  });
  return { details, events };
}

let store: ReturnType<typeof buildFixtures> | undefined;
/** New ids, shared by every mock instance, well above the seeded ones. */
let nextId = 900_000;
/** One store per page load. Built on first use: importing this file runs nothing. */
export const esignStore = () => (store ??= buildFixtures());
/** The fixtures as built (for tests and other mocks); copies. */
export const esignFixtures = (): EsignRequestDetail[] => copy(esignStore().details);

const MERGE_ROW = (r: EsignRequestDetail): Record<EsignMergeKey, string | null> => {
  const record = clientFixtures().find((x) => x.id === r.client?.id);
  const p = record?.profile;
  const a = p?.address;
  const [first, ...last] = (r.client?.displayName ?? '').split(' ');
  const staff = STAFF.find((s) => s.userId === r.sender.userId);
  const address = a?.line1
    ? `${a.line1}, ${a.city ?? ''}, ${a.state ?? ''} ${a.postalCode ?? ''}`.trim()
    : null;
  return {
    CLIENT_FIRST_NAME: record ? (p?.firstName ?? null) : r.client ? (first ?? null) : null,
    CLIENT_LAST_NAME: record ? (p?.lastName ?? null) : last.length ? last.join(' ') : null,
    CLIENT_FULL_NAME: r.client?.displayName ?? null,
    CLIENT_EMAIL: record?.email ?? null,
    CLIENT_PHONE: record?.phone ?? null,
    CLIENT_ADDRESS: address,
    BUSINESS_NAME: p?.businessName ?? null,
    SPOUSE_NAME: null,
    STAFF_NAME: r.sender.name,
    STAFF_TITLE: staff?.title ?? null,
    STAFF_EMAIL: staff?.email ?? null,
    STAFF_PHONE: staff?.phone ?? null,
    FIRM_NAME: mockBusiness.name,
    FIRM_ADDRESS: FIRM.address,
    FIRM_PHONE: FIRM.phone,
    FIRM_EMAIL: FIRM.email,
    CURRENT_DATE: new Date().toLocaleDateString('en-US', { dateStyle: 'long' }),
  };
};

/** An in-memory `api.esign`. `enabled: false` shows Firm Sign turned off (403 MODULE_OFF). */
export function createEsignMock(
  options: { role?: MockFirmRole; enabled?: boolean } = {},
): EsignClient {
  const role: EsignAccessRole = options.role ?? 'OWNER';
  const enabled = options.enabled ?? !ESIGN_OFF;
  const me: MemberRef = role === 'STAFF' ? mockStaff : mockMe;
  const uploads = new Map<
    string,
    { requestId: string; fileName: string; contentType: EsignContentType; sizeBytes: number }
  >();
  const scanDoneAt = new Map<string, number>();
  const newId = (prefix: string) => id(prefix, nextId++);

  const assigned = (clientId: string | undefined) =>
    clientFixtures().some((c) => c.id === clientId && c.assignedTo?.userId === mockStaff.userId);
  const visible = (r: EsignRequestDetail) =>
    role !== 'STAFF' || r.sender.userId === me.userId || assigned(r.client?.id);
  const on = async () => {
    await mockDelay();
    if (!enabled) throw fail(403, 'MODULE_OFF', 'Firm Sign is off for this firm');
  };
  /** A file's scan finishes 4 seconds after its upload. */
  const scanned = (r: EsignRequestDetail) => {
    for (const d of r.documents) {
      const at = scanDoneAt.get(d.id);
      if (d.scanStatus === 'PENDING' && at !== undefined && Date.now() >= at)
        d.scanStatus = 'CLEAN';
    }
  };
  const find = (requestId: string) => {
    const rid = parseInput(EsignRequestId, requestId);
    const r = esignStore().details.find((x) => x.id === rid && visible(x));
    if (!r) throw notFound();
    scanned(r);
    return r;
  };
  const draft = (requestId: string) => {
    const r = find(requestId);
    if (r.status !== 'DRAFT') throw invalidState();
    return r;
  };
  const open = (requestId: string, alsoApproval = false) => {
    const r = find(requestId);
    if (CLOSED.includes(r.status)) throw closed();
    if (!OPEN.includes(r.status) && !(alsoApproval && r.status === 'NEEDS_APPROVAL')) {
      throw invalidState();
    }
    return r;
  };
  const record = (r: EsignRequestDetail, type: EsignEventType, extra: Partial<EsignEvent> = {}) => {
    const list = esignStore().events.get(r.id) ?? [];
    list.push({
      id: newId('7'),
      type,
      createdAt: iso(Date.now()),
      actorKind: 'STAFF',
      actorName: me.name,
      recipient: null,
      reason: null,
      authMethod: null,
      ...extra,
    });
    esignStore().events.set(r.id, list);
  };
  const touched = (r: EsignRequestDetail) => {
    r.lastActivityAt = iso(Date.now());
    derive(r);
  };
  const actions = (r: EsignRequestDetail): EsignAction[] => {
    if (r.status === 'DRAFT') return ['EDIT', 'DISCARD', 'SEND'];
    if (r.status === 'NEEDS_APPROVAL') return ['VOID'];
    if (OPEN.includes(r.status)) return ['REMIND', 'VOID', 'CORRECT', 'REPLACE', 'DOWNLOAD'];
    if (r.status === 'COMPLETED') return ['RESEND_COPY', 'DOWNLOAD'];
    return r.sentAt ? ['DOWNLOAD'] : [];
  };
  const view = (r: EsignRequestDetail): EsignRequestDetail =>
    copy({ ...r, allowedActions: actions(r) });
  const row = (r: EsignRequestDetail): EsignRequestRow => {
    const {
      id: rowId,
      title,
      status,
      source,
      client,
      sender,
      signerNames,
      signedCount,
      signerCount,
      nextAction,
      createdAt,
      sentAt,
      lastActivityAt,
      expiresAt,
      completedAt,
    } = r;
    return copy({
      id: rowId,
      title,
      status,
      source,
      client,
      sender,
      signerNames,
      signedCount,
      signerCount,
      nextAction,
      createdAt,
      sentAt,
      lastActivityAt,
      expiresAt,
      completedAt,
      allowedActions: actions(r),
    });
  };
  const quick: Record<string, (r: EsignRequestDetail) => boolean> = {
    AWAITING_SIGNATURE: (r) => OPEN.includes(r.status),
    EXPIRING_SOON: (r) =>
      OPEN.includes(r.status) &&
      r.expiresAt !== null &&
      Date.parse(r.expiresAt) > Date.now() &&
      Date.parse(r.expiresAt) - Date.now() < ESIGN_EXPIRING_SOON_DAYS * DAY,
    RECENTLY_COMPLETED: (r) =>
      r.status === 'COMPLETED' &&
      r.completedAt !== null &&
      Date.now() - Date.parse(r.completedAt) < ESIGN_RECENT_DAYS * DAY,
    MY_REQUESTS: (r) => r.sender.userId === me.userId,
    NEEDS_MY_APPROVAL: (r) =>
      r.status === 'NEEDS_APPROVAL' &&
      r.recipients.some(
        (x) =>
          x.kind === 'APPROVER' &&
          x.link.type === 'STAFF' &&
          x.link.userId === me.userId &&
          x.status !== 'APPROVED',
      ),
  };
  /** The client a request may be for: one the caller may see, not archived. */
  const clientFor = (clientId: string): Client => {
    const c = clientFixtures().find((x) => x.id === clientId && !x.archivedAt);
    if (!c || (role === 'STAFF' && !assigned(c.id))) throw notFound();
    return { id: c.id, displayName: c.displayName };
  };
  /** One of the client's PENDING or ACTIVE services. */
  const engagementFor = (clientId: string | undefined, engagementId: string) => {
    const e = engagementFixtures().find(
      (x) =>
        x.id === engagementId &&
        x.clientId === clientId &&
        ['PENDING', 'ACTIVE'].includes(x.status),
    );
    if (!e) throw fail(409, 'ENGAGEMENT_MISMATCH', 'Choose one of the client’s open services');
    return { id: e.id, title: e.title };
  };
  const readiness = (r: EsignRequestDetail): EsignReadiness => {
    const problems: EsignReadiness['problems'] = [];
    const add = (
      code: EsignReadiness['problems'][number]['code'],
      at: Partial<EsignReadiness['problems'][number]> = {},
    ) =>
      problems.push({
        code,
        recipientId: null,
        fieldId: null,
        documentId: null,
        mergeKey: null,
        ...at,
      });
    if (r.documents.length === 0) add('NO_DOCUMENTS');
    if (!r.client) add('NO_CLIENT');
    else if (!r.engagement) add('NO_ENGAGEMENT');
    const signers = r.recipients.filter((x) => x.kind === 'SIGNER');
    if (signers.length === 0) add('NO_SIGNERS');
    for (const d of r.documents) {
      if (d.scanStatus === 'PENDING') add('SCAN_PENDING', { documentId: d.id });
      else if (d.scanStatus !== 'CLEAN') add('SCAN_BLOCKED', { documentId: d.id });
    }
    for (const x of r.recipients) {
      if (x.delivery === 'EMAIL' && !x.email) add('RECIPIENT_NO_CONTACT', { recipientId: x.id });
      if (x.authMethod === 'ACCESS_CODE' && !x.hasAccessCode)
        add('ACCESS_CODE_MISSING', { recipientId: x.id });
      if (x.kind === 'APPROVER' && x.status !== 'APPROVED')
        add('APPROVAL_PENDING', { recipientId: x.id });
    }
    if (r.fields.length > 0) {
      for (const s of signers) {
        if (!r.fields.some((f) => f.recipientId === s.id))
          add('SIGNER_NO_FIELDS', { recipientId: s.id });
      }
    }
    const values = MERGE_ROW(r);
    for (const f of r.fields) {
      if (f.mergeKey && values[f.mergeKey] === null)
        add('MERGE_MISSING', { fieldId: f.id, mergeKey: f.mergeKey });
    }
    if (r.reminders.max > 0 && r.reminders.firstAfterDays >= r.expiryDays)
      add('REMINDER_AFTER_EXPIRY');
    return { ready: problems.length === 0, problems, autoSignaturePage: r.fields.length === 0 };
  };

  const client: Omit<EsignClient, 'saveAsTemplate' | 'settings' | 'templates'> = {
    status: async () => {
      await mockDelay();
      return { enabled, myEsignRole: enabled ? role : null };
    },
    list: async (query = {}) => {
      await on();
      const q = parseInput(ListEsignRequestsQuery, query);
      const start = q.cursor === undefined ? 0 : Number(q.cursor);
      if (!Number.isInteger(start) || start < 0)
        throw fail(400, 'VALIDATION_FAILED', 'Invalid cursor');
      const search = q.q?.toLowerCase();
      const all = esignStore()
        .details.filter(visible)
        .filter(
          (r) =>
            (!q.status ||
              r.status === q.status ||
              (q.status === 'SENT' && r.status === 'DELIVERED')) &&
            (!q.quickFilter || quick[q.quickFilter]!(r)) &&
            (!q.clientId || r.client?.id === q.clientId) &&
            (!q.senderId || r.sender.userId === q.senderId) &&
            (!q.from || r.lastActivityAt.slice(0, 10) >= q.from) &&
            (!q.to || r.lastActivityAt.slice(0, 10) <= q.to) &&
            (!search ||
              [r.title, r.client?.displayName ?? '', r.sender.name, ...r.signerNames].some((t) =>
                t.toLowerCase().includes(search),
              )),
        )
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
      const items = all.slice(start, start + q.limit).map(row);
      return { items, nextCursor: start + q.limit < all.length ? String(start + q.limit) : null };
    },
    summary: async () => {
      await on();
      const mine = esignStore().details.filter(visible);
      const counts = Object.fromEntries(
        ESIGN_COUNTERS.map((s) => [s, 0]),
      ) as EsignSummary['counts'];
      for (const r of mine) {
        const key = r.status === 'DELIVERED' ? 'SENT' : r.status;
        counts[key] += 1;
      }
      const quickFilters = Object.fromEntries(
        Object.entries(quick).map(([k, test]) => [k, mine.filter(test).length]),
      ) as EsignSummary['quickFilters'];
      return { counts, quickFilters };
    },
    get: async (requestId) => {
      await on();
      return view(find(requestId));
    },
    create: async (body) => {
      await on();
      const input = parseInput(CreateEsignRequestBody, body);
      const client = input.clientId ? clientFor(input.clientId) : null;
      if (input.engagementId && !client) {
        throw fail(409, 'ENGAGEMENT_MISMATCH', 'Choose one of the client’s open services');
      }
      const engagement = input.engagementId ? engagementFor(client?.id, input.engagementId) : null;
      const at = iso(Date.now());
      const r = EsignRequestDetail.parse({
        ...seeded(0, {
          title: input.title,
          status: 'DRAFT',
          client: client ?? jamie,
          sender: me,
          signers: [],
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
        }).detail,
        id: newId('0'),
        source: input.source,
        client,
        engagement,
        internalNote: null,
        documents: [],
        pagePlan: [],
        createdAt: at,
        lastActivityAt: at,
      });
      derive(r);
      esignStore().details.push(r);
      record(r, 'CREATED');
      return view(r);
    },
    update: async (requestId, body) => {
      await on();
      const input = parseInput(UpdateEsignRequestBody, body);
      const r = draft(requestId);
      const { clientId, engagementId, ...rest } = input;
      if (clientId !== undefined && clientId !== (r.client?.id ?? null)) {
        if (r.recipients.some((x) => x.link.type === 'CLIENT_LOGIN')) {
          throw fail(409, 'RECIPIENTS_LINKED', 'Remove the client’s recipients first');
        }
        r.client = clientId === null ? null : clientFor(clientId);
        r.engagement = null;
      }
      if (engagementId !== undefined) {
        r.engagement = engagementId === null ? null : engagementFor(r.client?.id, engagementId);
      }
      for (const [key, value] of Object.entries(rest)) {
        if (value !== undefined) Object.assign(r, { [key]: value });
      }
      touched(r);
      record(r, 'EDITED');
      return view(r);
    },
    discard: async (requestId) => {
      await on();
      const r = draft(requestId);
      if (r.sentAt) throw invalidState();
      const list = esignStore().details;
      list.splice(list.indexOf(r), 1);
      return { ok: true as const };
    },

    createUpload: async (requestId, body) => {
      await on();
      if (!EsignContentType.safeParse(body.contentType).success) {
        throw fail(400, 'FILE_TYPE_NOT_ALLOWED', 'Only PDF, JPG and PNG files');
      }
      const input = parseInput(CreateEsignUploadBody, body);
      const r = draft(requestId);
      const n = nextId++;
      uploads.set(`mock-esign-upload-${n}`, {
        requestId: r.id,
        fileName: input.fileName,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
      });
      return {
        uploadToken: `mock-esign-upload-${n}`,
        url: `mock:upload/esign-${n}`,
        method: 'PUT' as const,
        headers: { 'content-type': input.contentType },
        expiresAt: iso(Date.now() + 15 * 60 * 1000),
      };
    },
    confirmUpload: async (requestId, body) => {
      await on();
      const { uploadToken } = parseInput(ConfirmEsignUploadBody, body);
      const r = draft(requestId);
      const upload = uploads.get(uploadToken);
      if (!upload || upload.requestId !== r.id) {
        throw fail(410, 'UPLOAD_EXPIRED', 'This upload has expired');
      }
      uploads.delete(uploadToken);
      const { fileName, contentType, sizeBytes } = upload;
      const name = fileName.toLowerCase();
      if (contentType === 'application/pdf' && name.includes('password')) {
        throw fail(409, 'PDF_ENCRYPTED', 'The PDF is encrypted');
      }
      if (contentType === 'application/pdf' && name.includes('broken')) {
        throw fail(409, 'PDF_UNREADABLE', 'The file could not be read');
      }
      const pageCount = contentType === 'application/pdf' ? 2 : 1;
      if (r.pagePlan.length + pageCount > ESIGN_MAX_PAGES) {
        throw fail(409, 'TOO_MANY_PAGES', 'At most 100 pages');
      }
      const d: EsignDocument = {
        id: newId('2'),
        position: r.documents.length,
        fileName: fileName.trim(),
        contentType,
        sizeBytes,
        pageCount,
        pageSizes: Array.from({ length: pageCount }, () => LETTER),
        sourceDocumentId: null,
        scanStatus: 'PENDING',
        createdAt: iso(Date.now()),
      };
      scanDoneAt.set(d.id, Date.now() + SCAN_MS);
      r.documents.push(d);
      for (let page = 0; page < pageCount; page++)
        r.pagePlan.push({ documentId: d.id, page, rotation: 0 });
      touched(r);
      return copy(d);
    },
    addFromVault: async (requestId, body) => {
      await on();
      const { documentId } = parseInput(EsignFromVaultBody, body);
      const r = draft(requestId);
      const source = documentFixtures().documents.find(
        (x) => x.id === documentId && x.clientId === r.client?.id,
      );
      if (!source) throw notFound();
      const contentType = EsignContentType.options.find((t) => t === source.contentType);
      if (!contentType) throw fail(409, 'FILE_TYPE_NOT_ALLOWED', 'Only PDF, JPG and PNG files');
      if (source.scanStatus === 'PENDING') throw fail(409, 'SCAN_PENDING', 'Still being checked');
      if (source.scanStatus !== 'CLEAN') throw fail(409, 'FILE_BLOCKED', 'The file is blocked');
      const pageCount = contentType === 'application/pdf' ? 2 : 1;
      if (r.pagePlan.length + pageCount > ESIGN_MAX_PAGES) {
        throw fail(409, 'TOO_MANY_PAGES', 'At most 100 pages');
      }
      const d: EsignDocument = {
        id: newId('2'),
        position: r.documents.length,
        fileName: source.fileName,
        contentType,
        sizeBytes: source.sizeBytes,
        pageCount,
        pageSizes: Array.from({ length: pageCount }, () => LETTER),
        sourceDocumentId: source.id,
        scanStatus: 'CLEAN',
        createdAt: iso(Date.now()),
      };
      r.documents.push(d);
      for (let page = 0; page < pageCount; page++)
        r.pagePlan.push({ documentId: d.id, page, rotation: 0 });
      touched(r);
      return copy(d);
    },
    removeDocument: async (requestId, documentId) => {
      await on();
      const docId = parseInput(EsignDocumentId, documentId);
      const r = draft(requestId);
      if (!r.documents.some((d) => d.id === docId)) throw notFound();
      const kept = r.pagePlan.filter((p) => p.documentId !== docId);
      remapFields(r, kept);
      r.documents = r.documents
        .filter((d) => d.id !== docId)
        .map((d, position) => ({ ...d, position }));
      touched(r);
      return view(r);
    },
    documentContentUrl: (requestId, documentId) => {
      parseInput(EsignRequestId, requestId);
      parseInput(EsignDocumentId, documentId);
      const d = esignStore()
        .details.flatMap((r) => r.documents)
        .find((x) => x.id === documentId);
      // Every image shows the same small PNG, whatever its type.
      return d && d.contentType !== 'application/pdf'
        ? `data:image/png;base64,${SAMPLE_PNG_BASE64}`
        : SAMPLE_PDF_URL;
    },
    putPagePlan: async (requestId, body) => {
      await on();
      const { pages } = parseInput(EsignPutPagePlanBody, body);
      const r = draft(requestId);
      for (const p of pages) {
        const d = r.documents.find((x) => x.id === p.documentId);
        if (!d || p.page >= d.pageCount) throw fail(400, 'VALIDATION_FAILED', 'Unknown page');
      }
      r.pagePlan.forEach((old, index) => {
        const moved = pages.find((p) => p.documentId === old.documentId && p.page === old.page);
        const hasFields = r.fields.some((f) => f.pageIndex === index);
        if (moved && hasFields && moved.rotation !== old.rotation) {
          throw fail(409, 'PAGE_HAS_FIELDS', 'Move or remove the fields on this page first');
        }
      });
      remapFields(r, pages);
      touched(r);
      return view(r);
    },
    putRecipients: async (requestId, body) => {
      await on();
      const input = parseInput(EsignPutRecipientsBody, body);
      const r = draft(requestId);
      const used = new Set<number>();
      const list: EsignRecipient[] = input.recipients.map((x) => {
        const old = x.id ? r.recipients.find((o) => o.id === x.id) : undefined;
        if (x.id && !old) throw fail(400, 'VALIDATION_FAILED', 'Unknown recipient');
        let name: string;
        let email: string | null;
        let phone: string | null = null;
        if (x.who.type === 'CLIENT_LOGIN') {
          const accountId = x.who.clientAccountId;
          const c = clientFixtures().find((k) => k.id === r.client?.id);
          const login = c?.portalLogins.find(
            (l) => l.clientAccountId === accountId && l.status === 'ACTIVE',
          );
          if (!c || !login) throw fail(409, 'LOGIN_NOT_ACTIVE', 'The login is not active');
          name = c.displayName;
          email = login.email;
        } else if (x.who.type === 'STAFF') {
          const userId = x.who.userId;
          const s = STAFF.find((m) => m.userId === userId);
          if (!s) throw fail(409, 'NOT_A_MEMBER', 'Not a member of the firm');
          name = s.name;
          email = s.email;
        } else {
          name = x.who.name;
          email = x.who.email;
          phone = x.who.phone ?? null;
        }
        if (old) used.add(old.colorIndex);
        return {
          id: old?.id ?? newId('3'),
          kind: x.kind,
          role: x.role,
          roleLabel: x.role === 'CUSTOM' ? (x.roleLabel ?? null) : null,
          routingOrder: r.routing === 'PARALLEL' ? 1 : x.routingOrder,
          name,
          email,
          phone,
          link:
            x.who.type === 'CLIENT_LOGIN'
              ? { type: 'CLIENT_LOGIN' as const, clientAccountId: x.who.clientAccountId }
              : x.who.type === 'STAFF'
                ? { type: 'STAFF' as const, userId: x.who.userId }
                : { type: 'EXTERNAL' as const },
          delivery: x.delivery,
          authMethod: x.authMethod,
          hasAccessCode:
            x.authMethod === 'ACCESS_CODE' &&
            (x.accessCode !== undefined || (old?.hasAccessCode ?? false)),
          colorIndex: old?.colorIndex ?? -1,
          status: 'WAITING' as const,
          sentAt: null,
          viewedAt: null,
          signedAt: null,
          declinedAt: null,
          declineReason: null,
          lastRemindedAt: null,
          reminderCount: 0,
        };
      });
      for (const x of list) {
        if (x.colorIndex >= 0) continue;
        let color = 0;
        while (used.has(color) && color < 7) color++;
        used.add(color);
        x.colorIndex = color;
      }
      const ids = new Set(list.filter((x) => x.kind === 'SIGNER').map((x) => x.id));
      r.recipients = list;
      r.fields = r.fields.filter((f) => f.recipientId === null || ids.has(f.recipientId));
      touched(r);
      return view(r);
    },
    putFields: async (requestId, body) => {
      await on();
      const input = parseInput(EsignPutFieldsBody, body);
      const r = draft(requestId);
      r.fields = input.fields.map((f) => {
        if (f.id && !r.fields.some((o) => o.id === f.id)) {
          throw fail(400, 'VALIDATION_FAILED', 'Unknown field');
        }
        if (
          f.recipientId !== null &&
          !r.recipients.some((x) => x.id === f.recipientId && x.kind === 'SIGNER')
        ) {
          throw fail(400, 'VALIDATION_FAILED', 'Assign the field to one of the signers');
        }
        if (f.pageIndex >= r.pagePlan.length) throw fail(400, 'VALIDATION_FAILED', 'Unknown page');
        return {
          ...field(f.id ?? newId('4'), f.recipientId, f.type, f.pageIndex, f.x, f.y),
          w: f.w,
          h: f.h,
          required: f.required,
          label: f.label ?? null,
          mergeKey: f.mergeKey ?? null,
          options: f.options,
          groupKey: f.groupKey ?? null,
          value: f.value ?? null,
        };
      });
      touched(r);
      return view(r);
    },
    mergeValues: async (requestId) => {
      await on();
      const r = find(requestId);
      const values = MERGE_ROW(r);
      const missing = [...new Set(r.fields.map((f) => f.mergeKey))].filter(
        (k): k is EsignMergeKey => k !== null && values[k] === null,
      );
      return { values, missing };
    },
    readiness: async (requestId) => {
      await on();
      return readiness(find(requestId));
    },
    send: async (requestId, body) => {
      await on();
      parseInput(SendEsignRequestBody, body);
      const r = draft(requestId);
      if (!readiness(r).ready) throw fail(409, 'NOT_READY', 'The request is not ready to send');
      const now = Date.now();
      const signers = r.recipients.filter((x) => x.kind === 'SIGNER');
      const first = Math.min(...signers.map((x) => x.routingOrder));
      for (const x of signers) {
        if (r.routing === 'PARALLEL' || x.routingOrder === first) {
          x.status = 'SENT';
          x.sentAt = iso(now);
        }
      }
      r.status = 'SENT';
      r.sentAt = iso(now);
      r.expiresAt = iso(now + r.expiryDays * DAY);
      r.originalSha256 = SHA(nextId++);
      touched(r);
      record(r, 'SENT');
      return view(r);
    },

    remind: async (requestId, body = {}) => {
      await on();
      const { recipientId } = parseInput(EsignRemindBody, body);
      const r = open(requestId);
      const targets = r.recipients.filter(
        (x) => TURN.includes(x.status) && (!recipientId || x.id === recipientId),
      );
      if (recipientId && targets.length === 0) {
        const x = r.recipients.find((k) => k.id === recipientId);
        if (!x) throw notFound();
        throw DONE.includes(x.status)
          ? fail(409, 'RECIPIENT_DONE', 'This recipient has finished')
          : invalidState();
      }
      const now = Date.now();
      if (targets.some((x) => x.lastRemindedAt && now - Date.parse(x.lastRemindedAt) < HOUR)) {
        throw fail(409, 'REMIND_TOO_SOON', 'Reminded less than an hour ago');
      }
      for (const x of targets) {
        x.lastRemindedAt = iso(now);
        x.reminderCount += 1;
        record(r, 'REMINDER_SENT', { recipient: { id: x.id, name: x.name } });
      }
      touched(r);
      return view(r);
    },
    void: async (requestId, body) => {
      await on();
      const { reason } = parseInput(EsignVoidBody, body);
      const r = open(requestId, true);
      r.status = 'VOIDED';
      r.voidedAt = iso(Date.now());
      r.voidReason = reason;
      r.voidedBy = me;
      touched(r);
      record(r, 'VOIDED', { reason });
      return view(r);
    },
    correctRecipient: async (requestId, recipientId, body) => {
      await on();
      const rid = parseInput(EsignRecipientId, recipientId);
      const input = parseInput(EsignCorrectRecipientBody, body);
      const r = open(requestId);
      const x = r.recipients.find((k) => k.id === rid);
      if (!x) throw notFound();
      if (DONE.includes(x.status)) throw fail(409, 'RECIPIENT_DONE', 'This recipient has finished');
      if (x.link.type !== 'EXTERNAL') throw invalidState();
      if (input.name !== undefined) x.name = input.name;
      if (input.email !== undefined) x.email = input.email;
      if (input.phone !== undefined) x.phone = input.phone;
      touched(r);
      record(r, 'CORRECTED', { recipient: { id: x.id, name: x.name } });
      return view(r);
    },
    replace: async (requestId, body) => {
      await on();
      const { reason } = parseInput(EsignReplaceBody, body);
      const old = open(requestId, true);
      const docIds = new Map(old.documents.map((d) => [d.id, newId('2')]));
      const recipientIds = new Map(old.recipients.map((x) => [x.id, newId('3')]));
      const at = iso(Date.now());
      const r: EsignRequestDetail = {
        ...copy(old),
        id: newId('0'),
        status: 'DRAFT',
        sender: me,
        createdAt: at,
        sentAt: null,
        lastActivityAt: at,
        expiresAt: null,
        completedAt: null,
        documents: old.documents.map((d) => ({ ...copy(d), id: docIds.get(d.id)!, createdAt: at })),
        pagePlan: old.pagePlan.map((p) => ({ ...p, documentId: docIds.get(p.documentId)! })),
        recipients: old.recipients.map((x) => ({
          ...copy(x),
          id: recipientIds.get(x.id)!,
          status: 'WAITING',
          sentAt: null,
          viewedAt: null,
          signedAt: null,
          declinedAt: null,
          declineReason: null,
          lastRemindedAt: null,
          reminderCount: 0,
        })),
        fields: old.fields.map((f) => ({
          ...copy(f),
          id: newId('4'),
          recipientId: f.recipientId === null ? null : recipientIds.get(f.recipientId)!,
          filled: false,
        })),
        replacesRequestId: old.id,
        replacedByRequestId: null,
        originalSha256: null,
        allowedActions: [],
      };
      derive(r);
      old.status = 'VOIDED';
      old.voidedAt = at;
      old.voidReason = reason;
      old.voidedBy = me;
      old.replacedByRequestId = r.id;
      touched(old);
      record(old, 'REPLACED', { reason });
      esignStore().details.push(r);
      record(r, 'CREATED');
      return view(r);
    },
    resendCopy: async (requestId, body = {}) => {
      await on();
      const { recipientId } = parseInput(EsignResendCopyBody, body);
      const r = find(requestId);
      if (r.status !== 'COMPLETED') throw invalidState();
      const targets = r.recipients.filter(
        (x) => x.link.type !== 'STAFF' && (!recipientId || x.id === recipientId),
      );
      if (targets.length === 0) throw notFound();
      for (const x of targets) record(r, 'COPY_SENT', { recipient: { id: x.id, name: x.name } });
      return { ok: true as const };
    },
    download: async (requestId, file) => {
      await on();
      const which = parseInput(EsignDownloadFile, file);
      const r = find(requestId);
      if (which === 'original' ? !r.sentAt : r.status !== 'COMPLETED') throw invalidState();
      record(r, 'DOWNLOADED');
      return { url: SAMPLE_PDF_URL, expiresAt: iso(Date.now() + 5 * 60 * 1000) };
    },
    events: async (requestId) => {
      await on();
      const r = find(requestId);
      return { items: copy(esignStore().events.get(r.id) ?? []) };
    },
  };
  return {
    ...client,
    ...esignAdminMock({
      client,
      on,
      find: (requestId) => view(find(requestId)),
      stored: find,
      record,
      me,
      manager: role !== 'STAFF',
      newId,
    }),
  };
}

/**
 * Sets the page plan and moves each field with its page; fields on pages that are gone are
 * removed.
 */
function remapFields(r: EsignRequestDetail, pages: EsignRequestDetail['pagePlan']): void {
  const indexOf = (old: number) => {
    const p = r.pagePlan[old];
    return p ? pages.findIndex((x) => x.documentId === p.documentId && x.page === p.page) : -1;
  };
  r.fields = r.fields
    .map((f) => ({ ...f, pageIndex: indexOf(f.pageIndex) }))
    .filter((f) => f.pageIndex >= 0);
  r.pagePlan = pages.map((p) => ({ ...p }));
}

/** `api.mySignatures(slug)` and `api.signing(slug)`: see mocks/esign-signing.ts. */
export { createMySignaturesMock as mySignaturesMock, createSigningMock } from './esign-signing';
export { SAMPLE_PDF_URL } from './esign-common';
