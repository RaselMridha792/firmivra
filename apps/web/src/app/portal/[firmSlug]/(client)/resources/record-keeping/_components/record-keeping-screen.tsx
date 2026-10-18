'use client';

import type { MyContentItem } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  ChartColumn,
  BriefcaseBusiness,
  Car,
  CreditCard,
  Database,
  FileText,
  Folder,
  Handshake,
  Lightbulb,
  MessageSquareText,
  Receipt,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { BusinessOnly, isBusinessOnly } from '../../_components/business-only';

type RecordRow = {
  key?: string;
  icon: LucideIcon;
  title: string;
  keep: string[];
  why: string[];
  practices: string[];
  retention: string;
};

const records: RecordRow[] = [
  {
    icon: ChartColumn,
    title: 'Income Records',
    keep: ['Invoices, sales receipts, payment confirmations, 1099s, merchant statements'],
    why: ['Shows your revenue and helps verify income for taxes and loans.'],
    practices: [
      'Keep all records and reconcile with bank deposits.',
      'Use accounting software to track income.',
    ],
    retention: 'At least 7 years',
  },
  {
    icon: FileText,
    title: 'Business Expenses',
    keep: ['Receipts, invoices, bills, expense reports, bank/credit card statements'],
    why: ['Supports your tax deductions and reduces taxable income.'],
    practices: [
      'Categorize expenses (e.g., office, travel, supplies).',
      'Keep receipts for all purchases.',
    ],
    retention: 'At least 7 years',
  },
  {
    icon: Receipt,
    title: 'Receipts & Invoices',
    keep: ['Proof of purchase, vendor invoices, client invoices'],
    why: ['Verifies transactions and supports deductions.'],
    practices: ['Store digital copies and keep them organized by date and category.'],
    retention: 'At least 7 years',
  },
  {
    icon: CreditCard,
    title: 'Bank & Credit Card Statements',
    keep: ['Monthly statements, canceled checks, transaction details'],
    why: ['Helps reconcile income and expenses and verifies business activity.'],
    practices: ['Download and save statements monthly.', 'Match with your accounting records.'],
    retention: 'At least 7 years',
  },
  {
    icon: Car,
    title: 'Mileage & Vehicle Records',
    keep: ['Mileage logs, fuel receipts, maintenance records, insurance'],
    why: ['Supports vehicle expense deductions.'],
    practices: [
      'Keep a detailed mileage log (date, purpose, destination, miles).',
      'Save all related receipts.',
    ],
    retention: 'At least 7 years',
  },
  {
    icon: UsersRound,
    title: 'Payroll Records',
    keep: ['Employee pay stubs, payroll reports, tax filings (941), W-2s, 1099s'],
    why: ['Required for compliance and accurate tax reporting.'],
    practices: [
      'Use a payroll system and keep all payroll reports.',
      'Maintain copies of W-2s and 1099s.',
    ],
    retention: 'At least 7 years',
  },
  {
    icon: Handshake,
    title: 'Contractor Records',
    keep: ['Contracts, 1099s, invoices, proof of payment'],
    why: ['Required to report payments and avoid penalties.'],
    practices: [
      'Keep signed contracts and payment records.',
      'Issue and save 1099s annually (if applicable).',
    ],
    retention: 'At least 7 years',
  },
  {
    icon: BriefcaseBusiness,
    title: 'Assets & Equipment',
    keep: ['Purchase invoices, loan documents, depreciation records'],
    why: ['Used for depreciation deductions.'],
    practices: ['Keep purchase details, financing info, and depreciation schedule.'],
    retention: "At least 7 years (or the asset's useful life)",
  },
  {
    icon: FileText,
    title: 'Tax Documents',
    keep: ['Prior year tax returns, tax notices, correspondence with the IRS'],
    why: ['Helps with future filings, audits, and loan applications.'],
    practices: ['Keep a complete copy of all filed returns and IRS letters.'],
    retention: 'At least 7 years (keep permanently for major assets)',
  },
  {
    icon: Folder,
    title: 'Business Formation & Legal Records',
    keep: [
      'Articles of Organization/Incorporation, EIN confirmation, operating agreement, licenses, permits, contracts',
    ],
    why: ['Verifies your business structure and keeps you compliant.'],
    practices: ['Store in a secure digital folder.', 'Update when changes occur.'],
    retention: 'Keep permanently',
  },
];

const tips = [
  'Use cloud storage or accounting software.',
  'Keep a consistent file naming system.',
  'Back up your records regularly.',
  'Scan and save paper documents.',
  'Organize files by year and category.',
  'Restrict access to sensitive information.',
];

function bodyTableRow(body: string | null): [string, string, string] | undefined {
  const lines =
    body
      ?.split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean) ?? [];
  const tableLines = lines.filter((line) => line.startsWith('|'));
  if (lines.length !== 3 || tableLines.length !== 3) return undefined;
  const [header, separator, row] = tableLines;
  if (!header || !separator || !row || !/^\|?\s*:?-{3,}/.test(separator)) return undefined;
  const cells = row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
  const [keep, why, retention] = cells;
  if (keep === undefined || why === undefined || retention === undefined) return undefined;
  return [keep, why, retention];
}

function rowsWithFirmContent(items: MyContentItem[]): RecordRow[] {
  const known = new Set(records.map((record) => record.title.toLowerCase()));
  const itemsByTitle = new Map<string, MyContentItem[]>();
  for (const item of items) {
    const key = item.title.toLowerCase();
    itemsByTitle.set(key, [...(itemsByTitle.get(key) ?? []), item]);
  }
  const merged = records.flatMap((record) => {
    const matches = itemsByTitle.get(record.title.toLowerCase());
    if (!matches?.length) return [record];
    return matches.map((item): RecordRow => {
      const cells = bodyTableRow(item.body);
      if (!cells && !item.body && !item.description) return record;
      return {
        ...record,
        key: item.id,
        keep: cells ? [cells[0]] : item.body ? [item.body] : record.keep,
        why: cells ? [cells[1]] : [],
        practices: item.description ? [item.description] : cells ? record.practices : [],
        retention: cells?.[2] ?? (cells ? record.retention : ''),
      };
    });
  });
  const extra = items
    .filter((item) => !known.has(item.title.toLowerCase()))
    .map((item): RecordRow => {
      const cells = bodyTableRow(item.body);
      const detail = item.description ?? item.body ?? '';
      return {
        key: item.id,
        icon: FileText,
        title: item.title,
        keep: cells ? [cells[0]] : detail ? [detail] : [],
        why: cells?.[1] ? [cells[1]] : [],
        practices: [],
        retention: cells?.[2] ?? '',
      };
    });
  return [...merged, ...extra];
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="grid gap-1.5 text-sm leading-snug text-text">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-1.5">
          <span aria-hidden className="mt-1 size-1.5 shrink-0 rounded-full bg-firm-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function RecordCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-control border border-folder-border bg-surface p-3">
      <p className="mb-1 text-sm font-bold text-heading md:hidden">{label}</p>
      {children}
    </div>
  );
}

function RecordTable({ rows }: { rows: RecordRow[] }) {
  const headings = [
    'Record Type',
    'What to Keep',
    'Why It Matters',
    'Best Practices',
    'How Long to Keep',
  ];
  return (
    <div className="grid min-w-0 gap-2">
      <div className="hidden grid-cols-5 gap-2 md:grid">
        {headings.map((heading) => (
          <div
            key={heading}
            className="rounded-control border border-folder-border bg-folder-surface px-3 py-2 text-base font-bold text-heading"
          >
            {heading}
          </div>
        ))}
      </div>
      {rows.map(({ key, icon: Icon, title, keep, why, practices, retention }, index) => (
        <div key={key ?? `${title}-${index}`} className="grid min-w-0 gap-2 md:grid-cols-5">
          <RecordCell label="Record Type">
            <div className="flex items-center gap-2">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-folder-surface text-firm-text">
                <Icon aria-hidden className="size-6" />
              </span>
              <strong className="font-display text-base leading-tight text-heading">{title}</strong>
            </div>
          </RecordCell>
          <RecordCell label="What to Keep">
            <BulletList items={keep} />
          </RecordCell>
          <RecordCell label="Why It Matters">
            <BulletList items={why} />
          </RecordCell>
          <RecordCell label="Best Practices">
            <BulletList items={practices} />
          </RecordCell>
          <RecordCell label="How Long to Keep">
            <p className="text-sm leading-snug text-text">{retention}</p>
          </RecordCell>
        </div>
      ))}
    </div>
  );
}

function RecordKeepingDashboard({ slug, items }: { slug: string; items: MyContentItem[] }) {
  const rows = rowsWithFirmContent(items);
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-4">
      <header className="min-w-0 lg:col-span-3">
        <Link
          href={`/${slug}/business`}
          className="inline-flex items-center gap-2 text-firm-text hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to Resources
        </Link>
        <h1 className="mt-1 font-display text-3xl leading-tight font-bold text-heading md:text-4xl">
          Record Keeping <span className="text-firm-accent">Best Practices</span>
        </h1>
        <h2 className="text-base font-semibold text-heading md:text-lg">
          Stay organized. Stay compliant. Build a stronger business.
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-text">
          Good record keeping helps you track your income and expenses, stay prepared for tax
          season, make better business decisions, and protect your business in case of an audit.
          Below are the key records every small business should maintain, along with best practices,
          retention guidelines, and what to keep.
        </p>
      </header>

      <Card className="grid content-start gap-3 border-folder-border! bg-folder-surface! p-4! lg:col-span-1">
        <div className="flex items-start gap-3">
          <Lightbulb aria-hidden className="size-8 shrink-0 text-firm-text" />
          <div>
            <h2 className="font-display text-lg font-bold text-heading">Need Professional Help?</h2>
            <p className="mt-1 text-sm text-text">
              Our team can help you set up a record keeping system that works for your business.
            </p>
          </div>
        </div>
        <Link
          href={`/${slug}/appointments`}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-firm-button px-4 py-2 text-sm font-semibold text-on-firm-button hover:bg-firm-button-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-firm-primary"
        >
          Schedule an Appointment <ArrowRight aria-hidden className="size-4" />
        </Link>
      </Card>

      <section
        aria-label="Record keeping recommendations"
        className="grid min-w-0 gap-3 lg:col-span-4"
      >
        <RecordTable rows={rows} />
        <Card className="flex min-w-0 flex-col gap-3 border-folder-border! bg-folder-surface! p-4! md:flex-row md:items-center">
          <Database
            aria-hidden
            className="size-12 shrink-0 rounded-full bg-surface p-2.5 text-firm-text"
          />
          <div className="min-w-0 md:flex-1">
            <h2 className="font-display text-2xl font-bold text-heading">
              Digital Recordkeeping Tips
            </h2>
            <p className="text-base text-muted">Go Paperless. Stay Organized.</p>
          </div>
          <div className="min-w-0 md:flex-1">
            <BulletList items={tips} />
          </div>
          <p className="font-display text-right text-2xl font-bold text-firm-text italic md:flex-1">
            Organize Today
            <br />
            Greater Tomorrow
          </p>
        </Card>
        <Card className="flex flex-col gap-3 border-folder-border! bg-folder-surface! p-4! sm:flex-row sm:items-center">
          <MessageSquareText aria-hidden className="size-10 shrink-0 text-firm-text" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-bold text-heading">Still Have Questions?</h2>
            <p className="text-base text-text">
              Our team is here to help you set up a record keeping system that fits your business
              needs.
            </p>
          </div>
          <Link
            href={`/${slug}/appointments`}
            className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-control bg-firm-button px-4 py-2 text-base font-semibold text-on-firm-button hover:bg-firm-button-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-firm-primary"
          >
            Schedule an Appointment <ArrowRight aria-hidden className="size-4" />
          </Link>
        </Card>
      </section>
    </div>
  );
}

export function RecordKeepingScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const content = useApiQuery(['my-content', slug, 'RESOURCE', 'record-keeping'], () =>
    api.myContent(slug).list({ kind: 'RESOURCE', category: 'record-keeping' }),
  );
  if (isBusinessOnly(content.error)) return <BusinessOnly slug={slug} />;
  return (
    <PageState query={content} empty="Your firm hasn't added anything here yet.">
      {(items) => <RecordKeepingDashboard slug={slug} items={items} />}
    </PageState>
  );
}
