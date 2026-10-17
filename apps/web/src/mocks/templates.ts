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

/** The 48 starters of the guide: number, kind, group, name, subject, what it says. */
const STARTERS: [number, MessageTemplateKind, string, string, string, string][] = [
  [
    1,
    'EMAIL',
    'Client Communications',
    'New Client Welcome Email',
    'Welcome to [Business Name]!',
    'We are glad to have you. Your client portal is ready, and here is what happens next.',
  ],
  [
    2,
    'EMAIL',
    'Client Communications',
    'Existing Client Welcome Back',
    'Welcome back, [Client First Name]',
    'It is good to work with you again. Here is a summary of the next steps.',
  ],
  [
    3,
    'EMAIL',
    'Client Communications',
    'Missing Documents Follow-Up',
    'We are still missing a few documents',
    'A few documents are still outstanding. You can upload them securely: [Document Upload Link]',
  ],
  [
    4,
    'EMAIL',
    'Client Communications',
    'Document Received Confirmation',
    'We received your documents',
    'Thank you. We received your documents and will review them within a few business days.',
  ],
  [
    5,
    'EMAIL',
    'Client Communications',
    'General Client Follow-Up',
    'Following up on our conversation',
    'Thank you for your time. Here is a short recap and what we need from you.',
  ],
  [
    6,
    'EMAIL',
    'Client Communications',
    'Client Portal Invitation',
    'Activate your client portal',
    'Your secure portal is ready. Sign in here: [Client Portal Link]. Never share your password.',
  ],
  [
    7,
    'EMAIL',
    'Tax Season',
    'Tax Season Opening Announcement',
    'Tax season is open',
    'Tax season appointments and intake are now open. Book your time when you are ready.',
  ],
  [
    8,
    'EMAIL',
    'Tax Season',
    'Tax Organizer Ready',
    'Your tax organizer is ready',
    'Your organizer is ready to complete: [Organizer Link]',
  ],
  [
    9,
    'EMAIL',
    'Tax Season',
    'Tax Appointment Preparation',
    'Getting ready for your appointment',
    'Before we meet on [Appointment Date], please complete your organizer and gather your documents.',
  ],
  [
    10,
    'EMAIL',
    'Tax Season',
    'Tax Documents Still Needed',
    'Tax documents still needed',
    'To finish your [Tax Year] return we still need a few documents: [Document Upload Link]',
  ],
  [
    11,
    'EMAIL',
    'Tax Season',
    'Tax Return Ready for Review',
    'Your return is ready for review',
    'Your [Tax Year] return is ready. Please review it in your portal: [Client Portal Link]',
  ],
  [
    12,
    'EMAIL',
    'Tax Season',
    'Tax Return Signature Request',
    'Please sign your return',
    'Please sign your return securely: [Signature Link]',
  ],
  [
    13,
    'EMAIL',
    'Tax Season',
    'Tax Return Filed Confirmation',
    'Your return has been filed',
    'Your [Tax Year] return was filed. Keep a copy of your records.',
  ],
  [
    14,
    'EMAIL',
    'Tax Season',
    'Extension Filed Confirmation',
    'Your extension has been filed',
    'We filed your extension. Any payment is still due on the original date.',
  ],
  [
    15,
    'EMAIL',
    'Tax Season',
    'Estimated Tax Payment Reminder',
    'Estimated tax payment due [Due Date]',
    'Your estimated tax payment is due on [Due Date].',
  ],
  [
    16,
    'APPOINTMENT',
    'Appointment',
    'Appointment Confirmation',
    'Your appointment is confirmed',
    'Your [Appointment Type] is confirmed for [Appointment Date] at [Appointment Time]. [Appointment Location]',
  ],
  [
    17,
    'APPOINTMENT',
    'Appointment',
    'Appointment Reminder — 24 Hours',
    'Reminder: appointment tomorrow',
    'A reminder that we meet tomorrow, [Appointment Date] at [Appointment Time].',
  ],
  [
    18,
    'APPOINTMENT',
    'Appointment',
    'Appointment Reminder — 1 Hour',
    'Your appointment starts in 1 hour',
    'We meet in one hour at [Appointment Time].',
  ],
  [
    19,
    'APPOINTMENT',
    'Appointment',
    'Appointment Rescheduled',
    'Your appointment was rescheduled',
    'Your appointment is now [Appointment Date] at [Appointment Time].',
  ],
  [
    20,
    'APPOINTMENT',
    'Appointment',
    'Missed Appointment / No-Show Follow-Up',
    'We missed you',
    'We missed you today. You can pick a new time here: [Reschedule Link]',
  ],
  [
    21,
    'APPOINTMENT',
    'Appointment',
    'Post-Appointment Follow-Up',
    'Thank you for meeting with us',
    'Thank you for meeting. Here is a recap of the next steps and the items we asked for.',
  ],
  [
    22,
    'INVOICE_PAYMENT',
    'Invoices & Payments',
    'Invoice Issued',
    'Invoice [Invoice Number] from [Business Name]',
    'Invoice [Invoice Number] for [Balance Due] is due on [Due Date]. Pay securely: [Payment Link]',
  ],
  [
    23,
    'INVOICE_PAYMENT',
    'Invoices & Payments',
    'Payment Due Soon',
    'Payment due soon',
    'A friendly reminder that invoice [Invoice Number] is due on [Due Date].',
  ],
  [
    24,
    'INVOICE_PAYMENT',
    'Invoices & Payments',
    'Payment Overdue — First Notice',
    'Invoice [Invoice Number] is past due',
    'Invoice [Invoice Number] is past due. Please pay at: [Payment Link]',
  ],
  [
    25,
    'INVOICE_PAYMENT',
    'Invoices & Payments',
    'Payment Overdue — Final Reminder',
    'Final reminder: invoice [Invoice Number]',
    'This is a final reminder before we follow up internally. Balance: [Balance Due].',
  ],
  [
    26,
    'INVOICE_PAYMENT',
    'Invoices & Payments',
    'Payment Received / Receipt',
    'Payment received, thank you',
    'We received your payment. Thank you.',
  ],
  [
    27,
    'BOOKKEEPING',
    'Bookkeeping',
    'Monthly Bookkeeping Document Request',
    'Documents needed for your monthly books',
    'Please send your bank, card and payroll statements: [Document Upload Link]',
  ],
  [
    28,
    'BOOKKEEPING',
    'Bookkeeping',
    'Bookkeeping Records Missing',
    'Some records are missing',
    'Some records are missing for this month. Please upload them securely.',
  ],
  [
    29,
    'BOOKKEEPING',
    'Bookkeeping',
    'Monthly Books Completed',
    'Your books are up to date',
    'Your books are updated and ready to review in the portal.',
  ],
  [
    30,
    'BOOKKEEPING',
    'Bookkeeping',
    'Quarterly Bookkeeping Review',
    'Your quarterly bookkeeping review',
    'Here is your quarterly review and the next steps.',
  ],
  [
    31,
    'BOOKKEEPING',
    'Bookkeeping',
    'Year-End Bookkeeping Checklist',
    'Year-end checklist',
    'Here is the checklist to close your year.',
  ],
  [
    32,
    'PAYROLL',
    'Payroll',
    'Payroll Information Reminder',
    'Payroll information needed',
    'Please send hours and changes before the payroll cutoff.',
  ],
  [
    33,
    'PAYROLL',
    'Payroll',
    'Payroll Completed Notification',
    'Payroll has been processed',
    'Your payroll was processed. Reports are available in your portal.',
  ],
  [
    34,
    'PAYROLL',
    'Payroll',
    'Payroll Document / Employee Info Request',
    'Employee information needed',
    'We need a few employee documents to complete payroll setup.',
  ],
  [
    35,
    'LEAD_FOLLOW_UP',
    'Leads',
    'New Lead First Response',
    'Thanks for reaching out',
    'Thank you for your inquiry. You can book a time here: [Reschedule Link]',
  ],
  [
    36,
    'LEAD_FOLLOW_UP',
    'Leads',
    'Lead Follow-Up — No Response',
    'Checking in',
    'We wanted to check in on your inquiry. Is there a good time to talk?',
  ],
  [
    37,
    'LEAD_FOLLOW_UP',
    'Leads',
    'Consultation Reminder',
    'Your consultation is coming up',
    'A reminder of your consultation on [Appointment Date] at [Appointment Time].',
  ],
  [
    38,
    'LEAD_FOLLOW_UP',
    'Leads',
    'Post-Consultation Follow-Up',
    'Next steps after our consultation',
    'Thank you for meeting. Here are the services we discussed and the next step.',
  ],
  [
    39,
    'ENGAGEMENT_AGREEMENT',
    'Engagement Agreements',
    'Engagement Agreement Sent',
    'Your engagement agreement is ready',
    'Your agreement is ready to review and sign: [Signature Link]',
  ],
  [
    40,
    'ENGAGEMENT_AGREEMENT',
    'Engagement Agreements',
    'Engagement Agreement Reminder',
    'Reminder: please sign your agreement',
    'Your agreement is still waiting for your signature: [Signature Link]',
  ],
  [
    41,
    'ENGAGEMENT_AGREEMENT',
    'Engagement Agreements',
    'Document Signature Request',
    'Please sign this document',
    'Please review and sign this document securely: [Signature Link]',
  ],
  [
    42,
    'DOCUMENT_REQUEST',
    'Documents',
    'Secure Document Upload Request',
    'Please upload your documents',
    'Please upload your documents through the secure portal: [Document Upload Link]',
  ],
  [
    43,
    'PORTAL_MESSAGE',
    'Portal Messages',
    'New Portal Message Notification',
    'You have a new secure message',
    'You have a new message. Sign in to read it: [Portal Message Link]',
  ],
  [
    44,
    'LETTER_NOTICE',
    'Notices',
    'Important Client Notice',
    'Important notice from [Business Name]',
    'We have time-sensitive information for you. Please read it in your portal.',
  ],
  [
    45,
    'CAMPAIGN',
    'Marketing',
    'Monthly Tax & Business Newsletter',
    'Your monthly tax and business update',
    'Here are this month’s tax tips and business updates.',
  ],
  [
    46,
    'CAMPAIGN',
    'Marketing',
    'Tax Deadline Reminder Campaign',
    'Upcoming tax deadlines',
    'Here are the deadlines coming up and how we can help.',
  ],
  [
    47,
    'ANNOUNCEMENT',
    'Marketing',
    'Service Announcement / New Service',
    'Introducing a new service',
    'We are introducing a new service. Reply to learn more.',
  ],
  [
    48,
    'TASK',
    'Workflow',
    'Standard Client Follow-Up Task Checklist',
    'Client follow-up checklist',
    'Call the client, request documents, confirm receipt, mark complete.',
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
    };
    return {
      d,
      favorite: v.favorite ?? false,
      versions: [
        { version: 1, name: v.name, savedBy: owner, savedAt: at, subject: v.subject, body: v.body },
      ],
    };
  };
  const addStarter = (s: (typeof STARTERS)[number], n: number) => {
    const [num, kind, group, name, subject, purpose] = s;
    const cat = ensureCategory(kind, group);
    recs.push(
      build({
        kind,
        name,
        subject: kind === 'SMS' ? null : subject,
        body: html(purpose),
        categoryId: cat.id,
        description: purpose.slice(0, 80),
        tags: [group],
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
    STARTERS.forEach((s, n) => {
      if (recs.some((r) => r.d.starter && r.d.name === s[3])) there += 1;
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
        bump(r, changedText);
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
        const subject = render(r.d.subject ?? '', input.sample);
        const text = render(r.d.body, input.sample);
        const pv = r.d.previewText ? render(r.d.previewText, input.sample) : null;
        const plainText = text.out.replace(/<[^>]+>/g, '');
        return {
          subject: r.d.subject === null ? null : subject.out,
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
    starters: () =>
      run(() => ({
        available: STARTERS.length,
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
