// Demo seed, portal gaps (R0, Oct 18 click-through): what the client portal showed empty for the
// demo firm. The "Where Your Taxes Stand" card (each client's status per tax year, from their
// returns), and the firm's published content: the four resource pages, external links and a tip.
// Resources and links show only to business clients (an individual like Harper sees the notice).
import { runInScope, type createPrismaClient } from '../src/client.js';
import { demoId, SEED_DEMO_USERS } from './seed-demo-data.js';
import { DEMO_ENGAGEMENTS } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

/** The tax status a return's stage shows the client (names from SEED_TAX_STATUSES.lvp). */
const STATUS_BY_STAGE: Readonly<Record<string, string>> = {
  New: 'Waiting for documents',
  'Missing documents': 'Waiting for documents',
  Preparation: 'In preparation',
  Review: 'Ready for review',
  Signature: 'Ready for review',
};

const NOTE_BY_STATUS: Readonly<Record<string, string>> = {
  'Waiting for documents': 'Please upload the documents on your list so we can start your return.',
  'In preparation': 'We have your documents and are preparing your return.',
  'Ready for review': 'Your return is ready. We will walk you through it before you sign.',
  Accepted: 'Your return was filed and accepted.',
};

interface DemoContent {
  key: string;
  kind: 'RESOURCE' | 'TIP' | 'EXTERNAL_LINK';
  category: string | null;
  title: string;
  description?: string;
  body?: string;
  url?: string;
  iconKey?: string;
}

const CONTENT: readonly DemoContent[] = [
  {
    key: 'startup-checklist',
    kind: 'RESOURCE',
    category: 'startup-guide',
    title: 'New business checklist',
    description: 'The first steps after you choose your business structure.',
    body: '1. Register your business name with your state.\n2. Get an EIN from the IRS.\n3. Open a business bank account.\n4. Ask us which licenses and tax registrations apply to you.',
  },
  {
    key: 'records-to-keep',
    kind: 'RESOURCE',
    category: 'record-keeping',
    title: 'What records to keep, and for how long',
    description: 'A simple schedule for receipts, statements and returns.',
    body: 'Keep receipts and bank statements for at least 3 years, payroll records for 4 years, and tax returns for good. Store them in one place, by year.',
  },
  {
    key: 'payroll-calendar',
    kind: 'RESOURCE',
    category: 'payroll',
    title: 'Payroll tax calendar',
    description: 'When payroll deposits and quarterly reports are due.',
    body: 'Form 941 is due the last day of the month after each quarter. Form 940 and W-2s are due January 31. We send a reminder before every deadline.',
  },
  {
    key: 'home-office',
    kind: 'RESOURCE',
    category: 'tax-deductions',
    title: 'The home office deduction',
    description: 'Who qualifies and what proof to keep.',
    body: 'The space must be used regularly and only for your business. Keep a floor plan, the square footage and your utility bills.',
  },
  {
    key: 'link-irs-business',
    kind: 'EXTERNAL_LINK',
    category: 'External Links',
    title: 'IRS: Small business and self-employed',
    description: 'Forms, deadlines and guides from the IRS.',
    url: 'https://www.irs.gov/businesses/small-businesses-self-employed',
    iconKey: 'irs',
  },
  {
    key: 'link-sba',
    kind: 'EXTERNAL_LINK',
    category: 'External Links',
    title: 'SBA: Plan, launch and grow your business',
    description: 'Funding programs and planning guides.',
    url: 'https://www.sba.gov/business-guide',
    iconKey: 'sba',
  },
  {
    key: 'link-refund',
    kind: 'EXTERNAL_LINK',
    category: 'External Links',
    title: "IRS: Where's My Refund?",
    description: 'Check the status of your federal refund.',
    url: 'https://www.irs.gov/refunds',
    iconKey: 'irs',
  },
  {
    key: 'tip-receipts',
    kind: 'TIP',
    category: null,
    title: 'Snap a photo of every receipt',
    body: 'Upload receipts as you get them. It saves time at tax season.',
  },
];

export async function seedDemoPortal(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    const statuses = await tx.taxStatus.findMany({
      where: { businessId },
      select: { id: true, name: true },
    });
    const statusId = (name: string) => {
      const found = statuses.find((s) => s.name === name);
      if (!found) throw new Error(`demo seed: tax status ${name} is missing`);
      return found.id;
    };

    // One status per client and tax year, from their return: this year's by its stage (none while
    // cancelled), last year's accepted.
    for (const e of DEMO_ENGAGEMENTS) {
      if (e.taxYear === null || (e.slot !== 'tax2025' && e.slot !== 'tax2024')) continue;
      if (e.status === 'CANCELLED') continue;
      const name =
        e.status === 'COMPLETED'
          ? 'Accepted'
          : (STATUS_BY_STAGE[e.stage ?? 'New'] ?? 'In preparation');
      const clientId = org.clients[e.clientKey]!;
      await tx.clientTaxStatus.upsert({
        where: { businessId_clientId_taxYear: { businessId, clientId, taxYear: e.taxYear } },
        update: {},
        create: {
          businessId,
          clientId,
          taxYear: e.taxYear,
          taxStatusId: statusId(name),
          clientNote: NOTE_BY_STATUS[name] ?? null,
          updatedByUserId: SEED_DEMO_USERS[e.assigned].id,
        },
      });
    }

    for (const [i, c] of CONTENT.entries()) {
      await tx.contentItem.upsert({
        where: { id: demoId(`content:${c.key}`) },
        update: {},
        create: {
          id: demoId(`content:${c.key}`),
          businessId,
          kind: c.kind,
          category: c.category,
          title: c.title,
          description: c.description ?? null,
          body: c.body ?? null,
          url: c.url ?? null,
          iconKey: c.iconKey ?? null,
          sortOrder: i,
          publishedAt: new Date(),
          createdByUserId: SEED_DEMO_USERS.owner.id,
        },
      });
    }
  });
}
