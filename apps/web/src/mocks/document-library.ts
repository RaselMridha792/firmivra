import {
  ApiRequestError,
  BulkRequestPacketsRequest,
  DocumentFolder,
  type DocumentLibraryClient,
  type DocumentsClient,
  parseInput,
  type RequestPacketDetail,
  type RequestPacketRow,
  RequestPacketsQuery,
  type RequestPacketView,
  type RequestTemplate,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

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
    { ...folder(1, 'Client Documents', 'CLIENT', null, 'YELLOW'), subfolderCount: children.length },
    ...children.map((name, i) => folder(i + 2, name, 'CLIENT', 1, 'BLUE')),
    folder(20, 'Firm Documents', 'FIRM', null, 'GRAY'),
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

/** Synthetic request templates (the firm's request types). */
export function requestTemplateFixtures(): RequestTemplate[] {
  const item = (t: number, n: number, title: string) => ({
    id: `0199d2b0-7e00-7000-8000-${String(t * 100 + n).padStart(12, '0')}`,
    title,
    description: null,
    required: true,
    category: null,
  });
  const template = (n: number, name: string, titles: string[]): RequestTemplate => ({
    id: templateId(n),
    name,
    description: null,
    owner: 'FIRM',
    items: titles.map((t, i) => item(n, i + 1, t)),
    updatedAt: ago(48 * n),
  });
  return [
    template(1, 'Personal Tax Documents', ['W-2', '1099-INT', '1098', 'Prior return', 'ID']),
    template(2, 'Business Tax Documents', [
      'P&L',
      'Balance sheet',
      '1099s',
      'Payroll',
      'Assets',
      'Loans',
    ]),
    template(3, 'Bookkeeping Onboarding', [
      'Bank statements',
      'Card statements',
      'Accounts',
      'Loans',
    ]),
    template(4, 'Payroll Setup', ['EIN letter', 'State IDs', 'Employee list', 'Pay schedule']),
    template(5, 'New Client Intake', [
      'ID',
      'Engagement letter',
      'Prior return',
      'Address',
      'Bank',
    ]),
  ];
}

interface MockPacket {
  row: RequestPacketRow;
  required: number;
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
  for (const p of list) p.row.view = viewOf(p.row, p.required);
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
  const folders = options.empty ? [] : documentFolderFixtures();
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
  return {
    list: notInMock,
    summary: notInMock,
    get: notInMock,
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
    preview: notInMock,
    bulk: notInMock,
    access: notInMock,
    share: notInMock,
    updateShare: notInMock,
    revokeShare: notInMock,
    accessHistory: notInMock,
    folders: async () => {
      await mockDelay();
      return structuredClone(folders);
    },
    createFolder: notInMock,
    updateFolder: notInMock,
    deleteFolder: notInMock,
    reorderFolders: notInMock,
    createCategory: notInMock,
    updateCategory: notInMock,
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
    createRequest: notInMock,
    updateRequest: notInMock,
    sendRequest: notInMock,
    resendRequest: async (id) => {
      await mockDelay();
      const p = find(id);
      open(p);
      p.row.sentAt = new Date().toISOString();
      touch(p);
      return detail(p);
    },
    remindRequest: async (id) => {
      await mockDelay();
      const p = find(id);
      open(p);
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
    addItem: notInMock,
    updateItem: notInMock,
    removeItem: notInMock,
    reorderItems: notInMock,
    templates: async () => {
      await mockDelay();
      return structuredClone(templates);
    },
    createTemplate: notInMock,
    updateTemplate: notInMock,
    archiveTemplate: notInMock,
    settings: notInMock,
    updateSettings: notInMock,
  };
}
