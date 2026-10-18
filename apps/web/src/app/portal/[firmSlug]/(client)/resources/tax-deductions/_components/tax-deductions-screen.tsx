'use client';

import type { MyContentItem } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import {
  ArrowLeft,
  Building2,
  CarFront,
  CircleCheck,
  Coins,
  FileText,
  GraduationCap,
  Handshake,
  House,
  Laptop,
  Lightbulb,
  Megaphone,
  Percent,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { ButtonLink } from '../../../../(public)/_components/button-link';
import { BusinessOnly, isBusinessOnly } from '../../_components/business-only';

type DeductionRow = {
  key: string;
  title: string;
  aliases: string[];
  icon: LucideIcon;
  covers: string;
  requirements: string[];
  proof: string[];
  timing: string;
};

const icons = {
  business: Building2,
  equipment: Laptop,
  vehicle: CarFront,
  home: House,
  people: UsersRound,
  contractor: Handshake,
  advertising: Megaphone,
  education: GraduationCap,
  interest: Percent,
  insurance: ShieldCheck,
  professional: FileText,
  retirement: Coins,
};
type DeductionSeed = [string, string, string, keyof typeof icons, string, string, string, string];
const deductionRows: DeductionRow[] = `
operating-expenses~Business Operating Expenses~operating expenses;business expenses~business~Regular day-to-day costs such as office supplies, software, postage, and subscriptions.~Ordinary and necessary;Directly related to business;Must be purchased during the tax year~Receipts;Invoices;Bank/credit card statements~In the year the expense is paid or incurred.
equipment~Equipment & Technology~equipment;technology~equipment~Computers, printers, phones, machinery, and other equipment used for your business.~Used for business purposes;Purchased, leased, or financed;May qualify for Section 179 or bonus depreciation~Receipts or invoices;Lease agreements;Business use documentation~In the year placed in service, or depreciated over time.
vehicle-expenses~Vehicle Expenses~vehicle expenses;vehicle~vehicle~Business vehicle costs, including mileage, fuel, maintenance, repairs, and insurance.~Used for business purposes;Track business mileage or actual expenses;Keep a contemporaneous log~Mileage log;Fuel receipts;Maintenance records;Insurance statements~In the year the expense is paid.
home-office~Home Office~home office~home~A portion of home expenses if you use a dedicated space regularly and exclusively for business.~Exclusive and regular use;Principal place of business or used to meet clients;Must meet IRS home office rules~Photos of the space;Utility bills;Rent or mortgage statements;Home insurance statements~In the year the expense is paid or incurred.
employee-wages~Employee Wages & Benefits~employee wages;wages and benefits;employee benefits~people~Salaries, wages, bonuses, and certain employee benefits.~Employees must be W-2;Reasonable compensation;Benefits must be allowed under IRS rules~Payroll reports;W-2s;Benefit statements;Proof of payment~In the year the wages and benefits are paid.
contractor-payments~Contractor Payments~contractor payments;contractor~contractor~Payments to independent contractors (1099) for services provided to your business.~Services must be for business purposes;Contractor must be properly classified;Issue a 1099-NEC if paid $600 or more in a year~Invoices;Contracts or agreements;Proof of payment;1099 records~In the year the payment is made.
advertising~Advertising & Marketing~advertising;marketing~advertising~Costs for promoting your business, including ads, social media, websites, and promotional materials.~Ordinary and necessary;Directly related to business;Must be for business promotion~Receipts;Invoices;Ad statements (for example, Facebook or Google)~In the year the expense is paid or incurred.
education~Education & Training~education;training~education~Courses, seminars, and training that maintain or improve skills for your current business.~Must relate to your current trade or business;Cannot be for a new trade or business~Receipts;Course invoices;Certificates of completion~In the year the expense is paid.
business-interest~Business Interest~business interest;interest~interest~Interest paid on business loans, lines of credit, and business credit cards.~Loan must be for business purposes;Keep proper documentation;Must be a legitimate loan or credit agreement~Loan statements;Interest statements (Form 1098);Bank/credit card statements~In the year the interest is paid.
insurance~Insurance Premiums~insurance premiums;insurance~insurance~Business liability, property, cybersecurity, and other required business insurance premiums.~Must be for business purposes;Must be required and ordinary~Insurance invoices;Proof of payment;Policy documents~In the year the premium is paid.
professional-services~Professional Services~professional services~professional~Fees paid to accountants, attorneys, consultants, and other professional service providers.~Services must be for business purposes;Must be ordinary and necessary~Invoices;Engagement letters;Proof of payment~In the year the expense is paid.
retirement-plans~Retirement Plans~retirement plans;retirement~retirement~Contributions to qualified plans such as SEP IRA, SIMPLE IRA, or Solo 401(k).~Must be a qualified plan;Contributions must meet IRS limits and rules~Plan documents;Contribution statements;Proof of payment~In the year the contribution is made.
`
  .trim()
  .split('\n')
  .map((line) => {
    const [key, title, aliases, icon, covers, requirements, proof, timing] = line.split(
      '~',
    ) as DeductionSeed;
    return {
      key,
      title,
      aliases: aliases.split(';'),
      icon: icons[icon],
      covers,
      requirements: requirements.split(';'),
      proof: proof.split(';'),
      timing,
    };
  });

type TableFields = Partial<Pick<DeductionRow, 'covers' | 'requirements' | 'proof' | 'timing'>>;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function plainText(value: string): string {
  return value
    .replaceAll('**', '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tableFields(body: string | null): TableFields {
  const lines = body?.split(/\r?\n/).filter((line) => line.trim().startsWith('|')) ?? [];
  if (lines.length < 3) return {};

  const cells = (line: string) =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => plainText(cell));
  const headers = cells(lines[0] ?? '').map(normalize);
  const data = lines.slice(2).map(cells);
  const get = (names: string[]) => {
    const column = headers.findIndex((header) => names.some((name) => header.includes(name)));
    return column < 0
      ? undefined
      : data
          .map((row) => row[column])
          .filter(Boolean)
          .join('; ');
  };
  const asList = (value: string | undefined) =>
    value
      ?.split(/;\s*|\s*•\s*/)
      .map((entry) => entry.trim())
      .filter(Boolean);

  const covers = get(['what it covers', 'covers', 'description']);
  const requirements = asList(get(['requirements', 'qualifies']));
  const proof = asList(get(['proof needed', 'proof', 'records']));
  const timing = get(['when it can be taken', 'when', 'timing']);
  return {
    ...(covers ? { covers } : {}),
    ...(requirements?.length ? { requirements } : {}),
    ...(proof?.length ? { proof } : {}),
    ...(timing ? { timing } : {}),
  };
}

function matchesItem(item: MyContentItem, row: DeductionRow): boolean {
  const title = normalize(item.title);
  return row.aliases.some(
    (alias) => title === normalize(alias) || title.includes(normalize(alias)),
  );
}

function fromItem(row: DeductionRow, item: MyContentItem): DeductionRow {
  const fields = tableFields(item.body);
  const bodyText = item.body ? plainText(item.body) : '';
  return {
    ...row,
    title: item.title || row.title,
    covers: item.description || fields.covers || bodyText || row.covers,
    requirements: fields.requirements ?? row.requirements,
    proof: fields.proof ?? row.proof,
    timing: fields.timing || row.timing,
  };
}

function fromAdditionalItem(item: MyContentItem): DeductionRow {
  const fields = tableFields(item.body);
  return {
    key: item.id,
    title: item.title,
    aliases: [],
    icon: FileText,
    covers: item.description || fields.covers || (item.body ? plainText(item.body) : ''),
    requirements: fields.requirements ?? [],
    proof: fields.proof ?? [],
    timing: fields.timing || '',
  };
}

function rowsFor(items: MyContentItem[]): DeductionRow[] {
  const matched = new Map<string, MyContentItem>();
  const additional: MyContentItem[] = [];
  for (const item of items) {
    const row = deductionRows.find((candidate) => matchesItem(item, candidate));
    if (row) matched.set(row.key, item);
    else additional.push(item);
  }
  return [
    ...deductionRows.map((row) => {
      const item = matched.get(row.key);
      return item ? fromItem(row, item) : row;
    }),
    ...additional.map(fromAdditionalItem),
  ];
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted">—</span>;
  if (items.length === 1) return <p>{items[0]}</p>;
  return (
    <ul className="grid gap-1">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-1.5">
          <CircleCheck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-firm-accent" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DeductionCard({ row }: { row: DeductionRow }) {
  const Icon = row.icon;
  return (
    <div
      role="row"
      className="grid min-w-0 grid-cols-1 overflow-hidden rounded-card border border-folder-border bg-surface text-xs leading-snug text-text lg:grid-cols-5"
      data-testid="resource-section"
    >
      <div
        role="cell"
        className="flex min-w-0 items-center gap-3 border-b border-folder-border p-3 last:border-b-0 lg:border-r lg:border-b-0"
      >
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-folder-surface text-firm-text">
          <Icon aria-hidden className="size-7" />
        </span>
        <h2 className="font-display text-base leading-tight font-bold text-heading">{row.title}</h2>
      </div>
      <div
        role="cell"
        className="min-w-0 border-b border-folder-border p-3 last:border-b-0 lg:border-r lg:border-b-0"
      >
        <p className="mb-1 font-semibold text-heading lg:sr-only">What It Covers</p>
        <p>{row.covers || '—'}</p>
      </div>
      <div
        role="cell"
        className="min-w-0 border-b border-folder-border p-3 last:border-b-0 lg:border-r lg:border-b-0"
      >
        <p className="mb-1 font-semibold text-heading lg:sr-only">Requirements</p>
        <BulletList items={row.requirements} />
      </div>
      <div
        role="cell"
        className="min-w-0 border-b border-folder-border p-3 last:border-b-0 lg:border-r lg:border-b-0"
      >
        <p className="mb-1 font-semibold text-heading lg:sr-only">Proof Needed</p>
        <BulletList items={row.proof} />
      </div>
      <div role="cell" className="min-w-0 p-3">
        <p className="mb-1 font-semibold text-heading lg:sr-only">When It Can Be Taken</p>
        <p>{row.timing || '—'}</p>
      </div>
    </div>
  );
}

export function TaxDeductionsScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const content = useApiQuery(['my-content', slug, 'RESOURCE', 'tax-deductions'], () =>
    api.myContent(slug).list({ kind: 'RESOURCE', category: 'tax-deductions' }),
  );

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-4">
      <header className="min-w-0 lg:col-span-3">
        <Link
          href={`/${slug}/business`}
          className="inline-flex items-center gap-2 text-firm-text hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to Resources
        </Link>
        <h1 className="mt-1 font-display text-4xl leading-tight font-bold text-firm-text md:text-5xl">
          Tax Deductions for <span className="text-firm-accent">Small Businesses</span>
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-text md:text-base">
          Reduce your tax liability and keep more of what you earn. Here are some of the most common
          tax deductions for small businesses, along with the requirements, the type of proof
          needed, and when each deduction can be taken.
        </p>
      </header>

      <Card className="grid content-start gap-3 border-folder-border! bg-folder-surface! p-4! lg:col-span-1">
        <div className="flex items-start gap-3">
          <Lightbulb aria-hidden className="size-10 shrink-0 text-firm-text" />
          <div>
            <h2 className="font-display text-xl font-bold text-heading">Need Professional Help?</h2>
            <p className="mt-1 text-sm leading-relaxed text-text">
              Not sure which deductions apply to your business? Our team can help you review your
              situation and provide guidance.
            </p>
          </div>
        </div>
        <ButtonLink
          href={`/${slug}/appointments`}
          className="bg-firm-button! hover:bg-firm-button-hover!"
        >
          Schedule an Appointment
        </ButtonLink>
      </Card>

      <section aria-label="Small business tax deductions" className="min-w-0 lg:col-span-4">
        {isBusinessOnly(content.error) ? (
          <BusinessOnly slug={slug} />
        ) : (
          <PageState query={content} empty="Your firm hasn't added anything here yet.">
            {(items) => (
              <div
                role="table"
                aria-label="Tax deductions for small businesses"
                className="grid min-w-0 gap-2"
              >
                <div
                  role="row"
                  className="hidden grid-cols-5 gap-2 text-sm font-semibold text-heading lg:grid"
                >
                  {[
                    'Deduction',
                    'What It Covers',
                    'Requirements',
                    'Proof Needed',
                    'When It Can Be Taken',
                  ].map((heading) => (
                    <div
                      key={heading}
                      role="columnheader"
                      className="rounded-control border border-folder-border bg-folder-surface px-3 py-2"
                    >
                      {heading}
                    </div>
                  ))}
                </div>
                <div className="grid min-w-0 gap-2">
                  {rowsFor(items).map((row) => (
                    <DeductionCard key={row.key} row={row} />
                  ))}
                </div>
              </div>
            )}
          </PageState>
        )}
      </section>

      <Card className="flex min-w-0 flex-col gap-3 border-folder-border! bg-folder-surface! p-4! sm:flex-row sm:items-center lg:col-span-4">
        <Lightbulb aria-hidden className="size-12 shrink-0 text-firm-text" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-bold text-heading">
            Have Questions About Your Deductions?
          </h2>
          <p className="text-sm text-text">
            Our team is here to help you maximize your deductions and stay compliant.
          </p>
        </div>
        <ButtonLink
          href={`/${slug}/appointments`}
          className="bg-firm-button! hover:bg-firm-button-hover! sm:max-w-64"
        >
          Schedule an Appointment
        </ButtonLink>
      </Card>
    </div>
  );
}
