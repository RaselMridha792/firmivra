import {
  AcceptMyBookkeepingTermsRequest,
  ApiRequestError,
  BookkeepingTermsId,
  DeclineMyBookkeepingTermsRequest,
  type MyBookkeepingTerms,
  type MyBookkeepingTermsClient,
  type MyBookkeepingTermsRow,
  parseInput,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

// Client Portal BK-CP3: the signed-in client's bookkeeping terms in mock mode, as the API
// (my-bookkeeping-terms.service.ts) keeps them: the versions that left the firm's drafts, in the
// portal version; Accept puts the version waiting for an answer in force (the one before is
// replaced), Decline sends it back to the firm (it leaves the list). Another id is 404, an answer
// to a version not waiting is 409 TERMS_STATE, one naming another sending 409 TERMS_CHANGED, and
// Accept while the e-signature waits 409 SIGNATURE_PENDING. The Primary login (Jamie). Synthetic.

const copy = <T>(value: T): T => structuredClone(value);
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');

/** The mock My Services' Bookkeeping (Growth) service (mocks/engagements.ts, fixture 2). */
const SERVICE = { id: '0199b6a2-0000-7000-8000-000000000002', title: 'Bookkeeping (Growth)' };

export const MY_BOOKKEEPING_TERMS_IDS = {
  inForce: '0199d6a0-0000-7000-8000-000000000001',
  waiting: '0199d6a0-0000-7000-8000-000000000002',
} as const;

/** Each version, with its status as the firm keeps it (a declined one is back to DRAFT). */
type Version = Omit<MyBookkeepingTerms, 'can'> & {
  status: 'SENT' | 'ACTIVE' | 'SUPERSEDED' | 'DRAFT';
};

function seed(): Version[] {
  const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const base = {
    serviceId: SERVICE.id,
    serviceTitle: SERVICE.title,
    packageName: 'Growth Plan',
    startDate: '2026-01-01',
    endDate: null,
    renewalType: 'AUTO' as const,
    renewalDate: '2027-01-01',
    noticeDays: 30,
    billingFrequency: 'MONTHLY' as const,
    billingTiming: 'ADVANCE' as const,
    paymentTerms: 'NET_15' as const,
    paymentTermsDays: null,
    preferredPaymentMethod: 'Auto-Debit (ACH)',
    autopay: true,
    setupFeeCents: 0,
    additionalBilling: [
      { service: 'Catch-up bookkeeping', feeCents: 25_000, billing: 'SEPARATE' as const },
    ],
    lateFeeRule: { amountCents: 2_500, afterDays: 10 },
    includedServices: ['Monthly bank and card reconciliation', 'Monthly financial statements'],
    excludedServices: ['Payroll', 'Sales tax filing'],
    addOns: [
      { name: 'Quarterly review meeting', feeCents: 15_000, frequency: 'QUARTERLY' as const },
    ],
    deliverables: [{ label: 'Profit and Loss, Balance Sheet', frequency: 'Monthly' }],
    clientResponsibilities: ['Upload bank statements by the 5th of each month'],
    firmResponsibilities: ['Deliver the monthly reports by the 15th'],
    supersededAt: null,
    terminatedAt: null,
    signature: null,
  };
  return [
    {
      ...base,
      id: MY_BOOKKEEPING_TERMS_IDS.waiting,
      version: 2,
      status: 'SENT',
      state: 'AWAITING_ANSWER',
      monthlyFeeCents: 52_500,
      effectiveFrom: '2026-12-01',
      discounts: [
        { label: 'Loyalty credit', kind: 'PERCENT', value: 5, startsOn: null, endsOn: null },
      ],
      sentAt: day(1),
      activatedAt: null,
      acceptedAt: null,
    },
    {
      ...base,
      id: MY_BOOKKEEPING_TERMS_IDS.inForce,
      version: 1,
      status: 'ACTIVE',
      state: 'IN_FORCE',
      monthlyFeeCents: 45_000,
      effectiveFrom: '2026-01-01',
      discounts: [],
      sentAt: day(330),
      activatedAt: day(325),
      acceptedAt: day(325),
    },
  ];
}

/** An in-memory `api.myBookkeepingTerms(slug)`. */
export function createMyBookkeepingTermsMock(): MyBookkeepingTermsClient {
  let versions: Version[] | undefined;
  const all = () => (versions ??= seed());
  const shown = () => all().filter((v) => v.status !== 'DRAFT');
  const find = (id: string) => {
    const v = shown().find((x) => x.id === parseInput(BookkeepingTermsId, id));
    if (!v) throw notFound();
    return v;
  };
  const view = (v: Version): MyBookkeepingTerms => {
    const { status, ...rest } = v;
    const waiting = status === 'SENT';
    return copy({
      ...rest,
      can: { accept: waiting && v.signature !== 'WAITING', decline: waiting },
    });
  };
  const row = (v: Version): MyBookkeepingTermsRow =>
    copy({
      id: v.id,
      serviceId: v.serviceId,
      serviceTitle: v.serviceTitle,
      version: v.version,
      state: v.state,
      packageName: v.packageName,
      monthlyFeeCents: v.monthlyFeeCents,
      effectiveFrom: v.effectiveFrom,
      sentAt: v.sentAt,
      activatedAt: v.activatedAt,
    });
  /** As the API: the version waiting, exactly as sent. */
  const waiting = (id: string, sentAt: string) => {
    const v = find(id);
    if (v.status !== 'SENT')
      throw fail(409, 'TERMS_STATE', 'These terms are not waiting for your answer');
    if (Date.parse(v.sentAt ?? '') !== Date.parse(sentAt))
      throw fail(
        409,
        'TERMS_CHANGED',
        'The firm changed these terms since you opened them. Reload them.',
      );
    return v;
  };
  return {
    list: async () => {
      await mockDelay();
      return shown()
        .slice()
        .sort((a, b) => b.version - a.version)
        .map(row);
    },
    get: async (id) => {
      await mockDelay();
      return view(find(id));
    },
    accept: async (id, body) => {
      await mockDelay();
      const input = parseInput(AcceptMyBookkeepingTermsRequest, body);
      const v = waiting(id, input.sentAt);
      if (v.signature === 'WAITING')
        throw fail(
          409,
          'SIGNATURE_PENDING',
          'Sign the agreement under Signatures first, then accept.',
        );
      const now = new Date().toISOString();
      for (const other of all())
        if (other.status === 'ACTIVE' && other.serviceId === v.serviceId) {
          other.status = 'SUPERSEDED';
          other.state = 'REPLACED';
          other.supersededAt = now;
        }
      v.status = 'ACTIVE';
      v.state = 'IN_FORCE';
      v.activatedAt = now;
      v.acceptedAt = now;
      return view(v);
    },
    decline: async (id, body) => {
      await mockDelay();
      const input = parseInput(DeclineMyBookkeepingTermsRequest, body);
      const v = waiting(id, input.sentAt);
      // Back with the firm as a draft: the portal no longer shows it.
      v.status = 'DRAFT';
      return { ok: true };
    },
  };
}

let mocks: Map<string, MyBookkeepingTermsClient> | undefined;

/** `api.myBookkeepingTerms(slug)` in mock mode: one mock per firm (by lower-cased slug). */
export function myBookkeepingTermsMock(firmSlug: string): MyBookkeepingTermsClient {
  mocks ??= new Map();
  const key = firmSlug.toLowerCase();
  const found = mocks.get(key);
  if (found) return found;
  const created = createMyBookkeepingTermsMock();
  mocks.set(key, created);
  return created;
}
