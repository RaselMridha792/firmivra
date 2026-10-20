// Demo seed, stage 5 (R0, Oct 19): the Templates library for the demo firm. Message template
// categories and templates (email, text, portal message, appointment) with their saved versions,
// sharing, favorites, uses and an attachment; the firm's template branding and custom merge
// fields; document request templates with their items; and invoice templates. Synthetic data,
// the demo firm only; fixed ids and natural keys, created once, so a re-run changes nothing.
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { demoId, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;
const id = (key: string) => demoId(`template:${key}`);

type Kind = 'EMAIL' | 'SMS' | 'PORTAL_MESSAGE' | 'APPOINTMENT' | 'DOCUMENT_REQUEST';

const CATEGORIES: readonly { kind: Kind; name: string; description: string }[] = [
  { kind: 'EMAIL', name: 'Onboarding', description: 'Welcome and getting-started messages.' },
  { kind: 'EMAIL', name: 'Tax Season', description: 'Organizers, missing documents and signing.' },
  { kind: 'EMAIL', name: 'Billing', description: 'Invoices and payment reminders.' },
  { kind: 'SMS', name: 'Reminders', description: 'Short text reminders.' },
  { kind: 'PORTAL_MESSAGE', name: 'Updates', description: 'Status updates in the portal.' },
  { kind: 'APPOINTMENT', name: 'Scheduling', description: 'Confirmations and changes.' },
  { kind: 'DOCUMENT_REQUEST', name: 'Tax documents', description: 'Requests for tax paperwork.' },
];

interface DemoTemplate {
  key: string;
  kind: Kind;
  category: string;
  name: string;
  subject?: string;
  body: string;
  tags: string[];
  owner: DemoStaffKey;
  status?: 'DRAFT' | 'ARCHIVED';
  access?: 'PRIVATE' | 'SELECTED';
  automations?: boolean;
  /** A second saved version: the earlier body. */
  earlierBody?: string;
}

const TEMPLATES: readonly DemoTemplate[] = [
  {
    key: 'welcome-new-client',
    kind: 'EMAIL',
    category: 'Onboarding',
    name: 'Welcome to the firm',
    subject: 'Welcome to [Firm Name]',
    body: 'Hello [Client First Name],\n\nWelcome to [Firm Name]! Your client portal is ready: [Portal Link]. Upload documents, message us and pay invoices there any time.\n\n[Staff Name]',
    tags: ['onboarding', 'portal'],
    owner: 'clientSupport',
    automations: true,
    earlierBody: 'Hello [Client First Name], welcome to [Firm Name]. Your portal: [Portal Link].',
  },
  {
    key: 'tax-organizer-ready',
    kind: 'EMAIL',
    category: 'Tax Season',
    name: 'Tax organizer ready',
    subject: 'Your [Tax Year] tax organizer is ready',
    body: 'Hello [Client First Name],\n\nYour [Tax Year] organizer is ready in the portal. Please complete it by [Due Date] so we can start your return.\n\n[Staff Name]',
    tags: ['tax', 'organizer'],
    owner: 'taxPreparer',
    automations: true,
  },
  {
    key: 'missing-documents',
    kind: 'EMAIL',
    category: 'Tax Season',
    name: 'Missing documents reminder',
    subject: 'We still need a few documents',
    body: 'Hello [Client First Name],\n\nTo finish your return we still need: [Missing Documents]. You can upload them in the portal: [Portal Link].',
    tags: ['tax', 'documents'],
    owner: 'taxPreparer',
    automations: true,
  },
  {
    key: 'return-ready-to-sign',
    kind: 'EMAIL',
    category: 'Tax Season',
    name: 'Return ready to sign',
    subject: 'Your return is ready for your signature',
    body: 'Hello [Client First Name],\n\nYour [Tax Year] return is ready. Please review and sign Form 8879 in the portal so we can e-file it.',
    tags: ['tax', 'signature'],
    owner: 'manager',
    access: 'SELECTED',
  },
  {
    key: 'invoice-reminder',
    kind: 'EMAIL',
    category: 'Billing',
    name: 'Friendly invoice reminder',
    subject: 'Invoice [Invoice Number] is due [Due Date]',
    body: 'Hello [Client First Name],\n\nA friendly reminder that invoice [Invoice Number] for [Amount Due] is due [Due Date]. Thank you!',
    tags: ['billing'],
    owner: 'admin',
    automations: true,
  },
  {
    key: 'sms-appointment-reminder',
    kind: 'SMS',
    category: 'Reminders',
    name: 'Appointment reminder (text)',
    body: '[Firm Name]: reminder of your appointment on [Appointment Date] at [Appointment Time]. Reply C to confirm.',
    tags: ['appointments'],
    owner: 'clientSupport',
  },
  {
    key: 'sms-documents-reminder',
    kind: 'SMS',
    category: 'Reminders',
    name: 'Documents reminder (text)',
    body: '[Firm Name]: we still need a few documents for your return. Upload them in your portal.',
    tags: ['documents'],
    owner: 'clientSupport',
    status: 'DRAFT',
  },
  {
    key: 'portal-return-filed',
    kind: 'PORTAL_MESSAGE',
    category: 'Updates',
    name: 'Return filed',
    body: 'Good news, [Client First Name]: your [Tax Year] return was filed and accepted. A copy is in your documents.',
    tags: ['tax'],
    owner: 'taxPreparer',
  },
  {
    key: 'appointment-confirmation',
    kind: 'APPOINTMENT',
    category: 'Scheduling',
    name: 'Appointment confirmation',
    subject: 'Your appointment on [Appointment Date]',
    body: 'Hello [Client First Name],\n\nYou are booked with [Staff Name] on [Appointment Date] at [Appointment Time]. Join here: [Meeting Link].',
    tags: ['appointments'],
    owner: 'clientSupport',
  },
  {
    key: 'old-extension-notice',
    kind: 'EMAIL',
    category: 'Tax Season',
    name: 'Extension filed (old wording)',
    subject: 'We filed an extension for you',
    body: 'Hello [Client First Name], we filed an extension for your return.',
    tags: ['tax', 'extension'],
    owner: 'manager',
    status: 'ARCHIVED',
  },
];

const REQUEST_TEMPLATES = [
  {
    key: 'personal-tax',
    name: 'Personal tax documents',
    description: 'What we need for an individual return.',
    items: [
      ['W-2 from each employer', 'W-2 and 1099', true],
      ['1099 forms (interest, dividends, brokerage)', 'W-2 and 1099', true],
      ['Photo ID', 'ID', true],
      ['Last year’s return (new clients)', 'Prior-year returns', false],
      ['Childcare and education receipts', null, false],
    ],
  },
  {
    key: 'business-tax',
    name: 'Business tax package',
    description: 'Year-end documents for a business return.',
    items: [
      ['Year-end bank and card statements', 'Bank statements', true],
      ['Payroll reports (941s, W-3)', 'Payroll', true],
      ['Formation documents and EIN letter (new clients)', 'Formation', false],
      ['Fixed asset purchases over $2,500', null, true],
    ],
  },
  {
    key: 'bookkeeping-onboarding',
    name: 'New bookkeeping client',
    description: 'To set up the books.',
    items: [
      ['Last three months of bank statements', 'Bank statements', true],
      ['Loan and lease agreements', null, false],
      ['Chart of accounts or last year’s financials', null, false],
    ],
  },
] as const;

export async function seedDemoTemplates(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    const categoryId: Record<string, string> = {};
    for (const [i, c] of CATEGORIES.entries()) {
      const row = await tx.templateCategory.upsert({
        where: { businessId_kind_name: { businessId, kind: c.kind, name: c.name } },
        update: {},
        create: { id: id(`category:${c.kind}:${c.name}`), businessId, ...c, sortOrder: i },
      });
      categoryId[`${c.kind}:${c.name}`] = row.id;
    }
    for (const t of TEMPLATES) await seedMessageTemplate(tx, org, t, categoryId);

    await tx.templateBranding.upsert({
      where: { businessId },
      update: {},
      create: {
        businessId,
        footerText: 'Demo Accounting Group · 100 Peachtree Street, Atlanta, GA',
        disclaimer: 'This message may contain confidential tax information meant only for you.',
        signatureText: 'The team at Demo Accounting Group',
        updatedByUserId: user('admin'),
      },
    });
    for (const [i, [key, label, fallback]] of [
      ['Office Hours', 'Office hours', 'Monday to Friday, 9 to 5'],
      ['Office Phone', 'Office phone', '(404) 555-0100'],
      ['Tax Deadline', 'This season’s filing deadline', 'April 15'],
    ].entries()) {
      await tx.customMergeField.upsert({
        where: { businessId_key: { businessId, key: key! } },
        update: {},
        create: { businessId, key: key!, label: label!, fallback, sortOrder: i },
      });
    }

    for (const [i, r] of REQUEST_TEMPLATES.entries()) {
      const templateId = id(`request:${r.key}`);
      await tx.documentRequestTemplate.upsert({
        where: { id: templateId },
        update: {},
        create: {
          id: templateId,
          businessId,
          name: r.name,
          description: r.description,
          ownerUserId: user('manager'),
          sortOrder: i,
        },
      });
      for (const [k, [title, category, required]] of r.items.entries()) {
        const itemId = id(`request:${r.key}:${k}`);
        await tx.documentRequestTemplateItem.upsert({
          where: { id: itemId },
          update: {},
          create: {
            id: itemId,
            businessId,
            templateId,
            title,
            required,
            categoryId: category ? org.categoryIds(category) : null,
            sortOrder: k,
          },
        });
      }
    }

    for (const [name, data] of [
      [
        'Standard invoice',
        {
          description: 'Lines, totals and a thank-you memo.',
          memo: 'Thank you for your business! Questions? Reply to this email or message us in the portal.',
          footer: 'Payment is due within 30 days.',
          isDefault: true,
        },
      ],
      [
        'Monthly bookkeeping',
        {
          description: 'For monthly bookkeeping packages.',
          memo: 'Your monthly bookkeeping package. Reports are in your portal.',
          footer: 'Billed on the 15th; paid by card on file where set up.',
        },
      ],
      [
        'Tax preparation',
        {
          description: 'For annual tax returns.',
          memo: 'Thank you for trusting us with your return.',
          showLogo: true,
        },
      ],
    ] as const) {
      await tx.invoiceTemplate.upsert({
        where: { businessId_name: { businessId, name } },
        update: {},
        create: { id: id(`invoice:${name}`), businessId, name, ...data },
      });
    }
  });
}

/** One template, its versions, and who shares, favors and has used it. */
async function seedMessageTemplate(
  tx: TxClient,
  org: DemoOrgResult,
  t: DemoTemplate,
  categoryId: Record<string, string>,
) {
  const { businessId } = org;
  const templateId = id(`message:${t.key}`);
  if (await tx.messageTemplate.findUnique({ where: { id: templateId } })) return;
  const versions = t.earlierBody ? 2 : 1;
  await tx.messageTemplate.create({
    data: {
      id: templateId,
      businessId,
      kind: t.kind,
      categoryId: categoryId[`${t.kind}:${t.category}`]!,
      starterKey: t.key,
      name: t.name,
      subject: t.subject ?? null,
      body: t.body,
      status: t.status ?? 'ACTIVE',
      access: t.access ?? 'TEAM',
      tags: t.tags,
      includeInAutomations: t.automations ?? false,
      version: versions,
      ownerUserId: user(t.owner),
      updatedByUserId: user(t.owner),
      ...(t.status === 'ARCHIVED' ? { archivedAt: demoDay(-40) } : {}),
    },
  });
  const link = { businessId, templateId };
  for (let v = 1; v <= versions; v++) {
    await tx.messageTemplateVersion.create({
      data: {
        id: id(`message:${t.key}:v${v}`),
        ...link,
        version: v,
        name: t.name,
        subject: t.subject ?? null,
        body: v === versions ? t.body : t.earlierBody!,
        savedByUserId: user(t.owner),
        savedAt: demoDay(v === versions ? -10 : -60),
      },
    });
  }
  if (t.access === 'SELECTED') {
    for (const who of ['taxPreparer', 'clientSupport'] as const) {
      await tx.messageTemplateShare.create({ data: { ...link, userId: user(who) } });
    }
  }
  if (t.status !== 'ARCHIVED' && t.status !== 'DRAFT') {
    await tx.messageTemplateFavorite.create({ data: { ...link, userId: user(t.owner) } });
    const clientIds = Object.values(org.clients);
    for (let u = 0; u < 3; u++) {
      await tx.messageTemplateUse.create({
        data: {
          id: id(`message:${t.key}:use:${u}`),
          ...link,
          version: versions,
          purpose: u === 0 && t.automations ? 'automation' : 'communication',
          entityType: 'client',
          entityId: clientIds[(u * 7 + t.key.length) % clientIds.length]!,
          usedByUserId: user(t.owner),
          usedAt: demoDay(-1 - u * 6),
        },
      });
    }
  }
  if (t.key === 'tax-organizer-ready') {
    await tx.messageTemplateAttachment.create({
      data: {
        id: id('message:tax-organizer-ready:attachment'),
        ...link,
        fileName: 'Tax organizer checklist.pdf',
        contentType: 'application/pdf',
        sizeBytes: 48_213,
        s3Key: `tenant/${businessId}/templates/${templateId}/organizer-checklist.pdf`,
      },
    });
  }
}
