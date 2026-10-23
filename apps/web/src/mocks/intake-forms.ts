import {
  AddFormNoteRequest,
  ApiRequestError,
  type AssignedFormEvent,
  type AssignedFormRecord,
  type AssignedFormRow,
  AssignedFormsQuery,
  beginOnlinePageUrl,
  FORM_CATEGORY_LABELS,
  type FormCategory,
  INTAKE_FILE_SIZE_CHOICES,
  INTAKE_FORMS,
  type IntakeFormDetail,
  type IntakeFormKey,
  type IntakeFormsClient,
  IntakeFormsQuery,
  type IntakeSettings,
  type IntakeStatus,
  type IntakeView,
  type MemberRef,
  parseInput,
  publicEmbedCode,
  RequestIntakeCorrectionRequest,
  ResetIntakeSettingsRequest,
  SaveIntakeFormRequest,
  SaveSendDraftRequest,
  type SendDraft,
  SendIntakeFormRequest,
  UpdateAssignedFormRequest,
  UpdateIntakeSettingsRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockIntakeAnswers } from './intake-forms-answers';

/** The categories with a mock service, and the service kind (one of the built-in forms' six). */
const KIND_OF_CATEGORY: Partial<Record<FormCategory, IntakeFormKey>> = {
  PERSONAL_TAX: 'ANNUAL_TAX',
  BUSINESS_TAX: 'QUARTERLY_TAX',
  BOOKKEEPING: 'BOOKKEEPING',
  PAYROLL: 'PAYROLL',
  TAX_PLANNING: 'TAX_PLANNING',
  ADVISORY: 'BUSINESS_DEVELOPMENT',
};
/** The mock firm offers every service on Begin Online but this one (a HIDDEN link). */
const MOCK_NOT_ON_BEGIN_ONLINE: IntakeFormKey = 'BUSINESS_DEVELOPMENT';
const PORTAL = process.env.NEXT_PUBLIC_PORTAL_BASE_URL ?? 'http://portal.localhost:3000';

/**
 * Mock data for `api.intakeForms` (R43 contract, the Intake Forms workspace). Synthetic people
 * only. One store behind the dashboard, the builder, the library and settings, so a form sent
 * from Send Intake Form shows in the table and its record. Same input checks and codes as the
 * API: sending a form the recipient already has open is 409 FORM_ALREADY_OPEN; saving a published
 * form makes its next draft version (the published one stays live); publishing a form with an empty choice question is 400
 * FORM_INCOMPLETE; PORTAL to a lead is 409 PORTAL_UNAVAILABLE; only a service's main form (its
 * first template here) has a public link, its Begin Online page. Staff see only their own forms
 * and cannot change settings. `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=intakeForms) starts with
 * no sent forms and only the starter templates.
 */

type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

const HOUR = 3_600_000;
const uuid = (block: string, n: number) =>
  `0199c0d0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(value: T): T => structuredClone(value);
const ago = (hours: number) => new Date(Date.now() - hours * HOUR).toISOString();
const day = (hours: number) => ago(hours).slice(0, 10);
const staff = (n: number, name: string): MemberRef => ({
  userId: `0199c0a0-0b00-7000-8000-${String(n).padStart(12, '0')}`,
  name,
});

interface Store {
  forms: IntakeFormDetail[];
  assigned: AssignedFormRecord[];
  drafts: SendDraft[];
  settings: IntakeSettings;
  changes: { id: string; at: string; label: string; by: string | null }[];
  idempotent: Map<string, string>;
  /** The forms with a published version: a new draft version over it keeps it live (as the API). */
  live: Set<string>;
  next: number;
}

const section = (key: string, title: string, labels: string[]) => ({
  key,
  title,
  description: null,
  questions: labels.map((label, i) => ({
    key: `${key}Q${i + 1}`,
    type:
      i === labels.length - 1 && key === 'uploads'
        ? ('FILE_UPLOAD' as const)
        : ('SHORT_ANSWER' as const),
    label,
    help: null,
    required: true,
  })),
});

function defaultSettings(): IntakeSettings {
  return {
    general: {
      defaultExpirationDays: 14,
      allowSaveAndResume: true,
      requireSignature: true,
      autoSubmissionId: true,
      defaultOwner: null,
    },
    clientExperience: {
      showProgressBar: true,
      mobileFriendly: true,
      thankYouMessage: 'Thank you for completing our intake form. We will be in touch soon!',
      redirectAfterCompletion: false,
      redirectUrl: null,
    },
    notifications: {
      sendClientConfirmation: true,
      notifyAssignedStaff: true,
      firstReminderAfterDays: 3,
      finalReminderAfterDays: 7,
      expirationAlertHours: 24,
    },
    automation: {
      autoCreateClient: false,
      autoCreateFollowUpTask: false,
      routeByServiceType: false,
      defaultFollowUpOwner: null,
      automationRuleCount: 0,
    },
    branding: { useFirmBranding: true },
    security: {
      encryptedUploads: true,
      acceptedFileTypes: ['PDF', 'JPG', 'PNG'],
      maxFileSizeMb: 10,
      consentRequired: true,
    },
    updatedAt: null,
    version: 'v1',
  };
}

function seed(empty: boolean): Store {
  const people = [
    staff(1, 'Morgan Avery'),
    staff(3, 'Daniel Okafor'),
    staff(6, 'Hana Kim'),
    staff(7, 'Theo Grant'),
  ];
  // name, category, questions (sections), used, custom
  const library: [string, FormCategory, number, number, boolean][] = [
    ['Personal Tax Intake Form', 'PERSONAL_TAX', 42, 156, false],
    ['Business Tax Intake Form', 'BUSINESS_TAX', 58, 134, false],
    ['Bookkeeping Intake Form', 'BOOKKEEPING', 36, 98, false],
    ['Payroll Setup Form', 'PAYROLL', 28, 87, false],
    ['New Client Intake Form', 'CLIENT_ONBOARDING', 24, 112, false],
    ['Tax Planning Discovery Form', 'TAX_PLANNING', 45, 76, true],
    ['Audit Support Intake Form', 'PERSONAL_TAX', 38, 64, true],
    ['Custom Advisory Intake Form', 'ADVISORY', 31, 52, true],
  ];
  // One service per category, as each real form belongs to one of the firm's services (Client
  // Onboarding has no service kind, so its sample form has none).
  const serviceOf = (category: FormCategory) => {
    const at = Object.keys(KIND_OF_CATEGORY).indexOf(category);
    return at < 0
      ? null
      : { id: uuid('5e00', at + 1), name: `${FORM_CATEGORY_LABELS[category]} service` };
  };
  const forms: IntakeFormDetail[] = library.map(([name, category, questions, used, custom], i) => ({
    id: uuid('0f00', i + 1),
    name,
    category,
    service: serviceOf(category),
    description: `Intake for ${name.replace(' Form', '').toLowerCase()} clients.`,
    isTemplate: true,
    custom,
    status: 'PUBLISHED',
    questionCount: questions,
    usageCount: empty ? 0 : used,
    lastUsedAt: empty ? null : ago(24 * (3 + i * 2)),
    updatedAt: ago(24 * (5 + i)),
    owner: people[i % people.length] ?? null,
    internalNotes: null,
    sections: [
      section('personal', 'Personal Information', [
        'Full name',
        'Date of birth',
        'Phone',
        'Email',
        'Filing status',
      ]),
      section('address', 'Address Information', ['Street', 'City', 'State']),
      section('income', 'Income Information', [
        'W-2 income',
        '1099 income',
        'Other income',
        'Rental income',
        'Business income',
        'Investments',
      ]),
      section('deductions', 'Deductions & Credits', [
        'Student loan interest',
        'Childcare',
        'Education',
        'Charity',
        'Mortgage interest',
      ]),
      section('uploads', 'Document Uploads', ['Photo ID', 'Tax documents']),
    ],
    settings: {
      requireAllQuestions: true,
      allowFileUploads: true,
      requireSignature: false,
      showProgressBar: true,
      expiresAfterDays: null,
      successMessage: "Thank you! We've received your information and will be in touch soon.",
    },
    version: 1,
    publishedAt: ago(24 * (5 + i)),
  }));
  // client, form index, status, sent hours ago, last activity hours ago, staff
  const rows: [string, number, IntakeStatus, number, number | null, number][] = [
    ['Avery Lawson', 0, 'COMPLETED', 120, 96, 0],
    ['Nina Fairbanks', 1, 'IN_PROGRESS', 72, 20, 1],
    ['Bruno Sandoval', 2, 'SUBMITTED', 60, 40, 2],
    ['Selma Shields', 0, 'SENT', 48, null, 3],
    ['Ravi Greenwood', 1, 'EXPIRED', 400, 330, 1],
    ['Kendra Gill', 2, 'COMPLETED', 150, 130, 0],
    ['Jonah Yates', 0, 'IN_PROGRESS', 40, 10, 1],
    ['Clara Voss', 1, 'SUBMITTED', 30, 12, 2],
    ['Owen Hartley', 4, 'SENT', 20, null, 3],
    ['Grace Pruitt', 3, 'UNDER_REVIEW', 90, 30, 0],
  ];
  const assigned: AssignedFormRecord[] = empty
    ? []
    : rows.map(([name, f, status, sent, last, who], i) => {
        const form = forms[f];
        const [first = name] = name.split(' ');
        const submitted = ['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'].includes(status);
        const history: AssignedFormEvent[] = [
          {
            id: uuid('0e00', i * 10 + 1),
            at: ago(sent),
            kind: 'SENT',
            label: 'Form sent to client',
            by: people[who]?.name ?? null,
          },
          ...(last !== null
            ? [
                {
                  id: uuid('0e00', i * 10 + 2),
                  at: ago(Math.max(last + 2, sent - 4)),
                  kind: 'OPENED' as const,
                  label: 'Client opened form',
                  by: null,
                },
              ]
            : []),
          ...(submitted && last !== null
            ? [
                {
                  id: uuid('0e00', i * 10 + 3),
                  at: ago(last),
                  kind: 'SUBMITTED' as const,
                  label: 'Form submitted',
                  by: null,
                },
              ]
            : []),
          ...(status === 'COMPLETED' && last !== null
            ? [
                {
                  id: uuid('0e00', i * 10 + 4),
                  at: ago(last - 1),
                  kind: 'COMPLETED' as const,
                  label: 'Marked as completed',
                  by: people[who]?.name ?? null,
                },
              ]
            : []),
        ];
        return {
          id: uuid('0a00', i + 1),
          recipient: {
            kind: i === 6 ? 'LEAD' : 'CLIENT',
            id: uuid('1c00', i + 1),
            name,
            email: `${first.toLowerCase()}@example.test`,
            phone: `(555) 040-${String(1000 + i)}`,
          },
          form: { id: form?.id ?? uuid('0f00', 1), name: form?.name ?? 'Form' },
          service: {
            id: uuid('0e10', f + 1),
            name:
              form?.category === 'BUSINESS_TAX'
                ? 'Business Tax'
                : form?.category === 'BOOKKEEPING'
                  ? 'Bookkeeping'
                  : 'Personal Tax',
          },
          status,
          sentAt: ago(sent),
          lastActivityAt: last === null ? null : ago(last),
          assignedTo: people[who] ?? null,
          dueOn: day(-24 * 7),
          expiresOn: day(-24 * 30),
          submittedAt: submitted && last !== null ? ago(last) : null,
          completedAt: status === 'COMPLETED' && last !== null ? ago(last - 1) : null,
          completedBy: status === 'COMPLETED' ? (people[who] ?? null) : null,
          progress: {
            percent: submitted ? 100 : status === 'IN_PROGRESS' ? 45 : 0,
            allQuestionsAnswered: submitted,
            requiredDocumentsUploaded: submitted,
            submitted,
            readyForReview: status === 'SUBMITTED' || status === 'UNDER_REVIEW',
          },
          documents: submitted
            ? ['W-2_2025.pdf', 'Driver_License.jpg', 'Prior_Year_Return.pdf', '1099-INT.pdf'].map(
                (fileName, k) => ({
                  id: uuid('0d00', i * 10 + k),
                  fileName,
                  contentType: fileName.endsWith('.jpg') ? 'image/jpeg' : 'application/pdf',
                  questionLabel: 'Tax documents',
                  uploadedAt: ago((last ?? 0) + 1),
                  scanStatus: 'CLEAN' as const,
                }),
              )
            : [],
          notes: submitted
            ? [
                {
                  id: uuid('0c00', i),
                  text: 'Client provided all requested documents. Looks complete.',
                  by: people[who] ?? null,
                  at: ago(last ?? 0),
                },
              ]
            : [],
          history,
          communications: history.filter((h) => h.kind === 'SENT'),
          revisionNote: null,
        };
      });
  return {
    forms,
    assigned,
    drafts: [],
    settings: defaultSettings(),
    changes: empty
      ? []
      : [
          {
            id: uuid('0b00', 1),
            at: ago(2),
            label: 'Updated form expiration to 14 days',
            by: 'Morgan Avery',
          },
        ],
    idempotent: new Map(),
    live: new Set(forms.map((f) => f.id)),
    next: 100,
  };
}

let stores: Map<string, Store> | undefined;
function storeFor(options: Options): Store {
  stores ??= new Map();
  const key = options.empty ? 'empty' : 'full';
  let s = stores.get(key);
  if (!s) {
    s = seed(options.empty ?? false);
    stores.set(key, s);
  }
  return s;
}

const TAB_STATUS: Record<string, readonly IntakeStatus[]> = {
  sent: ['SENT'],
  in_progress: ['IN_PROGRESS', 'NEEDS_CORRECTION'],
  submitted: ['SUBMITTED', 'UNDER_REVIEW'],
  completed: ['COMPLETED'],
  expired: ['EXPIRED'],
};

const toRow = (r: AssignedFormRecord): AssignedFormRow => ({
  id: r.id,
  recipient: r.recipient,
  form: r.form,
  service: r.service,
  status: r.status,
  sentAt: r.sentAt,
  lastActivityAt: r.lastActivityAt,
  assignedTo: r.assignedTo,
  dueOn: r.dueOn,
  expiresOn: r.expiresOn,
});

/** `api.intakeForms` in mock mode. */
export function createIntakeFormsMock(options: Options = {}): IntakeFormsClient {
  const role = options.role ?? 'OWNER';
  const s = storeFor(options);
  const me = role === 'STAFF' ? staff(3, 'Daniel Okafor') : staff(1, 'Morgan Avery');
  const sees = (r: AssignedFormRecord) => role !== 'STAFF' || r.assignedTo?.userId === me.userId;
  const find = (id: string) => {
    const r = s.assigned.find((x) => x.id === id);
    if (!r || !sees(r)) throw fail(404, 'NOT_FOUND', 'Not found');
    return r;
  };
  const findForm = (id: string) => {
    const f = s.forms.find((x) => x.id === id);
    if (!f) throw fail(404, 'NOT_FOUND', 'Not found');
    return f;
  };
  const managers = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const event = (r: AssignedFormRecord, kind: AssignedFormEvent['kind'], label: string) => {
    const e: AssignedFormEvent = {
      id: uuid('0e00', s.next++),
      at: new Date().toISOString(),
      kind,
      label,
      by: me.name,
    };
    r.history.push(e);
    if (['SENT', 'RESENT', 'REMINDER'].includes(kind)) r.communications.push(e);
    r.lastActivityAt = e.at;
  };
  const toView = (r: AssignedFormRecord): IntakeView => ({
    id: r.id,
    status: r.status,
    service: {
      id: r.service?.id ?? uuid('0e10', 1),
      name: r.service?.name ?? 'Personal Tax',
      kind: 'ANNUAL_TAX',
    },
    engagement: {
      id: uuid('1e00', 1),
      title: `2025 ${r.service?.name ?? 'Personal Tax'}`,
      taxYear: 2025,
    },
    formVersion: 1,
    version: 1,
    dueOn: r.dueOn,
    correctionNote: r.status === 'NEEDS_CORRECTION' ? r.revisionNote : null,
    correctionRequestedAt: r.status === 'NEEDS_CORRECTION' ? r.lastActivityAt : null,
    submittedAt: r.submittedAt,
    createdAt: r.sentAt ?? new Date().toISOString(),
    updatedAt: r.lastActivityAt ?? new Date().toISOString(),
    definition: INTAKE_FORMS.ANNUAL_TAX!,
    answers: mockIntakeAnswers(r),
    savedSteps: [],
    locked: !['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'].includes(r.status),
    uploads: r.documents.map((d) => ({
      documentId: d.id,
      slot: 'documents',
      fileName: d.fileName,
      contentType: d.contentType,
      sizeBytes: 120_000,
      scanStatus: d.scanStatus,
      createdAt: d.uploadedAt,
    })),
  });
  const setStatus = (r: AssignedFormRecord, status: IntakeStatus) => {
    r.status = status;
    r.progress.readyForReview = status === 'SUBMITTED' || status === 'UNDER_REVIEW';
  };

  return {
    summary: async () => {
      await mockDelay();
      const rows = s.assigned.filter(sees);
      const n = (statuses: readonly IntakeStatus[]) =>
        rows.filter((r) => statuses.includes(r.status)).length;
      const has = rows.length > 0;
      return {
        total: { value: rows.length, previous: has ? 20 : null },
        sent: {
          value: n([
            'SENT',
            'IN_PROGRESS',
            'SUBMITTED',
            'UNDER_REVIEW',
            'COMPLETED',
            'NEEDS_CORRECTION',
          ]),
          previous: has ? 14 : null,
        },
        inProgress: { value: n(['IN_PROGRESS', 'NEEDS_CORRECTION']), previous: has ? 7 : null },
        completed: { value: n(['COMPLETED']), previous: has ? 2 : null },
        expired: { value: n(['EXPIRED']), previous: has ? 5 : null },
        byStatus: {
          notStarted: n(['SENT']),
          inProgress: n(['IN_PROGRESS', 'NEEDS_CORRECTION']),
          submitted: n(['SUBMITTED', 'UNDER_REVIEW']),
          completed: n(['COMPLETED']),
          expired: n(['EXPIRED']),
        },
      };
    },
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(AssignedFormsQuery, query);
      const search = q.search?.toLowerCase() ?? '';
      const rows = s.assigned
        .filter(sees)
        .filter((r) => q.tab === 'all' || (TAB_STATUS[q.tab] ?? []).includes(r.status))
        .filter(
          (r) =>
            !search ||
            [
              r.recipient.name,
              r.recipient.email ?? '',
              r.form.name,
              r.service?.name ?? '',
              r.status,
            ].some((t) => t.toLowerCase().includes(search)),
        )
        .filter((r) => !q.assignedUserId || r.assignedTo?.userId === q.assignedUserId)
        .filter((r) => !q.formId || r.form.id === q.formId)
        .filter((r) => !q.from || (r.sentAt ?? '').slice(0, 10) >= q.from)
        .filter((r) => !q.to || (r.sentAt ?? '').slice(0, 10) <= q.to)
        .sort((a, b) => Date.parse(b.sentAt ?? '') - Date.parse(a.sentAt ?? ''))
        .map(toRow);
      const start = (q.page - 1) * q.pageSize;
      return {
        items: copy(rows.slice(start, start + q.pageSize)),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },

    send: async (body) => {
      await mockDelay();
      const input = parseInput(SendIntakeFormRequest, body);
      const again = s.idempotent.get(input.idempotencyKey);
      if (again) {
        const r = find(again);
        return {
          form: toRow(r),
          delivery: { channel: input.channel, status: 'SENT', to: 'c***@example.test' },
        };
      }
      // The API's refusals, in its order (intake-send.service.ts). The mock knows no services, so
      // a subject with "noservice" stands for a client with no active service for the form.
      if (input.channel === 'SMS')
        throw fail(400, 'SMS_UNAVAILABLE', 'Text messages are not available for intake forms yet');
      const rc = input.recipient;
      if (rc.kind === 'LEAD' && input.channel === 'PORTAL')
        throw fail(409, 'PORTAL_UNAVAILABLE', 'A lead has no portal access: choose Email');
      if (rc.kind !== 'CLIENT')
        throw fail(503, 'LEAD_LINK_UNAVAILABLE', 'Leads need the secure link page');
      const form = findForm(input.formId);
      if (form.status !== 'PUBLISHED')
        throw fail(409, 'FORM_NOT_PUBLISHED', 'Publish this form before sending it');
      if (input.subject.toLowerCase().includes('noservice'))
        throw fail(
          409,
          'NO_ENGAGEMENT',
          "This client has no active service for this form's service",
        );
      const open = s.assigned.find(
        (r) =>
          r.recipient.id === rc.id &&
          r.form.id === form.id &&
          ['SENT', 'IN_PROGRESS'].includes(r.status),
      );
      if (open)
        throw fail(
          409,
          'FORM_ALREADY_OPEN',
          'This recipient already has this form open: resend it instead',
        );
      const n = s.next++;
      const at = new Date().toISOString();
      // Only a client gets this far (as with the API).
      const r: AssignedFormRecord = {
        id: uuid('0a00', n),
        recipient: {
          kind: 'CLIENT',
          id: rc.id,
          name: 'Selected recipient',
          email: null,
          phone: null,
        },
        form: { id: form.id, name: form.name },
        service: form.service,
        status: 'SENT',
        sentAt: at,
        lastActivityAt: at,
        assignedTo: input.assignedUserId
          ? { userId: input.assignedUserId, name: 'Assigned member' }
          : me,
        dueOn: input.dueOn ?? null,
        expiresOn: input.expiresOn ?? null,
        submittedAt: null,
        completedAt: null,
        completedBy: null,
        progress: {
          percent: 0,
          allQuestionsAnswered: false,
          requiredDocumentsUploaded: false,
          submitted: false,
          readyForReview: false,
        },
        documents: [],
        notes: [],
        history: [],
        communications: [],
        revisionNote: null,
      };
      event(r, 'SENT', `Form sent by ${input.channel.toLowerCase()}`);
      s.assigned.unshift(r);
      form.usageCount += 1;
      form.lastUsedAt = at;
      s.idempotent.set(input.idempotencyKey, r.id);
      // "undelivered" in the subject: the form is kept but nothing reached the client, as the API
      // answers when the client has no portal sign-in for the bell and its email copy.
      const undelivered = input.subject.toLowerCase().includes('undelivered');
      return {
        form: toRow(r),
        delivery: {
          channel: input.channel,
          status: undelivered ? 'FAILED' : 'SENT',
          to: input.channel === 'PORTAL' ? 'Client portal' : 'c***@example.test',
        },
      };
    },
    sendDrafts: async () => {
      await mockDelay();
      return copy(s.drafts);
    },
    saveSendDraft: async (body, draftId) => {
      await mockDelay();
      const data = parseInput(SaveSendDraftRequest, body) as Record<string, unknown>;
      const existing = draftId ? s.drafts.find((d) => d.id === draftId) : undefined;
      if (draftId && !existing) throw fail(404, 'NOT_FOUND', 'Not found');
      const d: SendDraft = existing ?? {
        id: uuid('0b10', s.next++),
        data,
        updatedAt: new Date().toISOString(),
      };
      d.data = copy(data);
      d.updatedAt = new Date().toISOString();
      if (!existing) s.drafts.push(d);
      return copy(d);
    },

    record: async (id) => {
      await mockDelay();
      return copy(find(id));
    },
    responses: async (id) => {
      await mockDelay();
      return toView(find(id));
    },
    addNote: async (id, body) => {
      await mockDelay();
      const { text } = parseInput(AddFormNoteRequest, body);
      const r = find(id);
      const note = { id: uuid('0c00', s.next++), text, by: me, at: new Date().toISOString() };
      r.notes.push(note);
      return copy(note);
    },
    update: async (id, body) => {
      await mockDelay();
      const input = parseInput(UpdateAssignedFormRequest, body);
      const r = find(id);
      if (input.assignedUserId !== undefined) {
        r.assignedTo = input.assignedUserId
          ? { userId: input.assignedUserId, name: 'Assigned member' }
          : null;
        event(r, 'ASSIGNED', 'Assigned staff changed');
      }
      if (input.dueOn !== undefined) r.dueOn = input.dueOn;
      if (input.expiresOn !== undefined) {
        r.expiresOn = input.expiresOn;
        if (
          r.status === 'EXPIRED' &&
          input.expiresOn &&
          input.expiresOn >= new Date().toISOString().slice(0, 10)
        )
          setStatus(r, 'SENT');
        event(r, 'EXTENDED', 'Expiration extended');
      }
      return copy(r);
    },
    resend: async (id) => {
      await mockDelay();
      const r = find(id);
      if (r.status === 'COMPLETED') throw fail(409, 'INVALID_STATUS', 'This form is completed');
      event(r, 'RESENT', 'Form resent');
      return copy(r);
    },
    remind: async (id) => {
      await mockDelay();
      const r = find(id);
      if (!['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'].includes(r.status))
        throw fail(409, 'INVALID_STATUS', 'Only open forms get reminders');
      event(r, 'REMINDER', 'Reminder sent');
      return copy(r);
    },
    markReviewed: async (id) => {
      await mockDelay();
      const r = find(id);
      if (!['SUBMITTED', 'UNDER_REVIEW'].includes(r.status))
        throw fail(409, 'INVALID_STATUS', 'Only a submitted form can be marked reviewed');
      setStatus(r, 'COMPLETED');
      r.completedAt = new Date().toISOString();
      r.completedBy = me;
      event(r, 'COMPLETED', 'Marked as completed');
      return toView(r);
    },
    requestRevision: async (id, body) => {
      await mockDelay();
      managers();
      const { note } = parseInput(RequestIntakeCorrectionRequest, body);
      const r = find(id);
      if (!['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'].includes(r.status))
        throw fail(409, 'INVALID_STATUS', 'Only a submitted form can be revised');
      setStatus(r, 'NEEDS_CORRECTION');
      r.revisionNote = note;
      event(r, 'REVISION_REQUESTED', 'Revision requested');
      return toView(r);
    },
    archive: async (id) => {
      await mockDelay();
      const r = find(id);
      setStatus(r, 'ARCHIVED');
      event(r, 'ARCHIVED', 'Form archived');
      return copy(r);
    },
    exportPdf: async (id) => {
      await mockDelay();
      const r = find(id);
      return {
        url: `data:text/plain;charset=utf-8,${encodeURIComponent(`Mock PDF: ${r.form.name} - ${r.recipient.name}`)}`,
        expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      };
    },

    forms: async (query = {}) => {
      await mockDelay();
      const q = parseInput(IntakeFormsQuery, query);
      const search = q.search?.toLowerCase() ?? '';
      // As the API's list: a form with a published version shows it, even under a new draft.
      const shown = (f: IntakeFormDetail) =>
        f.status === 'DRAFT' && s.live.has(f.id) ? { ...f, status: 'PUBLISHED' as const } : f;
      const rows = s.forms
        .map(shown)
        .filter((f) => q.templates === 'all' || String(f.isTemplate) === q.templates)
        .filter((f) => !q.category || f.category === q.category)
        .filter((f) => !q.status || f.status === q.status)
        .filter((f) => !search || f.name.toLowerCase().includes(search))
        .sort((a, b) =>
          q.sort === 'name'
            ? a.name.localeCompare(b.name)
            : q.sort === 'used'
              ? b.usageCount - a.usageCount
              : q.sort === 'recent'
                ? Date.parse(b.lastUsedAt ?? '0') - Date.parse(a.lastUsedAt ?? '0')
                : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        );
      return rows.map(
        ({
          internalNotes: _n,
          sections: _s,
          settings: _st,
          version: _v,
          publishedAt: _p,
          ...item
        }) => copy(item),
      );
    },
    librarySummary: async () => {
      await mockDelay();
      // The same rows as the library's list (every form not archived), as the API counts them.
      const templates = s.forms.filter((f) => f.status !== 'RETIRED');
      const month = Date.now() - 30 * 24 * HOUR;
      const categories = [...new Set(templates.map((f) => f.category))];
      const most = Math.max(0, ...templates.map((f) => f.usageCount));
      return {
        total: templates.length,
        mostUsed: most > 0 ? templates.filter((f) => f.usageCount === most).length : 0,
        custom: templates.filter((f) => f.custom).length,
        updatedLast30Days: templates.filter((f) => Date.parse(f.updatedAt) >= month).length,
        byCategory: categories.map((category) => ({
          category,
          count: templates.filter((f) => f.category === category).length,
        })),
      };
    },
    form: async (id) => {
      await mockDelay();
      return copy(findForm(id));
    },
    createForm: async (body) => {
      await mockDelay();
      managers();
      const input = parseInput(SaveIntakeFormRequest, body);
      const source =
        input.startFrom && input.startFrom.kind !== 'SCRATCH'
          ? findForm(input.startFrom.formId)
          : null;
      const at = new Date().toISOString();
      const sections = input.sections
        ? input.sections.map((sec) => ({
            ...sec,
            description: sec.description ?? null,
            questions: sec.questions.map((q) => ({ ...q, help: q.help ?? null })),
          }))
        : (source?.sections ?? []);
      // The service chosen (its forms' category), as the API files a form under its service.
      const service = input.serviceId
        ? s.forms.find((form) => form.service?.id === input.serviceId)
        : undefined;
      if (input.serviceId && !service) {
        throw fail(404, 'NOT_FOUND', 'Not found');
      }
      const f: IntakeFormDetail = {
        id: uuid('0f00', s.next++),
        name: input.name,
        category: service?.category ?? input.category,
        service: service?.service ?? null,
        description: input.description ?? null,
        isTemplate: input.isTemplate,
        custom: true,
        status: 'DRAFT',
        questionCount: sections.reduce(
          (n, sec) =>
            n +
            sec.questions.filter((q) => q.type !== 'SECTION_BREAK' && q.type !== 'INSTRUCTION_TEXT')
              .length,
          0,
        ),
        usageCount: 0,
        lastUsedAt: null,
        updatedAt: at,
        owner: me,
        internalNotes: input.internalNotes ?? null,
        sections: copy(sections),
        settings: {
          requireAllQuestions: input.settings?.requireAllQuestions ?? false,
          allowFileUploads: input.settings?.allowFileUploads ?? true,
          requireSignature: input.settings?.requireSignature ?? false,
          showProgressBar: input.settings?.showProgressBar ?? true,
          expiresAfterDays: input.settings?.expiresAfterDays ?? null,
          successMessage: input.settings?.successMessage ?? null,
        },
        version: 1,
        publishedAt: null,
      };
      s.forms.push(f);
      return copy(f);
    },
    saveForm: async (id, body) => {
      await mockDelay();
      managers();
      const input = parseInput(SaveIntakeFormRequest, body);
      const f = findForm(id);
      if (f.status === 'RETIRED') throw fail(409, 'INVALID_STATUS', 'This form is archived');
      // As the API: a published version stays as it is; the changes are the next draft version.
      if (f.status === 'PUBLISHED') {
        f.version += 1;
        f.status = 'DRAFT';
        f.publishedAt = null;
      }
      f.name = input.name;
      f.category = input.category;
      f.description = input.description ?? null;
      f.internalNotes = input.internalNotes ?? null;
      if (input.sections) {
        f.sections = input.sections.map((sec) => ({
          ...sec,
          description: sec.description ?? null,
          questions: sec.questions.map((q) => ({
            ...q,
            help: q.help ?? null,
            required: q.required ?? false,
          })),
        }));
        f.questionCount = f.sections.reduce((n, sec) => n + sec.questions.length, 0);
      }
      if (input.settings)
        Object.assign(
          f.settings,
          Object.fromEntries(Object.entries(input.settings).filter(([, v]) => v !== undefined)),
        );
      f.updatedAt = new Date().toISOString();
      return copy(f);
    },
    publishForm: async (id) => {
      await mockDelay();
      managers();
      const f = findForm(id);
      const bad = f.sections
        .flatMap((sec) => sec.questions)
        .find(
          (q) =>
            ['MULTIPLE_CHOICE', 'CHECKBOXES', 'DROPDOWN'].includes(q.type) && !q.options?.length,
        );
      if (bad) throw fail(400, 'FORM_INCOMPLETE', `Add options to "${bad.label}"`);
      if (f.sections.length === 0) throw fail(400, 'FORM_INCOMPLETE', 'Add at least one section');
      f.status = 'PUBLISHED';
      f.publishedAt = new Date().toISOString();
      s.live.add(f.id);
      return copy(f);
    },
    duplicateForm: async (id, asTemplate = false) => {
      await mockDelay();
      managers();
      const f = findForm(id);
      const d: IntakeFormDetail = {
        ...copy(f),
        id: uuid('0f00', s.next++),
        name: `${f.name} (Copy)`,
        status: 'DRAFT',
        isTemplate: asTemplate || f.isTemplate,
        custom: true,
        usageCount: 0,
        lastUsedAt: null,
        publishedAt: null,
        updatedAt: new Date().toISOString(),
        owner: me,
      };
      s.forms.push(d);
      return copy(d);
    },
    archiveForm: async (id) => {
      await mockDelay();
      managers();
      const f = findForm(id);
      f.status = 'RETIRED';
      s.live.delete(f.id);
      return copy(f);
    },
    publicLink: async (id) => {
      await mockDelay();
      const f = findForm(id);
      const kind = KIND_OF_CATEGORY[f.category];
      const open = (x: IntakeFormDetail) => x.isTemplate && x.status !== 'RETIRED';
      const main = s.forms.find((x) => open(x) && x.service && x.service.id === f.service?.id);
      if (!kind || main !== f) throw fail(404, 'NOT_FOUND', 'Not found');
      const url = beginOnlinePageUrl(PORTAL, 'lvp', kind);
      return {
        kind: 'INTAKE_FORM',
        itemId: f.id,
        url,
        embedCode: publicEmbedCode(url, f.name),
        state: !s.live.has(f.id) ? 'DRAFT' : kind === MOCK_NOT_ON_BEGIN_ONLINE ? 'HIDDEN' : 'LIVE',
      };
    },

    settings: async () => {
      await mockDelay();
      return copy(s.settings);
    },
    updateSettings: async (body) => {
      await mockDelay();
      managers();
      const input = parseInput(UpdateIntakeSettingsRequest, body);
      if (input.version !== s.settings.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved the settings first');
      const st = s.settings;
      // As the API: a new size is one of the choices; the saved one stays valid as it is.
      const size = input.security?.maxFileSizeMb;
      const choices: readonly number[] = INTAKE_FILE_SIZE_CHOICES;
      if (size !== undefined && size !== st.security.maxFileSizeMb && !choices.includes(size)) {
        const message = 'Choose 2, 5, 10, 50 or 100 MB';
        throw new ApiRequestError(400, 'VALIDATION_FAILED', message, undefined, undefined, [
          { path: 'security.maxFileSizeMb', message },
        ]);
      }
      const pick = <T extends object>(o: T | undefined) =>
        Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined));
      // As the API: no first reminder is no reminders; no alert, or a final reminder that is not
      // after the first, is refused at its field.
      const n = { ...st.notifications, ...pick(input.notifications) };
      if (n.firstReminderAfterDays === null) n.finalReminderAfterDays = null;
      const refuse = (path: string, message: string) =>
        new ApiRequestError(400, 'VALIDATION_FAILED', message, undefined, undefined, [
          { path, message },
        ]);
      if (n.expirationAlertHours === null)
        throw refuse(
          'notifications.expirationAlertHours',
          'Choose how long before expiry the alert goes',
        );
      if (
        n.firstReminderAfterDays !== null &&
        (n.finalReminderAfterDays ?? 0) <= n.firstReminderAfterDays
      )
        throw refuse(
          'notifications.finalReminderAfterDays',
          'The final reminder comes after the first',
        );
      const { defaultOwnerUserId, ...general } = input.general ?? {};
      Object.assign(st.general, pick(general));
      if (defaultOwnerUserId !== undefined)
        st.general.defaultOwner = defaultOwnerUserId
          ? { userId: defaultOwnerUserId, name: 'Selected member' }
          : null;
      Object.assign(st.clientExperience, pick(input.clientExperience));
      Object.assign(st.notifications, n);
      const { defaultFollowUpOwnerUserId, ...automation } = input.automation ?? {};
      Object.assign(st.automation, pick(automation));
      if (defaultFollowUpOwnerUserId !== undefined)
        st.automation.defaultFollowUpOwner = defaultFollowUpOwnerUserId
          ? { userId: defaultFollowUpOwnerUserId, name: 'Selected member' }
          : null;
      Object.assign(st.branding, pick(input.branding));
      Object.assign(st.security, pick(input.security));
      st.version = `v${Number(st.version.slice(1)) + 1}`;
      st.updatedAt = new Date().toISOString();
      s.changes.unshift({
        id: uuid('0b00', s.next++),
        at: st.updatedAt,
        label: 'Intake settings updated',
        by: me.name,
      });
      return copy(st);
    },
    resetSettings: async (body) => {
      await mockDelay();
      managers();
      parseInput(ResetIntakeSettingsRequest, body);
      const version = s.settings.version;
      s.settings = {
        ...defaultSettings(),
        version: `v${Number(version.slice(1)) + 1}`,
        updatedAt: new Date().toISOString(),
      };
      s.changes.unshift({
        id: uuid('0b00', s.next++),
        at: new Date().toISOString(),
        label: 'Settings reset to defaults',
        by: me.name,
      });
      return copy(s.settings);
    },
    testReminder: async () => {
      await mockDelay();
      managers();
      return { ok: true };
    },
    settingsChanges: async () => {
      await mockDelay();
      return copy(s.changes);
    },
  };
}
