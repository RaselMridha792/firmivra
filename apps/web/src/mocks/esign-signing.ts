import {
  type EsignClient,
  type EsignConsentVersion,
  type EsignDefaults,
  type EsignEvent,
  type EsignEventType,
  type EsignRequestDetail,
  type EsignTemplateDetail,
  type EsignTemplateRole,
  type EsignPutRecipient,
  EsignTemplateId,
  type MemberRef,
  type MySignatureRow,
  type MySignaturesClient,
  ListEsignTemplatesQuery,
  ListMySignaturesQuery,
  parseInput,
  PublishEsignConsentBody,
  SaveEsignTemplateBody,
  SignerAcceptConsentBody,
  SignerAccessCodeBody,
  SignerAdoptBody,
  SignerAttachmentConfirmBody,
  SignerAttachmentUploadBody,
  SignerCopyFile,
  SignerDeclineBody,
  type SignerEnvelope,
  type SignerField,
  SignerFinishBody,
  SignerSessionBody,
  type SignerState,
  type SignerStep,
  SignerVerifyCodeBody,
  type SigningClient,
  UpdateEsignProfileBody,
  UpdateEsignSettingsBody,
  UpdateEsignTemplateBody,
  UseEsignTemplateBody,
  ESIGN_CODE_MINUTES,
  ESIGN_CODE_TRIES,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { copy, DAY, ESIGN_OFF, fail, iso, LETTER, MINUTE, SAMPLE_PDF_URL } from './esign-common';
import { clientFixtures } from './clients';
import { mockBusiness } from './me';

/**
 * Mock data for Firm Sign's contract 2 (R13): Signing Settings and templates on `api.esign`, the
 * signer pages (`api.signing(slug)`) and the portal's Signature center (`api.mySignatures(slug)`).
 * Synthetic data only, same input checks and error codes as the API.
 *
 * Signer pages: open /lvp/sign#t=<token> with one of MOCK_SIGNING_TOKENS:
 * - emailCode: the email code step (the code is 123456; 5 wrong tries lock it), consent, then sign.
 * - accessCode: an access code (MOCK1234) instead of the email code.
 * - autoPage: no placed fields, so they sign on the added signature page.
 * - waiting: someone signs first (WAITING). DONE comes after `finish`.
 * - copy: a completed-copy link (email code, then COPY). used and expired: LINK_INVALID (a link
 *   that was already used to sign, or ran out).
 * Any other token, another firm's slug, or NEXT_PUBLIC_API_MOCK_ESIGN=off answers 404 LINK_INVALID.
 * A page reload keeps the step (the mock "cookie" lives as long as the page).
 */

const linkInvalid = () => fail(404, 'LINK_INVALID', 'This link is not valid any more');
const wrongStep = () => fail(409, 'WRONG_STEP', 'Finish the step before this one first');

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** 43-character tokens (the real ones are 32 random bytes, base64url). */
export const MOCK_SIGNING_TOKENS = {
  emailCode: 'mock-email-code0000000000000000000000000000',
  accessCode: 'mock-access-code000000000000000000000000000',
  autoPage: 'mock-auto-page00000000000000000000000000000',
  waiting: 'mock-waiting0000000000000000000000000000000',
  used: 'mock-used0000000000000000000000000000000000',
  copy: 'mock-copy0000000000000000000000000000000000',
  expired: 'mock-expired0000000000000000000000000000000',
} as const;
export const MOCK_SIGNING_CODE = '123456';
export const MOCK_ACCESS_CODE = 'MOCK1234';

const consentV1 = (): EsignConsentVersion => ({
  id: uuid(0xc0),
  version: 1,
  bodyMarkdown: [
    '## Consent to sign electronically',
    '',
    'Draft text for review by counsel (synthetic). By continuing you agree to sign these documents electronically and to receive them electronically.',
    '',
    '- You may ask for a paper copy.',
    '- You may withdraw this consent before you sign by declining.',
    '- You need a device with a current web browser and an email address.',
  ].join('\n'),
  sha256: 'c0'.repeat(32),
  publishedAt: iso(Date.UTC(2026, 9, 8, 12)),
  publishedBy: { userId: '00000000-0000-4000-8000-000000000101', name: 'Mock User' },
});

// ---------- Signer pages ----------
type Scenario = keyof typeof MOCK_SIGNING_TOKENS | 'portal';

interface Session {
  scenario: Scenario;
  step: SignerStep;
  tries: number;
  codeSentAt: number | null;
  adopted: SignerEnvelope['adopted'];
  fields: SignerField[];
  attachments: Map<string, string>;
}

const FIRST_STEP: Record<Scenario, SignerStep> = {
  emailCode: 'VERIFY_EMAIL',
  accessCode: 'VERIFY_ACCESS_CODE',
  autoPage: 'VERIFY_EMAIL',
  waiting: 'WAITING',
  used: 'DONE',
  copy: 'VERIFY_EMAIL',
  expired: 'CLOSED',
  portal: 'CONSENT',
};

const signerFields = (): SignerField[] => {
  const f = (
    n: number,
    type: SignerField['type'],
    pageIndex: number,
    y: number,
    extra: Partial<SignerField> = {},
  ): SignerField => ({
    id: uuid(0xf00 + n),
    type,
    pageIndex,
    x: 0.1,
    y,
    w: type === 'CHECKBOX' ? 0.04 : 0.3,
    h: type === 'CHECKBOX' ? 0.03 : 0.05,
    required: true,
    label: null,
    options: [],
    groupKey: null,
    value: null,
    attachmentName: null,
    ...extra,
  });
  return [
    f(1, 'INITIALS', 0, 0.9),
    f(2, 'TEXT', 0, 0.5, { label: 'Your job title' }),
    f(3, 'CHECKBOX', 0, 0.6, { label: 'I have read the engagement terms' }),
    f(4, 'PRINTED_NAME', 1, 0.7, { value: 'Jamie Sample' }),
    f(5, 'SIGNATURE', 1, 0.78),
    f(6, 'DATE_SIGNED', 1, 0.86),
    f(7, 'ATTACHMENT', 1, 0.3, { label: 'Photo ID (optional)', required: false }),
  ];
};

/** The consent signers accept now: the newest version published in Signing Settings. */
const currentConsent = (): EsignConsentVersion => admin().consents[0] ?? consentV1();

/** One mock "cookie" per firm slug, kept while the page is open. */
let sessionMap: Map<string, Session> | undefined;
const sessions = () => (sessionMap ??= new Map());

function newSession(scenario: Scenario): Session {
  return {
    scenario,
    step: FIRST_STEP[scenario],
    tries: 0,
    codeSentAt: null,
    adopted: null,
    fields: scenario === 'autoPage' ? [] : signerFields(),
    attachments: new Map(),
  };
}

const signerState = (s: Session): SignerState => ({
  step: s.step,
  title: s.scenario === 'copy' ? 'Tax Engagement Letter 2026' : 'Bookkeeping Services Agreement',
  senderName: 'Mock User',
  firmName: mockBusiness.name,
  signerName: 'Jamie Sample',
  codeSentTo: s.step === 'VERIFY_EMAIL' ? 'j***@example.test' : null,
  requestStatus: s.step === 'COPY' ? 'COMPLETED' : s.step === 'CLOSED' ? 'EXPIRED' : null,
  expiresAt: s.step === 'CLOSED' ? null : iso(Date.now() + 10 * DAY),
});

/** An in-memory `api.signing(slug)`; see the file comment for the tokens. */
export function createSigningMock(firmSlug: string): SigningClient {
  const slug = firmSlug.toLowerCase();
  const firmOk = () => !ESIGN_OFF && slug === mockBusiness.slug;
  const current = async (): Promise<Session> => {
    await mockDelay();
    const s = sessions().get(slug);
    if (!firmOk() || !s) throw linkInvalid();
    return s;
  };
  const at = async (step: SignerStep): Promise<Session> => {
    const s = await current();
    if (s.step !== step) throw wrongStep();
    return s;
  };
  const afterAuth = (s: Session) => {
    s.step = s.scenario === 'copy' ? 'COPY' : 'CONSENT';
    s.tries = 0;
  };
  const envelope = (s: Session): SignerEnvelope => ({
    title: signerState(s).title,
    message: 'Please review and sign. Call us with any questions.',
    senderName: 'Mock User',
    firmName: mockBusiness.name,
    me: {
      recipientId: uuid(0xe01),
      name: 'Jamie Sample',
      kind: 'SIGNER',
      role: 'CLIENT',
      roleLabel: null,
    },
    packetUrl: SAMPLE_PDF_URL,
    pageCount: s.scenario === 'autoPage' ? 3 : 2,
    pageSizes: Array.from({ length: s.scenario === 'autoPage' ? 3 : 2 }, () => ({ ...LETTER })),
    fields: copy(s.fields),
    autoSignaturePage: s.scenario === 'autoPage',
    adopted: s.adopted ? { ...s.adopted } : null,
    progress: [
      { name: 'Jamie Sample', role: 'CLIENT', signed: false },
      { name: 'Mock User', role: 'PREPARER', signed: false },
    ],
    expiresAt: iso(Date.now() + 10 * DAY),
  });

  return {
    session: async (rawToken) => {
      await mockDelay();
      const { token: t } = parseInput(SignerSessionBody, { token: rawToken });
      const scenario = (
        Object.keys(MOCK_SIGNING_TOKENS) as (keyof typeof MOCK_SIGNING_TOKENS)[]
      ).find((k) => MOCK_SIGNING_TOKENS[k] === t);
      if (!firmOk() || !scenario || scenario === 'expired' || scenario === 'used') {
        throw linkInvalid();
      }
      const s = newSession(scenario);
      sessions().set(slug, s);
      return signerState(s);
    },
    state: async () => signerState(await current()),
    end: async () => {
      await mockDelay();
      sessions().delete(slug);
      return { ok: true as const };
    },
    sendCode: async () => {
      const s = await at('VERIFY_EMAIL');
      if (s.codeSentAt !== null && Date.now() - s.codeSentAt < MINUTE) {
        throw fail(429, 'CODE_TOO_SOON', 'A code was just sent');
      }
      s.codeSentAt = Date.now();
      s.tries = 0;
      return {
        sentTo: 'j***@example.test',
        expiresAt: iso(Date.now() + ESIGN_CODE_MINUTES * MINUTE),
        resendAfter: iso(Date.now() + MINUTE),
      };
    },
    verifyCode: async (body) => {
      const { code } = parseInput(SignerVerifyCodeBody, body);
      const s = await at('VERIFY_EMAIL');
      if (s.tries >= ESIGN_CODE_TRIES) throw fail(429, 'CODE_LOCKED', 'Too many tries');
      const expired =
        s.codeSentAt === null || Date.now() - s.codeSentAt > ESIGN_CODE_MINUTES * MINUTE;
      if (expired || code !== MOCK_SIGNING_CODE) {
        s.tries += 1;
        throw s.tries >= ESIGN_CODE_TRIES
          ? fail(429, 'CODE_LOCKED', 'Too many tries')
          : fail(400, 'CODE_INVALID', 'That code is not right');
      }
      afterAuth(s);
      return signerState(s);
    },
    verifyAccessCode: async (body) => {
      const { code } = parseInput(SignerAccessCodeBody, body);
      const s = await at('VERIFY_ACCESS_CODE');
      if (s.tries >= ESIGN_CODE_TRIES) throw fail(429, 'CODE_LOCKED', 'Too many tries');
      if (code !== MOCK_ACCESS_CODE) {
        s.tries += 1;
        throw s.tries >= ESIGN_CODE_TRIES
          ? fail(429, 'CODE_LOCKED', 'Too many tries')
          : fail(400, 'CODE_INVALID', 'That code is not right');
      }
      afterAuth(s);
      return signerState(s);
    },
    consent: async () => {
      await at('CONSENT');
      const { id: versionId, version, bodyMarkdown } = currentConsent();
      return { versionId, version, bodyMarkdown };
    },
    acceptConsent: async (body) => {
      const { versionId } = parseInput(SignerAcceptConsentBody, body);
      const s = await at('CONSENT');
      if (versionId !== currentConsent().id)
        throw fail(409, 'CONSENT_OUTDATED', 'The consent changed');
      s.step = 'SIGN';
      return signerState(s);
    },
    envelope: async () => envelope(await at('SIGN')),
    packetUrl: () => SAMPLE_PDF_URL,
    adopt: async (body) => {
      const input = parseInput(SignerAdoptBody, body);
      const s = await at('SIGN');
      const method = (input.signature as { method?: 'TYPED' | 'DRAWN' | 'UPLOADED' }).method;
      s.adopted = { method: method ?? 'TYPED', hasInitials: input.initials !== undefined };
      return envelope(s);
    },
    finish: async (body) => {
      const { values } = parseInput(SignerFinishBody, body);
      const s = await at('SIGN');
      const mine = new Set(s.fields.map((f) => f.id));
      if (values.some((v) => !mine.has(v.fieldId))) {
        throw fail(400, 'VALIDATION_FAILED', 'Unknown field');
      }
      const needsInitials = s.fields.some((f) => f.type === 'INITIALS');
      if (!s.adopted || (needsInitials && !s.adopted.hasInitials)) {
        throw fail(409, 'SIGNATURE_REQUIRED', 'Adopt your signature first');
      }
      const given = new Map(values.map((v) => [v.fieldId, v.value.trim()]));
      const missing = s.fields.some((f) => {
        if (!f.required || ['SIGNATURE', 'INITIALS', 'DATE_SIGNED'].includes(f.type)) return false;
        if (f.type === 'ATTACHMENT') return !s.attachments.has(f.id);
        const v = given.get(f.id) ?? f.value ?? '';
        return f.type === 'CHECKBOX' ? v !== 'true' : v === '';
      });
      if (missing) throw fail(409, 'REQUIRED_FIELDS_MISSING', 'Fill in every required field');
      s.step = 'DONE';
      return signerState(s);
    },
    decline: async (body = {}) => {
      parseInput(SignerDeclineBody, body);
      const s = await current();
      if (!['CONSENT', 'SIGN'].includes(s.step)) throw wrongStep();
      s.step = 'DECLINED';
      return signerState(s);
    },
    createAttachmentUpload: async (body) => {
      const input = parseInput(SignerAttachmentUploadBody, body);
      const s = await at('SIGN');
      if (!s.fields.some((f) => f.id === input.fieldId && f.type === 'ATTACHMENT')) {
        throw fail(400, 'VALIDATION_FAILED', 'Unknown field');
      }
      return {
        uploadToken: `mock-attachment:${input.fieldId}:${input.fileName}`,
        url: `mock:upload/attachment-${input.fieldId}`,
        method: 'PUT' as const,
        headers: { 'content-type': input.contentType },
        expiresAt: iso(Date.now() + 15 * MINUTE),
      };
    },
    confirmAttachment: async (body) => {
      const { fieldId, uploadToken } = parseInput(SignerAttachmentConfirmBody, body);
      const s = await at('SIGN');
      const [, tokenField, fileName] = uploadToken.split(':');
      const f = s.fields.find((x) => x.id === fieldId && x.type === 'ATTACHMENT');
      if (!f || tokenField !== fieldId || !fileName) throw fail(410, 'UPLOAD_EXPIRED', 'Expired');
      s.attachments.set(fieldId, fileName);
      f.attachmentName = fileName;
      return copy(f);
    },
    copy: async () => {
      await at('COPY');
      return {
        title: 'Tax Engagement Letter 2026',
        completedAt: iso(Date.now() - 2 * DAY),
        files: [
          { file: 'final' as const, fileName: 'Tax Engagement Letter 2026 (signed).pdf' },
          {
            file: 'certificate' as const,
            fileName: 'Tax Engagement Letter 2026 (certificate).pdf',
          },
        ],
      };
    },
    downloadCopy: async (file) => {
      parseInput(SignerCopyFile, file);
      await at('COPY');
      return { url: SAMPLE_PDF_URL, expiresAt: iso(Date.now() + 5 * MINUTE) };
    },
  };
}

// ---------- The portal's Signature center ----------
const MY_ROWS = (): MySignatureRow[] => {
  const now = Date.now();
  const row = (
    n: number,
    title: string,
    state: MySignatureRow['state'],
    sentDaysAgo: number,
  ): MySignatureRow => {
    const final = !['ACTION_NEEDED', 'WAITING'].includes(state);
    return {
      recipientId: uuid(0xe00 + n),
      title,
      senderName: 'Mock User',
      state,
      sentAt: iso(now - sentDaysAgo * DAY),
      expiresAt: final ? null : iso(now + (30 - sentDaysAgo) * DAY),
      signedAt: state === 'COMPLETED' || n === 3 ? iso(now - (sentDaysAgo - 1) * DAY) : null,
      completedAt: state === 'COMPLETED' ? iso(now - (sentDaysAgo - 1) * DAY) : null,
    };
  };
  return [
    row(1, 'Bookkeeping Services Agreement', 'ACTION_NEEDED', 2),
    row(2, 'Payroll Authorization', 'ACTION_NEEDED', 5),
    row(3, 'Joint Return Consent', 'WAITING', 3),
    row(4, 'Tax Engagement Letter 2026', 'COMPLETED', 12),
    row(5, 'Section 7216 Consent', 'COMPLETED', 40),
    row(6, 'Terms of Service Update', 'EXPIRED', 60),
  ];
};

/**
 * An in-memory `api.mySignatures(slug)`: Jamie Sample's requests at `lvp`. Firm Sign is off for
 * every other firm, and everywhere with NEXT_PUBLIC_API_MOCK_ESIGN=off (`status()` says so; the
 * other calls answer 404).
 */
export function createMySignaturesMock(firmSlug: string): MySignaturesClient {
  const slug = firmSlug.toLowerCase();
  const enabled = !ESIGN_OFF && slug === mockBusiness.slug;
  const on = async () => {
    await mockDelay();
    if (!enabled) throw fail(404, 'NOT_FOUND', 'Not found');
  };
  const mine = (recipientId: string) => {
    const r = MY_ROWS().find((x) => x.recipientId === recipientId);
    if (!r) throw fail(404, 'NOT_FOUND', 'Not found');
    return r;
  };
  return {
    status: async () => {
      await mockDelay();
      return { enabled };
    },
    list: async (query = {}) => {
      const { tab } = parseInput(ListMySignaturesQuery, query);
      await on();
      const pending = (r: MySignatureRow) => ['ACTION_NEEDED', 'WAITING'].includes(r.state);
      return { items: MY_ROWS().filter((r) => (tab === 'PENDING') === pending(r)) };
    },
    startSigning: async (recipientId) => {
      await on();
      if (mine(recipientId).state !== 'ACTION_NEEDED') throw linkInvalid();
      const s = newSession('portal');
      sessions().set(slug, s);
      return signerState(s);
    },
    download: async (recipientId, file) => {
      parseInput(SignerCopyFile, file);
      await on();
      if (mine(recipientId).state !== 'COMPLETED') {
        throw fail(409, 'INVALID_STATE', 'Not completed');
      }
      return { url: SAMPLE_PDF_URL, expiresAt: iso(Date.now() + 5 * MINUTE) };
    },
  };
}

// ---------- Settings and templates on api.esign ----------
type AdminKeys = 'saveAsTemplate' | 'settings' | 'templates';
/** Contract 3's calls, mocked in mocks/esign-extras.ts. */
export type ExtrasKeys =
  | 'saveAsVersion'
  | 'submitForApproval'
  | 'decideApproval'
  | 'inPerson'
  | 'roles'
  | 'bulk'
  | 'report';
export type TemplateExtrasKeys = 'versions' | 'restoreVersion' | 'duplicate' | 'bulkSend';
/** The request calls of mocks/esign.ts, without settings, templates and the extras. */
export type EsignBaseClient = Omit<EsignClient, AdminKeys | ExtrasKeys>;
type AdminClient = Pick<EsignClient, 'saveAsTemplate' | 'settings'> & {
  templates: Omit<EsignClient['templates'], TemplateExtrasKeys>;
};

/** What the firm-side mock (mocks/esign.ts) shares with settings and templates. */
export interface EsignAdminContext {
  client: EsignBaseClient;
  on: () => Promise<void>;
  /** The request, if the caller may see it (404 otherwise). */
  find: (requestId: string) => EsignRequestDetail;
  /** The store's own copy of a request (to change it). */
  stored: (requestId: string) => EsignRequestDetail;
  record: (r: EsignRequestDetail, type: EsignEventType, extra?: Partial<EsignEvent>) => void;
  me: MemberRef;
  manager: boolean;
  newId: (prefix: string) => string;
}

interface AdminState {
  defaults: EsignDefaults;
  consents: EsignConsentVersion[];
  jobTitles: Map<string, string | null>;
}
let adminState: AdminState | undefined;
const admin = (): AdminState =>
  (adminState ??= {
    defaults: {
      expiryDays: 30,
      reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
      expiryWarningDays: 2,
      authMethod: 'EMAIL_CODE',
      requireApproval: false,
      emailMessage: null,
    },
    consents: [consentV1()],
    jobTitles: new Map(),
  });
let templates: EsignTemplateDetail[] | undefined;

/** The firm's Signing Settings defaults (for the readiness check in mocks/esign.ts). */
export const esignDefaults = () => admin().defaults;
/** The mock's templates (shared with mocks/esign-extras.ts). */
export const esignTemplateStore = (me: MemberRef): EsignTemplateDetail[] => templateFixtures(me);
const templateFixtures = (me: MemberRef): EsignTemplateDetail[] =>
  (templates ??= (
    [
      ['Tax Engagement Letter', 'Annual engagement letter for individual returns.'],
      ['Section 7216 Consent', null],
      ['Bookkeeping Services Agreement', 'Monthly bookkeeping terms.'],
    ] as [string, string | null][]
  ).map(([name, description], i): EsignTemplateDetail => ({
    id: uuid(0x7e0 + i),
    name,
    description,
    visibility: 'FIRM' as const,
    owner: me,
    pageCount: 2,
    roleCount: 2,
    version: 1,
    updatedAt: iso(Date.now() - (i + 1) * 7 * DAY),
    archivedAt: null,
    canEdit: true,
    packetUrl: SAMPLE_PDF_URL,
    pageSizes: [{ ...LETTER }, { ...LETTER }],
    roles: [
      {
        key: 'client',
        kind: 'SIGNER' as const,
        role: 'CLIENT' as const,
        roleLabel: null,
        routingOrder: 1,
        authMethod: 'EMAIL_CODE' as const,
        colorIndex: 0,
      },
      {
        key: 'preparer',
        kind: 'SIGNER' as const,
        role: 'PREPARER' as const,
        roleLabel: null,
        routingOrder: 2,
        authMethod: 'EMAIL_CODE' as const,
        colorIndex: 1,
      },
    ],
    fields: [
      {
        id: uuid(0x7f0 + i * 4),
        roleKey: 'client',
        type: 'SIGNATURE' as const,
        pageIndex: 1,
        x: 0.1,
        y: 0.8,
        w: 0.3,
        h: 0.05,
        required: true,
        label: null,
        mergeKey: null,
        options: [],
        groupKey: null,
        value: null,
      },
      {
        id: uuid(0x7f1 + i * 4),
        roleKey: 'client',
        type: 'DATE_SIGNED' as const,
        pageIndex: 1,
        x: 0.5,
        y: 0.8,
        w: 0.2,
        h: 0.04,
        required: true,
        label: null,
        mergeKey: null,
        options: [],
        groupKey: null,
        value: null,
      },
      {
        id: uuid(0x7f2 + i * 4),
        roleKey: 'preparer',
        type: 'SIGNATURE' as const,
        pageIndex: 1,
        x: 0.1,
        y: 0.9,
        w: 0.3,
        h: 0.05,
        required: true,
        label: null,
        mergeKey: null,
        options: [],
        groupKey: null,
        value: null,
      },
      {
        id: uuid(0x7f3 + i * 4),
        roleKey: null,
        type: 'TEXT' as const,
        pageIndex: 0,
        x: 0.1,
        y: 0.2,
        w: 0.4,
        h: 0.04,
        required: true,
        label: 'Client name',
        mergeKey: 'CLIENT_FULL_NAME' as const,
        options: [],
        groupKey: null,
        value: null,
      },
    ],
    routing: 'SEQUENTIAL' as const,
    expiryDays: 30,
    reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
    expiryWarningDays: 2,
    emailSubject: null,
    emailMessage: null,
  })));

/** Signing Settings, templates and save-as-template for the firm-side mock. */
export function esignAdminMock(ctx: EsignAdminContext): AdminClient {
  const forbidden = () => fail(403, 'FORBIDDEN', 'Only an Owner or Admin can change this');
  const settingsView = () => ({
    defaults: copy(admin().defaults),
    consent: copy(admin().consents[0] ?? null),
    canEdit: ctx.manager,
    myJobTitle: admin().jobTitles.get(ctx.me.userId) ?? null,
  });
  const all = () => templateFixtures(ctx.me);
  const visibleTemplate = (t: EsignTemplateDetail) =>
    t.visibility === 'FIRM' || t.owner.userId === ctx.me.userId || ctx.manager;
  const template = (templateId: string) => {
    const tid = parseInput(EsignTemplateId, templateId);
    const t = all().find((x) => x.id === tid && visibleTemplate(x));
    if (!t) throw fail(404, 'NOT_FOUND', 'Not found');
    return t;
  };
  const nameTaken = (name: string, except?: string) =>
    all().some(
      (t) => !t.archivedAt && t.id !== except && t.name.toLowerCase() === name.toLowerCase(),
    );
  const editable = (t: EsignTemplateDetail) => {
    if (!(ctx.manager || t.owner.userId === ctx.me.userId)) throw forbidden();
    if (t.archivedAt) throw fail(409, 'TEMPLATE_ARCHIVED', 'This template is archived');
  };
  const rowOf = (t: EsignTemplateDetail) => {
    const { packetUrl: _p, pageSizes: _s, roles: _r, fields: _f, ...rest } = t;
    void [_p, _s, _r, _f];
    return { ...copy(rest), canEdit: ctx.manager || t.owner.userId === ctx.me.userId };
  };

  return {
    saveAsTemplate: async (requestId, body) => {
      const input = parseInput(SaveEsignTemplateBody, body);
      await ctx.on();
      const r = ctx.find(requestId);
      if (r.documents.some((d) => d.scanStatus !== 'CLEAN')) {
        throw fail(409, 'SCAN_PENDING', 'A file is still being checked');
      }
      if (r.pagePlan.length === 0) throw fail(409, 'INVALID_STATE', 'Add a document first');
      if (nameTaken(input.name)) throw fail(409, 'TEMPLATE_NAME_TAKEN', 'Name taken');
      const keyOf = (recipientId: string | null) => {
        const i = r.recipients.findIndex((x) => x.id === recipientId);
        return i < 0 ? null : `role-${i + 1}`;
      };
      const t: EsignTemplateDetail = {
        id: ctx.newId('8'),
        name: input.name,
        description: input.description ?? null,
        visibility: input.visibility ?? 'FIRM',
        owner: ctx.me,
        pageCount: r.pagePlan.length,
        roleCount: r.recipients.length,
        version: 1,
        updatedAt: iso(Date.now()),
        archivedAt: null,
        canEdit: true,
        packetUrl: SAMPLE_PDF_URL,
        pageSizes: r.pagePlan.map(() => ({ ...LETTER })),
        roles: r.recipients.map((x, i) => ({
          key: `role-${i + 1}`,
          kind: x.kind,
          role: x.role,
          roleLabel: x.roleLabel,
          routingOrder: x.routingOrder,
          authMethod: x.authMethod,
          colorIndex: x.colorIndex,
        })),
        fields: r.fields.map((f) => ({
          id: ctx.newId('9'),
          roleKey: keyOf(f.recipientId),
          type: f.type,
          pageIndex: f.pageIndex,
          x: f.x,
          y: f.y,
          w: f.w,
          h: f.h,
          required: f.required,
          label: f.label,
          mergeKey: f.mergeKey,
          options: [...f.options],
          groupKey: f.groupKey,
          value: f.mergeKey ? null : f.value,
        })),
        routing: r.routing,
        expiryDays: r.expiryDays,
        reminders: { ...r.reminders },
        expiryWarningDays: r.expiryWarningDays,
        emailSubject: r.emailSubject,
        emailMessage: r.emailMessage,
      };
      all().unshift(t);
      return copy(t);
    },

    settings: {
      get: async () => {
        await ctx.on();
        return settingsView();
      },
      update: async (body) => {
        const input = parseInput(UpdateEsignSettingsBody, body);
        await ctx.on();
        if (!ctx.manager) throw forbidden();
        admin().defaults = {
          ...admin().defaults,
          ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        };
        return settingsView();
      },
      consentVersions: async () => {
        await ctx.on();
        return { items: copy(admin().consents) };
      },
      publishConsent: async (body) => {
        const { bodyMarkdown } = parseInput(PublishEsignConsentBody, body);
        await ctx.on();
        if (!ctx.manager) throw forbidden();
        const v: EsignConsentVersion = {
          id: ctx.newId('a'),
          version: (admin().consents[0]?.version ?? 0) + 1,
          bodyMarkdown,
          sha256: 'c1'.repeat(32),
          publishedAt: iso(Date.now()),
          publishedBy: ctx.me,
        };
        admin().consents.unshift(v);
        return copy(v);
      },
      updateMyProfile: async (body) => {
        const { jobTitle } = parseInput(UpdateEsignProfileBody, body);
        await ctx.on();
        admin().jobTitles.set(ctx.me.userId, jobTitle ?? null);
        return settingsView();
      },
    },

    templates: {
      list: async (query = {}) => {
        const { q, archived } = parseInput(ListEsignTemplatesQuery, query);
        await ctx.on();
        const needle = q?.toLowerCase();
        return {
          items: all()
            .filter(visibleTemplate)
            .filter((t) => (archived ? t.archivedAt !== null : t.archivedAt === null))
            .filter((t) => !needle || t.name.toLowerCase().includes(needle))
            .map(rowOf),
        };
      },
      get: async (templateId) => {
        await ctx.on();
        return copy({ ...template(templateId), canEdit: rowOf(template(templateId)).canEdit });
      },
      update: async (templateId, body) => {
        const input = parseInput(UpdateEsignTemplateBody, body);
        await ctx.on();
        const t = template(templateId);
        editable(t);
        if (input.name && nameTaken(input.name, t.id)) {
          throw fail(409, 'TEMPLATE_NAME_TAKEN', 'Name taken');
        }
        if (input.name) t.name = input.name;
        if (input.description !== undefined) t.description = input.description;
        if (input.visibility) t.visibility = input.visibility;
        t.updatedAt = iso(Date.now());
        return copy(t);
      },
      archive: async (templateId) => {
        await ctx.on();
        const t = template(templateId);
        editable(t);
        t.archivedAt = iso(Date.now());
        return copy(t);
      },
      use: async (templateId, body) => {
        const input = parseInput(UseEsignTemplateBody, body);
        await ctx.on();
        const t = template(templateId);
        if (t.archivedAt) throw fail(409, 'TEMPLATE_ARCHIVED', 'This template is archived');
        const given = new Map(input.roles.map((r) => [r.key, r.who]));
        const logins = clientFixtures().find((c) => c.id === input.clientId)?.portalLogins ?? [];
        const login = (portalRole: string) =>
          logins.find((l) => l.portalRole === portalRole && l.status === 'ACTIVE');
        const auto = (role: EsignTemplateRole): EsignPutRecipient['who'] | undefined => {
          const l =
            role.role === 'CLIENT'
              ? login('PRIMARY')
              : role.role === 'SPOUSE'
                ? login('SPOUSE')
                : undefined;
          if (l) return { type: 'CLIENT_LOGIN', clientAccountId: l.clientAccountId };
          if (role.role === 'PREPARER') return { type: 'STAFF', userId: ctx.me.userId };
          return undefined;
        };
        const who = new Map(t.roles.map((role) => [role.key, given.get(role.key) ?? auto(role)]));
        const open = t.roles.filter((role) => !who.get(role.key));
        if (open.length > 0) {
          throw fail(
            409,
            'TEMPLATE_ROLES_UNFILLED',
            `Choose who fills: ${open.map((role) => role.key).join(', ')}`,
          );
        }
        const created = await ctx.client.create({
          title: input.title ?? t.name,
          clientId: input.clientId,
          engagementId: input.engagementId,
        });
        const r = ctx.stored(created.id);
        r.source = 'TEMPLATE';
        r.template = { id: t.id, version: t.version };
        const docId = ctx.newId('b');
        r.documents = [
          {
            id: docId,
            position: 0,
            fileName: `${t.name}.pdf`,
            contentType: 'application/pdf',
            sizeBytes: 1209,
            pageCount: t.pageCount,
            pageSizes: t.pageSizes.map((size) => ({ ...size })),
            sourceDocumentId: null,
            scanStatus: 'CLEAN',
            createdAt: created.createdAt,
          },
        ];
        r.pagePlan = t.pageSizes.map((_, page) => ({ documentId: docId, page, rotation: 0 }));
        r.routing = t.routing;
        r.expiryDays = t.expiryDays;
        r.reminders = { ...t.reminders };
        r.expiryWarningDays = t.expiryWarningDays;
        r.emailSubject = t.emailSubject;
        r.emailMessage = t.emailMessage;
        // The mock's own recipients and fields calls check and fill in the rest, as the API does.
        const withRecipients = await ctx.client.putRecipients(r.id, {
          recipients: t.roles.map((role) => ({
            kind: role.kind,
            role: role.role,
            roleLabel: role.roleLabel ?? undefined,
            routingOrder: role.routingOrder,
            who: who.get(role.key)!,
            authMethod: role.authMethod === 'ACCESS_CODE' ? 'EMAIL_CODE' : role.authMethod,
          })),
        });
        const recipientOf = new Map(
          t.roles.map((role, i) => [role.key, withRecipients.recipients[i]?.id ?? null]),
        );
        await ctx.client.putFields(r.id, {
          fields: t.fields.map((f) => ({
            recipientId: f.roleKey ? (recipientOf.get(f.roleKey) ?? null) : null,
            type: f.type,
            pageIndex: f.pageIndex,
            x: f.x,
            y: f.y,
            w: f.w,
            h: f.h,
            required: f.required,
            label: f.label ?? undefined,
            mergeKey: f.mergeKey ?? undefined,
            options: f.options.length > 0 ? f.options : undefined,
            groupKey: f.groupKey ?? undefined,
            value: f.value ?? undefined,
          })),
        });
        ctx.record(r, 'EDITED');
        return ctx.client.get(r.id);
      },
    },
  };
}
