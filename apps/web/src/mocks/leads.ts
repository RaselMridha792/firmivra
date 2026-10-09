import {
  ApiRequestError,
  ConvertLeadRequest,
  DeclineLeadRequest,
  INTAKE_FORMS,
  type LeadDetail,
  LeadId,
  type LeadListItem,
  type LeadsClient,
  ListLeadsQuery,
  parseInput,
  type ServiceRef,
} from '@firmivra/types';
import { mockStaff, type MockFirmRole } from './clients';

/**
 * Mock data for `api.leads` (R11): the firm's Begin Online inbox. Synthetic data only. Same input
 * checks, statuses and error codes as the API: only SUBMITTED and IN_REVIEW leads can be
 * converted or declined, and a new client's email must be free.
 */
const annual: ServiceRef = {
  id: '0199b6a2-0000-7000-8000-0000000000a1',
  name: 'Annual Tax',
  kind: 'ANNUAL_TAX',
};
const bookkeeping: ServiceRef = {
  id: '0199b6a2-0000-7000-8000-0000000000b2',
  name: 'Bookkeeping',
  kind: 'BOOKKEEPING',
};
/** An existing mock client's email: converting a lead with it needs that client's id. */
const TAKEN_EMAIL = 'taken@example.test';

const id = (n: number) => `0199b6a5-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = (day: number) => `2026-10-0${day}T14:30:00.000Z`;

function fixture(
  n: number,
  service: ServiceRef,
  data: Partial<LeadDetail> & Pick<LeadDetail, 'firstName' | 'lastName' | 'email'>,
): LeadDetail {
  const definition = INTAKE_FORMS[service.kind as 'ANNUAL_TAX' | 'BOOKKEEPING']!;
  return {
    id: id(n),
    status: 'SUBMITTED',
    service,
    phone: '(555) 010-0100',
    taxYear: service.kind === 'ANNUAL_TAX' ? 2025 : null,
    submittedAt: at(n),
    createdAt: at(n),
    intake: {
      id: id(100 + n),
      status: 'SUBMITTED',
      formVersion: 1,
      definition,
      answers: { email: data.email, firstName: data.firstName, lastName: data.lastName },
      uploads: [
        {
          id: id(200 + n),
          slot: 'additionalDocuments',
          fileName: 'sample-w2.pdf',
          contentType: 'application/pdf',
          sizeBytes: 182_000,
          scanStatus: 'CLEAN',
          createdAt: at(n),
        },
      ],
    },
    reviewedAt: null,
    reviewedBy: null,
    declineReason: null,
    client: null,
    engagementId: null,
    ...data,
  };
}

const fixtures = (): LeadDetail[] => [
  fixture(1, annual, { firstName: 'Avery', lastName: 'Sample', email: 'avery@example.test' }),
  fixture(2, bookkeeping, {
    firstName: 'Blake',
    lastName: 'Example',
    email: TAKEN_EMAIL,
    status: 'IN_REVIEW',
    reviewedAt: at(3),
    reviewedBy: mockStaff,
  }),
  fixture(3, annual, {
    firstName: 'Casey',
    lastName: 'Demo',
    email: 'casey@example.test',
    status: 'DECLINED',
    reviewedAt: at(4),
    reviewedBy: mockStaff,
    declineReason: 'Outside the services we offer this season.',
  }),
];

const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const open = (l: LeadDetail) => l.status === 'SUBMITTED' || l.status === 'IN_REVIEW';
const toItem = ({
  intake: _i,
  reviewedAt: _r,
  reviewedBy: _b,
  declineReason: _d,
  client: _c,
  engagementId: _e,
  ...item
}: LeadDetail): LeadListItem => item;

export function createLeadsMock(options: { role?: MockFirmRole } = {}): LeadsClient {
  const leads = fixtures();
  const staff = options.role === 'STAFF';
  const find = (leadId: string) => {
    const lead = leads.find((l) => l.id === parseInput(LeadId, leadId));
    if (!lead) throw notFound();
    return lead;
  };
  const reviewer = () => ({ reviewedAt: new Date().toISOString(), reviewedBy: mockStaff });

  return {
    async list(query = {}) {
      const q = parseInput(ListLeadsQuery, query);
      await pause();
      const term = q.search?.toLowerCase();
      const rows = leads
        .filter((l) => !q.status || l.status === q.status)
        .filter((l) => !q.serviceId || l.service.id === q.serviceId)
        .filter(
          (l) =>
            !term ||
            `${l.firstName} ${l.lastName} ${l.email} ${l.phone ?? ''}`.toLowerCase().includes(term),
        )
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      return { items: rows.slice(0, q.limit).map(toItem), nextCursor: null };
    },
    async counts() {
      await pause();
      return {
        submitted: leads.filter((l) => l.status === 'SUBMITTED').length,
        inReview: leads.filter((l) => l.status === 'IN_REVIEW').length,
      };
    },
    async get(leadId) {
      await pause();
      return find(leadId);
    },
    async startReview(leadId) {
      await pause();
      const lead = find(leadId);
      if (lead.status !== 'SUBMITTED') throw fail(409, 'INVALID_STATUS', 'Not a new lead');
      Object.assign(lead, { status: 'IN_REVIEW' }, reviewer());
      return lead;
    },
    async convert(leadId, body = {}) {
      const b = parseInput(ConvertLeadRequest, body);
      await pause();
      const lead = find(leadId);
      if (!open(lead)) throw fail(409, 'INVALID_STATUS', 'This lead was already handled');
      if (staff && b.assignedUserId && b.assignedUserId !== mockStaff.userId) {
        throw fail(403, 'FORBIDDEN', 'This action is not permitted');
      }
      if (!b.clientId && lead.email === TAKEN_EMAIL) {
        throw fail(409, 'DUPLICATE_EMAIL', 'Another client has this email');
      }
      const clientId = b.clientId ?? id(300 + leads.indexOf(lead));
      const engagementId = id(400 + leads.indexOf(lead));
      Object.assign(lead, reviewer(), {
        status: 'CONVERTED',
        client: { id: clientId, displayName: `${lead.firstName} ${lead.lastName}` },
        engagementId,
      });
      return { lead, clientId, engagementId, inviteSent: b.sendPortalInvite };
    },
    async decline(leadId, body) {
      const b = parseInput(DeclineLeadRequest, body);
      await pause();
      const lead = find(leadId);
      if (!open(lead)) throw fail(409, 'INVALID_STATUS', 'This lead was already handled');
      Object.assign(lead, reviewer(), { status: 'DECLINED', declineReason: b.reason });
      return lead;
    },
    async downloadUpload(leadId, uploadId) {
      await pause();
      const file = find(leadId).intake?.uploads.find((u) => u.id === parseInput(LeadId, uploadId));
      if (!file) throw notFound();
      if (file.scanStatus !== 'CLEAN') {
        throw fail(409, 'FILE_NOT_AVAILABLE', 'This file is not available');
      }
      return { url: 'about:blank', expiresAt: new Date(Date.now() + 300_000).toISOString() };
    },
  };
}
