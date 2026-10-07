import {
  ApiRequestError,
  type ContentClient,
  ContentItem,
  contentKindProblem,
  ContentQuery,
  CreateContentRequest,
  type MyContentClient,
  MyContentQuery,
  parseInput,
  UpdateContentRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import type { MockFirmRole } from './clients';

/**
 * Mock data for `api.content` and `api.myContent(slug)` (R12). The external links are the eight
 * approved in FirmVora_External_Links_Directions.docx; the resource sections are short synthetic
 * samples for the four resource pages. Same checks, rules and error codes as the API: drafts are
 * hidden from clients, and an INDIVIDUAL client gets 403 BUSINESS_ONLY for resources and links.
 */
const at = '2026-10-07T09:00:00.000Z';
const contentId = (n: number) => `0199b6c5-0000-7000-8000-${String(n).padStart(12, '0')}`;
type Seed = Partial<ContentItem> & Pick<ContentItem, 'kind' | 'title'>;
const item = (n: number, fields: Seed): ContentItem =>
  // Parsed, so a fixture that breaks the contract fails on first use.
  ContentItem.parse({
    id: contentId(n),
    category: null,
    description: null,
    body: null,
    url: null,
    iconKey: null,
    sortOrder: n,
    publishedAt: at,
    updatedAt: at,
    ...fields,
  });
const link = (
  n: number,
  category: string,
  iconKey: string,
  title: string,
  description: string,
  url: string,
) => item(n, { kind: 'EXTERNAL_LINK', category, iconKey, title, description, url });
const resource = (n: number, page: string, title: string, body: string) =>
  item(n, { kind: 'RESOURCE', category: page, title, body });

let fixtures: readonly ContentItem[] | undefined;

/** Built on first use: importing this file runs nothing. */
export function contentFixtures(): readonly ContentItem[] {
  const irs = 'IRS & Business Taxes';
  const funding = 'Funding & Financial Resources';
  const planning = 'Business Planning & Market Research';
  fixtures ??= [
    link(
      1,
      irs,
      'irs',
      'IRS Small Business & Self-Employed Tax Center',
      'Federal tax information, tools, forms, and common topics for small businesses and self-employed taxpayers.',
      'https://www.irs.gov/businesses/small-businesses-self-employed',
    ),
    link(
      2,
      irs,
      'irs',
      'IRS Employer Identification Number (EIN)',
      'Information on whether a business needs an EIN and how to obtain one from the IRS.',
      'https://www.irs.gov/ein',
    ),
    link(
      3,
      irs,
      'irs',
      'IRS - Pay Business Taxes from Your Bank Account',
      'Official IRS Direct Pay option for eligible business tax payments from a bank account.',
      'https://www.irs.gov/payments/pay-business-taxes-from-your-bank-account',
    ),
    link(
      4,
      funding,
      'sba',
      'SBA Loans',
      'Overview of SBA-backed 7(a), 504, microloan, and other small-business financing options.',
      'https://www.sba.gov/loans/',
    ),
    link(
      5,
      funding,
      'sba',
      'SBA Lender Match',
      'Tool that helps small businesses connect with participating SBA lenders.',
      'https://www.sba.gov/loans/lender-match/',
    ),
    link(
      6,
      funding,
      'sba',
      'SBA - Plan Your Business',
      'Business-planning guidance for preparing, starting, and funding a business.',
      'https://www.sba.gov/counseling/plan-your-business/',
    ),
    link(
      7,
      planning,
      'fdic',
      'FDIC Money Smart for Small Business',
      'Educational materials covering topics related to starting and managing a small business.',
      'https://www.fdic.gov/consumer-resource-center/money-smart-small-business',
    ),
    link(
      8,
      planning,
      'census',
      'U.S. Census - Census Business Builder',
      'Market, demographic, and economic data to help clients research locations, customers, and business conditions.',
      'https://www.census.gov/data/data-tools/cbb.html',
    ),
    resource(
      20,
      'startup-guide',
      'Sole Proprietorship',
      '**Description:** One owner, no separate legal entity.\n\n**Requirements:** A business license where needed; an EIN if you hire.\n\n**Process to start:**\n1. Choose a name.\n2. Register it with your county if needed.\n3. Get the licenses your city requires.',
    ),
    resource(
      21,
      'startup-guide',
      'Limited Liability Company (LLC)',
      '**Description:** Separates business debts from personal assets.\n\n**Requirements:** Articles of organization filed with the state.\n\n**Process to start:**\n1. File the articles.\n2. Write an operating agreement.\n3. Get an EIN.',
    ),
    resource(
      30,
      'record-keeping',
      'Income records',
      '| What to keep | Why it matters | How long to keep |\n| --- | --- | --- |\n| Invoices, deposit slips, 1099s | Proves the income you report | At least 7 years |',
    ),
    resource(
      40,
      'payroll',
      'Payroll setup steps',
      '1. Confirm your business structure.\n2. Get an EIN.\n3. Register for state employer accounts.\n4. Choose a payroll method.\n5. Set up your payroll system.\n6. Run your first payroll.',
    ),
    resource(
      50,
      'tax-deductions',
      'Home office',
      '| What it covers | Proof needed |\n| --- | --- |\n| A part of your home used only for business | Measurements and expense records |',
    ),
    item(60, {
      kind: 'TIP',
      category: 'Tax tips',
      title: 'Keep receipts digital',
      body: 'Scan receipts the day you get them, and keep them in one folder per year.',
    }),
    item(61, {
      kind: 'TIP',
      category: 'Tax tips',
      title: 'Draft (not published)',
      body: 'Clients never see drafts.',
      publishedAt: null,
    }),
  ];
  return fixtures;
}

const copy = <T>(value: T): T => structuredClone(value);
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const byOrder = (a: ContentItem, b: ContentItem) =>
  (a.category ?? '').localeCompare(b.category ?? '') || a.sortOrder - b.sortOrder;
const matches =
  (q: { kind?: string | undefined; category?: string | undefined }) => (c: ContentItem) =>
    (!q.kind || c.kind === q.kind) && (!q.category || c.category === q.category);

/** One store per page load, so the firm's edits show in the portal mock. */
let rows: ContentItem[] | undefined;
const store = () => (rows ??= contentFixtures().map(copy));

/** An in-memory `api.content`; `role: 'STAFF'` gets 403 on changes. */
export function createContentMock(options: { role?: MockFirmRole } = {}): ContentClient {
  let next = 100;
  const manager = () => {
    if (options.role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const find = (id: string) => {
    const c = store().find((x) => x.id === id);
    if (!c) throw fail(404, 'NOT_FOUND', 'Not found');
    return c;
  };
  const touch = (c: ContentItem, fields: Partial<ContentItem>) =>
    Object.assign(c, fields, { updatedAt: new Date().toISOString() });
  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(ContentQuery, query);
      return copy(store().filter(matches(q)).sort(byOrder));
    },
    create: async (body) => {
      await mockDelay();
      const input = parseInput(CreateContentRequest, body);
      manager();
      const created = item(next++, {
        ...input,
        category: input.category ?? null,
        description: input.description ?? null,
        body: input.body ?? null,
        url: input.url ?? null,
        iconKey: input.iconKey ?? null,
        sortOrder: input.sortOrder ?? 0,
        publishedAt: null,
        updatedAt: new Date().toISOString(),
      });
      store().push(created);
      return copy(created);
    },
    update: async (id, body) => {
      await mockDelay();
      const input = parseInput(UpdateContentRequest, body);
      manager();
      const c = find(id);
      // The edited item must still fit its kind, as the API checks.
      const problem = contentKindProblem({ ...c, ...input });
      if (problem) throw fail(400, 'VALIDATION_FAILED', problem);
      return copy(touch(c, input));
    },
    publish: async (id) => {
      await mockDelay();
      manager();
      const c = find(id);
      return copy(touch(c, { publishedAt: c.publishedAt ?? new Date().toISOString() }));
    },
    unpublish: async (id) => {
      await mockDelay();
      manager();
      return copy(touch(find(id), { publishedAt: null }));
    },
    remove: async (id) => {
      await mockDelay();
      manager();
      const c = find(id);
      rows = store().filter((x) => x !== c);
      return { ok: true };
    },
  };
}

/**
 * An in-memory `api.myContent(slug)`. `accountType: 'INDIVIDUAL'` shows the business rule:
 * resources and links are 403 BUSINESS_ONLY, and a list without `kind` holds only tips.
 */
export function createMyContentMock(
  options: { accountType?: 'INDIVIDUAL' | 'BUSINESS' } = {},
): MyContentClient {
  const business = (options.accountType ?? 'BUSINESS') === 'BUSINESS';
  return {
    list: async (query = {}) => {
      await mockDelay();
      const q = parseInput(MyContentQuery, query);
      if (!business && (q.kind === 'RESOURCE' || q.kind === 'EXTERNAL_LINK')) {
        throw fail(403, 'BUSINESS_ONLY', 'This area is for business clients');
      }
      return copy(
        store()
          .filter((c) => c.publishedAt !== null && (business || c.kind === 'TIP'))
          .filter(matches(q))
          .sort(byOrder)
          .map(({ publishedAt: _published, updatedAt: _updated, ...rest }) => rest),
      );
    },
  };
}
