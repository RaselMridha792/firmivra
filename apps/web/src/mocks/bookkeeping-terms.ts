import {
  ActivateBookkeepingTermsRequest,
  ApiRequestError,
  type BookkeepingPaymentScheduleRow,
  type BookkeepingTerms,
  type BookkeepingTermsClient,
  type BookkeepingTermsEvent,
  BookkeepingTermsNoticeRequest,
  CreateBookkeepingTermsRequest,
  parseInput,
  SendBookkeepingTermsRequest,
  SetBookkeepingTermsAgreementRequest,
  TerminateBookkeepingTermsRequest,
  UpdateBookkeepingTermsRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

const uid = (block: string, n: number) =>
  `0199c0f0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
/** The bookkeeping mock's first client, Green Leaf Café LLC: terms in force, five paid invoices. */
const green = () => uid('b100', 1);
const now = () => new Date().toISOString();
const today = () => now().slice(0, 10);

interface Store {
  terms: Map<string, BookkeepingTerms>;
  events: BookkeepingTermsEvent[];
  schedule: Map<string, BookkeepingPaymentScheduleRow[]>;
  next: number;
}

type Version = Omit<BookkeepingTerms, 'can'>;

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);

function base(id: string, clientId: string, version: number): Version {
  const at = now();
  return {
    id,
    bookkeepingClientId: clientId,
    version,
    status: 'DRAFT',
    packageName: null,
    startDate: today(),
    endDate: null,
    renewalType: 'AUTO',
    renewalDate: null,
    noticeDays: 30,
    effectiveFrom: today(),
    billingFrequency: 'MONTHLY',
    billingTiming: 'ADVANCE',
    paymentTerms: 'DUE_ON_RECEIPT',
    paymentTermsDays: null,
    preferredPaymentMethod: null,
    autopay: false,
    monthlyFeeCents: 0,
    setupFeeCents: 0,
    additionalBilling: [],
    lateFeeRule: null,
    discounts: [],
    includedServices: [],
    excludedServices: [],
    addOns: [],
    deliverables: [],
    clientResponsibilities: [],
    firmResponsibilities: [],
    internalNotes: null,
    documents: { agreement: null, signedAgreement: null, esignRequest: null, signedAt: null },
    sentAt: null,
    activatedAt: null,
    supersededAt: null,
    terminatedAt: null,
    terminationReason: null,
    createdBy: 'Alex Rivera',
    createdAt: at,
    updatedAt: at,
  };
}

/** What an Owner may do with a version in each status (the API's `can`). */
function withCan(t: Version, hasDraft: boolean): BookkeepingTerms {
  const open = t.status === 'DRAFT' || t.status === 'SENT';
  return {
    ...t,
    can: {
      edit: t.status === 'DRAFT',
      send: t.status === 'DRAFT',
      backToDraft: t.status === 'SENT',
      activate: open,
      terminate: t.status === 'ACTIVE',
      newVersion: t.status === 'ACTIVE' && !hasDraft,
    },
  };
}

let store: Store | undefined;
function seed(): Store {
  if (store) return store;
  const s: Store = { terms: new Map(), events: [], schedule: new Map(), next: 10 };
  const v1: Version = {
    ...base(uid('b900', 1), green(), 1),
    status: 'ACTIVE',
    packageName: 'Growth Plan',
    startDate: '2024-01-15',
    endDate: '2025-01-15',
    renewalType: 'AUTO',
    renewalDate: '2027-01-15',
    noticeDays: 30,
    effectiveFrom: '2024-01-15',
    paymentTerms: 'NET_7',
    preferredPaymentMethod: 'Auto-Debit (ACH)',
    autopay: true,
    monthlyFeeCents: 29000,
    lateFeeRule: { amountCents: 2500, afterDays: 7 },
    includedServices: [
      'Transaction categorization',
      'Bank & credit card reconciliations',
      'Monthly financial reports (P&L, Balance Sheet)',
      'Quarterly review call',
      'Year-end preparation',
      'Support via email and client portal',
    ],
    excludedServices: ['Payroll processing', 'Sales tax filing', '1099 preparation'],
    deliverables: [{ label: 'Monthly P&L and Balance Sheet', frequency: 'Monthly' }],
    clientResponsibilities: ['Share bank statements by the 5th of each month'],
    firmResponsibilities: ['Close the books by the 15th of each month'],
    documents: {
      agreement: null,
      signedAgreement: { id: uid('b901', 1), name: 'Fake signed agreement.pdf' },
      esignRequest: null,
      signedAt: '2024-01-12T15:00:00.000Z',
    },
    sentAt: '2024-01-10T15:00:00.000Z',
    activatedAt: '2024-01-15T09:00:00.000Z',
  };
  s.terms.set(v1.id, withCan(v1, false));
  for (const [kind, at] of [
    ['CREATED', '2024-01-08T10:00:00.000Z'],
    ['SENT', '2024-01-10T15:00:00.000Z'],
    ['SIGNED', '2024-01-12T15:00:00.000Z'],
    ['ACTIVATED', '2024-01-15T09:00:00.000Z'],
  ] as const) {
    s.events.push(event(s, v1, kind, at));
  }
  const months = ['September', 'August', 'July', 'June', 'May'];
  s.schedule.set(
    green(),
    months.map((m, i) => {
      const month = String(9 - i).padStart(2, '0');
      return {
        invoiceId: uid('b902', i + 1),
        number: `INV-2026-${String(9 - i).padStart(3, '0')}`,
        period: `${m} 2026`,
        issuedOn: `2026-${month}-01`,
        dueOn: `2026-${month}-08`,
        amountCents: 29000,
        status: 'PAID',
        paidAt: `2026-${month}-05T12:00:00.000Z`,
      };
    }),
  );
  store = s;
  return s;
}

function event(
  s: Store,
  t: Version,
  kind: BookkeepingTermsEvent['kind'],
  at = now(),
  extra: Partial<BookkeepingTermsEvent> = {},
): BookkeepingTermsEvent {
  s.next += 1;
  return {
    id: uid('b903', s.next),
    termsId: t.id,
    version: t.version,
    kind,
    effectiveDate: null,
    noticeSentAt: null,
    reason: null,
    details: {},
    actorName: 'Mock User',
    at,
    ...extra,
  };
}

/**
 * Contract mock for `api.bookkeepingTerms` (BK-E01): the bookkeeping mock's clients. Green Leaf
 * Café LLC has terms in force; any other client starts with none. As an Owner.
 */
export function createBookkeepingTermsMock(): BookkeepingTermsClient {
  const s = () => seed();
  const ofClient = (clientId: string) =>
    [...s().terms.values()]
      .filter((t) => t.bookkeepingClientId === clientId)
      .sort((a, b) => b.version - a.version);
  const find = (termsId: string) => {
    const t = s().terms.get(termsId);
    if (!t) throw fail(404, 'NOT_FOUND', 'Not found');
    return t;
  };
  const save = (t: Version) => {
    const hasDraft = ofClient(t.bookkeepingClientId).some(
      (x) => x.id !== t.id && (x.status === 'DRAFT' || x.status === 'SENT'),
    );
    const next = withCan({ ...t, updatedAt: now() }, hasDraft);
    s().terms.set(t.id, next);
    // The version in force can start a new one only while no draft is open.
    for (const other of ofClient(t.bookkeepingClientId)) {
      if (other.id !== t.id)
        s().terms.set(other.id, withCan(other, !!draftOf(t.bookkeepingClientId)));
    }
    return structuredClone(s().terms.get(t.id)!);
  };
  const draftOf = (clientId: string) =>
    ofClient(clientId).find((t) => t.status === 'DRAFT' || t.status === 'SENT') ?? null;
  const currentOf = (clientId: string) =>
    ofClient(clientId).find((t) => t.status === 'ACTIVE') ?? null;
  return {
    page: async (id) => {
      await mockDelay();
      const all = ofClient(id);
      return {
        bookkeepingClientId: id,
        current: structuredClone(currentOf(id)),
        draft: structuredClone(draftOf(id)),
        versions: all.map((t) => ({
          id: t.id,
          version: t.version,
          status: t.status,
          packageName: t.packageName,
          monthlyFeeCents: t.monthlyFeeCents,
          effectiveFrom: t.effectiveFrom,
          activatedAt: t.activatedAt,
          supersededAt: t.supersededAt,
          terminatedAt: t.terminatedAt,
        })),
      };
    },
    create: async (id, body) => {
      await mockDelay();
      const input = parseInput(CreateBookkeepingTermsRequest, body);
      if (draftOf(id)) throw fail(409, 'TERMS_DRAFT_EXISTS', 'A draft is already open');
      const from = currentOf(id);
      s().next += 1;
      const version = (ofClient(id)[0]?.version ?? 0) + 1;
      const { can: _can, ...rest } = from ?? withCan(base('', id, 0), false);
      const draft: Version = {
        ...rest,
        ...base(uid('b900', s().next), id, version),
        ...(from
          ? {
              ...Object.fromEntries(
                Object.entries(rest).filter(([k]) => !['id', 'version', 'status'].includes(k)),
              ),
              status: 'DRAFT' as const,
              sentAt: null,
              activatedAt: null,
              supersededAt: null,
              terminatedAt: null,
              documents: {
                agreement: null,
                signedAgreement: null,
                esignRequest: null,
                signedAt: null,
              },
            }
          : {}),
        id: uid('b900', s().next),
        version,
        ...input,
      } as Version;
      s().events.unshift(event(s(), draft, 'CREATED'));
      return save(draft);
    },
    get: async (termsId) => {
      await mockDelay();
      return structuredClone(find(termsId));
    },
    update: async (termsId, body) => {
      await mockDelay();
      const input = parseInput(UpdateBookkeepingTermsRequest, body);
      const t = find(termsId);
      if (t.status !== 'DRAFT') throw fail(409, 'TERMS_NOT_DRAFT', 'Only a draft can change');
      return save({ ...t, ...input } as Version);
    },
    send: async (termsId, body) => {
      await mockDelay();
      const { note } = parseInput(SendBookkeepingTermsRequest, body ?? {});
      const t = find(termsId);
      if (t.status !== 'DRAFT') throw fail(409, 'TERMS_NOT_DRAFT', 'Only a draft is sent');
      s().events.unshift(event(s(), t, 'SENT', now(), { reason: note ?? null }));
      return save({ ...t, status: 'SENT', sentAt: now() });
    },
    backToDraft: async (termsId) => {
      await mockDelay();
      const t = find(termsId);
      if (t.status !== 'SENT') throw fail(409, 'TERMS_NOT_SENT', 'Only sent terms go back');
      return save({ ...t, status: 'DRAFT' });
    },
    activate: async (termsId, body) => {
      await mockDelay();
      const input = parseInput(ActivateBookkeepingTermsRequest, body ?? {});
      const t = find(termsId);
      if (t.status !== 'DRAFT' && t.status !== 'SENT') {
        throw fail(409, 'TERMS_NOT_OPEN', 'Only a draft or sent version comes into force');
      }
      if (input.requireSigned && !t.documents.signedAt) {
        throw fail(409, 'AGREEMENT_NOT_SIGNED', 'The agreement is not signed yet');
      }
      const before = currentOf(t.bookkeepingClientId);
      if (before) {
        save({ ...before, status: 'SUPERSEDED', supersededAt: now() });
        s().events.unshift(event(s(), before, 'SUPERSEDED'));
      }
      s().events.unshift(event(s(), t, 'ACTIVATED', now(), { reason: input.note ?? null }));
      return save({ ...t, status: 'ACTIVE', activatedAt: now() });
    },
    terminate: async (termsId, body) => {
      await mockDelay();
      const input = parseInput(TerminateBookkeepingTermsRequest, body);
      const t = find(termsId);
      if (t.status !== 'ACTIVE') throw fail(409, 'TERMS_NOT_ACTIVE', 'Only terms in force end');
      s().events.unshift(
        event(s(), t, 'TERMINATED', now(), {
          reason: input.reason,
          effectiveDate: input.effectiveDate,
        }),
      );
      return save({
        ...t,
        status: 'TERMINATED',
        terminatedAt: now(),
        terminationReason: input.reason,
      });
    },
    recordNotice: async (termsId, body) => {
      await mockDelay();
      const input = parseInput(BookkeepingTermsNoticeRequest, body);
      const t = find(termsId);
      const e = event(s(), t, input.kind, now(), {
        reason: input.reason ?? null,
        effectiveDate: input.effectiveDate ?? null,
        noticeSentAt: input.noticeSentAt ?? null,
        details:
          input.newMonthlyFeeCents === undefined
            ? {}
            : { monthlyFeeCents: { from: t.monthlyFeeCents, to: input.newMonthlyFeeCents } },
      });
      s().events.unshift(e);
      return e;
    },
    setAgreement: async (termsId, body) => {
      await mockDelay();
      const input = parseInput(SetBookkeepingTermsAgreementRequest, body);
      const t = find(termsId);
      const docs = { ...t.documents };
      if (input.signedAgreementDocumentId !== undefined) {
        docs.signedAgreement = input.signedAgreementDocumentId
          ? { id: input.signedAgreementDocumentId, name: 'Signed agreement' }
          : null;
      }
      if (input.signed) {
        if (!docs.signedAgreement && !docs.esignRequest) {
          throw fail(409, 'AGREEMENT_NOT_SIGNED', 'Add the signed copy first');
        }
        docs.signedAt = now();
        s().events.unshift(event(s(), t, 'SIGNED'));
      }
      return save({ ...t, documents: docs });
    },
    history: async (id) => {
      await mockDelay();
      const ids = new Set(ofClient(id).map((t) => t.id));
      return {
        items: structuredClone(s().events.filter((e) => ids.has(e.termsId))),
        nextCursor: null,
      };
    },
    paymentSchedule: async (id) => {
      await mockDelay();
      const items = s().schedule.get(id) ?? [];
      return { items: structuredClone(items), total: items.length, page: 1, pageSize: 10 };
    },
  };
}
