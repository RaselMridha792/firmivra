import {
  ApiRequestError,
  type BeginDraft,
  BEGIN_ONLINE_ERRORS,
  beginOnlineContact,
  beginOnlineTaxYear,
  type BeginOnlineClient,
  type BeginOnlineErrorCode,
  type BeginOnlineService,
  checkIntakeAnswers,
  ConfirmUploadRequest,
  CreateDraftUploadRequest,
  type DraftUpload,
  INTAKE_LIMITS,
  intakeFields,
  INTAKE_FORMS,
  type IntakeFormDefinition,
  type IntakeIssue,
  IntakeKey,
  intakeStepFields,
  maskIntakeAnswers,
  parseInput,
  restoreMaskedNumbers,
  ResumeDraftRequest,
  SaveDraftStepRequest,
  StartDraftRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * Mock data for `api.beginOnline(slug)` (R11). Synthetic data only. The six built-in forms, one
 * draft per firm slug (the API keeps it in an HttpOnly cookie; here it lives in memory until the
 * page reloads), and the API's checks and error codes: the first step must carry the contact,
 * answers are checked with `checkIntakeAnswers`, SSNs and EINs come back as `{ last4 }`, a draft
 * runs 30 days from its last save. Nothing is built until the first call.
 */
const DAY = 86_400_000;
const today = () => new Date().toISOString().slice(0, 10);
const fail = (status: number, code: BeginOnlineErrorCode, details?: IntakeIssue[]) => {
  const error = new ApiRequestError(status, code, BEGIN_ONLINE_ERRORS[code]);
  return details ? Object.assign(error, { details: { issues: details } }) : error;
};

const SERVICES: readonly (Omit<BeginOnlineService, 'id'> & { n: number })[] = [
  {
    n: 1,
    kind: 'ANNUAL_TAX',
    name: 'Tax Preparation',
    description: 'Individual & Business Tax Returns',
    packages: [],
  },
  {
    n: 2,
    kind: 'BOOKKEEPING',
    name: 'Business Bookkeeping',
    description: 'Keep Your Business on Track',
    packages: ['Starter', 'Growth', 'Premium'],
  },
  {
    n: 3,
    kind: 'PAYROLL',
    name: 'Payroll Services',
    description: 'Simple. Accurate. On Time.',
    packages: [],
  },
  {
    n: 4,
    kind: 'BUSINESS_DEVELOPMENT',
    name: 'Business Development',
    description: 'Plan. Grow. Succeed.',
    packages: [],
  },
  {
    n: 5,
    kind: 'QUARTERLY_TAX',
    name: 'File Business Quarterly Taxes',
    description: 'Stay Compliant. Avoid Penalties.',
    packages: [],
  },
  {
    n: 6,
    kind: 'TAX_PLANNING',
    name: 'Tax Planning',
    description: 'Strategize Today for a Brighter Tomorrow',
    packages: [],
  },
];

/** The mock firm's Begin Online services, in its order. */
export function beginOnlineFixtures(): BeginOnlineService[] {
  return SERVICES.map(({ n, ...s }) => ({ id: `0199b6a3-0000-7000-8000-00000000000${n}`, ...s }));
}

interface MockDraft {
  leadId: string;
  service: BeginOnlineService;
  definition: IntakeFormDefinition;
  taxYear: number | null;
  answers: Record<string, unknown>;
  savedSteps: string[];
  expiresAt: number;
  uploads: DraftUpload[];
}

function createBeginOnlineMock(): BeginOnlineClient {
  const services = beginOnlineFixtures();
  let draft: MockDraft | null = null;

  const serviceOf = (id: string) => {
    const found = services.find((s) => s.id === id);
    const definition = found && INTAKE_FORMS[found.kind];
    if (!found || !definition) throw fail(404, 'NOT_FOUND');
    return { service: found, definition };
  };
  const view = (d: MockDraft): BeginDraft => ({
    leadId: d.leadId,
    service: { id: d.service.id, kind: d.service.kind, name: d.service.name },
    definition: d.definition,
    taxYear: d.taxYear,
    answers: maskIntakeAnswers(d.definition, d.answers),
    savedSteps: [...d.savedSteps],
    draftExpiresAt: new Date(d.expiresAt).toISOString(),
    uploads: d.uploads.map((u) => ({ ...u })),
  });
  const live = (): MockDraft => {
    if (!draft) throw fail(404, 'DRAFT_NOT_FOUND');
    if (draft.expiresAt <= Date.now()) throw fail(410, 'DRAFT_EXPIRED');
    return draft;
  };
  /** One step's answers, checked and with `{ last4 }` matched to the stored numbers. */
  const checked = (d: IntakeFormDefinition, step: string, answers: object, stored: object) => {
    const result = checkIntakeAnswers(d, answers as Record<string, unknown>, {
      mode: 'save',
      step,
      today: today(),
    });
    if (result.issues.length) throw fail(400, 'VALIDATION_FAILED', result.issues);
    const masked = maskIntakeAnswers(d, stored as Record<string, unknown>);
    const restored = restoreMaskedNumbers(d, result.answers, masked);
    if (restored.issues.length) throw fail(400, 'VALIDATION_FAILED', restored.issues);
    if (d.steps[0]?.key === step) {
      const { issues } = beginOnlineContact(d, restored.answers);
      if (issues.length) throw fail(400, 'VALIDATION_FAILED', issues);
    }
    // The mock keeps numbers as `{ last4 }`, as a screen would see them.
    return maskIntakeAnswers(d, restored.answers);
  };

  return {
    services: async () => {
      await mockDelay();
      return services.map((s) => ({ ...s, packages: [...s.packages] }));
    },
    form: async (serviceId) => {
      await mockDelay();
      const { definition } = serviceOf(serviceId);
      return { formId: null, version: definition.version, definition };
    },
    startDraft: async (body) => {
      const input = parseInput(StartDraftRequest, body);
      await mockDelay();
      const { service, definition } = serviceOf(input.serviceId);
      if (input.step !== definition.steps[0]?.key) {
        const issue = {
          step: input.step,
          path: [],
          label: '',
          message: 'Start with the first step',
        };
        throw fail(400, 'VALIDATION_FAILED', [issue]);
      }
      draft = {
        leadId: crypto.randomUUID(),
        service,
        definition,
        taxYear: beginOnlineTaxYear(definition, today()),
        answers: checked(definition, input.step, input.answers, {}),
        savedSteps: [input.step],
        expiresAt: Date.now() + 30 * DAY,
        uploads: [],
      };
      return view(draft);
    },
    current: async () => {
      await mockDelay();
      return view(live());
    },
    saveStep: async (stepKey, body) => {
      const step = parseInput(IntakeKey, stepKey);
      const input = parseInput(SaveDraftStepRequest, body);
      await mockDelay();
      const d = live();
      const answers = checked(d.definition, step, input.answers, d.answers);
      const own = d.definition.steps.find((s) => s.key === step);
      const keys = new Set(own ? intakeStepFields(own).map((f) => f.key) : []);
      d.answers = {
        ...Object.fromEntries(Object.entries(d.answers).filter(([k]) => !keys.has(k))),
        ...answers,
      };
      if (!d.savedSteps.includes(step)) d.savedSteps.push(step);
      d.expiresAt = Date.now() + 30 * DAY;
      return view(d);
    },
    // The mock sends no email: the link is "sent" and the draft renewed.
    sendResumeLink: async () => {
      await mockDelay();
      const d = live();
      d.expiresAt = Date.now() + 30 * DAY;
      return { draftExpiresAt: new Date(d.expiresAt).toISOString() };
    },
    // Any well-formed token reopens this firm's draft (the API checks the token's hash).
    resume: async (body) => {
      parseInput(ResumeDraftRequest, body);
      await mockDelay();
      if (!draft || draft.expiresAt <= Date.now()) throw fail(410, 'RESUME_LINK_EXPIRED');
      return view(draft);
    },
    // A mock ticket URL starts with `mock:`, so `uploadFile()` skips the PUT.
    createUpload: async (body) => {
      const input = parseInput(CreateDraftUploadRequest, body);
      await mockDelay();
      const d = live();
      const field = intakeFields(d.definition).find((f) => f.key === input.slot);
      if (field?.type !== 'upload') {
        const issue = {
          step: '',
          path: ['slot'],
          label: 'slot',
          message: 'Not an upload of this form',
        };
        throw fail(400, 'VALIDATION_FAILED', [issue]);
      }
      const inSlot = d.uploads.filter((u) => u.slot === input.slot).length;
      if (inSlot >= field.maxFiles || d.uploads.length >= INTAKE_LIMITS.maxFiles) {
        throw fail(409, 'TOO_MANY_FILES');
      }
      const uploadToken = JSON.stringify(input);
      const expiresAt = new Date(Date.now() + 4 * 60_000).toISOString();
      return {
        uploadToken,
        url: `mock:${crypto.randomUUID()}`,
        method: 'PUT',
        headers: {},
        expiresAt,
      };
    },
    confirmUpload: async (body) => {
      const { uploadToken } = parseInput(ConfirmUploadRequest, body);
      await mockDelay();
      const d = live();
      let claim: unknown = null;
      try {
        claim = JSON.parse(uploadToken);
      } catch {
        // not a mock ticket
      }
      const parsed = CreateDraftUploadRequest.safeParse(claim);
      if (!parsed.success) throw fail(410, 'UPLOAD_EXPIRED');
      const { slot, fileName, contentType, sizeBytes } = parsed.data;
      const upload: DraftUpload = {
        id: crypto.randomUUID(),
        slot,
        fileName,
        contentType,
        sizeBytes,
        scanStatus: 'CLEAN',
        createdAt: new Date().toISOString(),
      };
      d.uploads.push(upload);
      return { ...upload };
    },
    deleteUpload: async (id) => {
      await mockDelay();
      const d = live();
      const before = d.uploads.length;
      d.uploads = d.uploads.filter((u) => u.id !== id);
      if (d.uploads.length === before) throw fail(404, 'NOT_FOUND');
      return { ok: true as const };
    },
  };
}

let byFirm: Map<string, BeginOnlineClient> | undefined;

/** One mock per firm slug, kept while the page lives (like the draft cookie per firm). */
export function beginOnlineMock(firmSlug: string): BeginOnlineClient {
  byFirm ??= new Map();
  const key = firmSlug.toLowerCase();
  const found = byFirm.get(key) ?? createBeginOnlineMock();
  byFirm.set(key, found);
  return found;
}
