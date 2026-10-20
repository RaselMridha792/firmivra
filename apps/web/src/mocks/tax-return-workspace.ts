import {
  AmendTaxReturnRequest,
  ApiRequestError,
  ApproveTaxApprovalRequest,
  CarryForwardTaxReturnRequest,
  ChangeTaxReturnStatusRequest,
  CreateTaxApprovalRequest,
  CreateTaxChecklistItemRequest,
  CreateWorkspaceTaxReturnRequest,
  EfileReportQuery,
  LinkTaxAuthorizationRequest,
  LinkTaxReturnDocumentRequest,
  PaperFiledRequest,
  RecordTaxFilingAttemptRequest,
  ReturnTaxApprovalRequest,
  SetTaxAuthorizationsRequest,
  SetTaxReturnFilingsRequest,
  TaxReturnsQuery,
  TaxReturnSummaryQuery,
  UpdateTaxChecklistItemRequest,
  UpdateTaxFilingAttemptRequest,
  UpdateTaxReturnDetailsRequest,
  UpdateTaxReturnFilingRequest,
  WetSignatureRequest,
  parseInput,
  type MemberRef,
  type TaxApproval,
  type TaxAuthorization,
  type TaxChecklistItem,
  type TaxReturnActivityList,
  type TaxReturnBlocker,
  type TaxReturnDetail,
  type TaxReturnDocument,
  type TaxReturnFiling,
  type TaxReturnHistoryList,
  type TaxReturnRow,
  type TaxReturnWorkflowStatus,
  type TaxReturnWorkspaceClient,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { clientFixtures } from './clients';
import { teamFixtures } from './team';

/**
 * Mock data for `api.taxReturnWorkspace` (R55 contract, the Tax Returns module). Synthetic
 * clients only, dated around today. It checks input with the contract's schemas and keeps the
 * API's rules: Staff see only their own clients' returns (Sam Staff's), going back a step needs a
 * reason, Ready to File waits for validation, approvals and signatures (409 STATUS_BLOCKED with
 * the blockers), an e-file filing follows its newest transmission, and a filed return is never
 * deleted or unlinked. Firmivra tracks filing; nothing here transmits. `empty: true`
 * (NEXT_PUBLIC_API_MOCK_EMPTY=taxReturnWorkspace) starts with no returns.
 */
type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const copy = <T>(v: T): T => structuredClone(v);
const DAY = 86_400_000;
const nowIso = () => new Date().toISOString();
const ago = (days: number, hour = 10) => {
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hour, 15, 0, 0);
  return d.toISOString();
};
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const uid = (block: string, n: number) =>
  `0199c1a0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
let seq = 1000;
const newId = (block: string) => uid(block, ++seq);

const team = () => teamFixtures().filter((m) => m.status === 'ACTIVE');
const ref = (n: number): MemberRef => {
  const m = team()[n]!;
  return { userId: m.user.id, name: m.user.name };
};
const OLIVIA = () => ref(0);
const ADAM = () => ref(1);
const SAM = () => ref(2);

interface MockClient {
  id: string;
  name: string;
  accountType: 'INDIVIDUAL' | 'BUSINESS';
  last4: string | null;
  email: string | null;
  phone: string | null;
  /** Staff see a client's returns only when it is assigned to them. */
  staffs: boolean;
}

function mockClients(): MockClient[] {
  const fixtures = clientFixtures().filter((c) => !c.archivedAt);
  const own = fixtures.map((c, i) => ({
    id: c.id,
    name: c.displayName,
    accountType: c.accountType,
    last4: i === 0 ? '0001' : i === 1 ? '0002' : null,
    email: c.email ?? null,
    phone: c.phone ?? null,
    staffs: true,
  }));
  const more: [string, 'INDIVIDUAL' | 'BUSINESS', string][] = [
    ['Morgan Testwell', 'INDIVIDUAL', '6789'],
    ['Green Leaf Café LLC (fake)', 'BUSINESS', '6789'],
    ['Casey Placeholder', 'INDIVIDUAL', '4321'],
    ['Turner Group LLC (fake)', 'BUSINESS', '4321'],
    ['Drew Fictional', 'INDIVIDUAL', '9876'],
    ['Walker Properties (fake)', 'BUSINESS', '1234'],
    ['Robin Demo', 'INDIVIDUAL', '2468'],
    ['Avery Synthetic', 'INDIVIDUAL', '1357'],
    ['Smith Consulting LLC (fake)', 'BUSINESS', '6543'],
    ['Quinn Mockdata', 'INDIVIDUAL', '1122'],
  ];
  return [
    ...own,
    ...more.map(([name, accountType, last4], i) => ({
      id: uid('0c00', i + 1),
      name,
      accountType,
      last4,
      email: `${name.split(' ')[0]!.toLowerCase()}@example.test`,
      phone: '+14045550100',
      staffs: i % 3 === 0,
    })),
  ];
}

const maskedOf = (c: MockClient) =>
  c.last4 ? (c.accountType === 'BUSINESS' ? `**-***${c.last4}` : `***-**-${c.last4}`) : null;

interface Stored {
  id: string;
  clientId: string;
  taxYear: number;
  filingType: 'INDIVIDUAL' | 'BUSINESS';
  quarter: number | null;
  formType: string | null;
  workflowStatus: TaxReturnWorkflowStatus;
  statusReason: string | null;
  filingStatus: TaxReturnDetail['filingStatus'];
  preparer: MemberRef | null;
  reviewer: MemberRef | null;
  dueOn: string | null;
  amendsReturnId: string | null;
  amendReason: string | null;
  estimate: TaxReturnRow['estimate'];
  archivedAt: string | null;
  finalValidatedAt: string | null;
  finalValidatedBy: MemberRef | null;
  firstFiledAt: string | null;
  filedOn: string | null;
  createdAt: string;
  updatedAt: string;
  filings: TaxReturnFiling[];
  checklist: TaxChecklistItem[];
  approvals: TaxApproval[];
  authorizations: TaxAuthorization[];
  documents: TaxReturnDocument[];
  history: TaxReturnHistoryList['items'];
  activity: TaxReturnActivityList['items'];
}

const STEP: Partial<Record<TaxReturnWorkflowStatus, number>> = {
  IN_PREPARATION: 1,
  READY_FOR_REVIEW: 2,
  READY_FOR_SIGNATURE: 3,
  READY_TO_FILE: 4,
  TRANSMITTED: 5,
  REJECTED: 6,
  ACCEPTED: 7,
  CLOSED: 8,
};
const ALL: TaxReturnWorkflowStatus[] = [
  'IN_PREPARATION',
  'WAITING_ON_CLIENT',
  'READY_FOR_REVIEW',
  'READY_FOR_SIGNATURE',
  'READY_TO_FILE',
  'TRANSMITTED',
  'ACCEPTED',
  'REJECTED',
  'CLOSED',
];
const canMoveTo = (from: TaxReturnWorkflowStatus): TaxReturnWorkflowStatus[] =>
  from === 'TRANSMITTED'
    ? ['ACCEPTED', 'REJECTED', 'CLOSED']
    : from === 'ACCEPTED'
      ? ['CLOSED']
      : from === 'CLOSED'
        ? []
        : ALL.filter((s) => s !== from);
const isBackward = (from: TaxReturnWorkflowStatus, to: TaxReturnWorkflowStatus) =>
  STEP[from] !== undefined && STEP[to] !== undefined && STEP[to]! < STEP[from]!;
const coarse = (w: TaxReturnWorkflowStatus): TaxReturnRow['status'] =>
  w === 'TRANSMITTED'
    ? 'FILED'
    : w === 'ACCEPTED'
      ? 'ACCEPTED'
      : w === 'REJECTED'
        ? 'REJECTED'
        : w === 'CLOSED'
          ? 'COMPLETED'
          : 'IN_PROGRESS';

function blockersOf(r: Stored, all: Stored[]): TaxReturnBlocker[] {
  const out: TaxReturnBlocker[] = [];
  const step = STEP[r.workflowStatus] ?? 0;
  if (step < 4) {
    const checks = r.checklist.filter((c) => c.section === 'VALIDATION');
    if (checks.length > 0) {
      if (!r.finalValidatedAt) out.push('VALIDATION_NOT_RUN');
      if (checks.some((c) => c.result === 'ERROR')) out.push('VALIDATION_ERRORS');
      if (checks.some((c) => c.result === 'WARNING' && !c.acknowledgedAt)) {
        out.push('WARNINGS_NOT_ACKNOWLEDGED');
      }
    }
    if (r.approvals.some((a) => a.status === 'PENDING')) out.push('APPROVAL_PENDING');
    if (r.approvals.some((a) => a.status === 'RETURNED')) out.push('APPROVAL_RETURNED');
    if (
      r.authorizations.some((a) => a.required && a.status !== 'SIGNED' && a.status !== 'COMPLETED')
    ) {
      out.push('AUTHORIZATION_UNSIGNED');
    }
  }
  const required = r.filings.filter((f) => f.required);
  if (required.length > 0) {
    const done = (s: string) => s === 'ACCEPTED' || s === 'PAPER_FILED';
    if (step === 4 && !required.some((f) => f.status === 'TRANSMITTED' || done(f.status))) {
      out.push('NO_FILING_TRANSMITTED');
    }
    if ((step === 5 || step === 6) && !required.every((f) => done(f.status))) {
      out.push('FILINGS_NOT_ACCEPTED');
    }
  }
  const original = r.amendsReturnId ? all.find((x) => x.id === r.amendsReturnId) : undefined;
  if (original && !original.firstFiledAt) out.push('ORIGINAL_NOT_FILED');
  return out;
}

/** What a move to `to` needs (the database's check), before the move happens. */
function blockersFor(r: Stored, to: TaxReturnWorkflowStatus, all: Stored[]): TaxReturnBlocker[] {
  const at = STEP[to] ?? 0;
  const now = blockersOf({ ...r, workflowStatus: 'IN_PREPARATION' }, all).filter(
    (b) => b !== 'NO_FILING_TRANSMITTED' && b !== 'FILINGS_NOT_ACCEPTED',
  );
  const required = r.filings.filter((f) => f.required);
  const done = (s: string) => s === 'ACCEPTED' || s === 'PAPER_FILED';
  const out: TaxReturnBlocker[] = [];
  if (at >= 4) out.push(...now);
  if (
    at === 5 &&
    required.length &&
    !required.some((f) => f.status === 'TRANSMITTED' || done(f.status))
  ) {
    out.push('NO_FILING_TRANSMITTED');
  }
  if (
    (to === 'ACCEPTED' || to === 'CLOSED') &&
    required.length &&
    !required.every((f) => done(f.status))
  ) {
    out.push('FILINGS_NOT_ACCEPTED');
  }
  return [...new Set(out)];
}

/** Seeds one return with the parts a workspace shows, from a short description. */
function seed(
  clients: MockClient[],
  n: number,
  c: number,
  over: Partial<Stored> & { workflowStatus: TaxReturnWorkflowStatus },
): Stored {
  const client = clients[c % clients.length]!;
  const id = uid('0d00', n);
  const updatedAt = ago(Math.floor(n / 2), 9 + (n % 7));
  const base: Stored = {
    id,
    clientId: client.id,
    taxYear: new Date().getUTCFullYear() - 1,
    filingType: client.accountType,
    quarter: null,
    formType: client.accountType === 'BUSINESS' ? '1120S' : '1040',
    statusReason: null,
    filingStatus: client.accountType === 'INDIVIDUAL' ? 'SINGLE' : null,
    preparer: [SAM(), ADAM(), OLIVIA()][n % 3]!,
    reviewer: n % 2 ? ADAM() : OLIVIA(),
    dueOn: day(30 + n * 3),
    amendsReturnId: null,
    amendReason: null,
    estimate: null,
    archivedAt: null,
    finalValidatedAt: null,
    finalValidatedBy: null,
    firstFiledAt: null,
    filedOn: null,
    createdAt: ago(40 + n),
    updatedAt,
    filings: [],
    checklist: [],
    approvals: [],
    authorizations: [],
    documents: [],
    history: [],
    activity: [],
    ...over,
  };
  if (!base.quarter) {
    base.filings = [
      filing(id, 'US', base, 1),
      ...(base.filingType === 'INDIVIDUAL' ? [filing(id, 'GA', base, 2)] : []),
    ];
    base.checklist = checklist(id);
    base.approvals = approvals(id, base);
    base.authorizations = authorizations(id, base);
    base.documents = documents(id, base);
  }
  base.history = [
    {
      at: base.updatedAt,
      workflowStatus: base.workflowStatus,
      preparer: base.preparer,
      reviewer: base.reviewer,
      reason: base.statusReason,
      by: base.preparer,
    },
    {
      at: base.createdAt,
      workflowStatus: 'IN_PREPARATION',
      preparer: base.preparer,
      reviewer: base.reviewer,
      reason: null,
      by: OLIVIA(),
    },
  ];
  base.activity = [
    {
      id: newId('0e00'),
      at: base.updatedAt,
      kind: 'STATUS',
      label: 'Status changed',
      by: base.preparer?.name ?? null,
    },
    {
      id: newId('0e00'),
      at: ago(Math.floor(n / 2) + 2),
      kind: 'DOCUMENT',
      label: 'Document linked: W-2',
      by: base.preparer?.name ?? null,
    },
    {
      id: newId('0e00'),
      at: base.createdAt,
      kind: 'CREATED',
      label: 'Return created',
      by: 'Olivia Owner',
    },
  ];
  return base;
}

const filed = (s: TaxReturnWorkflowStatus) => (STEP[s] ?? 0) >= 5;

function filing(id: string, jurisdiction: string, r: Stored, k: number): TaxReturnFiling {
  const sent = filed(r.workflowStatus);
  const ack =
    r.workflowStatus === 'REJECTED'
      ? ('REJECTED' as const)
      : r.workflowStatus === 'ACCEPTED' || r.workflowStatus === 'CLOSED'
        ? ('ACCEPTED' as const)
        : ('PENDING' as const);
  return {
    id: uid(`0f0${k}`, Number(id.slice(-4))),
    jurisdiction,
    filingMethod: 'EFILE',
    required: true,
    status: sent ? (ack === 'PENDING' ? 'TRANSMITTED' : ack) : 'NOT_FILED',
    paperFiledOn: null,
    refundCents: jurisdiction === 'US' ? 284_200 : 31_600,
    amountDueCents: null,
    amountStatus: sent ? 'FINAL' : 'ESTIMATED',
    attempts: sent
      ? [
          {
            id: uid(`0a0${k}`, Number(id.slice(-4))),
            submissionId: `${jurisdiction}-SUB-${id.slice(-6)}`,
            transmittedAt: ago(5),
            ackStatus: ack,
            acknowledgedAt: ack === 'PENDING' ? null : ago(3),
            rejectCode: ack === 'REJECTED' ? 'IND-031-04' : null,
            rejectDescription:
              ack === 'REJECTED' ? 'The prior-year AGI does not match the agency record.' : null,
            correctiveAction: null,
            recordedBy: r.preparer,
            createdAt: ago(5),
          },
        ]
      : [],
  };
}

function checklist(id: string): TaxChecklistItem[] {
  const item = (
    k: number,
    section: TaxChecklistItem['section'],
    label: string,
    result: TaxChecklistItem['result'],
  ): TaxChecklistItem => ({
    id: uid('0b00', Number(id.slice(-4)) * 20 + k),
    section,
    label,
    sortOrder: k,
    result,
    note: null,
    acknowledgedAt: null,
    acknowledgedBy: null,
    updatedAt: ago(3),
  });
  return [
    item(1, 'PREPARATION', 'Enter W-2 income', 'DONE'),
    item(2, 'PREPARATION', 'Enter 1099 income', 'DONE'),
    item(3, 'PREPARATION', 'Review deductions and credits', 'OPEN'),
    item(4, 'REVIEW', 'Compare with prior-year return', 'OPEN'),
    item(5, 'VALIDATION', 'SSN matches IRS format', 'VALID'),
    item(6, 'VALIDATION', 'Required fields completed', 'VALID'),
    item(7, 'VALIDATION', 'W-2 income matches forms', 'VALID'),
    item(8, 'VALIDATION', 'EIC eligibility verified', 'WARNING'),
    item(9, 'VALIDATION', 'State withholding verified', 'VALID'),
  ];
}

function approvals(id: string, r: Stored): TaxApproval[] {
  const done = (STEP[r.workflowStatus] ?? 0) >= 3;
  return [
    {
      id: uid('0c10', Number(id.slice(-4)) * 2),
      step: 'Preparer Review',
      sortOrder: 1,
      assignedTo: r.preparer,
      status: (STEP[r.workflowStatus] ?? 0) >= 2 ? 'APPROVED' : 'PENDING',
      decidedAt: (STEP[r.workflowStatus] ?? 0) >= 2 ? ago(2, 16) : null,
      decidedBy: (STEP[r.workflowStatus] ?? 0) >= 2 ? r.preparer : null,
      approvedDocument: null,
      note: null,
      createdAt: ago(10),
    },
    {
      id: uid('0c10', Number(id.slice(-4)) * 2 + 1),
      step: 'Final Review / Approval',
      sortOrder: 2,
      assignedTo: r.reviewer,
      status: done ? 'APPROVED' : 'PENDING',
      decidedAt: done ? ago(1, 11) : null,
      decidedBy: done ? r.reviewer : null,
      approvedDocument: null,
      note: null,
      createdAt: ago(10),
    },
  ];
}

function authorizations(id: string, r: Stored): TaxAuthorization[] {
  const signed = (STEP[r.workflowStatus] ?? 0) >= 4;
  const line = (
    k: number,
    kind: TaxAuthorization['kind'],
    jurisdiction: string | null,
    status: TaxAuthorization['status'],
  ): TaxAuthorization => ({
    id: uid('0c20', Number(id.slice(-4)) * 3 + k),
    kind,
    jurisdiction,
    required: true,
    status,
    esignRequestId: null,
    signedOn: status === 'SIGNED' ? day(-4) : null,
    document: null,
    updatedAt: ago(4),
  });
  return [
    line(0, 'FEDERAL_EFILE', null, signed ? 'SIGNED' : 'NOT_SENT'),
    ...(r.filingType === 'INDIVIDUAL'
      ? [line(1, 'STATE_EFILE', 'GA', signed ? 'SIGNED' : 'NOT_SENT')]
      : []),
    line(2, 'CLIENT_CONSENT', null, 'SIGNED'),
  ];
}

function documents(id: string, r: Stored): TaxReturnDocument[] {
  const doc = (
    k: number,
    kind: TaxReturnDocument['kind'],
    fileName: string,
  ): TaxReturnDocument => ({
    id: uid('0c30', Number(id.slice(-4)) * 4 + k),
    kind,
    jurisdiction: null,
    document: { id: uid('0c40', Number(id.slice(-4)) * 4 + k), fileName, scanStatus: 'CLEAN' },
    addedBy: r.preparer,
    createdAt: ago(6 - k),
  });
  return [
    doc(0, 'DRAFT_RETURN', `${r.taxYear}_Tax_Return_Draft.pdf`),
    doc(1, 'SIGNATURE_FORM', 'Form 8879.pdf'),
  ];
}

function seedAll(): Stored[] {
  const clients = mockClients();
  const year = new Date().getUTCFullYear() - 1;
  const rows: Stored[] = [];
  const plan: [number, TaxReturnWorkflowStatus, Partial<Stored>?][] = [
    [3, 'IN_PREPARATION'],
    [4, 'WAITING_ON_CLIENT', { statusReason: 'Waiting for the second W-2' }],
    [5, 'READY_FOR_REVIEW'],
    [6, 'READY_TO_FILE', { formType: '1065' }],
    [7, 'ACCEPTED', { taxYear: year - 1, firstFiledAt: ago(300), filedOn: day(-300) }],
    [8, 'REJECTED', { firstFiledAt: ago(5), filedOn: day(-5) }],
    [9, 'TRANSMITTED', { taxYear: year - 2, firstFiledAt: ago(5), filedOn: day(-5) }],
    [10, 'WAITING_ON_CLIENT'],
    [11, 'READY_FOR_SIGNATURE'],
    [12, 'ACCEPTED', { firstFiledAt: ago(20), filedOn: day(-20) }],
    [0, 'IN_PREPARATION'],
    [1, 'READY_FOR_REVIEW'],
    [2, 'CLOSED', { taxYear: year - 1, firstFiledAt: ago(320), filedOn: day(-320) }],
  ];
  plan.forEach(([c, status, over], i) =>
    rows.push(seed(clients, i + 1, c, { workflowStatus: status, ...over })),
  );
  // Quarterly estimates for two clients, and an amendment of a filed return.
  [1, 2, 3, 4].forEach((q) =>
    rows.push(
      seed(clients, 20 + q, 8, {
        workflowStatus: q < 3 ? 'CLOSED' : 'IN_PREPARATION',
        taxYear: year + 1,
        quarter: q,
        formType: '1040-ES',
        dueOn: day(-200 + q * 90),
        estimate: {
          amountCents: 125_000,
          status: q < 3 ? 'PAID' : q === 3 ? 'SENT_TO_CLIENT' : 'CALCULATED',
          paidOn: q < 3 ? day(-200 + q * 90) : null,
          overdue: false,
        },
      }),
    ),
  );
  const original = rows.find(
    (r) => r.workflowStatus === 'ACCEPTED' && r.filingType === 'INDIVIDUAL',
  );
  if (original) {
    rows.push(
      seed(
        clients,
        30,
        clients.findIndex((c) => c.id === original.clientId),
        {
          workflowStatus: 'IN_PREPARATION',
          taxYear: original.taxYear,
          formType: '1040-X',
          amendsReturnId: original.id,
          amendReason: 'A corrected 1099-B arrived after filing',
        },
      ),
    );
  }
  return rows;
}

export function createTaxReturnWorkspaceMock(options: Options = {}): TaxReturnWorkspaceClient {
  const role = options.role ?? 'OWNER';
  const me = role === 'STAFF' ? SAM() : role === 'ADMIN' ? ADAM() : OLIVIA();
  const clients = mockClients();
  let rows: Stored[] = options.empty ? [] : seedAll();

  const clientOf = (r: Stored) => clients.find((c) => c.id === r.clientId)!;
  const reachable = (r: Stored) => role !== 'STAFF' || clientOf(r).staffs;
  const find = (id: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r || !reachable(r)) throw notFound();
    return r;
  };
  const touch = (
    r: Stored,
    kind: TaxReturnActivityList['items'][number]['kind'],
    label: string,
  ) => {
    r.updatedAt = nowIso();
    r.activity.unshift({ id: newId('0e00'), at: r.updatedAt, kind, label, by: me.name });
  };
  const toRow = (r: Stored): TaxReturnRow => {
    const c = clientOf(r);
    const overdue = !!r.estimate && r.estimate.status !== 'PAID' && !!r.dueOn && r.dueOn < day(0);
    return copy({
      id: r.id,
      client: { id: c.id, name: c.name, accountType: c.accountType, maskedId: maskedOf(c) },
      taxYear: r.taxYear,
      filingType: r.filingType,
      quarter: r.quarter,
      formType: r.formType,
      workflowStatus: r.workflowStatus,
      status: coarse(r.workflowStatus),
      preparer: r.preparer,
      reviewer: r.reviewer,
      dueOn: r.dueOn,
      amendsReturnId: r.amendsReturnId,
      estimate: r.estimate ? { ...r.estimate, overdue } : null,
      archivedAt: r.archivedAt,
      updatedAt: r.updatedAt,
    });
  };
  const toDetail = (r: Stored): TaxReturnDetail => {
    const c = clientOf(r);
    const amends = r.amendsReturnId ? rows.find((x) => x.id === r.amendsReturnId) : undefined;
    return {
      ...toRow(r),
      client: {
        id: c.id,
        name: c.name,
        accountType: c.accountType,
        maskedId: maskedOf(c),
        email: c.email,
        phone: c.phone,
      },
      engagement: null,
      statusReason: r.statusReason,
      filingStatus: r.filingStatus,
      amends: amends ? { id: amends.id, taxYear: amends.taxYear, formType: amends.formType } : null,
      amendReason: r.amendReason,
      amendedBy: rows
        .filter((x) => x.amendsReturnId === r.id)
        .map((x) => ({ id: x.id, workflowStatus: x.workflowStatus })),
      finalValidatedAt: r.finalValidatedAt,
      finalValidatedBy: r.finalValidatedBy,
      importSource: null,
      importedAt: null,
      filedOn: r.filedOn,
      firstFiledAt: r.firstFiledAt,
      document: null,
      canMoveTo: canMoveTo(r.workflowStatus),
      blockers: blockersOf(r, rows),
      createdAt: r.createdAt,
    };
  };
  const tabOf = (r: Stored, tab: string) => {
    const year = new Date().getUTCFullYear();
    if (tab === 'personal') return r.filingType === 'INDIVIDUAL' && !r.quarter && !r.amendsReturnId;
    if (tab === 'business') return r.filingType === 'BUSINESS' && !r.quarter && !r.amendsReturnId;
    if (tab === 'quarterly') return r.quarter !== null;
    if (tab === 'amended') return r.amendsReturnId !== null;
    if (tab === 'prior_year') return r.taxYear < year - 1;
    return true;
  };
  const move = (r: Stored, to: TaxReturnWorkflowStatus, reason: string | null) => {
    if (!canMoveTo(r.workflowStatus).includes(to)) {
      throw fail(409, 'STATUS_BLOCKED', 'This move is not allowed');
    }
    if (isBackward(r.workflowStatus, to) && !reason) {
      throw fail(400, 'REASON_REQUIRED', 'Going back a step needs a reason');
    }
    const blockers = blockersFor(r, to, rows);
    if (blockers.length) throw fail(409, 'STATUS_BLOCKED', 'Blocked');
    r.workflowStatus = to;
    r.statusReason = reason;
    if (filed(to) && !r.firstFiledAt) {
      r.firstFiledAt = nowIso();
      r.filedOn = day(0);
    }
    r.history.unshift({
      at: nowIso(),
      workflowStatus: to,
      preparer: r.preparer,
      reviewer: r.reviewer,
      reason,
      by: me,
    });
    touch(r, 'STATUS', 'Status changed');
  };
  const syncFilingStatus = (f: TaxReturnFiling) => {
    if (f.filingMethod === 'PAPER') return;
    const newest = f.attempts[0];
    f.status = !newest
      ? 'NOT_FILED'
      : newest.ackStatus === 'PENDING'
        ? 'TRANSMITTED'
        : newest.ackStatus;
  };
  const filingOf = (r: Stored, filingId: string) => {
    const f = r.filings.find((x) => x.id === filingId);
    if (!f) throw notFound();
    return f;
  };
  const memberRef = (userId: string | null | undefined): MemberRef | null => {
    if (!userId) return null;
    const m = team().find((t) => t.user.id === userId);
    if (!m) throw fail(409, 'NOT_A_MEMBER', 'Not an active member');
    return { userId, name: m.user.name };
  };

  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(TaxReturnsQuery, query);
      const s = q.search?.trim().toLowerCase();
      const filtered = rows.filter((r) => {
        const c = clientOf(r);
        return (
          reachable(r) &&
          (q.archived ? r.archivedAt !== null : r.archivedAt === null) &&
          tabOf(r, q.tab) &&
          (!q.workflowStatus || r.workflowStatus === q.workflowStatus) &&
          (!q.taxYear || r.taxYear === q.taxYear) &&
          (!q.formType || r.formType?.toLowerCase() === q.formType.toLowerCase()) &&
          (!q.clientType || c.accountType === q.clientType) &&
          (!q.assignedUserId ||
            r.preparer?.userId === q.assignedUserId ||
            r.reviewer?.userId === q.assignedUserId) &&
          (!q.updatedFrom || r.updatedAt.slice(0, 10) >= q.updatedFrom) &&
          (!q.updatedTo || r.updatedAt.slice(0, 10) <= q.updatedTo) &&
          (!s ||
            c.name.toLowerCase().includes(s) ||
            (r.formType ?? '').toLowerCase().includes(s) ||
            c.last4 === s ||
            r.id === s)
        );
      });
      const key: Record<string, (r: Stored) => string | number> = {
        updated: (r) => -Date.parse(r.updatedAt),
        client: (r) => clientOf(r).name.toLowerCase(),
        due: (r) => r.dueOn ?? '9999',
        year: (r) => -r.taxYear,
        status: (r) => ALL.indexOf(r.workflowStatus),
      };
      const by = key[q.sort]!;
      filtered.sort((a, b) => {
        const x = by(a);
        const y = by(b);
        return x < y ? -1 : x > y ? 1 : b.id.localeCompare(a.id);
      });
      const start = (q.page - 1) * q.pageSize;
      return {
        items: filtered.slice(start, start + q.pageSize).map(toRow),
        total: filtered.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    summary: async (query = {}) => {
      await mockDelay();
      const q = parseInput(TaxReturnSummaryQuery, query);
      const live = rows.filter((r) => reachable(r) && !r.archivedAt);
      const latest = Math.max(0, ...live.map((r) => r.taxYear));
      const taxYear = q.taxYear ?? (latest || new Date().getUTCFullYear() - 1);
      const year = live.filter((r) => r.taxYear === taxYear);
      const count = (statuses: TaxReturnWorkflowStatus[] | null) => {
        const value = year.filter((r) => !statuses || statuses.includes(r.workflowStatus)).length;
        // A month ago: fewer returns, mostly earlier in the workflow (synthetic).
        return { value, previous: year.length ? Math.max(0, Math.round(value * 0.85)) : null };
      };
      return {
        taxYear,
        total: count(null),
        inPreparation: count(['IN_PREPARATION']),
        waitingOnClient: count(['WAITING_ON_CLIENT']),
        readyForReviewOrFile: count(['READY_FOR_REVIEW', 'READY_FOR_SIGNATURE', 'READY_TO_FILE']),
        transmitted: count(['TRANSMITTED']),
        accepted: count(['ACCEPTED']),
        rejected: count(['REJECTED']),
        progress: ALL.map((workflowStatus) => ({
          workflowStatus,
          count: year.filter((r) => r.workflowStatus === workflowStatus).length,
        })).filter((p) => p.count > 0),
      };
    },
    create: async (body) => {
      await mockDelay();
      const b = parseInput(CreateWorkspaceTaxReturnRequest, body);
      const client = clients.find((c) => c.id === b.clientId);
      if (!client || (role === 'STAFF' && !client.staffs)) throw notFound();
      const duplicate = rows.some(
        (r) =>
          r.clientId === b.clientId &&
          r.taxYear === b.taxYear &&
          (r.formType ?? '') === (b.formType ?? '') &&
          r.quarter === (b.quarter ?? null) &&
          !r.archivedAt,
      );
      if (duplicate && !b.allowDuplicate) {
        throw fail(409, 'DUPLICATE_RETURN', 'This client already has this return');
      }
      if (b.amendsReturnId) {
        const original = rows.find((r) => r.id === b.amendsReturnId && r.clientId === b.clientId);
        if (!original) throw notFound();
        if (!original.firstFiledAt) throw fail(409, 'ORIGINAL_NOT_FILED', 'Not filed yet');
      }
      const id = newId('0d00');
      const at = nowIso();
      const r: Stored = {
        id,
        clientId: b.clientId,
        taxYear: b.taxYear,
        filingType: b.filingType,
        quarter: b.quarter ?? null,
        formType: b.formType ?? null,
        workflowStatus: 'IN_PREPARATION',
        statusReason: null,
        filingStatus: b.filingStatus ?? null,
        preparer: memberRef(b.preparerUserId),
        reviewer: memberRef(b.reviewerUserId),
        dueOn: b.dueOn ?? null,
        amendsReturnId: b.amendsReturnId ?? null,
        amendReason: b.amendReason ?? null,
        estimate: b.quarter
          ? { amountCents: null, status: 'NOT_STARTED', paidOn: null, overdue: false }
          : null,
        archivedAt: null,
        finalValidatedAt: null,
        finalValidatedBy: null,
        firstFiledAt: null,
        filedOn: null,
        createdAt: at,
        updatedAt: at,
        filings: b.quarter
          ? []
          : ['US', ...(b.states ?? [])].map((jurisdiction) => ({
              id: newId('0f00'),
              jurisdiction,
              filingMethod: 'EFILE' as const,
              required: true,
              status: 'NOT_FILED' as const,
              paperFiledOn: null,
              refundCents: null,
              amountDueCents: null,
              amountStatus: null,
              attempts: [],
            })),
        checklist: [],
        approvals: [],
        authorizations: [],
        documents: [],
        history: [
          {
            at,
            workflowStatus: 'IN_PREPARATION',
            preparer: memberRef(b.preparerUserId),
            reviewer: memberRef(b.reviewerUserId),
            reason: null,
            by: me,
          },
        ],
        activity: [
          { id: newId('0e00'), at, kind: 'CREATED', label: 'Return created', by: me.name },
        ],
      };
      rows = [r, ...rows];
      return toDetail(r);
    },
    efileReport: async (query = {}) => {
      await mockDelay();
      const q = parseInput(EfileReportQuery, query);
      const live = rows.filter((r) => reachable(r) && !r.archivedAt);
      const taxYear =
        q.taxYear ?? Math.max(new Date().getUTCFullYear() - 1, ...live.map((r) => r.taxYear));
      const year = live.filter((r) => r.taxYear === taxYear);
      const filings = year.flatMap((r) => r.filings.map((f) => ({ r, f })));
      const jurisdictions = [...new Set(filings.map((x) => x.f.jurisdiction))].sort((a, b) =>
        a === 'US' ? -1 : b === 'US' ? 1 : a.localeCompare(b),
      );
      return {
        taxYear,
        byJurisdiction: jurisdictions.map((jurisdiction) => {
          const of = filings.filter((x) => x.f.jurisdiction === jurisdiction);
          const n = (s: string) => of.filter((x) => x.f.status === s).length;
          return {
            jurisdiction,
            notFiled: n('NOT_FILED'),
            transmitted: n('TRANSMITTED'),
            accepted: n('ACCEPTED'),
            rejected: n('REJECTED'),
            paperFiled: n('PAPER_FILED'),
          };
        }),
        rejections: filings
          .filter((x) => x.f.status === 'REJECTED')
          .map((x) => ({
            taxReturnId: x.r.id,
            clientName: clientOf(x.r).name,
            jurisdiction: x.f.jurisdiction,
            rejectCode: x.f.attempts[0]?.rejectCode ?? null,
            acknowledgedAt: x.f.attempts[0]?.acknowledgedAt ?? nowIso(),
          })),
      };
    },
    exportList: async (query = {}) => {
      await mockDelay();
      parseInput(TaxReturnsQuery, query);
      if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'Exports need the export permission');
      const csv = 'Client,Return Type,Tax Year,Status\n';
      return {
        url: `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        fileName: 'tax-returns.csv',
        rowCount: rows.filter(reachable).length,
      };
    },

    get: async (id) => {
      await mockDelay();
      return toDetail(find(id));
    },
    updateDetails: async (id, body) => {
      await mockDelay();
      const b = parseInput(UpdateTaxReturnDetailsRequest, body);
      const r = find(id);
      if (b.formType !== undefined) r.formType = b.formType || null;
      if (b.filingStatus !== undefined) r.filingStatus = b.filingStatus;
      if (b.dueOn !== undefined) r.dueOn = b.dueOn;
      const assigned = b.preparerUserId !== undefined || b.reviewerUserId !== undefined;
      if (b.preparerUserId !== undefined) r.preparer = memberRef(b.preparerUserId);
      if (b.reviewerUserId !== undefined) r.reviewer = memberRef(b.reviewerUserId);
      if (r.estimate) {
        if (b.estimateAmountCents !== undefined) r.estimate.amountCents = b.estimateAmountCents;
        if (b.estimateStatus !== undefined) r.estimate.status = b.estimateStatus;
        if (b.estimatePaidOn !== undefined) r.estimate.paidOn = b.estimatePaidOn;
      }
      if (assigned) {
        r.history.unshift({
          at: nowIso(),
          workflowStatus: r.workflowStatus,
          preparer: r.preparer,
          reviewer: r.reviewer,
          reason: null,
          by: me,
        });
      }
      touch(
        r,
        assigned ? 'ASSIGNED' : 'UPDATED',
        assigned ? 'Assignment changed' : 'Details updated',
      );
      return toDetail(r);
    },
    changeStatus: async (id, body) => {
      await mockDelay();
      const b = parseInput(ChangeTaxReturnStatusRequest, body);
      const r = find(id);
      move(r, b.workflowStatus, b.reason ?? null);
      return toDetail(r);
    },
    history: async (id) => {
      await mockDelay();
      return copy(find(id).history);
    },
    activity: async (id) => {
      await mockDelay();
      return copy(find(id).activity);
    },
    archive: async (id) => {
      await mockDelay();
      const r = find(id);
      r.archivedAt = nowIso();
      touch(r, 'ARCHIVED', 'Return archived');
      return toDetail(r);
    },
    restore: async (id) => {
      await mockDelay();
      const r = find(id);
      r.archivedAt = null;
      touch(r, 'RESTORED', 'Return restored');
      return toDetail(r);
    },
    amend: async (id, body) => {
      await mockDelay();
      const b = parseInput(AmendTaxReturnRequest, body);
      const r = find(id);
      if (!r.firstFiledAt) throw fail(409, 'ORIGINAL_NOT_FILED', 'Not filed yet');
      const created = seed(clients, ++seq, clients.indexOf(clientOf(r)), {
        workflowStatus: 'IN_PREPARATION',
        taxYear: r.taxYear,
        formType: r.filingType === 'INDIVIDUAL' ? '1040-X' : r.formType,
        amendsReturnId: r.id,
        amendReason: b.reason,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      rows = [created, ...rows];
      return toDetail(created);
    },
    carryForward: async (id, body) => {
      await mockDelay();
      const b = parseInput(CarryForwardTaxReturnRequest, body);
      const r = find(id);
      if (
        rows.some(
          (x) =>
            x.clientId === r.clientId &&
            x.taxYear === b.taxYear &&
            x.formType === r.formType &&
            x.quarter === r.quarter,
        )
      ) {
        throw fail(409, 'DUPLICATE_RETURN', 'This client already has this return');
      }
      const created = seed(clients, ++seq, clients.indexOf(clientOf(r)), {
        workflowStatus: 'IN_PREPARATION',
        taxYear: b.taxYear,
        formType: r.formType,
        preparer: r.preparer,
        reviewer: r.reviewer,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      });
      rows = [created, ...rows];
      return toDetail(created);
    },

    filings: async (id) => {
      await mockDelay();
      return copy(find(id).filings);
    },
    setFilings: async (id, body) => {
      await mockDelay();
      const b = parseInput(SetTaxReturnFilingsRequest, body);
      const r = find(id);
      const next: TaxReturnFiling[] = b.filings.map((f) => {
        const had = r.filings.find((x) => x.jurisdiction === f.jurisdiction);
        return had
          ? {
              ...had,
              required: f.required,
              filingMethod: had.attempts.length ? had.filingMethod : f.filingMethod,
            }
          : {
              id: newId('0f00'),
              jurisdiction: f.jurisdiction,
              filingMethod: f.filingMethod,
              required: f.required,
              status: 'NOT_FILED',
              paperFiledOn: null,
              refundCents: null,
              amountDueCents: null,
              amountStatus: null,
              attempts: [],
            };
      });
      for (const old of r.filings) {
        if (!next.some((x) => x.jurisdiction === old.jurisdiction) && old.attempts.length) {
          next.push({ ...old, required: false });
        }
      }
      r.filings = next;
      touch(r, 'FILING', 'Jurisdictions updated');
      return copy(r.filings);
    },
    updateFiling: async (id, filingId, body) => {
      await mockDelay();
      const b = parseInput(UpdateTaxReturnFilingRequest, body);
      const r = find(id);
      const f = filingOf(r, filingId);
      if (b.filingMethod && f.attempts.length)
        throw fail(409, 'RETURN_LOCKED', 'Already transmitted');
      Object.assign(f, b);
      touch(r, 'FILING', `${f.jurisdiction} filing updated`);
      return copy(r.filings);
    },
    recordAttempt: async (id, filingId, body) => {
      await mockDelay();
      const b = parseInput(RecordTaxFilingAttemptRequest, body);
      const r = find(id);
      const f = filingOf(r, filingId);
      if (f.attempts[0] && f.attempts[0].ackStatus !== 'REJECTED') {
        throw fail(409, 'ATTEMPT_PENDING', 'Wait for the last transmission');
      }
      f.attempts.unshift({
        id: newId('0a00'),
        submissionId: b.submissionId,
        transmittedAt: b.transmittedAt,
        ackStatus: 'PENDING',
        acknowledgedAt: null,
        rejectCode: null,
        rejectDescription: null,
        correctiveAction: null,
        recordedBy: me,
        createdAt: nowIso(),
      });
      syncFilingStatus(f);
      touch(r, 'TRANSMISSION', `${f.jurisdiction} transmission recorded`);
      return copy(r.filings);
    },
    updateAttempt: async (id, attemptId, body) => {
      await mockDelay();
      const b = parseInput(UpdateTaxFilingAttemptRequest, body);
      const r = find(id);
      const f = r.filings.find((x) => x.attempts.some((a) => a.id === attemptId));
      const a = f?.attempts.find((x) => x.id === attemptId);
      if (!f || !a) throw notFound();
      if (b.ackStatus === 'NOTE') a.correctiveAction = b.correctiveAction ?? null;
      else {
        if (a.ackStatus !== 'PENDING') throw fail(409, 'RETURN_LOCKED', 'Already answered');
        a.ackStatus = b.ackStatus;
        a.acknowledgedAt = b.acknowledgedAt;
        if (b.ackStatus === 'REJECTED') {
          a.rejectCode = b.rejectCode ?? null;
          a.rejectDescription = b.rejectDescription ?? null;
          a.correctiveAction = b.correctiveAction ?? null;
        }
      }
      syncFilingStatus(f);
      touch(r, 'TRANSMISSION', `${f.jurisdiction} acknowledgment recorded`);
      return copy(r.filings);
    },
    paperFiled: async (id, filingId, body) => {
      await mockDelay();
      const b = parseInput(PaperFiledRequest, body);
      const r = find(id);
      const f = filingOf(r, filingId);
      if (f.filingMethod !== 'PAPER') throw fail(409, 'RETURN_LOCKED', 'Only a paper filing');
      f.paperFiledOn = b.paperFiledOn;
      f.status = 'PAPER_FILED';
      touch(r, 'FILING', `${f.jurisdiction} paper filing recorded`);
      return copy(r.filings);
    },

    checklist: async (id) => {
      await mockDelay();
      return copy(find(id).checklist);
    },
    addChecklistItem: async (id, body) => {
      await mockDelay();
      const b = parseInput(CreateTaxChecklistItemRequest, body);
      const r = find(id);
      r.checklist.push({
        id: newId('0b00'),
        section: b.section,
        label: b.label,
        sortOrder: r.checklist.length + 1,
        result: b.result ?? (b.section === 'VALIDATION' ? 'VALID' : 'OPEN'),
        note: b.note ?? null,
        acknowledgedAt: null,
        acknowledgedBy: null,
        updatedAt: nowIso(),
      });
      if (b.section === 'VALIDATION') {
        r.finalValidatedAt = null;
        r.finalValidatedBy = null;
      }
      touch(r, 'CHECKLIST', 'Checklist item added');
      return copy(r.checklist);
    },
    updateChecklistItem: async (id, itemId, body) => {
      await mockDelay();
      const b = parseInput(UpdateTaxChecklistItemRequest, body);
      const r = find(id);
      const item = r.checklist.find((x) => x.id === itemId);
      if (!item) throw notFound();
      if (b.label !== undefined) item.label = b.label;
      if (b.note !== undefined) item.note = b.note ?? null;
      if (b.sortOrder !== undefined) item.sortOrder = b.sortOrder;
      if (b.result !== undefined && b.result !== item.result) {
        item.result = b.result;
        item.acknowledgedAt = null;
        item.acknowledgedBy = null;
        if (item.section === 'VALIDATION') {
          r.finalValidatedAt = null;
          r.finalValidatedBy = null;
        }
      }
      if (b.acknowledge) {
        item.acknowledgedAt = nowIso();
        item.acknowledgedBy = me;
      }
      item.updatedAt = nowIso();
      touch(
        r,
        item.section === 'VALIDATION' ? 'VALIDATION' : 'CHECKLIST',
        'Checklist item updated',
      );
      return copy(r.checklist);
    },
    removeChecklistItem: async (id, itemId) => {
      await mockDelay();
      const r = find(id);
      if (!r.checklist.some((x) => x.id === itemId)) throw notFound();
      r.checklist = r.checklist.filter((x) => x.id !== itemId);
      touch(r, 'CHECKLIST', 'Checklist item removed');
      return copy(r.checklist);
    },
    finalValidation: async (id) => {
      await mockDelay();
      const r = find(id);
      const checks = r.checklist.filter((c) => c.section === 'VALIDATION');
      if (checks.some((c) => c.result === 'ERROR')) {
        throw fail(409, 'STATUS_BLOCKED', 'Errors remain');
      }
      if (checks.some((c) => c.result === 'WARNING' && !c.acknowledgedAt)) {
        throw fail(409, 'STATUS_BLOCKED', 'Warnings');
      }
      r.finalValidatedAt = nowIso();
      r.finalValidatedBy = me;
      touch(r, 'VALIDATION', 'Final validation recorded');
      return toDetail(r);
    },

    approvals: async (id) => {
      await mockDelay();
      return copy(find(id).approvals);
    },
    addApproval: async (id, body) => {
      await mockDelay();
      const b = parseInput(CreateTaxApprovalRequest, body);
      const r = find(id);
      r.approvals.push({
        id: newId('0c10'),
        step: b.step,
        sortOrder: r.approvals.length + 1,
        assignedTo: memberRef(b.assignedUserId),
        status: 'PENDING',
        decidedAt: null,
        decidedBy: null,
        approvedDocument: null,
        note: null,
        createdAt: nowIso(),
      });
      touch(r, 'APPROVAL', 'Approval step added');
      return copy(r.approvals);
    },
    approve: async (id, approvalId, body = {}) => {
      await mockDelay();
      const b = parseInput(ApproveTaxApprovalRequest, body);
      const r = find(id);
      const a = r.approvals.find((x) => x.id === approvalId);
      if (!a) throw notFound();
      if (a.status !== 'PENDING') throw fail(409, 'RETURN_LOCKED', 'Already decided');
      a.status = 'APPROVED';
      a.decidedAt = nowIso();
      a.decidedBy = me;
      a.note = b.note ?? null;
      const doc = b.approvedDocumentId
        ? r.documents.find((d) => d.document.id === b.approvedDocumentId)
        : undefined;
      a.approvedDocument = doc ? { id: doc.document.id, fileName: doc.document.fileName } : null;
      touch(r, 'APPROVAL', `${a.step} approved`);
      return copy(r.approvals);
    },
    returnToPreparer: async (id, approvalId, body) => {
      await mockDelay();
      const b = parseInput(ReturnTaxApprovalRequest, body);
      const r = find(id);
      const a = r.approvals.find((x) => x.id === approvalId);
      if (!a) throw notFound();
      if (a.status !== 'PENDING') throw fail(409, 'RETURN_LOCKED', 'Already decided');
      a.status = 'RETURNED';
      a.decidedAt = nowIso();
      a.decidedBy = me;
      a.note = b.note;
      if ((STEP[r.workflowStatus] ?? 0) > 1) {
        r.workflowStatus = 'IN_PREPARATION';
        r.statusReason = b.note;
      }
      touch(r, 'APPROVAL', `${a.step} returned to the preparer`);
      return copy(r.approvals);
    },

    authorizations: async (id) => {
      await mockDelay();
      return copy(find(id).authorizations);
    },
    setAuthorizations: async (id, body) => {
      await mockDelay();
      const b = parseInput(SetTaxAuthorizationsRequest, body);
      const r = find(id);
      r.authorizations = b.items.map((i) => {
        const had = r.authorizations.find(
          (a) => a.kind === i.kind && a.jurisdiction === (i.jurisdiction ?? null),
        );
        return had
          ? { ...had, required: i.required }
          : {
              id: newId('0c20'),
              kind: i.kind,
              jurisdiction: i.jurisdiction ?? null,
              required: i.required,
              status: 'NOT_SENT' as const,
              esignRequestId: null,
              signedOn: null,
              document: null,
              updatedAt: nowIso(),
            };
      });
      touch(r, 'AUTHORIZATION', 'Authorizations updated');
      return copy(r.authorizations);
    },
    linkAuthorization: async (id, authorizationId, body) => {
      await mockDelay();
      const b = parseInput(LinkTaxAuthorizationRequest, body);
      const r = find(id);
      const a = r.authorizations.find((x) => x.id === authorizationId);
      if (!a) throw notFound();
      a.esignRequestId = b.esignRequestId;
      a.status = 'SENT';
      a.updatedAt = nowIso();
      touch(r, 'AUTHORIZATION', 'Signature request linked');
      return copy(r.authorizations);
    },
    wetSignature: async (id, authorizationId, body) => {
      await mockDelay();
      const b = parseInput(WetSignatureRequest, body);
      const r = find(id);
      const a = r.authorizations.find((x) => x.id === authorizationId);
      if (!a) throw notFound();
      a.status = 'SIGNED';
      a.signedOn = b.signedOn;
      const doc = r.documents.find((d) => d.document.id === b.documentId);
      a.document = doc ? { id: doc.document.id, fileName: doc.document.fileName } : null;
      a.updatedAt = nowIso();
      touch(r, 'AUTHORIZATION', 'Signed on paper');
      return copy(r.authorizations);
    },

    documents: async (id) => {
      await mockDelay();
      return copy(find(id).documents);
    },
    linkDocument: async (id, body) => {
      await mockDelay();
      const b = parseInput(LinkTaxReturnDocumentRequest, body);
      const r = find(id);
      r.documents.push({
        id: newId('0c30'),
        kind: b.kind,
        jurisdiction: b.jurisdiction ?? null,
        document: { id: b.documentId, fileName: 'Linked document.pdf', scanStatus: 'CLEAN' },
        addedBy: me,
        createdAt: nowIso(),
      });
      touch(r, 'DOCUMENT', 'Document linked');
      return copy(r.documents);
    },
    unlinkDocument: async (id, documentId) => {
      await mockDelay();
      const r = find(id);
      const d = r.documents.find((x) => x.document.id === documentId);
      if (!d) throw notFound();
      if (d.kind === 'FILED_RETURN' || d.kind === 'ACKNOWLEDGMENT') {
        throw fail(409, 'DOCUMENT_LOCKED', 'This document stays linked');
      }
      r.documents = r.documents.filter((x) => x !== d);
      touch(r, 'DOCUMENT', 'Document unlinked');
      return { ok: true };
    },
  };
}
