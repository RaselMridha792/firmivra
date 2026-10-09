import {
  ApiRequestError,
  BEGIN_ONLINE_ERRORS,
  BEGIN_ONLINE_FORM_ORDER,
  BEGIN_ONLINE_LIMITS,
  type BeginContact,
  type BeginDraft,
  type BeginOnlineClient,
  beginOnlinePrefill,
  ConfirmUploadRequest,
  CreateIntakeUploadRequest,
  EmailResumeLinkRequest,
  FirmSlug,
  INTAKE_FORMS,
  type IntakeAnswers,
  IntakeFormKey,
  IntakeKey,
  IntakeUploadId,
  maskIntakeAnswers,
  parseInput,
  ResumeBeginDraftRequest,
  SaveIntakeStepRequest,
  StartBeginDraftRequest,
  SubmitIntakeRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import {
  answersOrFail,
  checkFixture,
  createMockSlotUploads,
  fileView,
  keptFiles,
  mockForm,
  type MockSlotFile,
  slotCounts,
  storeStep,
  submitTrigger,
} from './intake';
import { mockBusiness } from './me';

/**
 * Mock data for `api.beginOnline(slug)` (R11): Begin Online on the `lvp` portal, without an
 * account (any other firm is 404). Synthetic data only. Same input checks, answer checks
 * (`checkIntakeAnswers`, `restoreMaskedNumbers`) and error codes as the API; the "browser's
 * draft" (the API's signed HttpOnly cookie) is kept in memory, so a page reload starts over. Only
 * the forms in INTAKE_FORMS are offered (another answers 404). No form carries an agreement: the
 * review step shows the firm's agreements from R14's `api.publicAgreements(slug)`. Nothing is
 * built until the first call, and the fixture draft's answers are checked against its form then.
 * To see each state on a screen:
 *   - Resume links: open `/lvp/begin/resume#token=` + one of MOCK_RESUME_TOKENS: `saved` (a
 *     half-filled Annual Tax for Avery Example: step 1 saved, one file), `expired` (410
 *     DRAFT_EXPIRED; any unknown token answers the same) or `submitted` (409 DRAFT_SUBMITTED).
 *   - "Save and Continue Later" sends nothing in mock mode and renews nothing; it always answers
 *     `{ received: true }`, and the fourth request within a minute answers 429 RATE_LIMITED (the
 *     API's per-IP limit; its silent per-address limit answers the same `{ received: true }`).
 *   - Starting with an email that contains "ratelimit" answers 429 RATE_LIMITED.
 *   - A start, a save or an upload renews the draft to 30 days, never past 90 days after the
 *     start. An expired draft is never renewed: it loses its answers and files and only becomes
 *     expired (410 DRAFT_EXPIRED).
 *   - Uploads: a new file is CHECKING (scan PENDING) for 4 s, then READY (CLEAN); a name with
 *     "virus" ends BLOCKED (INFECTED), one with "unreadable" BLOCKED (FAILED); an .xlsx or .docx
 *     named "password" or "macro" is refused as the API would. Only CLEAN and PENDING files
 *     answer a required slot; every file counts toward the slot's `maxFiles` and the draft's
 *     limit, at step 1 and again at step 3 (409 TOO_MANY_FILES). The ticket URL starts with
 *     `mock:`, so `uploadFile()` skips the PUT.
 *   - `forms` lists the services in the page's order (BEGIN_ONLINE_FORM_ORDER); `start` fills
 *     the form's contact fields with `beginOnlinePrefill`, as the API does.
 *   - A save (or a submit's answers) with a new SSN or EIN ending in 0503 (MOCK_KEY_DOWN_LAST4
 *     in ./intake) answers 503 ENCRYPTION_UNAVAILABLE and saves nothing.
 *   - Submit checks the whole form: 400 VALIDATION_FAILED names the first problem. Then, until
 *     R14's signature is in the body, a word in a text answer answers a submit code instead
 *     (MOCK_SUBMIT_TRIGGERS in ./intake; the start's email fills the form's email, so starting
 *     as e.g. `termsoutdated@lvp.test` works too): "termsoutdated" 409 TERMS_OUTDATED,
 *     "noagreement" 409 NO_INTAKE_AGREEMENT, "agreementoutdated" 409 AGREEMENT_OUTDATED,
 *     "acknowledgmentrequired" 400 ACKNOWLEDGMENT_REQUIRED, "signaturemismatch" 400
 *     SIGNATURE_MISMATCH, "pdfrequired" 400 PDF_REQUIRED. A submit deletes the files whose slot
 *     is not a shown upload field, keeps only the answers of shown fields, then locks the draft:
 *     it answers 409 DRAFT_SUBMITTED, and `start` begins a new one.
 */
export const MOCK_RESUME_TOKENS = {
  saved: 'mockSavedAnnualTaxDraft00000000000000000001',
  expired: 'mockExpiredBookkeepingDraft0000000000000002',
  submitted: 'mockSubmittedPayrollDraft000000000000000003',
} as const;

const DAY = 86_400_000;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const rateLimited = () => fail(429, 'RATE_LIMITED', 'Too many requests');
const now = () => new Date().toISOString();
const inDays = (days: number, from = Date.now()) => new Date(from + days * DAY).toISOString();
/** The tax year the mock firm prepares: the current one, as the mockups show it. */
const taxYear = () => new Date().getFullYear();

/** A draft as the mock stores it (the API's leads row and its answers). */
export interface MockBeginDraft {
  form: IntakeFormKey;
  contact: BeginContact;
  answers: IntakeAnswers;
  files: MockSlotFile[];
  savedSteps: string[];
  taxYear: number;
  startedAt: string;
  expiresAt: string;
  updatedAt: string;
  submitted: boolean;
}

/** The visitor's own activity renews a draft: 30 days from now, never past 90 days from start. */
const renew = (d: MockBeginDraft) => {
  const cap = Date.parse(d.startedAt) + BEGIN_ONLINE_LIMITS.maxDraftDays * DAY;
  d.expiresAt = new Date(
    Math.min(Date.now() + BEGIN_ONLINE_LIMITS.draftDays * DAY, cap),
  ).toISOString();
  d.updatedAt = now();
};

/** The drafts behind the mock's resume links. Built on first use: importing this runs nothing. */
function resumeFixtures(): Map<string, MockBeginDraft> {
  const avery: BeginContact = {
    firstName: 'Avery',
    lastName: 'Example',
    email: 'avery.example@lvp.test',
    phone: '+14045550147',
  };
  const draft = (form: IntakeFormKey, data: Partial<MockBeginDraft>): MockBeginDraft => ({
    form,
    contact: avery,
    answers: { firstName: avery.firstName, lastName: avery.lastName, email: avery.email },
    files: [],
    savedSteps: [],
    taxYear: taxYear(),
    startedAt: inDays(-5),
    expiresAt: inDays(25),
    updatedAt: inDays(-5),
    submitted: false,
    ...data,
  });
  const saved = draft('ANNUAL_TAX', {
    answers: {
      firstName: 'Avery',
      lastName: 'Example',
      dateOfBirth: '1988-02-14',
      phone: '+14045550147',
      email: 'avery.example@lvp.test',
      ssn: { last4: '0147' },
      street: '200 Sample Street',
      city: 'Decatur',
      state: 'GA',
      zip: '30030',
      filingStatus: 'MARRIED_FILING_JOINTLY',
      spouseFirstName: 'Jordan',
      spouseLastName: 'Example',
      spouseSsn: { last4: '0148' },
      spouseDateOfBirth: '1989-07-30',
      claimedAsDependent: false,
      returnTypes: ['PERSONAL'],
      legalStatus: 'US_CITIZEN',
      armedForces: false,
      hasDependents: true,
      dependents: [
        {
          id: 'dependent-1',
          firstName: 'Riley',
          lastName: 'Example',
          dateOfBirth: '2016-05-03',
          relationship: 'DAUGHTER',
          ssn: { last4: '0149' },
          livesWithYou: true,
          childTaxCredit: true,
        },
      ],
      incomeWages: true,
    },
    files: [
      {
        upload: {
          id: '0199b6a9-0000-7000-8000-000000000051',
          slot: 'governmentId',
          fileName: 'Drivers_License.pdf',
          contentType: 'application/pdf',
          sizeBytes: 182_400,
          uploadedAt: inDays(-5),
        },
        scan: 'CLEAN',
        readyAt: 0,
      },
    ],
    savedSteps: ['personal'],
  });
  checkFixture('resume draft "saved"', mockForm(saved.form), saved.answers, null);
  return new Map([
    [MOCK_RESUME_TOKENS.saved, saved],
    // These two answer before their form is needed.
    [MOCK_RESUME_TOKENS.expired, draft('BOOKKEEPING', { expiresAt: inDays(-1) })],
    [MOCK_RESUME_TOKENS.submitted, draft('PAYROLL', { submitted: true })],
  ]);
}

let mocks: Map<string, BeginOnlineClient> | undefined;

/**
 * `api.beginOnline(slug)` in mock mode: one mock per firm, so a draft (and an upload's three
 * steps) reach the same mock however often the page calls `api.beginOnline(slug)`.
 */
export function beginOnlineMock(firmSlug: string): BeginOnlineClient {
  mocks ??= new Map();
  const slug = firmSlug.trim().toLowerCase();
  let mock = mocks.get(slug);
  if (!mock) {
    mock = createBeginOnlineMock(firmSlug);
    mocks.set(slug, mock);
  }
  return mock;
}

/**
 * An in-memory `api.beginOnline(slug)`: only `lvp` (the mock firm) offers Begin Online. `drafts`
 * holds this browser's draft per service (the API's draft cookie); a test passes its own map to
 * read what a submit stored, which no route shows once the draft is submitted.
 */
export function createBeginOnlineMock(
  firmSlug: string,
  drafts = new Map<IntakeFormKey, MockBeginDraft>(),
): BeginOnlineClient {
  const current = drafts;
  let tokens: Map<string, MockBeginDraft> | undefined;
  const byToken = () => (tokens ??= resumeFixtures());
  const uploads = createMockSlotUploads();
  let linkRequests: number[] = [];

  /** The firm, checked first like the API's route: a bad slug is 400, another firm 404. */
  const firm = () => {
    if (parseInput(FirmSlug, firmSlug) !== mockBusiness.slug) throw notFound();
  };
  const usable = (d: MockBeginDraft) => {
    if (d.submitted) throw fail(409, 'DRAFT_SUBMITTED', BEGIN_ONLINE_ERRORS.DRAFT_SUBMITTED);
    if (Date.parse(d.expiresAt) <= Date.now()) {
      // As the API: the answers and files go, and the lead only becomes EXPIRED.
      d.answers = {};
      d.files = [];
      throw fail(410, 'DRAFT_EXPIRED', BEGIN_ONLINE_ERRORS.DRAFT_EXPIRED);
    }
    return d;
  };
  /** This browser's draft for the service: 404 when there is none. */
  const mine = (form: IntakeFormKey) => {
    const d = current.get(form);
    if (!d) throw notFound();
    return usable(d);
  };
  const view = (d: MockBeginDraft): BeginDraft => {
    const definition = mockForm(d.form);
    return structuredClone({
      form: d.form,
      version: definition.version,
      title: definition.title,
      definition,
      taxYear: d.taxYear,
      contact: d.contact,
      answers: maskIntakeAnswers(definition, d.answers),
      uploads: d.files.map(fileView),
      savedSteps: definition.steps.map((s) => s.key).filter((k) => d.savedSteps.includes(k)),
      expiresAt: d.expiresAt,
      updatedAt: d.updatedAt,
    });
  };
  const saveStep = (d: MockBeginDraft, step: string, answers: Record<string, unknown>) => {
    const definition = mockForm(d.form);
    const clean = answersOrFail(definition, answers, { mode: 'save', step });
    d.answers = storeStep(definition, step, clean, d.answers);
    if (!d.savedSteps.includes(step)) d.savedSteps.push(step);
    renew(d);
  };

  return {
    forms: async () => {
      await mockDelay();
      firm();
      return BEGIN_ONLINE_FORM_ORDER.flatMap((form) => {
        const definition = INTAKE_FORMS[form];
        return definition ? [{ form, title: definition.title, version: definition.version }] : [];
      });
    },
    form: async (form) => {
      await mockDelay();
      const key = parseInput(IntakeFormKey, form);
      firm();
      const definition = mockForm(key);
      return structuredClone({
        form: key,
        version: definition.version,
        title: definition.title,
        definition,
        taxYear: taxYear(),
      });
    },
    start: async (form, body) => {
      await mockDelay();
      const key = parseInput(IntakeFormKey, form);
      const contact = parseInput(StartBeginDraftRequest, body);
      firm();
      const definition = mockForm(key);
      if (contact.email.includes('ratelimit')) throw rateLimited();
      const d: MockBeginDraft = {
        form: key,
        contact: { ...contact, phone: contact.phone ?? null },
        // The form's own contact fields start filled in, as the API does.
        answers: beginOnlinePrefill(definition, contact),
        files: [],
        savedSteps: [],
        taxYear: taxYear(),
        startedAt: now(),
        expiresAt: now(),
        updatedAt: now(),
        submitted: false,
      };
      renew(d);
      current.set(key, d);
      return view(d);
    },
    get: async (form) => {
      await mockDelay();
      const key = parseInput(IntakeFormKey, form);
      firm();
      return view(mine(key));
    },
    saveStep: async (form, step, body) => {
      await mockDelay();
      const key = parseInput(IntakeFormKey, form);
      const stepKey = parseInput(IntakeKey, step);
      const { answers } = parseInput(SaveIntakeStepRequest, body);
      firm();
      const d = mine(key);
      saveStep(d, stepKey, answers);
      return { step: stepKey, savedAt: d.updatedAt };
    },
    emailResumeLink: async (body) => {
      await mockDelay();
      parseInput(EmailResumeLinkRequest, body);
      firm();
      // Per IP address (this browser): the fourth within a minute is 429. Nothing is renewed.
      const minuteAgo = Date.now() - 60_000;
      linkRequests = linkRequests.filter((t) => t > minuteAgo);
      if (linkRequests.length >= 3) throw rateLimited();
      linkRequests.push(Date.now());
      return { received: true };
    },
    resume: async (body) => {
      await mockDelay();
      const { token } = parseInput(ResumeBeginDraftRequest, body);
      firm();
      const d = byToken().get(token);
      if (!d) throw fail(410, 'DRAFT_EXPIRED', BEGIN_ONLINE_ERRORS.DRAFT_EXPIRED);
      usable(d);
      current.set(d.form, d);
      return view(d);
    },
    uploads: async (form) => {
      await mockDelay();
      const key = parseInput(IntakeFormKey, form);
      firm();
      return mine(key).files.map(fileView);
    },
    createUpload: async (form, body) => {
      await mockDelay();
      const key = parseInput(IntakeFormKey, form);
      const b = parseInput(CreateIntakeUploadRequest, body);
      firm();
      const d = mine(key);
      return uploads.ticket(key, mockForm(key), d.files, b);
    },
    confirmUpload: async (form, body) => {
      await mockDelay();
      const key = parseInput(IntakeFormKey, form);
      const { uploadToken } = parseInput(ConfirmUploadRequest, body);
      firm();
      const d = mine(key);
      const file = uploads.confirm(key, uploadToken, mockForm(key), d);
      renew(d);
      return fileView(file);
    },
    removeUpload: async (form, id) => {
      await mockDelay();
      const key = parseInput(IntakeFormKey, form);
      const fileId = parseInput(IntakeUploadId, id);
      firm();
      const d = mine(key);
      if (!d.files.some((f) => f.upload.id === fileId)) throw notFound();
      d.files = d.files.filter((f) => f.upload.id !== fileId);
      renew(d);
      return { ok: true };
    },
    submit: async (form, body) => {
      await mockDelay();
      const key = parseInput(IntakeFormKey, form);
      const { answers } = parseInput(SubmitIntakeRequest, body);
      firm();
      const d = mine(key);
      const definition = mockForm(key);
      if (answers) saveStep(d, definition.steps.at(-1)!.key, answers);
      const kept = keptFiles(definition, d.answers, d.files);
      const clean = answersOrFail(definition, d.answers, {
        mode: 'submit',
        uploads: slotCounts(kept),
      });
      const triggered = submitTrigger(clean, BEGIN_ONLINE_ERRORS);
      if (triggered) throw triggered;
      // As the API, in one transaction: the files of hidden slots are deleted and the answers of
      // hidden fields dropped, then the lead leaves DRAFT.
      d.files = kept;
      d.answers = clean;
      d.submitted = true;
      d.updatedAt = now();
      return { received: true, form: key, submittedAt: d.updatedAt };
    },
  };
}
