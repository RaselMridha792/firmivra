import {
  ApiRequestError,
  checkIntakeAnswers,
  INTAKE_FORMS,
  IntakeId,
  type IntakeChoice,
  type IntakeFormDefinition,
  type IntakesClient,
  type IntakeSummary,
  type IntakeView,
  maskIntakeAnswers,
  type MyIntakesClient,
  parseInput,
  RequestIntakeCorrectionRequest,
  restoreMaskedNumbers,
  SaveIntakeStepRequest,
  SendIntakeRequest,
  type ServiceRef,
  StartIntakeRequest,
} from '@firmivra/types';
import { firstClientId, type MockFirmRole } from './clients';

/**
 * Mock data for `api.myIntakes(slug)` and `api.intakes` (R11): the first fixture client's intake
 * forms. Synthetic data only. Same checks, statuses and error codes as the API: a save checks the
 * step's answers, SSNs come back as `{ last4 }`, a submitted version is locked, and corrections
 * and unlocking (Owner and Admin) start the next version. Submit comes with the signing step.
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
const engagements = [
  {
    id: '0199b6a3-0000-7000-8000-0000000000c1',
    title: '2025 Annual Tax',
    taxYear: 2025,
    service: annual,
  },
  {
    id: '0199b6a3-0000-7000-8000-0000000000c2',
    title: 'Bookkeeping',
    taxYear: null,
    service: bookkeeping,
  },
];

const id = (n: number) => `0199b6a6-0000-7000-8000-${String(n).padStart(12, '0')}`;
const now = () => new Date().toISOString();
const pause = () => new Promise((resolve) => setTimeout(resolve, 250));
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const OPEN: readonly string[] = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'];

/** One intake as the mock keeps it: full answers (synthetic), masked on the way out. */
interface Row extends Omit<IntakeView, 'definition' | 'locked'> {
  clientId: string;
  stored: Record<string, unknown>;
  lastSubmitted: Record<string, unknown> | null;
}

const definitionOf = (s: ServiceRef): IntakeFormDefinition => {
  const d = INTAKE_FORMS[s.kind as keyof typeof INTAKE_FORMS];
  if (!d) throw fail(409, 'NO_INTAKE_FORM', 'This service has no intake form');
  return d;
};

function newRow(engagementIndex: number, status: Row['status'], n: number): Row {
  const e = engagements[engagementIndex]!;
  const at = now();
  return {
    id: id(n),
    clientId: firstClientId,
    status,
    service: e.service,
    engagement: { id: e.id, title: e.title, taxYear: e.taxYear },
    formVersion: 1,
    version: 1,
    dueOn: null,
    correctionNote: null,
    correctionRequestedAt: null,
    submittedAt: null,
    createdAt: at,
    updatedAt: at,
    answers: {},
    savedSteps: [],
    uploads: [],
    stored: {},
    lastSubmitted: null,
  };
}

function createStore() {
  const first = newRow(0, 'IN_PROGRESS', 1);
  first.stored = { firstName: 'Sample', lastName: 'Client', ssn: '000-12-3456' };
  first.savedSteps = ['personal'];
  const rows: Row[] = [first];
  let next = 2;
  const view = (r: Row): IntakeView => {
    const { clientId: _c, stored, lastSubmitted: _l, ...rest } = r;
    const definition = definitionOf(r.service);
    return {
      ...rest,
      definition,
      answers: maskIntakeAnswers(definition, stored),
      locked: !OPEN.includes(r.status),
    };
  };
  const summary = (r: Row): IntakeSummary => {
    const { definition: _d, answers: _a, savedSteps: _s, locked: _k, uploads: _u, ...s } = view(r);
    return s;
  };
  const find = (intakeId: string) => {
    const row = rows.find((r) => r.id === parseInput(IntakeId, intakeId));
    if (!row) throw notFound();
    return row;
  };
  const openFor = (engagementId: string) =>
    rows.find((r) => r.engagement.id === engagementId && OPEN.includes(r.status));
  const create = (engagementId: string, status: Row['status']) => {
    const index = engagements.findIndex((e) => e.id === engagementId);
    if (index < 0) throw notFound();
    definitionOf(engagements[index]!.service);
    const row = newRow(index, status, next++);
    rows.push(row);
    return row;
  };
  const touch = (r: Row, change: Partial<Row>) => Object.assign(r, change, { updatedAt: now() });
  return { rows, view, summary, find, openFor, create, touch };
}

let store: ReturnType<typeof createStore> | undefined;
const shared = () => (store ??= createStore());

/** `api.myIntakes(slug)` in mock mode: the first fixture client, at any firm slug. */
export function myIntakesMock(_firmSlug: string): MyIntakesClient {
  const s = shared();
  return {
    list: async () => {
      await pause();
      return s.rows.map(s.summary);
    },
    choices: async (): Promise<IntakeChoice[]> => {
      await pause();
      return engagements.map((e) => {
        const newest = s.rows.filter((r) => r.engagement.id === e.id).at(-1);
        return {
          engagement: { id: e.id, title: e.title, taxYear: e.taxYear },
          service: e.service,
          intake: newest ? s.summary(newest) : null,
        };
      });
    },
    start: async (body) => {
      await pause();
      const { engagementId } = parseInput(StartIntakeRequest, body);
      return s.view(s.openFor(engagementId) ?? s.create(engagementId, 'IN_PROGRESS'));
    },
    get: async (intakeId) => {
      await pause();
      return s.view(s.find(intakeId));
    },
    saveStep: async (intakeId, stepKey, body) => {
      await pause();
      const row = s.find(intakeId);
      const { answers } = parseInput(SaveIntakeStepRequest, body);
      if (!OPEN.includes(row.status))
        throw fail(409, 'INTAKE_LOCKED', 'This form was already sent');
      const definition = definitionOf(row.service);
      if (!definition.steps.some((st) => st.key === stepKey)) {
        throw fail(400, 'VALIDATION_FAILED', 'Unknown step');
      }
      const restored = restoreMaskedNumbers(definition, answers, row.stored);
      const checked = checkIntakeAnswers(definition, restored.answers, {
        mode: 'save',
        step: stepKey,
      });
      if (restored.issues.length || checked.issues.length) {
        throw fail(400, 'VALIDATION_FAILED', 'Check the highlighted answers');
      }
      s.touch(row, {
        stored: { ...row.stored, ...checked.answers },
        savedSteps: row.savedSteps.includes(stepKey)
          ? row.savedSteps
          : [...row.savedSteps, stepKey],
        status: row.status === 'SENT' ? 'IN_PROGRESS' : row.status,
      });
      return s.view(row);
    },
  };
}

/** `api.intakes` in mock mode. Staff see the first client (assigned to them in the fixtures). */
export function createIntakesMock(options: { role?: MockFirmRole } = {}): IntakesClient {
  const s = shared();
  const manager = (options.role ?? 'OWNER') !== 'STAFF';
  const move = (intakeId: string, from: Row['status'][], to: Row['status']) => {
    const row = s.find(intakeId);
    if (!from.includes(row.status)) throw fail(409, 'INVALID_STATUS', 'Not in this status');
    return s.view(s.touch(row, { status: to }));
  };
  const reopen = (
    intakeId: string,
    to: 'NEEDS_CORRECTION' | 'IN_PROGRESS',
    note: string | null,
  ) => {
    if (!manager) throw fail(403, 'FORBIDDEN', 'This action is not permitted');
    const row = s.find(intakeId);
    const from =
      to === 'IN_PROGRESS'
        ? ['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED']
        : ['SUBMITTED', 'UNDER_REVIEW'];
    if (!from.includes(row.status)) throw fail(409, 'INVALID_STATUS', 'Not in this status');
    return s.view(
      s.touch(row, {
        status: to,
        version: row.version + 1,
        correctionNote: note,
        correctionRequestedAt: note ? now() : null,
        stored: { ...(row.lastSubmitted ?? row.stored) },
      }),
    );
  };
  return {
    listForClient: async (clientId) => {
      await pause();
      return s.rows.filter((r) => r.clientId === clientId).map(s.summary);
    },
    send: async (engagementId, body = {}) => {
      await pause();
      const { dueOn } = parseInput(SendIntakeRequest, body);
      if (s.openFor(engagementId)) throw fail(409, 'INTAKE_OPEN', 'This service has an open form');
      return s.view(s.touch(s.create(engagementId, 'SENT'), { dueOn: dueOn ?? null }));
    },
    get: async (intakeId) => {
      await pause();
      return s.view(s.find(intakeId));
    },
    startReview: async (intakeId) => {
      await pause();
      return move(intakeId, ['SUBMITTED'], 'UNDER_REVIEW');
    },
    complete: async (intakeId) => {
      await pause();
      return move(intakeId, ['SUBMITTED', 'UNDER_REVIEW'], 'COMPLETED');
    },
    requestCorrection: async (intakeId, body) => {
      await pause();
      const { note } = parseInput(RequestIntakeCorrectionRequest, body);
      return reopen(intakeId, 'NEEDS_CORRECTION', note);
    },
    unlock: async (intakeId) => {
      await pause();
      return reopen(intakeId, 'IN_PROGRESS', null);
    },
  };
}
