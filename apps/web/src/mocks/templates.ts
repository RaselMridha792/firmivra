import {
  ApiRequestError,
  ArchiveMessageTemplateRequest,
  BulkTemplatesRequest,
  ConfirmUploadRequest,
  CreateMessageTemplateRequest,
  CreateTemplateCategoryRequest,
  ImportTemplateRequest,
  MergeTemplateCategoryRequest,
  MessageTemplatesQuery,
  parseInput,
  PreviewTemplateRequest,
  ReorderTemplateCategoriesRequest,
  SaveCustomMergeFieldRequest,
  SaveTemplateBrandingRequest,
  SetTemplateSharesRequest,
  StartTemplateAttachmentRequest,
  TemplateCategoriesQuery,
  TestSendTemplateRequest,
  UpdateMessageTemplateRequest,
  UpdateTemplateCategoryRequest,
  type MemberRef,
  type MergeField,
  type MessageTemplateDetail,
  type MessageTemplateKind,
  type MessageTemplateRow,
  type TemplateBranding,
  type TemplateCategory,
  type TemplatesClient,
  type TemplateVersion,
  STARTER_TEMPLATES,
  type StarterTemplate,
  BookkeepingStructure,
  type LinkedModuleTemplate,
  TaxWorkflowStructure,
  TemplateStructureOptionsQuery,
  SetLinkedTemplateRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';
import { teamFixtures } from './team';

/**
 * Mock data for `api.templates` (R55 contract, Templates). Synthetic text only. It checks input
 * with the contract's schemas and answers its codes: DUPLICATE_NAME, SAVE_CONFLICT,
 * AUTOMATION_IN_USE, CATEGORY_NOT_ALLOWED, SUBJECT_REQUIRED, NOT_AUTOMATION_ELIGIBLE,
 * NOT_A_MEMBER, NOT_THE_OWNER, TEMPLATE_ARCHIVED, FIELD_IN_USE, TEST_SEND_REFUSED. The 48 starter
 * templates of the guide are installed at the start; `empty: true`
 * (NEXT_PUBLIC_API_MOCK_EMPTY=templates) starts with none so "Install starter templates" shows.
 */
type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

const uuid = (block: string, n: number) =>
  `0199c0f0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(value: T): T => structuredClone(value);
const nowIso = () => new Date().toISOString();
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const OTHER: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000001', name: 'Team Member' };
const KEVIN: MemberRef = { userId: '0199c0f0-0b00-7000-8000-000000000002', name: 'Kevin Martin' };
const memberOf = (userId: string): MemberRef | undefined => {
  const known = [mockMe, OTHER, KEVIN].find((m) => m.userId === userId);
  if (known) return known;
  const mate = teamFixtures().find((m) => m.user.id === userId);
  return mate ? { userId, name: mate.user.name } : undefined;
};

const NEEDS_SUBJECT: MessageTemplateKind[] = ['EMAIL', 'CAMPAIGN', 'LETTER_NOTICE', 'ANNOUNCEMENT'];
const AUTOMATION_KINDS: MessageTemplateKind[] = [
  'EMAIL',
  'SMS',
  'PORTAL_MESSAGE',
  'DOCUMENT_REQUEST',
  'APPOINTMENT',
  'INVOICE_PAYMENT',
  'LEAD_FOLLOW_UP',
  'BOOKKEEPING',
  'PAYROLL',
  'TASK',
];

const FIELD_DEFS: [MergeField['group'], string, string, string][] = [
  ['CLIENT', 'Client First Name', 'First name of client', 'Jamie'],
  ['CLIENT', 'Client Last Name', 'Last name of client', 'Sample'],
  ['CLIENT', 'Client Full Name', 'Full name of client', 'Jamie Sample'],
  ['CLIENT', 'Email Address', 'Client email address', 'jamie@example.test'],
  ['CLIENT', 'Phone Number', 'Client phone number', '(555) 010-0101'],
  [
    'CLIENT',
    'Client Portal Link',
    'Secure link to the client portal',
    'https://portal.example.test/lvp',
  ],
  ['COMPANY', 'Business Name', 'Your firm’s name', 'LVP Accounting & Taxes'],
  ['COMPANY', 'Company Phone', 'Your firm’s phone', '(555) 010-0200'],
  ['COMPANY', 'Company Email', 'Your firm’s email', 'hello@example.test'],
  ['COMPANY', 'Company Website', 'Your firm’s website', 'https://example.test'],
  ['COMPANY', 'Company Address', 'Your firm’s address', '100 Main Street'],
  ['STAFF', 'Staff Name', 'Name of the staff member', 'Kevin Martin'],
  ['STAFF', 'Your Name', 'Name of the sender', 'Kevin Martin'],
  ['STAFF', 'Preparer Name', 'Name of the preparer', 'Alicia Park'],
  ['STAFF', 'Staff Email', 'Email of the staff member', 'kevin@example.test'],
  ['STAFF', 'Staff Phone', 'Phone of the staff member', '(555) 010-0300'],
  ['APPOINTMENT', 'Appointment Date', 'Upcoming appointment date', 'Nov 4, 2026'],
  ['APPOINTMENT', 'Appointment Time', 'Upcoming appointment time', '10:00 AM'],
  ['APPOINTMENT', 'Appointment Type', 'Type of appointment', 'Tax Consultation'],
  ['APPOINTMENT', 'Appointment Location', 'Location or meeting link', 'Video call'],
  [
    'APPOINTMENT',
    'Reschedule Link',
    'Link to reschedule',
    'https://portal.example.test/reschedule',
  ],
  ['INVOICE', 'Invoice Number', 'Invoice number', 'INV-1042'],
  ['INVOICE', 'Invoice Date', 'Invoice date', 'Oct 1, 2026'],
  ['INVOICE', 'Due Date', 'Invoice due date', 'Oct 31, 2026'],
  ['INVOICE', 'Balance Due', 'Current outstanding balance', '$450.00'],
  ['INVOICE', 'Payment Link', 'Secure payment link', 'https://portal.example.test/pay'],
  ['INVOICE', 'Payment Status', 'Payment status', 'Unpaid'],
  ['TAX', 'Tax Year', 'Tax year (e.g., 2025)', '2025'],
  ['TAX', 'Return Type', 'Type of return', 'Form 1040'],
  ['TAX', 'Organizer Link', 'Link to the tax organizer', 'https://portal.example.test/organizer'],
  ['TAX', 'Document Upload Link', 'Secure upload link', 'https://portal.example.test/upload'],
  ['TAX', 'Signature Link', 'Link to sign', 'https://portal.example.test/sign'],
  ['WORKFLOW', 'Task Name', 'Name of the task', 'Collect W-2 forms'],
  ['WORKFLOW', 'Service Name', 'Name of the service', 'Tax Preparation'],
  [
    'WORKFLOW',
    'Portal Message Link',
    'Link to the portal message',
    'https://portal.example.test/messages',
  ],
];

interface Rec {
  d: MessageTemplateDetail;
  versions: TemplateVersion[];
  favorite: boolean;
}
interface Custom extends MergeField {
  customId: string;
}

const TOKEN = /\[([^\]\n]{1,60})\]/g;

export function createTemplatesMock({
  role = 'OWNER',
  empty = false,
}: Options = {}): TemplatesClient {
  let next = 1000;
  const id = (block: string) => uuid(block, next++);
  const run = async <T>(work: () => T): Promise<T> => {
    await mockDelay();
    return copy(work());
  };
  const manage = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };

  const categories: TemplateCategory[] = [];
  const recs: Rec[] = [];
  const customs: Custom[] = [];
  let branding: TemplateBranding = {
    footerText: 'LVP Accounting & Taxes · 100 Main Street',
    disclaimer: 'This message is for the intended client only.',
    signatureText: 'Best regards,\nThe LVP team',
    letterheadEnabled: true,
    businessName: 'LVP Accounting & Taxes',
    logoUrl: null,
    updatedAt: null,
  };
  const pending = new Map<
    string,
    { templateId: string; fileName: string; contentType: string; sizeBytes: number }
  >();

  const ensureCategory = (kind: MessageTemplateKind, name: string): TemplateCategory => {
    const hit = categories.find((c) => c.kind === kind && c.name === name);
    if (hit) return hit;
    const c: TemplateCategory = {
      id: id('7200'),
      kind,
      name,
      description: null,
      sortOrder: categories.filter((x) => x.kind === kind).length,
      archivedAt: null,
      templateCount: 0,
    };
    categories.push(c);
    return c;
  };
  const known = () => [...FIELD_DEFS.map(([, key]) => key), ...customs.map((c) => c.key)];
  const analyze = (text: string) => {
    const keys = new Set(known().map((k) => k.toLowerCase()));
    const used: string[] = [];
    const unknown: string[] = [];
    for (const m of text.matchAll(TOKEN)) {
      const k = m[1]!.trim();
      (keys.has(k.toLowerCase()) ? used : unknown).push(k);
    }
    return { used: [...new Set(used)], unknown: [...new Set(unknown)] };
  };
  const html = (p: string) =>
    `<p>Hi [Client First Name],</p><p>${p}</p><p>Best regards,<br>[Staff Name]<br>[Business Name]</p>`;
  const plain = (p: string) => `Hi [Client First Name], ${p} - [Business Name]`;

  const build = (v: {
    kind: MessageTemplateKind;
    name: string;
    subject: string | null;
    body: string;
    categoryId?: string | null;
    description?: string | null;
    tags?: string[];
    owner?: MemberRef;
    status?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    access?: 'PRIVATE' | 'TEAM' | 'SELECTED';
    starter?: boolean;
    automations?: boolean;
    automationCount?: number;
    uses?: number;
    days?: number;
    favorite?: boolean;
    sharedWith?: MemberRef[];
  }): Rec => {
    const cat = categories.find((c) => c.id === v.categoryId) ?? null;
    const at = ago(v.days ?? 3);
    const owner = v.owner ?? mockMe;
    const d: MessageTemplateDetail = {
      id: id('7100'),
      kind: v.kind,
      category: cat ? { id: cat.id, name: cat.name } : null,
      name: v.name,
      description: v.description ?? null,
      subject: v.subject,
      tags: v.tags ?? [],
      status: v.status ?? 'ACTIVE',
      access: v.access ?? 'TEAM',
      starter: v.starter ?? false,
      includeInAutomations: v.automations ?? false,
      owner,
      updatedBy: owner,
      version: 1,
      favorite: false,
      useCount: v.uses ?? 0,
      updatedAt: at,
      previewText: null,
      body: v.body,
      sharedWith: v.sharedWith ?? [],
      attachments: [],
      mergeFields: analyze(`${v.subject ?? ''} ${v.body}`),
      automationCount: v.automationCount ?? 0,
      lastUsedAt: v.uses ? at : null,
      createdAt: at,
      etag: `e${next++}`,
      linkedTemplate: null,
      structure: null,
    };
    return {
      d,
      favorite: v.favorite ?? false,
      versions: [
        { version: 1, name: v.name, savedBy: owner, savedAt: at, subject: v.subject, body: v.body },
      ],
    };
  };
  /** TP-F18: the API's own 48 (STARTER_TEMPLATES), with some variety in owners and use. */
  const addStarter = (s: StarterTemplate, n: number) => {
    const num = n + 1;
    const { kind } = s;
    const cat = ensureCategory(kind, s.category);
    recs.push(
      build({
        kind,
        name: s.name,
        subject: s.subject ?? null,
        body: s.body,
        categoryId: cat.id,
        description: s.description,
        tags: [s.category],
        owner: num % 3 === 0 ? OTHER : mockMe,
        starter: true,
        automations: AUTOMATION_KINDS.includes(kind) && num % 4 === 0,
        automationCount: AUTOMATION_KINDS.includes(kind) && num % 4 === 0 ? 1 : 0,
        uses: (num * 37) % 210,
        days: 1 + (n % 40),
        favorite: num % 9 === 1,
      }),
    );
  };
  const installStarters = () => {
    let added = 0;
    let there = 0;
    STARTER_TEMPLATES.forEach((s, n) => {
      if (recs.some((r) => r.d.starter && r.d.name === s.name)) there += 1;
      else {
        addStarter(s, n);
        added += 1;
      }
    });
    return { installed: added, alreadyThere: there };
  };
  if (!empty) {
    installStarters();
    const sms = ensureCategory('SMS', 'Reminders');
    const quick = ensureCategory('SMS', 'Quick Replies');
    recs.push(
      build({
        kind: 'SMS',
        name: 'Appointment Reminder Text',
        subject: null,
        body: plain('your appointment is tomorrow at [Appointment Time].'),
        categoryId: sms.id,
        tags: ['Reminder'],
        automations: true,
        automationCount: 2,
        uses: 88,
        days: 2,
      }),
      build({
        kind: 'SMS',
        name: 'Missing Documents Text',
        subject: null,
        body: plain('we still need a few documents. Upload: [Document Upload Link]'),
        categoryId: sms.id,
        tags: ['Documents'],
        uses: 41,
        days: 6,
        favorite: true,
      }),
      build({
        kind: 'SMS',
        name: 'Thanks, Received',
        subject: null,
        body: plain('thanks, we received it.'),
        categoryId: quick.id,
        owner: OTHER,
        access: 'TEAM',
        uses: 12,
        days: 9,
      }),
      build({
        kind: 'EMAIL',
        name: 'Tax Season Reminder (2026)',
        subject: 'It’s almost tax season – let’s get prepared!',
        body: '<p>Hi [Client First Name],</p><p>Tax season is approaching and we want to help you get prepared!</p><ul><li>W-2 and 1099 forms</li><li>Business income and expense records</li></ul><p>Upload here: [Document Upload Link]</p><p>Best regards,<br>[Your Name]<br>[Business Name]<br>Phone: [Company Phone]</p>',
        categoryId: ensureCategory('EMAIL', 'Tax Season').id,
        tags: ['Tax Season', 'Reminder'],
        automations: true,
        automationCount: 1,
        uses: 124,
        days: 1,
      }),
      build({
        kind: 'EMAIL',
        name: 'Private Draft Idea',
        subject: null,
        body: '<p>Draft only for me [Unknown Field]</p>',
        categoryId: ensureCategory('EMAIL', 'Client Communications').id,
        status: 'DRAFT',
        access: 'PRIVATE',
        days: 0,
      }),
      build({
        kind: 'EMAIL',
        name: 'Referral Thank You',
        subject: 'Thank you for the referral',
        body: html('Thank you for referring a friend.'),
        categoryId: ensureCategory('EMAIL', 'Marketing').id,
        owner: KEVIN,
        access: 'SELECTED',
        sharedWith: [mockMe],
        tags: ['Referral'],
        uses: 9,
        days: 12,
      }),
    );
    categories.forEach((c) => {
      c.templateCount = 0;
    });
  }

  const find = (templateId: string) => {
    const r = recs.find((x) => x.d.id === templateId);
    if (!r) throw fail(404, 'NOT_FOUND', 'That template was not found.');
    return r;
  };
  const mine = (r: Rec) => r.d.owner.userId === mockMe.userId;
  const sharedWithMe = (r: Rec) =>
    !mine(r) && (r.d.access === 'TEAM' || r.d.sharedWith.some((m) => m.userId === mockMe.userId));
  const visible = (r: Rec) => mine(r) || r.d.access === 'TEAM' || sharedWithMe(r);
  const canEdit = (r: Rec) => mine(r) || role !== 'STAFF';
  const needEdit = (r: Rec) => {
    if (!canEdit(r)) throw fail(403, 'NOT_THE_OWNER', 'Only the owner can change this template.');
  };
  const recount = () => {
    for (const c of categories) {
      c.templateCount = recs.filter(
        (r) => r.d.category?.id === c.id && r.d.status !== 'ARCHIVED' && visible(r),
      ).length;
    }
  };
  const rowOf = (r: Rec): MessageTemplateRow => {
    const {
      previewText,
      body,
      sharedWith,
      attachments,
      mergeFields,
      automationCount,
      lastUsedAt,
      createdAt,
      etag,
      ...row
    } = r.d;
    void previewText;
    void body;
    void sharedWith;
    void attachments;
    void mergeFields;
    void automationCount;
    void lastUsedAt;
    void createdAt;
    void etag;
    return { ...row, favorite: r.favorite };
  };
  const detailOf = (r: Rec): MessageTemplateDetail => ({ ...r.d, favorite: r.favorite });

  /** TP-F08: the firm's task templates, request lists and intake templates (synthetic). */
  const MODULE_TEMPLATES: LinkedModuleTemplate[] = [
    {
      kind: 'TASK',
      id: id('7500'),
      name: 'New client onboarding',
      steps: [
        'Confirm contact details',
        'Send the engagement letter',
        'Request ID',
        'Open the file',
      ],
    },
    {
      kind: 'TASK',
      id: id('7500'),
      name: 'Return review',
      steps: ['Check income and deductions', 'Review with the client', 'Collect signatures'],
    },
    {
      kind: 'DOCUMENT_REQUEST',
      id: id('7500'),
      name: 'Individual tax documents',
      steps: ['W-2 forms', '1099 forms', 'Prior-year return', 'Charitable receipts (optional)'],
    },
    {
      kind: 'DOCUMENT_REQUEST',
      id: id('7500'),
      name: 'Monthly bookkeeping',
      steps: ['Bank statements', 'Card statements', 'Receipts (optional)'],
    },
    {
      kind: 'INTAKE_ORGANIZER',
      id: id('7500'),
      name: 'Individual Tax Preparation intake',
      steps: ['Individual tax organizer'],
    },
  ];
  const LINKED_KINDS: readonly MessageTemplateKind[] = [
    'TASK',
    'DOCUMENT_REQUEST',
    'INTAKE_ORGANIZER',
  ];
  /** As the API: PUT .../linked-template, on its kind, one of the firm's, used by one template. */
  const linkTo = (r: Pick<Rec, 'd'>, moduleTemplateId: string | null) => {
    if (!LINKED_KINDS.includes(r.d.kind))
      throw fail(
        400,
        'VALIDATION_FAILED',
        'Only a task, document request or intake template stands for one',
      );
    if (moduleTemplateId === null) {
      r.d.linkedTemplate = null;
      return;
    }
    const m = MODULE_TEMPLATES.find((x) => x.id === moduleTemplateId && x.kind === r.d.kind);
    if (!m) throw fail(404, 'NOT_FOUND', 'That template was not found');
    if (recs.some((o) => o.d.id !== r.d.id && o.d.linkedTemplate?.id === moduleTemplateId))
      throw fail(409, 'STRUCTURE_IN_USE', 'Another template already stands for this one');
    r.d.linkedTemplate = m;
  };
  /** As the API: a structure only on Tax Workflow and Bookkeeping, of their shape. */
  const applyStructure = (r: Pick<Rec, 'd'>, input: { structure?: unknown }) => {
    if (input.structure !== undefined) {
      const shape =
        r.d.kind === 'TAX_WORKFLOW'
          ? TaxWorkflowStructure
          : r.d.kind === 'BOOKKEEPING'
            ? BookkeepingStructure
            : null;
      if (input.structure === null) r.d.structure = null;
      else if (!shape)
        throw fail(400, 'VALIDATION_FAILED', 'Only its own kind of template has this');
      else {
        const parsed = shape.safeParse(input.structure);
        if (!parsed.success) throw fail(400, 'VALIDATION_FAILED', 'Check the structure');
        r.d.structure = parsed.data;
      }
    }
  };
  const categoryOk = (kind: MessageTemplateKind, categoryId: string | null | undefined) => {
    if (!categoryId) return null;
    const c = categories.find((x) => x.id === categoryId);
    if (!c) throw fail(404, 'NOT_FOUND', 'That category was not found.');
    if (c.kind !== kind || c.archivedAt) {
      throw fail(
        409,
        'CATEGORY_NOT_ALLOWED',
        'That category does not belong to this kind of template.',
      );
    }
    return c;
  };
  const uniqueName = (kind: MessageTemplateKind, name: string, except?: string) => {
    if (
      recs.some(
        (r) =>
          r.d.id !== except &&
          r.d.kind === kind &&
          r.d.status !== 'ARCHIVED' &&
          r.d.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      throw fail(409, 'DUPLICATE_NAME', 'A template with this name already exists.');
    }
  };
  const checkRules = (
    kind: MessageTemplateKind,
    status: string,
    subject: string | null,
    automations: boolean,
  ) => {
    if (status === 'ACTIVE' && NEEDS_SUBJECT.includes(kind) && !(subject ?? '').trim()) {
      throw fail(400, 'SUBJECT_REQUIRED', 'Add a subject line before activating this template.');
    }
    if (automations && !AUTOMATION_KINDS.includes(kind)) {
      throw fail(
        409,
        'NOT_AUTOMATION_ELIGIBLE',
        'This kind of template cannot be used in automations.',
      );
    }
  };
  const bump = (r: Rec, note?: boolean) => {
    r.d.version += 1;
    r.d.etag = `e${next++}`;
    r.d.updatedAt = nowIso();
    r.d.updatedBy = mockMe;
    r.d.mergeFields = analyze(`${r.d.subject ?? ''} ${r.d.body}`);
    if (note !== false) {
      r.versions.unshift({
        version: r.d.version,
        name: r.d.name,
        savedBy: mockMe,
        savedAt: r.d.updatedAt,
        subject: r.d.subject,
        body: r.d.body,
      });
    }
  };
  const render = (text: string, sample: Record<string, string> = {}) => {
    const unresolved: string[] = [];
    const byKey = new Map<string, string>();
    for (const [, key, , example] of FIELD_DEFS) byKey.set(key.toLowerCase(), example);
    for (const c of customs) byKey.set(c.key.toLowerCase(), c.fallback ?? c.example);
    for (const [k, v] of Object.entries(sample)) byKey.set(k.toLowerCase(), v);
    const out = text.replace(TOKEN, (whole, key: string) => {
      const v = byKey.get(key.trim().toLowerCase());
      if (v === undefined) {
        unresolved.push(key.trim());
        return whole;
      }
      return v;
    });
    return { out, unresolved };
  };
  const sanitize = (content: string) => {
    let removed = 0;
    const clean = content
      .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, () => {
        removed += 1;
        return '';
      })
      .replace(/\son\w+="[^"]*"/gi, () => {
        removed += 1;
        return '';
      });
    return { clean, removed };
  };

  return {
    summary: () =>
      run(() => {
        recount();
        const vis = recs.filter((r) => visible(r) && r.d.status !== 'ARCHIVED');
        const kinds = new Set(recs.map((r) => r.d.kind));
        return {
          total: vis.length,
          mine: vis.filter(mine).length,
          shared: vis.filter(sharedWithMe).length,
          favorites: vis.filter((r) => r.favorite).length,
          categories: categories.filter((c) => !c.archivedAt),
          uncategorized: [...kinds].map((kind) => ({
            kind,
            templateCount: vis.filter((r) => r.d.kind === kind && !r.d.category).length,
          })),
          recent: [...vis]
            .sort((a, b) => b.d.updatedAt.localeCompare(a.d.updatedAt))
            .slice(0, 5)
            .map(rowOf),
        };
      }),
    list: (q = {}) =>
      run(() => {
        const query = parseInput(MessageTemplatesQuery, q);
        const term = query.search?.toLowerCase();
        let rows = recs.filter((r) => visible(r));
        rows = rows.filter((r) =>
          query.status ? r.d.status === query.status : r.d.status !== 'ARCHIVED',
        );
        rows = rows.filter(
          (r) =>
            (query.tab === 'all' ||
              (query.tab === 'mine' && mine(r)) ||
              (query.tab === 'shared' && sharedWithMe(r)) ||
              (query.tab === 'favorites' && r.favorite)) &&
            (!query.kind || r.d.kind === query.kind) &&
            (!query.categoryId || r.d.category?.id === query.categoryId) &&
            (!query.ownerUserId || r.d.owner.userId === query.ownerUserId) &&
            (!query.tag || r.d.tags.some((t) => t.toLowerCase() === query.tag!.toLowerCase())) &&
            (query.automations === undefined || r.d.includeInAutomations === query.automations) &&
            (!term ||
              [r.d.name, r.d.description ?? '', r.d.subject ?? '', ...r.d.tags].some((v) =>
                v.toLowerCase().includes(term),
              )),
        );
        const key = {
          name: (r: Rec) => r.d.name.toLowerCase(),
          updated: (r: Rec) => r.d.updatedAt,
          category: (r: Rec) => r.d.category?.name ?? '',
          uses: (r: Rec) => r.d.useCount,
          status: (r: Rec) => r.d.status,
        }[query.sort];
        rows.sort((a, b) => {
          const x = key(a);
          const y = key(b);
          const c = x < y ? -1 : x > y ? 1 : 0;
          return query.direction === 'desc' ? -c : c;
        });
        const at = query.page;
        return {
          items: rows.slice((at - 1) * query.pageSize, at * query.pageSize).map(rowOf),
          total: rows.length,
          page: at,
          pageSize: query.pageSize,
        };
      }),
    get: (templateId) => run(() => detailOf(find(templateId))),
    create: (body) =>
      run(() => {
        const input = parseInput(CreateMessageTemplateRequest, body);
        categoryOk(input.kind, input.categoryId);
        uniqueName(input.kind, input.name);
        const status = input.status ?? 'DRAFT';
        // CM-F12, as the API: only an Owner or Admin makes a template active.
        if (status === 'ACTIVE' && role === 'STAFF')
          throw fail(
            403,
            'ACTIVATE_NOT_ALLOWED',
            'Only an Owner or an Admin can make a template active',
          );
        const subject = input.subject ?? null;
        checkRules(input.kind, status, subject, input.includeInAutomations ?? false);
        const shares = (input.sharedWithUserIds ?? []).map((u) => {
          const m = memberOf(u);
          if (!m) throw fail(409, 'NOT_A_MEMBER', 'That person is not on your team.');
          return m;
        });
        const r = build({
          kind: input.kind,
          name: input.name,
          subject,
          body: input.body,
          categoryId: input.categoryId ?? null,
          description: input.description ?? null,
          tags: input.tags ?? [],
          status,
          access: input.access ?? 'TEAM',
          automations: input.includeInAutomations ?? false,
          sharedWith: shares,
          days: 0,
        });
        r.d.previewText = input.previewText ?? null;
        applyStructure(r, input);
        recs.unshift(r);
        return detailOf(r);
      }),
    update: (templateId, body) =>
      run(() => {
        const input = parseInput(UpdateMessageTemplateRequest, body);
        const r = find(templateId);
        needEdit(r);
        if (r.d.status === 'ARCHIVED')
          throw fail(409, 'TEMPLATE_ARCHIVED', 'Restore the template before changing it.');
        if (input.etag !== r.d.etag)
          throw fail(409, 'SAVE_CONFLICT', 'Someone saved this template after you opened it.');
        const material =
          input.body !== undefined || input.subject !== undefined || input.status === 'DRAFT';
        if (material && r.d.automationCount > 0 && !input.confirmAutomationImpact) {
          throw fail(
            409,
            'AUTOMATION_IN_USE',
            `${r.d.automationCount} automation(s) use this template.`,
          );
        }
        const name = input.name ?? r.d.name;
        const kind = r.d.kind;
        if (input.name !== undefined) uniqueName(kind, name, r.d.id);
        if (input.categoryId !== undefined) {
          const c = categoryOk(kind, input.categoryId);
          r.d.category = c ? { id: c.id, name: c.name } : null;
        }
        const subject = input.subject === undefined ? r.d.subject : input.subject;
        const status = input.status ?? r.d.status;
        if (status === 'ACTIVE' && r.d.status !== 'ACTIVE' && role === 'STAFF')
          throw fail(
            403,
            'ACTIVATE_NOT_ALLOWED',
            'Only an Owner or an Admin can make a template active',
          );
        const auto = input.includeInAutomations ?? r.d.includeInAutomations;
        checkRules(kind, status, subject, auto);
        if (input.sharedWithUserIds) {
          r.d.sharedWith = input.sharedWithUserIds.map((u) => {
            const m = memberOf(u);
            if (!m) throw fail(409, 'NOT_A_MEMBER', 'That person is not on your team.');
            return m;
          });
        }
        const changedText =
          name !== r.d.name ||
          subject !== r.d.subject ||
          (input.body !== undefined && input.body !== r.d.body);
        r.d.name = name;
        r.d.subject = subject;
        if (input.body !== undefined) r.d.body = input.body;
        if (input.description !== undefined) r.d.description = input.description;
        if (input.previewText !== undefined) r.d.previewText = input.previewText;
        if (input.tags !== undefined) r.d.tags = input.tags;
        if (input.access !== undefined) r.d.access = input.access;
        r.d.status = status;
        r.d.includeInAutomations = auto;
        const structureBefore = JSON.stringify(r.d.structure);
        applyStructure(r, input);
        bump(r, changedText || JSON.stringify(r.d.structure) !== structureBefore);
        return detailOf(r);
      }),
    duplicate: (templateId) =>
      run(() => {
        const r = find(templateId);
        let name = `${r.d.name} (Copy)`;
        let n = 2;
        while (recs.some((x) => x.d.kind === r.d.kind && x.d.name === name))
          name = `${r.d.name} (Copy ${n++})`;
        const c = build({
          kind: r.d.kind,
          name,
          subject: r.d.subject,
          body: r.d.body,
          categoryId: r.d.category?.id ?? null,
          description: r.d.description,
          tags: [...r.d.tags],
          status: 'DRAFT',
          access: 'PRIVATE',
          days: 0,
        });
        recs.unshift(c);
        return detailOf(c);
      }),
    archive: (templateId, body = {}) =>
      run(() => {
        const input = parseInput(ArchiveMessageTemplateRequest, body);
        const r = find(templateId);
        needEdit(r);
        if (r.d.automationCount > 0 && !input.confirmAutomationImpact) {
          throw fail(
            409,
            'AUTOMATION_IN_USE',
            `${r.d.automationCount} automation(s) use this template.`,
          );
        }
        r.d.status = 'ARCHIVED';
        bump(r, false);
        return detailOf(r);
      }),
    restore: (templateId) =>
      run(() => {
        const r = find(templateId);
        needEdit(r);
        uniqueName(r.d.kind, r.d.name, r.d.id);
        r.d.status = 'DRAFT';
        bump(r, false);
        return detailOf(r);
      }),
    favorite: (templateId) =>
      run(() => {
        const r = find(templateId);
        r.favorite = true;
        return detailOf(r);
      }),
    unfavorite: (templateId) =>
      run(() => {
        const r = find(templateId);
        r.favorite = false;
        return detailOf(r);
      }),
    setShares: (templateId, body) =>
      run(() => {
        const input = parseInput(SetTemplateSharesRequest, body);
        const r = find(templateId);
        if (!mine(r) && role === 'STAFF')
          throw fail(403, 'NOT_THE_OWNER', 'Only the owner can share this template.');
        r.d.sharedWith = input.userIds.map((u) => {
          const m = memberOf(u);
          if (!m) throw fail(409, 'NOT_A_MEMBER', 'That person is not on your team.');
          return m;
        });
        r.d.access = input.userIds.length
          ? 'SELECTED'
          : r.d.access === 'SELECTED'
            ? 'PRIVATE'
            : r.d.access;
        bump(r, false);
        return detailOf(r);
      }),
    bulk: (body) =>
      run(() => {
        const input = parseInput(BulkTemplatesRequest, body);
        let updated = 0;
        const skipped: { id: string; reason: string }[] = [];
        for (const tid of input.ids) {
          const r = recs.find((x) => x.d.id === tid);
          if (!r || !canEdit(r)) {
            skipped.push({ id: tid, reason: 'Not yours to change.' });
            continue;
          }
          if (input.action === 'ARCHIVE') {
            if (r.d.automationCount > 0) {
              skipped.push({ id: tid, reason: 'Used by an automation.' });
              continue;
            }
            r.d.status = 'ARCHIVED';
          } else if (input.action === 'SET_CATEGORY') {
            try {
              const c = categoryOk(r.d.kind, input.categoryId);
              r.d.category = c ? { id: c.id, name: c.name } : null;
            } catch {
              skipped.push({ id: tid, reason: 'Category does not fit this kind.' });
              continue;
            }
          } else if (input.action === 'ADD_TAG') {
            if (!r.d.tags.some((t) => t.toLowerCase() === input.tag.toLowerCase()))
              r.d.tags.push(input.tag);
          } else {
            r.d.tags = r.d.tags.filter((t) => t.toLowerCase() !== input.tag.toLowerCase());
          }
          bump(r, false);
          updated += 1;
        }
        return { updated, skipped };
      }),
    versions: (templateId) =>
      run(() =>
        find(templateId).versions.map(({ version, name, savedBy, savedAt }) => ({
          version,
          name,
          savedBy,
          savedAt,
        })),
      ),
    version: (templateId, version) =>
      run(() => {
        const v = find(templateId).versions.find((x) => x.version === version);
        if (!v) throw fail(404, 'NOT_FOUND', 'That version was not found.');
        return v;
      }),
    restoreVersion: (templateId, version) =>
      run(() => {
        const r = find(templateId);
        needEdit(r);
        const v = r.versions.find((x) => x.version === version);
        if (!v) throw fail(404, 'NOT_FOUND', 'That version was not found.');
        r.d.name = v.name;
        r.d.subject = v.subject;
        r.d.body = v.body;
        bump(r);
        return detailOf(r);
      }),
    preview: (templateId, body = {}) =>
      run(() => {
        const input = parseInput(PreviewTemplateRequest, body);
        const r = find(templateId);
        // TP-F04: the editor's unsaved words, as the API previews them (nothing saved).
        const shownSubject = input.draft ? (input.draft.subject ?? null) : r.d.subject;
        const subject = render(shownSubject ?? '', input.sample);
        const text = render(input.draft?.body ?? r.d.body, input.sample);
        const pv = r.d.previewText ? render(r.d.previewText, input.sample) : null;
        const plainText = text.out.replace(/<[^>]+>/g, '');
        return {
          subject: shownSubject === null ? null : subject.out,
          previewText: pv?.out ?? null,
          body: text.out,
          unresolved: [
            ...new Set([...subject.unresolved, ...text.unresolved, ...(pv?.unresolved ?? [])]),
          ],
          sample: true,
          sms:
            r.d.kind === 'SMS'
              ? {
                  characters: plainText.length,
                  parts: Math.max(1, Math.ceil(plainText.length / 160)),
                }
              : null,
        };
      }),
    testSend: (templateId, body) =>
      run(() => {
        const input = parseInput(TestSendTemplateRequest, body);
        const r = find(templateId);
        if (
          ![
            'EMAIL',
            'SMS',
            'PORTAL_MESSAGE',
            'APPOINTMENT',
            'INVOICE_PAYMENT',
            'LEAD_FOLLOW_UP',
            'CAMPAIGN',
            'ANNOUNCEMENT',
            'BOOKKEEPING',
            'PAYROLL',
            'LETTER_NOTICE',
            'DOCUMENT_REQUEST',
          ].includes(r.d.kind)
        ) {
          throw fail(409, 'TEST_SEND_REFUSED', 'This kind of template cannot be test-sent.');
        }
        if (input.channel === 'EMAIL' && !input.toEmail)
          throw fail(409, 'TEST_SEND_REFUSED', 'Enter an email address.');
        if (input.channel === 'SMS' && !input.toPhone)
          throw fail(409, 'TEST_SEND_REFUSED', 'Enter a phone number.');
        if (r.d.mergeFields.unknown.length)
          throw fail(409, 'TEST_SEND_REFUSED', 'Fix the unknown merge fields first.');
        return { ok: true as const };
      }),
    startAttachment: (templateId, body) =>
      run(() => {
        const input = parseInput(StartTemplateAttachmentRequest, body);
        find(templateId);
        const token = `mock-template-upload-${next++}`;
        pending.set(token, { templateId, ...input });
        return {
          uploadToken: token,
          url: `mock:upload/${token}`,
          method: 'PUT' as const,
          headers: { 'content-type': input.contentType },
          expiresAt: new Date(Date.now() + 4 * 60_000).toISOString(),
        };
      }),
    confirmAttachment: (body) =>
      run(() => {
        const { uploadToken } = parseInput(ConfirmUploadRequest, body);
        const p = pending.get(uploadToken);
        if (!p) throw fail(410, 'UPLOAD_EXPIRED', 'This upload has expired.');
        pending.delete(uploadToken);
        const r = find(p.templateId);
        const a = {
          id: id('7400'),
          fileName: p.fileName,
          contentType: p.contentType,
          sizeBytes: p.sizeBytes,
          createdAt: nowIso(),
        };
        r.d.attachments.push(a);
        return a;
      }),
    attachmentLink: (templateId, attachmentId) =>
      run(() => {
        const r = find(templateId);
        if (!r.d.attachments.some((a) => a.id === attachmentId))
          throw fail(404, 'NOT_FOUND', 'That attachment was not found.');
        return {
          url: `mock:download/${attachmentId}`,
          expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
        };
      }),
    removeAttachment: (templateId, attachmentId) =>
      run(() => {
        const r = find(templateId);
        needEdit(r);
        r.d.attachments = r.d.attachments.filter((a) => a.id !== attachmentId);
        return { ok: true as const };
      }),
    importTemplate: (body) =>
      run(() => {
        manage();
        const input = parseInput(ImportTemplateRequest, body);
        categoryOk(input.kind, input.categoryId);
        uniqueName(input.kind, input.name);
        const { clean, removed } =
          input.format === 'HTML'
            ? sanitize(input.content)
            : {
                clean: `<p>${input.content.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>')}</p>`,
                removed: 0,
              };
        const r = build({
          kind: input.kind,
          name: input.name,
          subject: null,
          body: clean,
          categoryId: input.categoryId ?? null,
          status: 'DRAFT',
          days: 0,
        });
        recs.unshift(r);
        return { template: detailOf(r), removed };
      }),
    setLinkedTemplate: (templateId, body) =>
      run(() => {
        const input = parseInput(SetLinkedTemplateRequest, body);
        const r = find(templateId);
        needEdit(r);
        if (r.d.etag !== input.etag)
          throw fail(409, 'SAVE_CONFLICT', 'Someone saved this template after you opened it.');
        linkTo(r, input.moduleTemplateId);
        r.d.etag = `e${next++}`;
        return detailOf(r);
      }),
    structureOptions: (q) =>
      run(() => {
        const { kind } = parseInput(TemplateStructureOptionsQuery, q);
        return {
          items: MODULE_TEMPLATES.filter((m) => m.kind === kind).map((m) => ({
            ...m,
            usedByTemplateId: recs.find((r) => r.d.linkedTemplate?.id === m.id)?.d.id ?? null,
          })),
        };
      }),
    starters: () =>
      run(() => ({
        available: STARTER_TEMPLATES.length,
        installed: recs.filter((r) => r.d.starter).length,
      })),
    installStarters: () =>
      run(() => {
        manage();
        return installStarters();
      }),
    categories: (q = {}) =>
      run(() => {
        const query = parseInput(TemplateCategoriesQuery, q);
        recount();
        return categories
          .filter(
            (c) =>
              (!query.kind || c.kind === query.kind) &&
              (query.includeArchived === true || !c.archivedAt),
          )
          .sort((a, b) => a.sortOrder - b.sortOrder);
      }),
    createCategory: (body) =>
      run(() => {
        manage();
        const input = parseInput(CreateTemplateCategoryRequest, body);
        if (
          categories.some(
            (c) =>
              c.kind === input.kind &&
              c.name.toLowerCase() === input.name.toLowerCase() &&
              !c.archivedAt,
          )
        ) {
          throw fail(409, 'DUPLICATE_NAME', 'A category with this name already exists.');
        }
        const c = ensureCategory(input.kind, input.name);
        c.description = input.description ?? null;
        return c;
      }),
    updateCategory: (categoryId, body) =>
      run(() => {
        manage();
        const input = parseInput(UpdateTemplateCategoryRequest, body);
        const c = categories.find((x) => x.id === categoryId);
        if (!c) throw fail(404, 'NOT_FOUND', 'That category was not found.');
        if (input.name !== undefined) {
          if (
            categories.some(
              (x) =>
                x.id !== c.id &&
                x.kind === c.kind &&
                x.name.toLowerCase() === input.name!.toLowerCase(),
            )
          ) {
            throw fail(409, 'DUPLICATE_NAME', 'A category with this name already exists.');
          }
          c.name = input.name;
          for (const r of recs)
            if (r.d.category?.id === c.id) r.d.category = { id: c.id, name: c.name };
        }
        if (input.description !== undefined) c.description = input.description;
        return c;
      }),
    reorderCategories: (body) =>
      run(() => {
        manage();
        const input = parseInput(ReorderTemplateCategoriesRequest, body);
        input.ids.forEach((cid, i) => {
          const c = categories.find((x) => x.id === cid && x.kind === input.kind);
          if (c) c.sortOrder = i;
        });
        recount();
        return categories
          .filter((c) => c.kind === input.kind && !c.archivedAt)
          .sort((a, b) => a.sortOrder - b.sortOrder);
      }),
    mergeCategory: (categoryId, body) =>
      run(() => {
        manage();
        const input = parseInput(MergeTemplateCategoryRequest, body);
        const from = categories.find((x) => x.id === categoryId);
        const into = categories.find((x) => x.id === input.intoId);
        if (!from || !into) throw fail(404, 'NOT_FOUND', 'That category was not found.');
        if (from.kind !== into.kind)
          throw fail(
            409,
            'CATEGORY_NOT_ALLOWED',
            'Categories of different kinds cannot be merged.',
          );
        for (const r of recs)
          if (r.d.category?.id === from.id) r.d.category = { id: into.id, name: into.name };
        from.archivedAt = nowIso();
        recount();
        return into;
      }),
    archiveCategory: (categoryId) =>
      run(() => {
        manage();
        const c = categories.find((x) => x.id === categoryId);
        if (!c) throw fail(404, 'NOT_FOUND', 'That category was not found.');
        c.archivedAt = nowIso();
        return c;
      }),
    restoreCategory: (categoryId) =>
      run(() => {
        manage();
        const c = categories.find((x) => x.id === categoryId);
        if (!c) throw fail(404, 'NOT_FOUND', 'That category was not found.');
        c.archivedAt = null;
        return c;
      }),
    mergeFields: () =>
      run(() => [
        ...FIELD_DEFS.map(([group, key, label, example]): MergeField => ({
          key,
          token: `[${key}]`,
          label,
          group,
          sensitive: false,
          example,
          customId: null,
          fallback: null,
        })),
        ...customs,
      ]),
    createMergeField: (body) =>
      run(() => {
        manage();
        const input = parseInput(SaveCustomMergeFieldRequest, body);
        if (known().some((k) => k.toLowerCase() === input.key.toLowerCase())) {
          throw fail(409, 'DUPLICATE_NAME', 'A merge field with this name already exists.');
        }
        const f: Custom = {
          key: input.key,
          token: `[${input.key}]`,
          label: input.label,
          group: 'CUSTOM',
          sensitive: false,
          example: input.fallback ?? input.label,
          customId: id('7300'),
          fallback: input.fallback ?? null,
        };
        customs.push(f);
        return f;
      }),
    updateMergeField: (fieldId, body) =>
      run(() => {
        manage();
        const input = parseInput(SaveCustomMergeFieldRequest, body);
        const f = customs.find((x) => x.customId === fieldId);
        if (!f) throw fail(404, 'NOT_FOUND', 'That merge field was not found.');
        f.label = input.label;
        f.fallback = input.fallback ?? null;
        return f;
      }),
    deleteMergeField: (fieldId) =>
      run(() => {
        manage();
        const f = customs.find((x) => x.customId === fieldId);
        if (!f) throw fail(404, 'NOT_FOUND', 'That merge field was not found.');
        if (
          recs.some((r) =>
            r.d.mergeFields.used.some((u) => u.toLowerCase() === f.key.toLowerCase()),
          )
        ) {
          throw fail(409, 'FIELD_IN_USE', 'Templates still use this field.');
        }
        customs.splice(customs.indexOf(f), 1);
        return { ok: true as const };
      }),
    branding: () => run(() => branding),
    saveBranding: (body) =>
      run(() => {
        manage();
        const input = parseInput(SaveTemplateBrandingRequest, body);
        branding = { ...branding, ...input, updatedAt: nowIso() } as TemplateBranding;
        return branding;
      }),
  };
}
