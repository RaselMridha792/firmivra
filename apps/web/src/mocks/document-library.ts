import {
  ApiRequestError,
  BulkRequestPacketsRequest,
  CreateRequestPacketRequest,
  CreateDocumentCategoryRequest,
  CreateDocumentFolderRequest,
  CreateDocumentShareRequest,
  DocumentFolder,
  type DocumentShare,
  type LibraryDocument,
  UpdateDocumentShareRequest,
  type DocumentCategory,
  type DocumentSettings,
  ReorderDocumentFoldersRequest,
  UpdateDocumentCategoryRequest,
  UpdateDocumentFolderRequest,
  UpdateDocumentSettingsRequest,
  UPLOAD_LIMITS,
  type DocumentLibraryClient,
  type DocumentsClient,
  parseInput,
  type RequestPacketDetail,
  type RequestPacketRow,
  RequestPacketsQuery,
  type RequestPacketView,
  type RequestItem,
  CreateRequestItemRequest,
  UpdateRequestItemRequest,
  UpdateRequestPacketRequest,
  type DocumentActivity,
  type RequestTemplate,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { clientFixtures } from './clients';

// Synthetic folders and the upload step of the firm's document library (R55 contract,
// `api.documentLibrary`) for mock mode. Uploads go through the documents mock (`api.documents`),
// so the confirm step and the library page see the same files. The requests dashboard (Frame 3)
// reads synthetic request packets and templates that follow the API's views, tabs and sorts.
// The methods no screen uses yet answer 501 until their screen arrives.

const at = '2026-10-01T15:00:00.000Z';
const folderId = (n: number) => `0199d2b0-6a00-7000-8000-${String(n).padStart(12, '0')}`;

/** The design's configurable categories under Client Documents, and the firm's own folder. */
export function documentFolderFixtures(): DocumentFolder[] {
  const folder = (
    n: number,
    name: string,
    scope: DocumentFolder['scope'],
    parent: number | null,
    color: DocumentFolder['color'],
  ): DocumentFolder =>
    DocumentFolder.parse({
      id: folderId(n),
      name,
      description: null,
      parentId: parent === null ? null : folderId(parent),
      scope,
      color,
      sortOrder: n,
      requireExpiryDate: false,
      remindBeforeExpiry: false,
      allowClientUploads: scope === 'CLIENT',
      notifyStaffOnUpload: true,
      defaultClientAccess: 'NONE',
      documentCount: 0,
      subfolderCount: 0,
      createdAt: at,
      updatedAt: at,
    });
  const children = [
    'Tax Returns',
    'Bookkeeping',
    'Payroll',
    'Advisory',
    'Business Formation',
    'Licenses & Credentials',
    'Contracts & Agreements',
    'Marketing & Misc',
  ];
  return [
    {
      ...folder(1, 'Client Documents', 'CLIENT', null, 'YELLOW'),
      description: "Each client's own documents, by service.",
      subfolderCount: children.length,
      documentCount: 4,
    },
    ...children.map((name, i) => ({
      ...folder(i + 2, name, 'CLIENT', 1, 'BLUE'),
      ...(i === 0
        ? {
            description: 'Client documents for individual tax preparation, prior returns and IDs.',
            requireExpiryDate: true,
            remindBeforeExpiry: true,
            defaultClientAccess: 'VIEW_UPLOAD' as const,
            documentCount: 12,
          }
        : {}),
    })),
    { ...folder(20, 'Firm Documents', 'FIRM', null, 'GRAY'), subfolderCount: 3 },
    folder(21, 'Templates', 'FIRM', 20, 'PURPLE'),
    folder(22, 'Marketing', 'FIRM', 20, 'ORANGE'),
    folder(23, 'Staff Only', 'FIRM', 20, 'GRAY'),
  ];
}

const packetId = (n: number) => `0199d2b0-7b00-7000-8000-${String(n).padStart(12, '0')}`;
const templateId = (n: number) => `0199d2b0-7c00-7000-8000-${String(n).padStart(12, '0')}`;
const memberId = (n: number) => `0199d2b0-7d00-7000-8000-${String(n).padStart(12, '0')}`;
const clientRef = (n: number, name: string) => ({
  id: `0199b6a1-0000-7000-8000-${String(n).padStart(12, '0')}`,
  name,
});
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const MEMBERS = [
  { userId: memberId(1), name: 'Morgan Avery' },
  { userId: memberId(2), name: 'Sam Carter' },
  { userId: memberId(3), name: 'Taylor Moore' },
];

/** Synthetic request templates: the firm's request types, and one member's saved list. */
export function requestTemplateFixtures(): RequestTemplate[] {
  const template = (
    n: number,
    name: string,
    description: string,
    items: [string, string?][],
    owner: RequestTemplate['owner'] = 'FIRM',
  ): RequestTemplate => ({
    id: templateId(n),
    name,
    description,
    owner,
    items: items.map(([title, about], i) => ({
      id: `0199d2b0-7e00-7000-8000-${String(n * 100 + i + 1).padStart(12, '0')}`,
      title,
      description: about ?? null,
      required: true,
      category: null,
    })),
    updatedAt: ago(48 * n),
  });
  return [
    template(
      1,
      'Personal Tax Documents',
      'Common documents needed for individual tax preparation.',
      [
        ['W-2 Forms (All Employers)', 'All W-2 forms for tax year 2025.'],
        ['1099 Forms (All Applicable)', 'All 1099 forms for tax year 2025.'],
        ['Bank Statements (Jan – Dec 2025)', 'Checking, savings, and business accounts.'],
        ['Investment Statements'],
        ['Prior Year Tax Return (2024)'],
      ],
    ),
    template(
      2,
      'Business Tax Documents',
      'Documents for business tax clients (S-Corp, LLC, etc.).',
      [
        ['Profit and Loss Statement'],
        ['Balance Sheet'],
        ['1099s Issued'],
        ['Payroll Reports'],
        ['Fixed Asset Purchases'],
        ['Loan Statements'],
      ],
    ),
    template(3, 'Bookkeeping Onboarding', 'Initial documents for bookkeeping clients.', [
      ['Bank Statements'],
      ['Credit Card Statements'],
      ['Chart of Accounts'],
      ['Loan Statements'],
    ]),
    template(4, 'Payroll Setup', 'Documents needed to set up payroll services.', [
      ['EIN Confirmation Letter'],
      ['State Tax IDs'],
      ['Employee List'],
      ['Pay Schedule'],
    ]),
    template(5, 'New Client Intake', 'General documents for all new clients.', [
      ["Driver's License or State ID", 'A clear copy of a valid government-issued ID.'],
      ['Signed Engagement Letter'],
      ['Prior Year Tax Return (2024)'],
      ['Proof of Address'],
      ['Voided Check'],
    ]),
    template(6, 'Entity Formation', 'Documents for business formation services.', [
      ['Articles of Organization'],
      ['Operating Agreement'],
      ['EIN Confirmation Letter'],
      ['Owner IDs'],
    ]),
    template(7, 'Advisory Engagement', 'Documents for advisory and consulting clients.', [
      ['Financial Statements (3 Years)'],
      ['Business Plan'],
      ['Budget and Forecast'],
      ['Debt Schedule'],
    ]),
    template(
      8,
      'My Year-End Checklist',
      'A saved list of year-end documents.',
      [['Year-End Bank Statements'], ['Property Tax Statements'], ['Charitable Donation Receipts']],
      'MINE',
    ),
  ];
}

interface MockPacket {
  row: RequestPacketRow;
  required: number;
  /** What a created request keeps beyond its row (the fixtures leave the defaults). */
  extra?: Partial<RequestPacketDetail>;
}

/** The dashboard's status as the API works it out (packets.service.ts `viewOf`). */
function viewOf(p: RequestPacketRow, required: number): RequestPacketView {
  if (p.status === 'DRAFT' || p.status === 'CANCELLED' || p.status === 'COMPLETED') return p.status;
  if (p.expiresAt && Date.parse(p.expiresAt) < Date.now()) return 'EXPIRED';
  if (p.dueOn && p.dueOn < day(0)) return 'OVERDUE';
  if (p.status === 'SUBMITTED' || (required > 0 && p.items.received >= required))
    return 'READY_FOR_REVIEW';
  return p.items.received > 0 ? 'PARTIALLY_RECEIVED' : 'OUTSTANDING';
}

const ITEM_TITLES = [
  'W-2 Forms (All Employers)',
  '1099 Forms (All Applicable)',
  'Bank Statements (Jan – Dec 2025)',
  'Prior Year Tax Return (2024)',
  "Driver's License or State ID",
  'Signed Engagement Letter',
];
const itemId = (n: number, k: number) =>
  `0199d2b0-7d00-7000-8000-${String(n * 100 + k).padStart(12, '0')}`;
const activityId = (n: number, k: number) =>
  `0199d2b0-7a00-7000-8000-${String(n * 100 + k).padStart(12, '0')}`;

/**
 * A fixture's checklist and history, matching its row: the received items have a file (the first
 * one accepted), a completed request's are all accepted, the rest wait.
 */
function fixtureExtra(p: MockPacket): Partial<RequestPacketDetail> {
  const r = p.row;
  const n = Number(r.reference.slice(3));
  const checklist: RequestItem[] = Array.from({ length: r.items.total }, (_, k) => {
    const title = ITEM_TITLES[k % ITEM_TITLES.length]!;
    const got = k < r.items.received;
    const status: RequestItem['status'] =
      r.status === 'COMPLETED' || (got && k === 0) ? 'ACCEPTED' : got ? 'SUBMITTED' : 'REQUESTED';
    return {
      id: itemId(n, k),
      title,
      instructions: null,
      required: true,
      category: null,
      status,
      statusNote: null,
      sortOrder: k,
      documents: got
        ? [
            {
              id: itemId(n, 50 + k),
              fileName: `${title
                .split(' (')[0]!
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')}.pdf`,
              scanStatus: 'CLEAN',
              createdAt: r.updatedAt,
            },
          ]
        : [],
      resolvedAt: status === 'ACCEPTED' ? r.updatedAt : null,
    };
  });
  const by = MEMBERS[0]?.name ?? null;
  const created = r.sentAt ? new Date(Date.parse(r.sentAt) - 3_600_000).toISOString() : ago(6);
  const events: DocumentActivity[] = [
    { id: activityId(n, 0), at: created, kind: 'REQUEST_CREATED', label: 'Request created', by },
  ];
  if (r.sentAt)
    events.push({
      id: activityId(n, 1),
      at: r.sentAt,
      kind: 'REQUEST_SENT',
      label: `Request sent to ${r.recipient.name}`,
      by,
    });
  if (r.items.received)
    events.push({
      id: activityId(n, 2),
      at: r.updatedAt,
      kind: 'REQUEST_RECEIVED',
      label: `${r.client.name} uploaded ${r.items.received} ${r.items.received === 1 ? 'document' : 'documents'}`,
      by: r.client.name,
    });
  if (r.status === 'COMPLETED' || r.status === 'CANCELLED')
    events.push({
      id: activityId(n, 3),
      at: r.updatedAt,
      kind: r.status === 'COMPLETED' ? 'REQUEST_COMPLETED' : 'REQUEST_CANCELLED',
      label: r.status === 'COMPLETED' ? 'Request completed' : 'Request cancelled',
      by,
    });
  const sent = r.status !== 'DRAFT';
  return {
    checklist,
    activity: events.reverse(),
    messageSubject: sent ? `Action Needed: ${r.title}` : null,
    messageBody: sent
      ? `Hi ${r.client.name},\n\nPlease upload the documents listed in this request through your client portal.\n\nThank you,\n${by ?? ''}`
      : null,
    reminderDaysBefore: 3,
    requestedBy: MEMBERS[0] ?? null,
  };
}

/** Synthetic request packets in every status, due dates relative to today. */
function packetFixtures(): MockPacket[] {
  const make = (
    n: number,
    title: string,
    service: string,
    client: { id: string; name: string },
    status: RequestPacketRow['status'],
    received: number,
    total: number,
    due: number | null,
    member: number,
    sentHoursAgo: number | null,
  ): MockPacket => ({
    required: total,
    row: {
      id: packetId(n),
      reference: `DR-${String(n).padStart(4, '0')}`,
      title,
      client,
      service: { id: `0199d2b0-7f00-7000-8000-${String(n).padStart(12, '0')}`, title: service },
      recipient: { kind: 'CLIENT', userId: null, name: client.name },
      status,
      view: 'OUTSTANDING',
      items: { total, required: total, received },
      dueOn: due === null ? null : day(due),
      expiresAt: null,
      assignedTo: MEMBERS[member] ?? null,
      sentAt: sentHoursAgo === null ? null : ago(sentHoursAgo),
      updatedAt: ago(sentHoursAgo === null ? 4 : Math.max(1, sentHoursAgo - 2)),
    },
  });
  const jamie = clientRef(1, 'Jamie Sample');
  const acme = clientRef(2, 'Acme Widgets LLC (fake)');
  const riley = clientRef(3, 'Riley Example');
  const morgan = clientRef(5, 'Morgan Lee');
  const bakery = clientRef(6, 'Northwind Bakery LLC (fake)');
  const list = [
    make(24, '2025 Tax Documents', 'Personal Tax Intake', jamie, 'OPEN', 3, 5, 12, 0, 2),
    make(23, 'Business Formation Docs', 'New Client Intake', acme, 'OPEN', 0, 4, 14, 1, 5),
    make(22, 'Bookkeeping Onboarding', 'Bookkeeping Intake', bakery, 'OPEN', 2, 6, 10, 2, 30),
    make(21, 'Payroll Setup Documents', 'Payroll Intake', morgan, 'COMPLETED', 4, 4, 7, 0, 60),
    make(20, 'Engagement Agreement', 'Firm Document', riley, 'OPEN', 0, 1, -2, 2, 120),
    make(19, '2025 W-2s and 1099s', 'Personal Tax Intake', riley, 'SUBMITTED', 4, 4, 9, 0, 70),
    make(18, 'Updated Bank Statements', 'Bookkeeping Intake', bakery, 'OPEN', 4, 4, 11, 1, 50),
    make(17, 'Advisory Intake Documents', 'Advisory Intake', acme, 'DRAFT', 0, 3, 20, 1, null),
    make(16, 'Entity Documents', 'Business Tax Intake', acme, 'OPEN', 1, 4, 17, 2, 26),
    make(15, 'Prior Year Return', 'Personal Tax Intake', morgan, 'CANCELLED', 0, 1, 5, 0, 200),
  ];
  for (const p of list) {
    p.row.view = viewOf(p.row, p.required);
    p.extra = fixtureExtra(p);
  }
  return list;
}

const TABS: Record<string, (r: RequestPacketRow) => boolean> = {
  all: (r) => r.view !== 'CANCELLED',
  draft: (r) => r.view === 'DRAFT',
  outstanding: (r) => r.view === 'OUTSTANDING',
  partially_received: (r) => r.view === 'PARTIALLY_RECEIVED',
  ready_for_review: (r) => r.view === 'READY_FOR_REVIEW',
  due_soon: (r) =>
    ['OUTSTANDING', 'PARTIALLY_RECEIVED'].includes(r.view) && !!r.dueOn && r.dueOn <= day(7),
  overdue: (r) => r.view === 'OVERDUE',
  completed: (r) => r.view === 'COMPLETED',
  cancelled: (r) => r.view === 'CANCELLED',
};

const notInMock = async (): Promise<never> => {
  await mockDelay();
  throw new ApiRequestError(501, 'NOT_IMPLEMENTED', 'Not in the mock yet');
};

export function createDocumentLibraryMock(options: {
  documents: DocumentsClient;
  empty?: boolean;
}): DocumentLibraryClient {
  let folders = options.empty ? [] : documentFolderFixtures();
  let settings: DocumentSettings = {
    requestReminderDaysBefore: options.empty ? null : 3,
    requestExpiryDays: null,
    documentExpiryReminderDays: options.empty ? null : 30,
    shareExpiryDays: options.empty ? null : 14,
    uploadMaxBytes: UPLOAD_LIMITS.maxBytes,
    uploadTypes: [],
    defaultReviewer: options.empty ? null : (MEMBERS[0] ?? null),
    updatedAt: null,
  };
  // New and changed document types live here; the documents mock's own list answers the rest.
  const added: DocumentCategory[] = [];
  const changed = new Map<string, Partial<DocumentCategory>>();
  const baseCategories = options.documents.categories;
  options.documents.categories = async () => {
    const base = await baseCategories();
    return [...base, ...added].map((c) => ({ ...c, ...changed.get(c.id) }));
  };
  const folderOf = (id: string) => {
    const f = folders.find((x) => x.id === id);
    if (!f) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
    return f;
  };
  const recountFolders = () => {
    folders = folders.map((f) => ({
      ...f,
      subfolderCount: folders.filter((x) => x.parentId === f.id).length,
    }));
  };
  const nameTaken = (name: string, parentId: string | null, except?: string) =>
    folders.some(
      (f) =>
        f.id !== except &&
        (f.parentId ?? null) === parentId &&
        f.name.toLowerCase() === name.toLowerCase(),
    );
  let nextFolder = 100;
  // Sharing (Frame 5): grants and their history per document; the tax return starts shared.
  const sharedDoc = '0199b6a5-0000-7000-8000-000000000006';
  const grants = new Map<string, DocumentShare[]>();
  const accessLog = new Map<string, DocumentActivity[]>();
  let nextShare = 1;
  const shareId = () => `0199d2b0-6b00-7000-8000-${String(nextShare++).padStart(12, '0')}`;
  const record = (docId: string, kind: DocumentActivity['kind'], label: string) =>
    accessLog.set(docId, [
      { id: shareId(), at: new Date().toISOString(), kind, label, by: MEMBERS[0]?.name ?? null },
      ...(accessLog.get(docId) ?? []),
    ]);
  if (!options.empty) {
    grants.set(sharedDoc, [
      {
        id: shareId(),
        recipient: {
          kind: 'MEMBER',
          id: MEMBERS[1]!.userId,
          name: MEMBERS[1]!.name,
          email: null,
        },
        canDownload: true,
        canUpload: true,
        canSign: false,
        expiresAt: null,
        grantedBy: MEMBERS[0] ?? null,
        createdAt: ago(72),
      },
    ]);
    accessLog.set(sharedDoc, [
      {
        id: shareId(),
        at: ago(72),
        kind: 'SHARED',
        label: `Shared with ${MEMBERS[1]!.name}`,
        by: MEMBERS[0]?.name ?? null,
      },
    ]);
  }
  /** The documents mock's file, as the library reads it. */
  const libraryDoc = async (id: string): Promise<LibraryDocument> => {
    const d = await options.documents.get(id);
    const client = clientFixtures().find((c) => c.id === d.clientId);
    return {
      id: d.id,
      fileName: d.fileName,
      contentType: d.contentType,
      sizeBytes: d.sizeBytes,
      client: { id: d.clientId, name: client?.displayName ?? 'Client' },
      service: d.service,
      folder: null,
      category: d.category,
      direction: d.direction,
      taxYear: d.taxYear,
      description: null,
      tags: [],
      reviewStatus: d.direction === 'FIRM_TO_CLIENT' ? 'COMPLETED' : null,
      reviewer: null,
      reviewedAt: null,
      reviewedBy: null,
      scanStatus: d.scanStatus,
      expiresOn: null,
      versionNo: 1,
      replacesId: null,
      superseded: false,
      requestId: d.requestId,
      visibleToClient: d.direction !== 'INTERNAL',
      uploadedBy: d.uploadedBy,
      createdAt: d.createdAt,
      updatedAt: d.createdAt,
      archivedAt: null,
      trashedAt: null,
    };
  };
  const loginsOf = (clientId: string) =>
    (clientFixtures().find((c) => c.id === clientId)?.portalLogins ?? [])
      .filter((l) => l.status === 'ACTIVE')
      .map((l) => ({
        id: l.clientAccountId,
        name: clientFixtures().find((c) => c.id === clientId)?.displayName ?? l.email,
        email: l.email,
        primary: l.portalRole === 'PRIMARY',
      }));
  const shareOf = (docId: string, id: string) => {
    const g = (grants.get(docId) ?? []).find((x) => x.id === id);
    if (!g) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
    return g;
  };
  const packets = options.empty ? [] : packetFixtures();
  const templates = options.empty ? [] : requestTemplateFixtures();
  const fail = (status: number, code: string, message: string) =>
    new ApiRequestError(status, code, message);
  const find = (id: string) => {
    const p = packets.find((x) => x.row.id === id);
    if (!p) throw fail(404, 'NOT_FOUND', 'Not found');
    return p;
  };
  const detail = (p: MockPacket): RequestPacketDetail => ({
    ...structuredClone(p.row),
    templateId: null,
    messageSubject: null,
    messageBody: null,
    notifyEmail: true,
    notifyPortal: true,
    notifySms: false,
    reminderDaysBefore: null,
    allowMultipleFiles: true,
    allowClientComments: true,
    requestedBy: MEMBERS[0] ?? null,
    submittedAt: null,
    completedAt: p.row.status === 'COMPLETED' ? p.row.updatedAt : null,
    cancelledAt: p.row.status === 'CANCELLED' ? p.row.updatedAt : null,
    checklist: [],
    activity: [],
    ...structuredClone(p.extra ?? {}),
  });
  /** Only an open request can be reminded, resent or completed (409 otherwise). */
  const open = (p: MockPacket) => {
    if (!['OPEN', 'SUBMITTED'].includes(p.row.status))
      throw fail(409, 'REQUEST_CLOSED', 'This request is not open');
  };
  const touch = (p: MockPacket, status?: RequestPacketRow['status']) => {
    if (status) p.row.status = status;
    p.row.updatedAt = new Date().toISOString();
    p.row.view = viewOf(p.row, p.required);
  };
  let events = 0;
  const log = (p: MockPacket, kind: DocumentActivity['kind'], label: string) => {
    p.extra ??= {};
    p.extra.activity = [
      {
        id: activityId(990, events++),
        at: new Date().toISOString(),
        kind,
        label,
        by: MEMBERS[0]?.name ?? null,
      },
      ...(p.extra.activity ?? []),
    ];
  };
  const checklistOf = (p: MockPacket) => ((p.extra ??= {}).checklist ??= []);
  /** The row's counts from the live checklist, as the API works them out. */
  const recount = (p: MockPacket) => {
    const live = checklistOf(p).filter((i) => i.status !== 'CANCELLED');
    p.required = live.filter((i) => i.required).length;
    p.row.items = {
      total: live.length,
      required: p.required,
      received: live.filter((i) => ['SUBMITTED', 'ACCEPTED', 'NOT_AVAILABLE'].includes(i.status))
        .length,
    };
    touch(p);
  };
  const draftOnly = (p: MockPacket) => {
    if (p.row.status !== 'DRAFT') throw fail(409, 'REQUEST_SENT', 'This request was sent');
  };
  const findItem = (itemId: string) => {
    for (const p of packets) {
      const item = checklistOf(p).find((i) => i.id === itemId);
      if (item) return { p, item };
    }
    return null;
  };
  // Accept and Request Replacement are the documents API's calls on one item: the shared
  // documents mock answers them for this mock's checklist items too.
  const documents = options.documents;
  const accept = documents.acceptRequest;
  const reject = documents.rejectRequest;
  type FirmRequest = Awaited<ReturnType<DocumentsClient['acceptRequest']>>;
  documents.acceptRequest = async (itemId) => {
    const hit = findItem(itemId);
    if (!hit) return accept(itemId);
    await mockDelay();
    if (hit.item.status !== 'SUBMITTED') throw fail(409, 'NOTHING_SUBMITTED', 'Nothing submitted');
    hit.item.status = 'ACCEPTED';
    hit.item.resolvedAt = new Date().toISOString();
    log(hit.p, 'REVIEW', `${hit.item.title} accepted`);
    recount(hit.p);
    return { id: itemId } as unknown as FirmRequest;
  };
  documents.rejectRequest = async (itemId, body) => {
    const hit = findItem(itemId);
    if (!hit) return reject(itemId, body);
    await mockDelay();
    if (hit.item.status !== 'SUBMITTED') throw fail(409, 'NOTHING_SUBMITTED', 'Nothing submitted');
    hit.item.status = 'REJECTED';
    hit.item.statusNote = body.reason;
    log(hit.p, 'REVIEW', `Replacement requested for ${hit.item.title}`);
    recount(hit.p);
    return { id: itemId } as unknown as FirmRequest;
  };
  return {
    list: notInMock,
    summary: notInMock,
    get: async (id) => {
      await mockDelay();
      return libraryDoc(id);
    },
    /** Through the documents mock, so `api.documents.confirmUpload` finds the ticket. */
    createUpload: async (body) =>
      options.documents.createUpload(body.clientId, {
        serviceId: body.serviceId,
        categoryId: body.categoryId ?? null,
        taxYear: body.taxYear ?? null,
        shareWithClient: body.shareWithClient ?? false,
        fileName: body.fileName,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    update: notInMock,
    review: notInMock,
    archive: notInMock,
    restore: notInMock,
    trash: notInMock,
    untrash: notInMock,
    versions: notInMock,
    activity: notInMock,
    preview: async (id) => {
      const d = await libraryDoc(id);
      if (d.scanStatus !== 'CLEAN') throw new ApiRequestError(409, 'FILE_NOT_CLEAN', 'Not clean');
      return options.documents.download(id);
    },
    bulk: notInMock,
    access: async (id) => {
      const d = await libraryDoc(id);
      return {
        document: { id, fileName: d.fileName, versionNo: d.versionNo, direction: d.direction },
        shares: structuredClone(grants.get(id) ?? []),
        clientLogins: d.direction === 'INTERNAL' ? [] : loginsOf(d.client.id),
      };
    },
    share: async (id, body) => {
      const input = parseInput(CreateDocumentShareRequest, body);
      const d = await libraryDoc(id);
      const list = grants.get(id) ?? [];
      const r = input.recipient;
      if (r.kind === 'CLIENT' && d.direction === 'INTERNAL')
        throw new ApiRequestError(409, 'INTERNAL_DOCUMENT', 'Internal document');
      const who =
        r.kind === 'CLIENT'
          ? loginsOf(d.client.id).find((l) => l.id === r.clientAccountId)
          : MEMBERS.map((m) => ({ id: m.userId, name: m.name, email: null })).find(
              (m) => m.id === r.userId,
            );
      if (!who) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
      if (list.some((g) => g.recipient.kind === r.kind && g.recipient.id === who.id))
        throw new ApiRequestError(409, 'SHARE_EXISTS', 'Already shared');
      const g: DocumentShare = {
        id: shareId(),
        recipient: { kind: r.kind, id: who.id, name: who.name, email: who.email },
        canDownload: input.canDownload,
        canUpload: input.canUpload,
        canSign: input.canSign,
        expiresAt: input.expiresAt ?? null,
        grantedBy: MEMBERS[0] ?? null,
        createdAt: new Date().toISOString(),
      };
      grants.set(id, [...list, g]);
      record(id, 'SHARED', `Shared with ${who.name}`);
      return structuredClone(g);
    },
    updateShare: async (id, sid, body) => {
      await mockDelay();
      const input = parseInput(UpdateDocumentShareRequest, body);
      const g = shareOf(id, sid);
      Object.assign(
        g,
        Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
      );
      record(id, 'SHARE_CHANGED', `Access of ${g.recipient.name} changed`);
      return structuredClone(g);
    },
    revokeShare: async (id, sid) => {
      await mockDelay();
      const g = shareOf(id, sid);
      grants.set(
        id,
        (grants.get(id) ?? []).filter((x) => x.id !== sid),
      );
      record(id, 'SHARE_REVOKED', `Access of ${g.recipient.name} revoked`);
      return { ok: true };
    },
    accessHistory: async (id) => {
      await mockDelay();
      return structuredClone(accessLog.get(id) ?? []);
    },
    folders: async () => {
      await mockDelay();
      return structuredClone(folders);
    },
    createFolder: async (body) => {
      await mockDelay();
      const input = parseInput(CreateDocumentFolderRequest, body);
      const parent = input.parentId ? folderOf(input.parentId) : null;
      if (nameTaken(input.name, input.parentId ?? null))
        throw new ApiRequestError(409, 'DUPLICATE_NAME', 'That name is taken');
      const scope = parent?.scope ?? input.scope;
      const now = new Date().toISOString();
      const f: DocumentFolder = {
        id: folderId(nextFolder++),
        name: input.name,
        description: input.description ?? null,
        parentId: parent?.id ?? null,
        scope,
        color: input.color ?? 'BLUE',
        sortOrder:
          folders.filter((x) => (x.parentId ?? null) === (parent?.id ?? null)).length + 100,
        requireExpiryDate: input.requireExpiryDate ?? false,
        remindBeforeExpiry: input.remindBeforeExpiry ?? false,
        allowClientUploads: scope === 'CLIENT' && (input.allowClientUploads ?? true),
        notifyStaffOnUpload: input.notifyStaffOnUpload ?? true,
        defaultClientAccess: scope === 'CLIENT' ? (input.defaultClientAccess ?? 'NONE') : 'NONE',
        documentCount: 0,
        subfolderCount: 0,
        createdAt: now,
        updatedAt: now,
      };
      folders = [...folders, f];
      recountFolders();
      return structuredClone(folderOf(f.id));
    },
    updateFolder: async (id, body) => {
      await mockDelay();
      const input = parseInput(UpdateDocumentFolderRequest, body);
      const f = folderOf(id);
      const parentId = input.parentId === undefined ? f.parentId : input.parentId;
      if (nameTaken(input.name ?? f.name, parentId, id))
        throw new ApiRequestError(409, 'DUPLICATE_NAME', 'That name is taken');
      folders = folders.map((x) =>
        x.id === id
          ? {
              ...x,
              ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
              parentId,
              updatedAt: new Date().toISOString(),
            }
          : x,
      );
      recountFolders();
      return structuredClone(folderOf(id));
    },
    deleteFolder: async (id) => {
      await mockDelay();
      const f = folderOf(id);
      if (f.documentCount || folders.some((x) => x.parentId === id))
        throw new ApiRequestError(409, 'FOLDER_NOT_EMPTY', 'The folder is not empty');
      folders = folders.filter((x) => x.id !== id);
      recountFolders();
      return { ok: true };
    },
    reorderFolders: async (body) => {
      await mockDelay();
      const input = parseInput(ReorderDocumentFoldersRequest, body);
      folders = folders.map((f) =>
        input.ids.includes(f.id) ? { ...f, sortOrder: input.ids.indexOf(f.id) } : f,
      );
      return structuredClone(folders.filter((f) => (f.parentId ?? null) === input.parentId));
    },
    createCategory: async (body) => {
      await mockDelay();
      const input = parseInput(CreateDocumentCategoryRequest, body);
      const c: DocumentCategory = {
        id: folderId(500 + added.length),
        name: input.name,
        retentionYears: input.retentionYears ?? null,
        archivedAt: null,
      };
      added.push(c);
      return structuredClone(c);
    },
    updateCategory: async (id, body) => {
      await mockDelay();
      const input = parseInput(UpdateDocumentCategoryRequest, body);
      const next: Partial<DocumentCategory> = { ...changed.get(id) };
      if (input.name !== undefined) next.name = input.name;
      if (input.retentionYears !== undefined) next.retentionYears = input.retentionYears;
      if (input.archived !== undefined)
        next.archivedAt = input.archived ? new Date().toISOString() : null;
      changed.set(id, next);
      const all = await options.documents.categories();
      const c = all.find((x) => x.id === id);
      if (!c) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
      return structuredClone(c);
    },
    requests: async (query) => {
      await mockDelay();
      const q = parseInput(RequestPacketsQuery, query ?? {});
      const text = q.search?.toLowerCase();
      const template = templates.find((x) => x.id === q.templateId);
      let rows = packets
        .map((p) => p.row)
        .filter(TABS[q.tab]!)
        .filter(
          (r) =>
            !text ||
            [r.title, r.reference, r.client.name].some((v) => v.toLowerCase().includes(text)),
        )
        .filter((r) => !q.clientId || r.client.id === q.clientId)
        .filter((r) => !q.assignedUserId || r.assignedTo?.userId === q.assignedUserId)
        .filter((r) => !q.dueFrom || (!!r.dueOn && r.dueOn >= q.dueFrom))
        .filter((r) => !q.dueTo || (!!r.dueOn && r.dueOn <= q.dueTo))
        .filter(
          (r) =>
            !q.templateId ||
            (!!template &&
              r.title.toLowerCase().includes(template.name.split(' ')[0]!.toLowerCase())),
        );
      const byTitle = (a: RequestPacketRow, b: RequestPacketRow) => a.title.localeCompare(b.title);
      if (q.sort === 'due')
        rows = rows.sort(
          (a, b) => (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') || byTitle(a, b),
        );
      else if (q.sort === 'client')
        rows = rows.sort((a, b) => a.client.name.localeCompare(b.client.name) || byTitle(a, b));
      else if (q.sort === 'title') rows = rows.sort(byTitle);
      else
        rows = rows.sort((a, b) =>
          (b.sentAt ?? b.updatedAt).localeCompare(a.sentAt ?? a.updatedAt),
        );
      const start = (q.page - 1) * q.pageSize;
      return {
        items: structuredClone(rows.slice(start, start + q.pageSize)),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    requestSummary: async () => {
      await mockDelay();
      const rows = packets.map((p) => p.row);
      const count = (tab: string) => rows.filter(TABS[tab]!).length;
      return {
        total: count('all'),
        outstanding: count('outstanding'),
        partiallyReceived: count('partially_received'),
        completed: count('completed'),
        overdue: count('overdue'),
      };
    },
    request: async (id) => {
      await mockDelay();
      return detail(find(id));
    },
    createRequest: async (body) => {
      await mockDelay();
      const input = parseInput(CreateRequestPacketRequest, body);
      const client = clientFixtures().find((c) => c.id === input.clientId);
      if (!client) throw fail(404, 'NOT_FOUND', 'Not found');
      const template = templates.find((t) => t.id === input.templateId);
      const items = [
        ...(template?.items ?? []).map((i) => ({ ...i, instructions: i.description })),
        ...(input.items ?? []).map((i) => ({ ...i, instructions: i.instructions ?? null })),
      ];
      if (
        input.send &&
        (!input.dueOn || !input.messageSubject || !input.messageBody || !items.length)
      )
        throw fail(400, 'REQUEST_INCOMPLETE', 'Add the missing parts before sending');
      const n = Math.max(0, ...packets.map((p) => Number(p.row.reference.slice(3)))) + 1;
      const member =
        input.recipient.kind === 'MEMBER'
          ? MEMBERS.find((m) => m.userId === (input.recipient as { userId: string }).userId)
          : undefined;
      const now = new Date().toISOString();
      const required = items.filter((i) => i.required).length;
      const p: MockPacket = {
        required,
        row: {
          id: packetId(n),
          reference: `DR-${String(n).padStart(4, '0')}`,
          title: input.title,
          client: { id: client.id, name: client.displayName },
          service: { id: input.serviceId ?? packetId(900 + n), title: 'Personal Tax Intake' },
          recipient: member
            ? { kind: 'MEMBER', userId: member.userId, name: member.name }
            : { kind: 'CLIENT', userId: null, name: client.displayName },
          status: input.send ? 'OPEN' : 'DRAFT',
          view: 'DRAFT',
          items: { total: items.length, required, received: 0 },
          dueOn: input.dueOn ?? null,
          expiresAt: input.expiresAt ?? null,
          assignedTo: null,
          sentAt: input.send ? now : null,
          updatedAt: now,
        },
        extra: {
          templateId: input.templateId ?? null,
          messageSubject: input.messageSubject ?? null,
          messageBody: input.messageBody ?? null,
          notifyEmail: input.notifyEmail ?? true,
          notifyPortal: input.notifyPortal ?? true,
          notifySms: input.notifySms ?? false,
          reminderDaysBefore: input.reminderDaysBefore ?? null,
          allowMultipleFiles: input.allowMultipleFiles ?? true,
          allowClientComments: input.allowClientComments ?? true,
          checklist: items.map((i, k) => ({
            id: `0199d2b0-7d00-7000-8000-${String(n * 100 + k).padStart(12, '0')}`,
            title: i.title,
            instructions: i.instructions,
            required: i.required,
            category: null,
            status: 'REQUESTED' as const,
            statusNote: null,
            sortOrder: k,
            documents: [],
            resolvedAt: null,
          })),
        },
      };
      p.row.view = viewOf(p.row, p.required);
      packets.unshift(p);
      return detail(p);
    },
    updateRequest: async (id, body) => {
      await mockDelay();
      const input = parseInput(UpdateRequestPacketRequest, body);
      const p = find(id);
      const later = ['dueOn', 'assignedUserId', 'reminderDaysBefore', 'expiresAt'];
      if (p.row.status !== 'DRAFT' && Object.keys(input).some((k) => !later.includes(k)))
        throw fail(409, 'REQUEST_SENT', 'This request was sent');
      if (input.title !== undefined) p.row.title = input.title;
      if (input.dueOn !== undefined) p.row.dueOn = input.dueOn;
      if (input.expiresAt !== undefined) p.row.expiresAt = input.expiresAt;
      if (input.assignedUserId !== undefined)
        p.row.assignedTo = MEMBERS.find((m) => m.userId === input.assignedUserId) ?? null;
      p.extra ??= {};
      if (input.messageSubject !== undefined) p.extra.messageSubject = input.messageSubject;
      if (input.messageBody !== undefined) p.extra.messageBody = input.messageBody;
      if (input.reminderDaysBefore !== undefined)
        p.extra.reminderDaysBefore = input.reminderDaysBefore;
      touch(p);
      return detail(p);
    },
    sendRequest: async (id) => {
      await mockDelay();
      const p = find(id);
      if (p.row.status !== 'DRAFT') throw fail(409, 'INVALID_STATUS', 'Already sent');
      const live = checklistOf(p).filter((i) => i.status !== 'CANCELLED');
      if (!p.row.dueOn || !p.extra?.messageSubject || !p.extra.messageBody || !live.length)
        throw fail(400, 'REQUEST_INCOMPLETE', 'Add the missing parts before sending');
      p.row.sentAt = new Date().toISOString();
      log(p, 'REQUEST_SENT', `Request sent to ${p.row.recipient.name}`);
      touch(p, 'OPEN');
      return detail(p);
    },
    resendRequest: async (id) => {
      await mockDelay();
      const p = find(id);
      open(p);
      p.row.sentAt = new Date().toISOString();
      log(p, 'REQUEST_SENT', `Request sent again to ${p.row.recipient.name}`);
      touch(p);
      return detail(p);
    },
    remindRequest: async (id) => {
      await mockDelay();
      const p = find(id);
      open(p);
      log(p, 'REQUEST_REMINDED', `Reminder sent to ${p.row.recipient.name}`);
      touch(p);
      return detail(p);
    },
    completeRequest: async (id) => {
      await mockDelay();
      const p = find(id);
      open(p);
      touch(p, 'COMPLETED');
      return detail(p);
    },
    cancelRequest: async (id) => {
      await mockDelay();
      const p = find(id);
      if (['COMPLETED', 'CANCELLED'].includes(p.row.status))
        throw fail(409, 'REQUEST_CLOSED', 'This request is closed');
      touch(p, 'CANCELLED');
      return detail(p);
    },
    bulkRequests: async (body) => {
      await mockDelay();
      const input = parseInput(BulkRequestPacketsRequest, body);
      let updated = 0;
      const skipped: { id: string; code: string }[] = [];
      for (const id of input.ids) {
        const p = packets.find((x) => x.row.id === id);
        if (!p || !['OPEN', 'SUBMITTED'].includes(p.row.status)) {
          skipped.push({ id, code: p ? 'REQUEST_CLOSED' : 'NOT_FOUND' });
          continue;
        }
        if (input.action === 'ASSIGN')
          p.row.assignedTo = MEMBERS.find((m) => m.userId === input.assignedUserId) ?? null;
        touch(p);
        updated += 1;
      }
      return { updated, skipped };
    },
    addItem: async (id, body) => {
      await mockDelay();
      const input = parseInput(CreateRequestItemRequest, body);
      const p = find(id);
      draftOnly(p);
      const list = checklistOf(p);
      list.push({
        id: itemId(Number(p.row.reference.slice(3)), 80 + list.length),
        title: input.title,
        instructions: input.instructions ?? null,
        required: input.required,
        category: null,
        status: 'REQUESTED',
        statusNote: null,
        sortOrder: list.length,
        documents: [],
        resolvedAt: null,
      });
      recount(p);
      return detail(p);
    },
    updateItem: async (id, itemId, body) => {
      await mockDelay();
      const input = parseInput(UpdateRequestItemRequest, body);
      const p = find(id);
      draftOnly(p);
      const item = checklistOf(p).find((i) => i.id === itemId);
      if (!item) throw fail(404, 'NOT_FOUND', 'Not found');
      if (input.title !== undefined) item.title = input.title;
      if (input.instructions !== undefined) item.instructions = input.instructions;
      if (input.required !== undefined) item.required = input.required;
      recount(p);
      return detail(p);
    },
    removeItem: async (id, itemId) => {
      await mockDelay();
      const p = find(id);
      draftOnly(p);
      const item = checklistOf(p).find((i) => i.id === itemId);
      if (!item) throw fail(404, 'NOT_FOUND', 'Not found');
      item.status = 'CANCELLED';
      recount(p);
      return detail(p);
    },
    reorderItems: notInMock,
    templates: async () => {
      await mockDelay();
      return structuredClone(templates);
    },
    createTemplate: notInMock,
    updateTemplate: notInMock,
    archiveTemplate: notInMock,
    settings: async () => {
      await mockDelay();
      return structuredClone(settings);
    },
    updateSettings: async (body) => {
      await mockDelay();
      const input = parseInput(UpdateDocumentSettingsRequest, body);
      const { defaultReviewerUserId, ...rest } = input;
      settings = {
        ...settings,
        ...Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)),
        ...(defaultReviewerUserId !== undefined
          ? { defaultReviewer: MEMBERS.find((m) => m.userId === defaultReviewerUserId) ?? null }
          : {}),
        updatedAt: new Date().toISOString(),
      };
      return structuredClone(settings);
    },
  };
}
