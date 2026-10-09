import {
  ApiRequestError,
  checkIntakeAnswers,
  type ClientPortalRole,
  ConfirmUploadRequest,
  CreateIntakeUploadRequest,
  DOCUMENT_ERRORS,
  FirmSlug,
  hiddenSlotUploads,
  INTAKE_AGREEMENT_ERRORS,
  INTAKE_EDITABLE_STATUSES,
  INTAKE_ERRORS,
  INTAKE_FORMS,
  INTAKE_LIMITS,
  INTAKE_UPLOAD_STATUS,
  type IntakeAgreementErrorCode,
  type IntakeAnswers,
  type IntakeFormDefinition,
  type IntakeFormKey,
  IntakeId,
  IntakeKey,
  intakeStepFields,
  type IntakeUpload,
  intakeUploadCounts,
  IntakeUploadId,
  maskIntakeAnswers,
  type MyIntake,
  MyIntakeListItem,
  type MyIntakesClient,
  parseInput,
  restoreMaskedNumbers,
  SaveIntakeStepRequest,
  type ScanStatus,
  SubmitIntakeRequest,
  type UploadTicket,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { engagementFixtures } from './engagements';
import { mockBusiness } from './me';

/**
 * Mock data for `api.myIntakes(slug)` (R11): the signed-in portal client's Intake Forms tab
 * (client 1, Jamie Sample) at the `lvp` firm (another firm is 404). Synthetic data only. Same input
 * checks, in the same order (400, then 403/404, then 409/410), the same answer checks
 * (`checkIntakeAnswers`, `restoreMaskedNumbers`) and error codes as the API. SSNs and EINs are
 * kept and returned as `{ last4 }` only (`maskIntakeAnswers`). Nothing is built until the first
 * call, and every fixture's answers are checked against its form then (a broken one throws).
 * Only intakes whose form is in INTAKE_FORMS are listed:
 *   1. 2025 Annual Tax: IN_PROGRESS, step 1 saved, one file in "Your Government ID".
 *   2. Bookkeeping: NEEDS_CORRECTION with the firm's note; complete, so it can be sent again.
 *   3. 2024 Annual Tax: COMPLETED (read only; a save answers 409 INTAKE_LOCKED).
 *   4. Payroll: EXPIRED (410 INTAKE_EXPIRED).
 *   5. Q3 2026 Quarterly Taxes: SENT, nothing filled in yet.
 *   6. 2026 Tax Planning: UNDER_REVIEW.
 * Intakes 5 and 6 are for services the My Services mock doesn't list.
 * `createMyIntakesMock({ portalRole: 'SPOUSE' })` is a spouse's login: it reads everything, and
 * every change answers 403 FORBIDDEN. No form carries an agreement: the review step shows the
 * firm's agreements from R14's `api.publicAgreements(slug)`.
 * Uploads need no storage (the ticket URL starts with `mock:`; `uploadFile()` skips the PUT). A
 * new file is CHECKING (scan PENDING) for 4 s, then READY (CLEAN). A name with "virus" ends
 * BLOCKED (INFECTED), one with "unreadable" BLOCKED (FAILED); an .xlsx or .docx named "password"
 * or "macro" is refused as the API would. Only CLEAN and PENDING files answer a required slot
 * (`intakeUploadCounts` on the scan status); every file counts toward a slot's `maxFiles` and the
 * form's limit, a blocked one too. A submit takes the files whose slot is not a shown upload field
 * out of the intake (`hiddenSlotUploads`), before the status changes.
 * Submit errors (MOCK_SUBMIT_TRIGGERS), until R14's signature is in the submit body: a complete
 * form with one of these words in a text answer (a comments box, say) answers that code instead:
 *   "noagreement" 409 NO_INTAKE_AGREEMENT, "agreementoutdated" 409 AGREEMENT_OUTDATED (the API's
 *   `details` carry the current agreements; ApiRequestError keeps no details yet),
 *   "acknowledgmentrequired" 400 ACKNOWLEDGMENT_REQUIRED, "signaturemismatch" 400
 *   SIGNATURE_MISMATCH, "pdfrequired" 400 PDF_REQUIRED. 400 VALIDATION_FAILED names the first
 *   problem of an incomplete form.
 */
const at = (date: string) => `${date}T15:00:00.000Z`;
const intakeId = (n: number) => `0199b6a8-0000-7000-8000-${String(n).padStart(12, '0')}`;
const uploadId = (n: number) => `0199b6a9-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SCAN_MS = 4000;
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const notFound = () => fail(404, 'NOT_FOUND', 'Not found');
const forbidden = () => fail(403, 'FORBIDDEN', 'This action is not permitted');
const now = () => new Date().toISOString();

// ---------- Shared by the intake and Begin Online mocks ----------
/** A form the mock firm offers: 404 for one INTAKE_FORMS doesn't have. */
export function mockForm(form: IntakeFormKey): IntakeFormDefinition {
  const definition = INTAKE_FORMS[form];
  if (!definition) throw notFound();
  return definition;
}

/** 400 VALIDATION_FAILED with the first problem, as `parseInput` reports one. */
export function answersOrFail(
  definition: IntakeFormDefinition,
  answers: Readonly<Record<string, unknown>>,
  options: Parameters<typeof checkIntakeAnswers>[2],
): IntakeAnswers {
  const { answers: clean, issues } = checkIntakeAnswers(definition, answers, options);
  const first = issues[0];
  if (first) throw fail(400, 'VALIDATION_FAILED', `${first.label}: ${first.message}`);
  return clean;
}

/**
 * A step's checked answers merged into what is stored, as the API does: `{ last4 }` keeps the
 * stored number only when it matches it (by key, and by row id in a group), otherwise 400. The
 * mock keeps every number as `{ last4 }` (the API keeps it encrypted).
 */
export function storeStep(
  definition: IntakeFormDefinition,
  stepKey: string,
  clean: IntakeAnswers,
  stored: IntakeAnswers,
): IntakeAnswers {
  const { answers, issues } = restoreMaskedNumbers(definition, clean, stored);
  const first = issues[0];
  if (first) throw fail(400, 'VALIDATION_FAILED', `${first.label}: ${first.message}`);
  const step = definition.steps.find((s) => s.key === stepKey);
  const next: Record<string, unknown> = { ...stored };
  for (const f of step ? intakeStepFields(step) : []) {
    if (answers[f.key] === undefined) delete next[f.key];
    else next[f.key] = answers[f.key];
  }
  return maskIntakeAnswers(definition, next);
}

/**
 * A fixture's answers checked against its form on first use: each step's as a save checks them,
 * and the whole form as a submit does when it was submitted. A broken fixture throws at once.
 */
export function checkFixture(
  name: string,
  definition: IntakeFormDefinition,
  answers: IntakeAnswers,
  submitted: { uploads: Record<string, number> } | null,
) {
  const issues = definition.steps.flatMap((step) => {
    const keys = new Set(intakeStepFields(step).map((f) => f.key));
    const part = Object.fromEntries(Object.entries(answers).filter(([k]) => keys.has(k)));
    return checkIntakeAnswers(definition, part, { mode: 'save', step: step.key }).issues;
  });
  if (submitted) {
    issues.push(
      ...checkIntakeAnswers(definition, answers, { mode: 'submit', ...submitted }).issues,
    );
  }
  const first = issues[0];
  if (first) throw new Error(`Mock fixture ${name}: ${first.path.join('.')} ${first.message}`);
}

/**
 * The words that make a complete form's submit answer a code instead (see the comment at the
 * top). TERMS_OUTDATED is Begin Online's only (its review step accepts the firm's Terms and
 * Privacy); the portal mock skips it.
 */
export const MOCK_SUBMIT_TRIGGERS = {
  noagreement: [409, 'NO_INTAKE_AGREEMENT'],
  agreementoutdated: [409, 'AGREEMENT_OUTDATED'],
  acknowledgmentrequired: [400, 'ACKNOWLEDGMENT_REQUIRED'],
  signaturemismatch: [400, 'SIGNATURE_MISMATCH'],
  pdfrequired: [400, 'PDF_REQUIRED'],
  termsoutdated: [409, 'TERMS_OUTDATED'],
} as const satisfies Record<string, readonly [number, IntakeAgreementErrorCode | 'TERMS_OUTDATED']>;

/** The submit error a trigger word in a text answer asks for, if any (checked before the submit). */
export function submitTrigger(
  answers: IntakeAnswers,
  messages: Readonly<Record<string, string>>,
): ApiRequestError | null {
  const texts = Object.values(answers)
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.toLowerCase());
  for (const [word, [status, code]] of Object.entries(MOCK_SUBMIT_TRIGGERS)) {
    const message = messages[code];
    if (message && texts.some((t) => t.includes(word))) return fail(status, code, message);
  }
  return null;
}

/**
 * A stored file: `scan` is what its malware scan ends with, `readyAt` when it ends (until then
 * the scan status is PENDING).
 */
export interface MockSlotFile {
  upload: Omit<IntakeUpload, 'status'>;
  scan: ScanStatus;
  readyAt: number;
}

/** The file's scan status now (the database's ScanStatus). */
const scanNow = (f: MockSlotFile): ScanStatus => (Date.now() < f.readyAt ? 'PENDING' : f.scan);

/** The file as the person sees it: CHECKING, READY or BLOCKED (never INFECTED). */
export const fileView = (f: MockSlotFile): IntakeUpload => ({
  ...f.upload,
  status: INTAKE_UPLOAD_STATUS[scanNow(f)],
});

/** How many files answer each slot on submit: CLEAN and PENDING only (`intakeUploadCounts`). */
export const slotCounts = (files: readonly MockSlotFile[]) =>
  intakeUploadCounts(files.map((f) => ({ slot: f.upload.slot, status: scanNow(f) })));

/** The files a submit keeps: those in shown upload fields (`hiddenSlotUploads` takes the rest). */
export const keptFiles = (
  definition: IntakeFormDefinition,
  answers: IntakeAnswers,
  files: MockSlotFile[],
) => {
  const hidden = new Set(
    hiddenSlotUploads(
      definition,
      answers,
      files.map((f) => f.upload),
    ).map((u) => u.id),
  );
  return files.filter((f) => !hidden.has(f.upload.id));
};

/**
 * Upload tickets for slot files: step 1 checks the slot and the limits (the slot's `maxFiles`
 * and INTAKE_LIMITS.maxFiles, every file counted, blocked ones too); step 3 refuses what the API
 * would refuse (by the file's name only) and stores the file.
 */
export function createMockSlotUploads() {
  const pending = new Map<string, CreateIntakeUploadRequest & { owner: string }>();
  let next = 100;
  return {
    ticket(
      owner: string,
      definition: IntakeFormDefinition,
      files: readonly MockSlotFile[],
      body: ReturnType<typeof CreateIntakeUploadRequest.parse>,
    ): UploadTicket {
      const slot = definition.steps
        .flatMap(intakeStepFields)
        .find((f) => f.key === body.slot && f.type === 'upload');
      if (slot?.type !== 'upload') {
        throw fail(400, 'VALIDATION_FAILED', 'This is not an upload slot of the form');
      }
      const inSlot = files.filter((f) => f.upload.slot === body.slot).length;
      if (inSlot >= slot.maxFiles || files.length >= INTAKE_LIMITS.maxFiles) {
        throw fail(409, 'TOO_MANY_FILES', INTAKE_ERRORS.TOO_MANY_FILES);
      }
      const token = `mock-slot-upload-${String(next++)}`;
      pending.set(token, { ...body, owner });
      return {
        uploadToken: token,
        url: `mock:upload/${token}`,
        method: 'PUT',
        headers: { 'content-type': body.contentType },
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    },
    confirm(owner: string, uploadToken: string): MockSlotFile {
      const p = pending.get(uploadToken);
      if (!p || p.owner !== owner) {
        throw fail(410, 'UPLOAD_EXPIRED', DOCUMENT_ERRORS.UPLOAD_EXPIRED);
      }
      pending.delete(uploadToken);
      const name = p.fileName.toLowerCase();
      if (p.contentType === XLSX || p.contentType === DOCX) {
        if (name.includes('password')) {
          throw fail(409, 'FILE_PASSWORD_PROTECTED', DOCUMENT_ERRORS.FILE_PASSWORD_PROTECTED);
        }
        if (name.includes('macro')) {
          throw fail(409, 'FILE_HAS_MACROS', DOCUMENT_ERRORS.FILE_HAS_MACROS);
        }
      }
      return {
        upload: {
          id: uploadId(next++),
          slot: p.slot,
          fileName: p.fileName,
          contentType: p.contentType,
          sizeBytes: p.sizeBytes,
          uploadedAt: now(),
        },
        scan: name.includes('virus')
          ? 'INFECTED'
          : name.includes('unreadable')
            ? 'FAILED'
            : 'CLEAN',
        readyAt: Date.now() + SCAN_MS,
      };
    },
  };
}

// ---------- Fixtures ----------
interface Row {
  item: MyIntakeListItem;
  answers: IntakeAnswers;
  files: MockSlotFile[];
  savedSteps: string[];
  signature: MyIntake['signature'];
  taxYear: number;
}

const cleanFile = (n: number, slot: string, fileName: string, date: string): MockSlotFile => ({
  upload: {
    id: uploadId(n),
    slot,
    fileName,
    contentType: 'application/pdf',
    sizeBytes: 154_000 + n * 1000,
    uploadedAt: at(date),
  },
  scan: 'CLEAN',
  readyAt: 0,
});

/** The statuses whose answers were submitted (and so are complete). */
const SUBMITTED_STATUSES: readonly string[] = [
  'SUBMITTED',
  'NEEDS_CORRECTION',
  'UNDER_REVIEW',
  'COMPLETED',
];

let fixtures: readonly Row[] | undefined;

/**
 * The intakes of client 1 whose form INTAKE_FORMS has, each checked against its form. Built on
 * first use: importing this file runs nothing.
 */
export function intakeFixtures(): readonly Row[] {
  if (fixtures) return fixtures;
  const engagements = engagementFixtures();
  const service = (n: number) => ({ id: engagements[n - 1]!.id, title: engagements[n - 1]!.title });
  const item = (n: number, form: IntakeFormKey, data: Partial<MyIntakeListItem>) => {
    // Parsed, so a fixture that breaks the contract fails on first use.
    const parsed = MyIntakeListItem.parse({
      id: intakeId(n),
      form,
      title: INTAKE_FORMS[form]?.title ?? form,
      service: service(1),
      status: 'IN_PROGRESS',
      dueOn: null,
      version: 1,
      submittedAt: null,
      correction: null,
      updatedAt: at('2026-10-01'),
      ...data,
    });
    // As the database: the firm's note is set exactly while NEEDS_CORRECTION.
    if ((parsed.correction !== null) !== (parsed.status === 'NEEDS_CORRECTION')) {
      throw new Error(
        `Mock fixture intake ${String(n)}: a correction note only while NEEDS_CORRECTION`,
      );
    }
    return parsed;
  };
  const jamie = {
    firstName: 'Jamie',
    lastName: 'Sample',
    dateOfBirth: '1985-04-12',
    phone: '+14045550123',
    email: 'jamie.sample@lvp.test',
    ssn: { last4: '0001' },
    street: '123 Main Street',
    city: 'Atlanta',
    state: 'GA',
    zip: '30301',
    filingStatus: 'SINGLE',
    claimedAsDependent: false,
    returnTypes: ['PERSONAL'],
    legalStatus: 'US_CITIZEN',
    armedForces: false,
    hasDependents: false,
  };
  const all: Row[] = [
    {
      item: item(1, 'ANNUAL_TAX', { dueOn: '2026-10-31', updatedAt: at('2026-10-05') }),
      answers: { ...jamie, incomeWages: true, incomeInterest: true, mortgageInterest: false },
      files: [cleanFile(1, 'governmentId', 'Drivers_License.pdf', '2026-10-05')],
      savedSteps: ['personal'],
      signature: null,
      taxYear: 2025,
    },
    {
      item: item(2, 'BOOKKEEPING', {
        service: service(2),
        status: 'NEEDS_CORRECTION',
        version: 2,
        submittedAt: at('2026-09-20'),
        correction: {
          note: "Please add your second checking account (Example Credit Union) and upload last year's business tax return.",
          requestedAt: at('2026-09-25'),
        },
        updatedAt: at('2026-09-25'),
      }),
      answers: {
        firstName: 'Jamie',
        lastName: 'Sample',
        title: 'Owner',
        email: 'jamie.sample@lvp.test',
        phone: '+14045550123',
        preferredContact: 'EMAIL',
        businessName: 'Sample Home Bakery LLC',
        ein: { last4: '0002' },
        street: '45 Example Avenue',
        city: 'Decatur',
        state: 'GA',
        zip: '30030',
        industry: 'Food service',
        entityType: 'LLC',
        yearsInBusiness: 3,
        package: 'GROWTH',
        primaryBanks: 'Example Community Bank',
        hasBookkeeper: false,
        currentSituation: 'I handle it myself and I am two months behind.',
        reportFrequency: 'Monthly',
        goodsOrServices: 'Baked goods for cafes and events',
        startDate: '2023-03-01',
        commonExpenses: ['RENT', 'UTILITIES', 'INVENTORY'],
        startMonth: '2026-08',
        needsCatchUp: true,
        catchUpFrom: '2026-01',
        hadBookkeeperBefore: false,
        checkingAccounts: 1,
        creditCards: 1,
        loans: 0,
        merchantAccounts: 1,
        institutions: 'Example Community Bank',
        paymentMethods: 'Card and bank transfer',
        hasReceivables: false,
        invoiceTracking: 'A spreadsheet',
        hasPayables: false,
        billTracking: 'Paid when the bill arrives',
        vendorPayments: 'Bank transfer',
        w2Employees: 2,
        contractors1099: 0,
        hasPayrollProvider: false,
        needsPayrollSetup: true,
        collectsSalesTax: true,
        salesTaxStates: ['GA'],
        salesTaxFrequency: 'Monthly',
        salesTaxCurrent: true,
        salesTaxHelp: false,
        hasInventory: false,
        hasFinancing: false,
        businessFundsPersonal: false,
        personalFundsBusiness: false,
        hasCurrentReports: false,
        reportsDetails: 'No reports since the start of the year.',
        accountingMethod: 'CASH',
        reportingRequirements: 'None beyond the annual tax return.',
        businessGoals: 'Monthly statements and a clean year end.',
        lastYearReturn: { notAvailable: true, reason: 'My previous accountant is sending it.' },
        confirmAccurate: true,
        confirmDocuments: true,
        confirmUnderstand: true,
      },
      files: [
        cleanFile(2, 'formationDocument', 'Articles_of_Organization.pdf', '2026-09-20'),
        cleanFile(3, 'einDocument', 'EIN_Letter.pdf', '2026-09-20'),
      ],
      savedSteps: ['business', 'background', 'documents', 'review'],
      signature: { printedName: 'Jamie Sample', signedAt: at('2026-09-20') },
      taxYear: 2026,
    },
    {
      item: item(3, 'ANNUAL_TAX', {
        service: service(3),
        status: 'COMPLETED',
        submittedAt: at('2025-02-10'),
        updatedAt: at('2025-02-14'),
      }),
      answers: {
        ...jamie,
        incomeWages: true,
        certifyDocuments: true,
        paymentPreference: 'PAY_AFTER',
      },
      files: [
        cleanFile(4, 'governmentId', 'Drivers_License_2025.pdf', '2025-02-10'),
        cleanFile(5, 'socialSecurityCard', 'Social_Security_Card.pdf', '2025-02-10'),
        cleanFile(6, 'incomeDocuments', 'W-2_2024.pdf', '2025-02-10'),
      ],
      savedSteps: ['personal', 'documents', 'review'],
      signature: { printedName: 'Jamie Sample', signedAt: at('2025-02-10') },
      taxYear: 2024,
    },
    {
      item: item(4, 'PAYROLL', {
        service: service(4),
        status: 'EXPIRED',
        dueOn: '2026-08-31',
        updatedAt: at('2026-09-01'),
      }),
      answers: {},
      files: [],
      savedSteps: [],
      signature: null,
      taxYear: 2026,
    },
    {
      item: item(5, 'QUARTERLY_TAX', {
        service: { id: '0199b6a2-0000-7000-8000-000000000005', title: 'Q3 2026 Quarterly Taxes' },
        status: 'SENT',
        dueOn: '2026-10-15',
        updatedAt: at('2026-10-02'),
      }),
      answers: {},
      files: [],
      savedSteps: [],
      signature: null,
      taxYear: 2026,
    },
    {
      item: item(6, 'TAX_PLANNING', {
        service: { id: '0199b6a2-0000-7000-8000-000000000006', title: '2026 Tax Planning' },
        status: 'UNDER_REVIEW',
        submittedAt: at('2026-09-28'),
        updatedAt: at('2026-09-29'),
      }),
      answers: {
        fullName: 'Jamie Sample',
        phone: '+14045550123',
        email: 'jamie.sample@lvp.test',
        planningFor: 'INDIVIDUAL',
        accountingMethod: 'CASH',
        planningTaxYear: 2026,
        hasBookkeeper: 'NO',
        services: ['INDIVIDUAL', 'RETIREMENT'],
        reasons: ['REDUCE_LIABILITY'],
        w2Income: 8_500_000,
        multipleStates: false,
        filedRecentReturn: 'YES',
        recentReturnYear: 2025,
        taxIssues: false,
        taxProfessional: 'NO',
        goals: ['RETIREMENT'],
      },
      files: [],
      savedSteps: ['profile', 'finances', 'goals', 'review'],
      signature: { printedName: 'Jamie Sample', signedAt: at('2026-09-28') },
      taxYear: 2026,
    },
  ];
  fixtures = all.filter((row) => {
    const definition = INTAKE_FORMS[row.item.form];
    if (!definition) return false;
    const submitted = SUBMITTED_STATUSES.includes(row.item.status)
      ? { uploads: slotCounts(row.files) }
      : null;
    checkFixture(`intake ${row.item.id}`, definition, row.answers, submitted);
    return true;
  });
  return fixtures;
}

const editable = (status: string) =>
  (INTAKE_EDITABLE_STATUSES as readonly string[]).includes(status);
/** Open ones first by due date (none last), then the rest, newest first. */
const order = (a: MyIntakeListItem, b: MyIntakeListItem) =>
  Number(editable(b.status)) - Number(editable(a.status)) ||
  (editable(a.status) ? (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') : 0) ||
  b.updatedAt.localeCompare(a.updatedAt);

let myMocks: Map<string, MyIntakesClient> | undefined;

/**
 * `api.myIntakes(slug)` in mock mode: one mock per firm, so an upload's three steps (and what a
 * save stored) reach the same mock however often the page calls `api.myIntakes(slug)`.
 */
export function myIntakesMock(firmSlug: string): MyIntakesClient {
  myMocks ??= new Map();
  const slug = firmSlug.trim().toLowerCase();
  let mock = myMocks.get(slug);
  if (!mock) {
    mock = createMyIntakesMock({}, firmSlug);
    myMocks.set(slug, mock);
  }
  return mock;
}

/**
 * An in-memory `api.myIntakes(slug)` for the signed-in portal client (client 1). The firm is
 * checked first: a slug that isn't one is 400, another firm's 404.
 */
export function createMyIntakesMock(
  options: { portalRole?: ClientPortalRole } = {},
  firmSlug: string = mockBusiness.slug,
): MyIntakesClient {
  const primary = (options.portalRole ?? 'PRIMARY') === 'PRIMARY';
  let rows: Row[] | undefined;
  const all = () => (rows ??= intakeFixtures().map((r) => structuredClone(r)));
  const uploads = createMockSlotUploads();
  const definition = (row: Row) => mockForm(row.item.form);

  const firm = () => {
    if (parseInput(FirmSlug, firmSlug) !== mockBusiness.slug) throw notFound();
  };
  const find = (id: string) => {
    const row = all().find((r) => r.item.id === id);
    if (!row) throw notFound();
    return row;
  };
  /** A change: the primary login, on an intake that is open. */
  const changeable = (row: Row) => {
    if (!primary) throw forbidden();
    if (row.item.status === 'EXPIRED') {
      throw fail(410, 'INTAKE_EXPIRED', INTAKE_ERRORS.INTAKE_EXPIRED);
    }
    if (!editable(row.item.status)) throw fail(409, 'INTAKE_LOCKED', INTAKE_ERRORS.INTAKE_LOCKED);
    return row;
  };
  const touched = (row: Row) => {
    if (row.item.status === 'SENT') row.item.status = 'IN_PROGRESS';
    row.item.updatedAt = now();
  };
  const saveStep = (row: Row, step: string, answers: Record<string, unknown>) => {
    const clean = answersOrFail(definition(row), answers, { mode: 'save', step });
    row.answers = storeStep(definition(row), step, clean, row.answers);
    if (!row.savedSteps.includes(step)) row.savedSteps.push(step);
    touched(row);
  };
  const view = (row: Row): MyIntake =>
    structuredClone({
      ...row.item,
      definition: definition(row),
      taxYear: row.taxYear,
      answers: maskIntakeAnswers(definition(row), row.answers),
      uploads: row.files.map(fileView),
      savedSteps: definition(row)
        .steps.map((s) => s.key)
        .filter((k) => row.savedSteps.includes(k)),
      signature: row.signature,
      canEdit: primary && editable(row.item.status),
      canSubmit: primary && editable(row.item.status),
    });

  return {
    list: async () => {
      await mockDelay();
      firm();
      return all()
        .map((r) => structuredClone(r.item))
        .sort(order);
    },
    get: async (id) => {
      await mockDelay();
      const iid = parseInput(IntakeId, id);
      firm();
      return view(find(iid));
    },
    saveStep: async (id, step, body) => {
      await mockDelay();
      const iid = parseInput(IntakeId, id);
      const key = parseInput(IntakeKey, step);
      const { answers } = parseInput(SaveIntakeStepRequest, body);
      firm();
      const row = changeable(find(iid));
      saveStep(row, key, answers);
      return { step: key, savedAt: row.item.updatedAt };
    },
    submit: async (id, body) => {
      await mockDelay();
      const iid = parseInput(IntakeId, id);
      const { answers } = parseInput(SubmitIntakeRequest, body);
      firm();
      const row = changeable(find(iid));
      const form = definition(row);
      if (answers) saveStep(row, form.steps.at(-1)!.key, answers);
      const kept = keptFiles(form, row.answers, row.files);
      answersOrFail(form, row.answers, { mode: 'submit', uploads: slotCounts(kept) });
      const triggered = submitTrigger(row.answers, INTAKE_AGREEMENT_ERRORS);
      if (triggered) throw triggered;
      // As the API, in one transaction: the files of hidden slots leave the intake (they stay in
      // My Documents) while it is still open, then the status changes and the note is cleared.
      row.files = kept;
      row.item = {
        ...row.item,
        status: 'SUBMITTED',
        submittedAt: now(),
        correction: null,
        updatedAt: now(),
      };
      // The signature joins the body with R14's contract; the mock signs as the client.
      row.signature = { printedName: 'Jamie Sample', signedAt: now() };
      return view(row);
    },
    createUpload: async (id, body) => {
      await mockDelay();
      const iid = parseInput(IntakeId, id);
      const b = parseInput(CreateIntakeUploadRequest, body);
      firm();
      const row = changeable(find(iid));
      const open = engagementFixtures().find((e) => e.id === row.item.service.id);
      if (open && open.status !== 'ACTIVE') {
        throw fail(409, 'NO_OPEN_SERVICE', DOCUMENT_ERRORS.NO_OPEN_SERVICE);
      }
      return uploads.ticket(row.item.id, definition(row), row.files, b);
    },
    confirmUpload: async (id, body) => {
      await mockDelay();
      const iid = parseInput(IntakeId, id);
      const { uploadToken } = parseInput(ConfirmUploadRequest, body);
      firm();
      const row = changeable(find(iid));
      const file = uploads.confirm(row.item.id, uploadToken);
      row.files.push(file);
      touched(row);
      return fileView(file);
    },
    removeUpload: async (id, fileId) => {
      await mockDelay();
      const iid = parseInput(IntakeId, id);
      const fid = parseInput(IntakeUploadId, fileId);
      firm();
      const row = changeable(find(iid));
      if (!row.files.some((f) => f.upload.id === fid)) throw notFound();
      row.files = row.files.filter((f) => f.upload.id !== fid);
      touched(row);
      return { ok: true };
    },
  };
}
