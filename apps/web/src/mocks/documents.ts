import {
  ApiRequestError,
  ConfirmUploadRequest,
  CreateDocumentRequestRequest,
  CreateFirmUploadRequest,
  CreateMyUploadRequest,
  type DocumentCategory,
  DocumentId,
  DocumentRequestId,
  type DocumentsClient,
  type Engagement,
  type FirmDocument,
  type FirmDocumentRequest,
  ListDocumentRequestsQuery,
  ListFirmDocumentsQuery,
  ListMyDocumentsQuery,
  type MyDocument,
  type MyDocumentsClient,
  NotAvailableRequest,
  parseInput,
  RejectDocumentRequestRequest,
  TAX_SERVICE_KINDS,
  type UploadTicket,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { clientFixtures, firstClientId, type MockFirmRole, mockStaff } from './clients';
import { engagementFixtures } from './engagements';

/**
 * Mock data for `api.documents` (firm) and `api.myDocuments(slug)` (portal), R5. Synthetic data
 * only. Same input checks, rules and error codes as the API: uploads only for an open service,
 * downloads only after a clean scan, and INTERNAL files never in the portal. A mock upload needs
 * no storage: its ticket URL starts with `mock:` and `uploadFile()` skips the PUT. A new upload
 * is CHECKING for a few seconds, then READY. Nothing is built until the first call.
 */
const at = (day: number) => `2026-09-${String(day).padStart(2, '0')}T15:00:00.000Z`;
const docId = (n: number) => `0199b6a5-0000-7000-8000-${String(n).padStart(12, '0')}`;
const requestId = (n: number) => `0199b6a6-0000-7000-8000-${String(n).padStart(12, '0')}`;
const categoryId = (n: number) => `0199b6a7-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SCAN_MS = 4000;

interface Fixtures {
  categories: DocumentCategory[];
  documents: FirmDocument[];
  requests: FirmDocumentRequest[];
}
let fixtures: Fixtures | undefined;

/**
 * Client 1's files and requests (the signed-in portal client), on R10's mock services: the 2025
 * tax return and bookkeeping are open; the 2024 return is completed.
 */
export function documentFixtures(): Readonly<Fixtures> {
  if (fixtures) return fixtures;
  const engagements = engagementFixtures();
  const service = (n: number) => {
    const e = engagements[n - 1]!;
    return { id: e.id, title: e.title };
  };
  const categories: DocumentCategory[] = [
    { id: categoryId(1), name: 'Tax Documents', retentionYears: 7, archivedAt: null },
    { id: categoryId(2), name: 'Business Documents', retentionYears: 7, archivedAt: null },
    { id: categoryId(3), name: 'Identification', retentionYears: null, archivedAt: null },
    { id: categoryId(4), name: 'Old Receipts', retentionYears: 3, archivedAt: at(1) },
  ];
  const category = (n: number) => ({ id: categoryId(n), name: categories[n - 1]!.name });
  const client = { name: 'Jamie Sample', byClient: true };
  const staff = { name: mockStaff.name, byClient: false };
  const doc = (n: number, data: Partial<FirmDocument> & { fileName: string }): FirmDocument => ({
    id: docId(n),
    clientId: firstClientId,
    service: service(1),
    category: category(1),
    requestId: null,
    direction: 'CLIENT_TO_FIRM',
    contentType: 'application/pdf',
    sizeBytes: 182_400 + n * 1000,
    taxYear: 2025,
    scanStatus: 'CLEAN',
    uploadedBy: client,
    createdAt: at(10 + n),
    ...data,
  });
  const documents = [
    doc(1, { fileName: 'W-2_2025.pdf', requestId: requestId(1) }),
    doc(2, { fileName: 'Business_Expenses_Q3.pdf', service: service(2), category: category(2) }),
    doc(3, { fileName: '1099-NEC_2025.pdf', scanStatus: 'PENDING' }),
    doc(4, {
      fileName: 'Driver_License.jpg',
      contentType: 'image/jpeg',
      category: category(3),
      taxYear: null,
    }),
    doc(5, {
      fileName: 'Engagement_Letter_2025.pdf',
      direction: 'FIRM_TO_CLIENT',
      uploadedBy: staff,
    }),
    doc(6, {
      fileName: 'Tax_Return_2024.pdf',
      service: service(3),
      direction: 'FIRM_TO_CLIENT',
      taxYear: 2024,
      uploadedBy: staff,
    }),
    doc(7, { fileName: 'Preparer_Worksheet.pdf', direction: 'INTERNAL', uploadedBy: staff }),
    doc(8, { fileName: 'Scanned_Receipt.pdf', scanStatus: 'INFECTED', category: null }),
  ];
  const request = (
    n: number,
    data: Partial<FirmDocumentRequest> & { title: string },
  ): FirmDocumentRequest => ({
    id: requestId(n),
    clientId: firstClientId,
    service: service(1),
    category: category(1),
    instructions: null,
    dueOn: '2026-10-31',
    status: 'REQUESTED',
    statusNote: null,
    documents: [],
    requestedBy: mockStaff,
    createdAt: at(5 + n),
    resolvedAt: null,
    ...data,
  });
  const requests = [
    request(1, {
      title: 'W-2 from your employer',
      status: 'SUBMITTED',
      documents: [{ id: docId(1), fileName: 'W-2_2025.pdf', createdAt: at(11) }],
    }),
    request(2, {
      title: '1099-INT from your bank',
      instructions: 'One for each bank account that paid interest.',
    }),
    request(3, {
      title: 'Bank statements for September',
      service: service(2),
      category: category(2),
      status: 'REJECTED',
      statusNote: 'Pages 3 and 4 are missing. Please upload the whole statement.',
    }),
    request(4, {
      title: 'Childcare receipts',
      status: 'NOT_AVAILABLE',
      statusNote: 'We had no childcare costs this year.',
    }),
  ];
  fixtures = { categories, documents, requests };
  return fixtures;
}

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const now = () => new Date().toISOString();
/** Requests the client can still answer. */
const isOpen = (r: { status: string }) => r.status === 'REQUESTED' || r.status === 'REJECTED';
const page = <T>(items: T[], query: { cursor?: string; limit: number }) => {
  const start = Number(query.cursor ?? 0);
  const next = start + query.limit;
  return {
    items: items.slice(start, next),
    nextCursor: next < items.length ? String(next) : null,
  };
};
const yearsOf = (docs: FirmDocument[]) =>
  [...new Set(docs.flatMap((d) => (d.taxYear === null ? [] : [d.taxYear])))].sort((a, b) => b - a);

/** In-memory state shared by one mock client: documents, requests and pending uploads. */
function store() {
  const f = documentFixtures();
  let documents = structuredClone(f.documents);
  let requests = structuredClone(f.requests);
  const categories = structuredClone(f.categories);
  const pending = new Map<string, { clientId: string; body: Record<string, unknown> }>();
  /** When each new upload's scan finishes (a few seconds after it was stored). */
  const readyAt = new Map<string, number>();
  let next = 100;
  const scanOf = (d: FirmDocument): FirmDocument['scanStatus'] =>
    d.scanStatus === 'PENDING' && (readyAt.get(d.id) ?? Infinity) <= Date.now()
      ? 'CLEAN'
      : d.scanStatus;
  const view = (d: FirmDocument): FirmDocument => structuredClone({ ...d, scanStatus: scanOf(d) });

  return {
    get documents() {
      return documents;
    },
    get requests() {
      return requests;
    },
    categories,
    scanOf,
    view,
    engagement: (clientId: string, serviceId: string): Engagement | undefined =>
      engagementFixtures().find((e) => e.id === serviceId && e.clientId === clientId),
    category: (id: string | null | undefined) => {
      if (!id) return null;
      const c = categories.find((x) => x.id === id);
      if (!c) throw notFound();
      if (c.archivedAt) throw fail(409, 'CATEGORY_ARCHIVED', 'This category is archived');
      return { id: c.id, name: c.name };
    },
    ticket: (
      clientId: string,
      body: Record<string, unknown>,
      contentType: string,
    ): UploadTicket => {
      const n = next++;
      pending.set(`mock-upload-${n}`, { clientId, body });
      return {
        uploadToken: `mock-upload-${n}`,
        url: `mock:upload/${n}`,
        method: 'PUT',
        headers: { 'content-type': contentType },
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    },
    /** Step 3: the pending upload becomes a document (scan running); its request is answered. */
    confirm: (
      token: string,
      make: (p: { clientId: string; body: Record<string, unknown> }, id: string) => FirmDocument,
    ) => {
      const p = pending.get(token);
      if (!p) throw fail(410, 'UPLOAD_EXPIRED', 'This upload has expired. Please try again.');
      pending.delete(token);
      const d = make(p, docId(next++));
      readyAt.set(d.id, Date.now() + SCAN_MS);
      documents = [d, ...documents];
      if (d.requestId) {
        requests = requests.map((r) =>
          r.id === d.requestId
            ? {
                ...r,
                status: 'SUBMITTED',
                statusNote: null,
                documents: [
                  { id: d.id, fileName: d.fileName, createdAt: d.createdAt },
                  ...r.documents,
                ],
              }
            : r,
        );
      }
      return d;
    },
    openRequest: (id: string, serviceId: string) => {
      const r = requests.find((x) => x.id === id);
      if (!r || r.service.id !== serviceId || !isOpen(r)) {
        throw fail(409, 'REQUEST_CLOSED', 'This request is no longer open');
      }
    },
    addRequest: (r: Omit<FirmDocumentRequest, 'id'>) => {
      const added = { ...r, id: requestId(next++) };
      requests = [added, ...requests];
      return structuredClone(added);
    },
    replaceRequest: (r: FirmDocumentRequest) => {
      requests = requests.map((x) => (x.id === r.id ? r : x));
      return structuredClone(r);
    },
    download: (d: FirmDocument) => {
      const scan = scanOf(d);
      if (scan === 'PENDING') throw fail(409, 'SCAN_PENDING', 'The file is still being checked');
      if (scan !== 'CLEAN') throw fail(409, 'FILE_BLOCKED', 'This file failed the security check');
      return {
        url: `data:text/plain;charset=utf-8,${encodeURIComponent(`Mock file: ${d.fileName}`)}`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    },
  };
}

/**
 * An in-memory `api.documents` (firm). `role: 'STAFF'` is Sam Staff: only the clients assigned to
 * them exist (as in the clients mock). Only client 1 has documents.
 */
export function createDocumentsMock(options: { role?: MockFirmRole } = {}): DocumentsClient {
  const s = store();
  const reachable = (clientId: string) => {
    const c = clientFixtures().find((x) => x.id === clientId);
    if (!c || (options.role === 'STAFF' && c.assignedTo?.userId !== mockStaff.userId)) {
      throw notFound();
    }
    return c.id;
  };
  const visible = (d: FirmDocument) => {
    reachable(d.clientId);
    return d;
  };
  const findDoc = (id: string) => {
    const d = s.documents.find((x) => x.id === parseInput(DocumentId, id));
    if (!d) throw notFound();
    return visible(d);
  };
  const findRequest = (id: string) => {
    const r = s.requests.find((x) => x.id === parseInput(DocumentRequestId, id));
    if (!r) throw notFound();
    reachable(r.clientId);
    return r;
  };
  const decide = (id: string, change: Partial<FirmDocumentRequest>) => {
    const r = findRequest(id);
    if (r.status === 'ACCEPTED' || r.status === 'CANCELLED') {
      throw fail(409, 'REQUEST_CLOSED', 'This request is closed');
    }
    if (change.status !== 'CANCELLED' && r.status !== 'SUBMITTED') {
      throw fail(409, 'NOTHING_SUBMITTED', 'Nothing has been uploaded for this request yet');
    }
    return s.replaceRequest({ ...r, ...change });
  };

  return {
    list: async (clientId, query = {}) => {
      await mockDelay();
      const q = parseInput(ListFirmDocumentsQuery, query);
      const docs = s.documents.filter((d) => d.clientId === reachable(clientId));
      const found = docs
        .filter((d) => !q.serviceId || d.service.id === q.serviceId)
        .filter((d) => !q.categoryId || d.category?.id === q.categoryId)
        .filter((d) => !q.taxYear || d.taxYear === q.taxYear)
        .filter((d) => !q.direction || d.direction === q.direction)
        .filter((d) => !q.search || d.fileName.toLowerCase().includes(q.search.toLowerCase()))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(s.view);
      return { ...page(found, q), years: yearsOf(docs) };
    },
    get: async (id) => {
      await mockDelay();
      return s.view(findDoc(id));
    },
    createUpload: async (clientId, body) => {
      await mockDelay();
      const b = parseInput(CreateFirmUploadRequest, body);
      const e = s.engagement(reachable(clientId), b.serviceId);
      if (!e) throw notFound();
      if (e.status !== 'ACTIVE') throw fail(409, 'NO_OPEN_SERVICE', 'This service is not open');
      s.category(b.categoryId);
      return s.ticket(clientId, b, b.contentType);
    },
    confirmUpload: async (body) => {
      await mockDelay();
      const { uploadToken } = parseInput(ConfirmUploadRequest, body);
      const d = s.confirm(uploadToken, ({ clientId, body: raw }, id) => {
        const b = raw as ReturnType<typeof CreateFirmUploadRequest.parse>;
        const e = s.engagement(clientId, b.serviceId)!;
        return {
          id,
          clientId,
          service: { id: e.id, title: e.title },
          category: s.category(b.categoryId),
          requestId: null,
          direction: b.shareWithClient ? 'FIRM_TO_CLIENT' : 'INTERNAL',
          fileName: b.fileName,
          contentType: b.contentType,
          sizeBytes: b.sizeBytes,
          taxYear: b.taxYear ?? null,
          scanStatus: 'PENDING',
          uploadedBy: { name: mockStaff.name, byClient: false },
          createdAt: now(),
        };
      });
      return s.view(d);
    },
    download: async (id) => {
      await mockDelay();
      return s.download(findDoc(id));
    },
    categories: async () => {
      await mockDelay();
      return structuredClone(s.categories);
    },
    requests: async (clientId, query = {}) => {
      await mockDelay();
      const q = parseInput(ListDocumentRequestsQuery, query);
      return structuredClone(
        s.requests
          .filter((r) => r.clientId === reachable(clientId))
          .filter((r) => !q.status || r.status === q.status)
          .filter((r) => !q.serviceId || r.service.id === q.serviceId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    },
    createRequest: async (clientId, body) => {
      await mockDelay();
      const b = parseInput(CreateDocumentRequestRequest, body);
      const e = s.engagement(reachable(clientId), b.serviceId);
      if (!e) throw notFound();
      if (e.status !== 'ACTIVE') throw fail(409, 'NO_OPEN_SERVICE', 'This service is not open');
      return s.addRequest({
        clientId,
        service: { id: e.id, title: e.title },
        category: s.category(b.categoryId),
        title: b.title,
        instructions: b.instructions ?? null,
        dueOn: b.dueOn ?? null,
        status: 'REQUESTED',
        statusNote: null,
        documents: [],
        requestedBy: mockStaff,
        createdAt: now(),
        resolvedAt: null,
      });
    },
    acceptRequest: async (id) => {
      await mockDelay();
      return decide(id, { status: 'ACCEPTED', resolvedAt: now() });
    },
    rejectRequest: async (id, body) => {
      await mockDelay();
      const { reason } = parseInput(RejectDocumentRequestRequest, body);
      return decide(id, { status: 'REJECTED', statusNote: reason });
    },
    cancelRequest: async (id) => {
      await mockDelay();
      return decide(id, { status: 'CANCELLED', resolvedAt: now() });
    },
  };
}

let myMocks: Map<string, MyDocumentsClient> | undefined;

/**
 * `api.myDocuments(slug)` in mock mode: one mock per firm, so an upload's three steps (and what
 * it saved) reach the same mock however often the page calls `api.myDocuments(slug)`.
 */
export function myDocumentsMock(firmSlug: string): MyDocumentsClient {
  myMocks ??= new Map();
  const slug = firmSlug.toLowerCase();
  let mock = myMocks.get(slug);
  if (!mock) {
    mock = createMyDocumentsMock();
    myMocks.set(slug, mock);
  }
  return mock;
}

/** An in-memory `api.myDocuments(slug)` for the signed-in portal client (client 1). */
export function createMyDocumentsMock(): MyDocumentsClient {
  const s = store();
  const me = firstClientId;
  const STATUS = {
    PENDING: 'CHECKING',
    CLEAN: 'READY',
    INFECTED: 'BLOCKED',
    FAILED: 'BLOCKED',
  } as const;
  // Never INTERNAL, never another client's.
  const mine = () => s.documents.filter((d) => d.clientId === me && d.direction !== 'INTERNAL');
  const toMine = (d: FirmDocument): MyDocument => ({
    id: d.id,
    source: d.direction === 'CLIENT_TO_FIRM' ? 'MINE' : 'FIRM',
    service: { ...d.service },
    category: d.category && { ...d.category },
    requestId: d.requestId,
    fileName: d.fileName,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    taxYear: d.taxYear,
    status: STATUS[s.scanOf(d)],
    uploadedAt: d.createdAt,
  });
  const findMine = (id: string) => {
    const d = mine().find((x) => x.id === parseInput(DocumentId, id));
    if (!d) throw notFound();
    return d;
  };
  const myRequests = () => s.requests.filter((r) => r.clientId === me && r.status !== 'CANCELLED');

  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ListMyDocumentsQuery, query);
      const docs = mine().filter(
        (d) => (q.source === 'MINE') === (d.direction === 'CLIENT_TO_FIRM'),
      );
      const found = docs
        .filter((d) => !q.categoryId || d.category?.id === q.categoryId)
        .filter((d) => !q.taxYear || d.taxYear === q.taxYear)
        .filter((d) => !q.search || d.fileName.toLowerCase().includes(q.search.toLowerCase()))
        .sort((a, b) =>
          q.sort === 'name'
            ? a.fileName.localeCompare(b.fileName)
            : b.createdAt.localeCompare(a.createdAt),
        )
        .map(toMine);
      return { ...page(found, q), years: yearsOf(docs) };
    },
    get: async (id) => {
      await mockDelay();
      return toMine(findMine(id));
    },
    uploadTargets: async () => {
      await mockDelay();
      const open = engagementFixtures().filter((e) => e.clientId === me && e.status === 'ACTIVE');
      const target = (e: Engagement) => ({
        serviceId: e.id,
        title: e.title,
        taxYear: e.taxYear,
        openRequests: myRequests()
          .filter((r) => r.service.id === e.id && isOpen(r))
          .map((r) => ({ id: r.id, title: r.title, dueOn: r.dueOn })),
      });
      const isTax = (e: Engagement) =>
        (TAX_SERVICE_KINDS as readonly string[]).includes(e.service.kind);
      return {
        tax: open.filter(isTax).map(target),
        business: open.filter((e) => !isTax(e)).map(target),
      };
    },
    createUpload: async (body) => {
      await mockDelay();
      const b = parseInput(CreateMyUploadRequest, body);
      const e = s.engagement(me, b.serviceId);
      if (e?.status !== 'ACTIVE') throw fail(409, 'NO_OPEN_SERVICE', 'This service is not open');
      if (b.requestId) s.openRequest(b.requestId, b.serviceId);
      s.category(b.categoryId);
      return s.ticket(me, b, b.contentType);
    },
    confirmUpload: async (body) => {
      await mockDelay();
      const { uploadToken } = parseInput(ConfirmUploadRequest, body);
      const d = s.confirm(uploadToken, ({ body: raw }, id) => {
        const b = raw as ReturnType<typeof CreateMyUploadRequest.parse>;
        const e = s.engagement(me, b.serviceId)!;
        return {
          id,
          clientId: me,
          service: { id: e.id, title: e.title },
          category: s.category(b.categoryId),
          requestId: b.requestId ?? null,
          direction: 'CLIENT_TO_FIRM',
          fileName: b.fileName,
          contentType: b.contentType,
          sizeBytes: b.sizeBytes,
          taxYear: b.taxYear ?? e.taxYear,
          scanStatus: 'PENDING',
          uploadedBy: { name: 'Jamie Sample', byClient: true },
          createdAt: now(),
        };
      });
      return toMine(d);
    },
    download: async (id) => {
      await mockDelay();
      return s.download(findMine(id));
    },
    categories: async () => {
      await mockDelay();
      return s.categories.filter((c) => !c.archivedAt).map((c) => ({ id: c.id, name: c.name }));
    },
    requests: async () => {
      await mockDelay();
      return myRequests()
        .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)))
        .map(({ id, service, category, title, instructions, dueOn, status, statusNote }) =>
          structuredClone({
            id,
            service,
            category,
            title,
            instructions,
            dueOn,
            status,
            statusNote,
          }),
        );
    },
    notAvailable: async (id, body) => {
      await mockDelay();
      const key = parseInput(DocumentRequestId, id);
      const { reason } = parseInput(NotAvailableRequest, body);
      const r = myRequests().find((x) => x.id === key);
      if (!r) throw notFound();
      if (!isOpen(r)) throw fail(409, 'REQUEST_CLOSED', 'This request is closed');
      const {
        clientId: _c,
        documents: _d,
        requestedBy: _b,
        createdAt: _a,
        resolvedAt: _r,
        ...rest
      } = s.replaceRequest({ ...r, status: 'NOT_AVAILABLE', statusNote: reason });
      return rest;
    },
  };
}
