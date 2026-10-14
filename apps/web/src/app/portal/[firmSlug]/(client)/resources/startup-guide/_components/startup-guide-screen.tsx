'use client';

import type { MyContentItem } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import {
  ArrowLeft,
  Building2,
  ChartNoAxesColumnIncreasing,
  CircleCheck,
  Ellipsis,
  FileText,
  GraduationCap,
  Heart,
  Lightbulb,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { ButtonLink } from '../../../../(public)/_components/button-link';
import { BusinessOnly, isBusinessOnly } from '../../_components/business-only';

type GuideRow = {
  key: string;
  title: string;
  aliases: string;
  icon: LucideIcon;
  summary: string;
  description: string;
  requirements: string[];
  steps: string[];
};

const defineRow = (
  key: string,
  title: string,
  aliases: string,
  icon: LucideIcon,
  summary: string,
  description: string,
  requirements: string,
  steps: string,
): GuideRow => ({
  key,
  title,
  aliases,
  icon,
  summary,
  description,
  requirements: requirements.split('|'),
  steps: steps.split('|'),
});

const guideRows: GuideRow[] = [
  defineRow(
    'sole',
    'Sole Proprietorship',
    'sole proprietorship',
    UserRound,
    'The simplest and most common business structure for individuals.',
    'Owned and operated by one person. Not a separate legal entity from the owner.',
    'Choose a business name (if different from your legal name)|Register a trade name (DBA) if needed|Obtain any required local licenses or permits',
    'Choose a business name|Register a DBA (if applicable)|Apply for local licenses/permits|Start doing business',
  ),
  defineRow(
    'partnership',
    'Partnership',
    'partnership',
    UsersRound,
    'A business owned by two or more people who share responsibilities and profits.',
    'Owned by two or more individuals. It can be general or limited, depending on involvement and liability.',
    'Choose a business name|Create a partnership agreement (recommended)|Register a DBA (if applicable)|Obtain required licenses/permits',
    'Choose a business name|Draft a partnership agreement|Register a DBA (if applicable)|Apply for licenses/permits|Start doing business',
  ),
  defineRow(
    'llc',
    'Limited Liability Company (LLC)',
    'limited liability company|llc',
    FileText,
    'A flexible structure that provides personal liability protection.',
    'A separate legal entity that protects owners (members) from personal liability. Offers flexibility in how it is taxed.',
    'File Articles of Organization with the state|Create an Operating Agreement (recommended)|Obtain an EIN (Tax ID Number)|Register a DBA (if applicable)|Obtain required licenses/permits',
    'Choose a business name|File Articles of Organization|Create an Operating Agreement|Get an EIN from the IRS|Apply for licenses/permits|Start doing business',
  ),
  defineRow(
    's-corp',
    'S Corporation',
    's corporation|s corp',
    ChartNoAxesColumnIncreasing,
    'A tax election for corporations that can provide significant tax advantages.',
    'A corporation that elects S Corporation tax status, allowing profits and losses to pass through to owners.',
    'Form a corporation (file Articles of Incorporation)|File IRS Form 2553 for S Corp election|Create corporate bylaws|Obtain an EIN (Tax ID Number)|Obtain required licenses/permits',
    'Form a corporation with the state|Create bylaws|Obtain an EIN|File Form 2553 with the IRS|Apply for licenses/permits|Start doing business',
  ),
  defineRow(
    'c-corp',
    'C Corporation',
    'c corporation|c corp',
    Building2,
    'A separate legal entity suited to larger businesses and those seeking to raise capital.',
    'A corporation that pays its own taxes. It can have unlimited shareholders and is often used for larger or growing businesses.',
    'File Articles of Incorporation|Create corporate bylaws|Hold an initial meeting (record minutes)|Obtain an EIN (Tax ID Number)|Obtain required licenses/permits',
    'Choose a business name|File Articles of Incorporation|Create bylaws and hold initial meeting|Obtain an EIN|Apply for licenses/permits|Start doing business',
  ),
  defineRow(
    'nonprofit',
    'Nonprofit Organization',
    'nonprofit organization|nonprofit',
    Heart,
    'A mission-driven organization focused on serving a public purpose.',
    'A tax-exempt organization formed for charitable, educational, religious, or other qualifying purposes.',
    'File Articles of Incorporation (nonprofit)|Create bylaws|Obtain an EIN (Tax ID Number)|Apply for 501(c)(3) tax-exempt status (if applicable)|Obtain required licenses/permits',
    'Choose a nonprofit name|File Articles of Incorporation|Create bylaws and hold initial meeting|Obtain an EIN|Apply for 501(c)(3) status (if applicable)|Start your mission',
  ),
  defineRow(
    'other',
    'Other Business Types',
    'other business types|limited liability partnership|professional corporation|llp|pc',
    Ellipsis,
    'There are other structures depending on your industry and goals.',
    'Includes options like Limited Liability Partnership (LLP), Professional Corporation (PC), and more.',
    'Requirements vary by business type and state|Consult with a tax professional to determine the best structure for your situation',
    'Research your industry requirements|File the appropriate formation documents|Obtain an EIN|Apply for required licenses/permits|Start doing business',
  ),
];

type ContentSections = { description: string[]; requirements: string[]; steps: string[] };

function parseBody(body: string | null): ContentSections {
  const result: ContentSections = { description: [], requirements: [], steps: [] };
  let active: keyof ContentSections | null = null;
  for (const rawLine of body?.split(/\r?\n/) ?? []) {
    const line = rawLine.replaceAll('**', '').trim();
    const heading = line.match(/^(Description|Requirements|Process to Start):?\s*(.*)$/i);
    if (heading) {
      active =
        heading[1]?.toLowerCase() === 'description'
          ? 'description'
          : heading[1]?.toLowerCase() === 'requirements'
            ? 'requirements'
            : 'steps';
      if (heading[2]) result[active].push(heading[2]);
    } else if (active && line) {
      result[active].push(line);
    }
  }
  return result;
}

function cleanLines(lines: string[], splitSemicolons = false): string[] {
  return lines.flatMap((line) => {
    const cleaned = line.replace(/^[-*]\s+|^\d+[.)]\s+/, '').trim();
    return splitSemicolons ? cleaned.split(/;\s*/).filter(Boolean) : cleaned ? [cleaned] : [];
  });
}

function plainText(value: string): string {
  return value
    .replaceAll('**', '')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

function matchesRow(title: string, row: GuideRow): boolean {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return row.aliases.split('|').some((alias) => {
    const candidate = alias
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    return normalized === candidate || normalized.startsWith(`${candidate} `);
  });
}

function fromContent(row: GuideRow, item: MyContentItem): GuideRow {
  const parsed = parseBody(item.body);
  const description = cleanLines(parsed.description).join(' ');
  return {
    ...row,
    key: item.id,
    summary: item.description || row.summary,
    description:
      description || item.description || (item.body ? plainText(item.body) : row.description),
    requirements: cleanLines(parsed.requirements, true).length
      ? cleanLines(parsed.requirements, true)
      : row.requirements,
    steps: cleanLines(parsed.steps).length ? cleanLines(parsed.steps) : row.steps,
  };
}

function fromAdditionalContent(item: MyContentItem): GuideRow {
  const parsed = parseBody(item.body);
  return {
    key: item.id,
    title: item.title,
    aliases: '',
    icon: Building2,
    summary: item.description || 'Business structure information from your firm.',
    description:
      cleanLines(parsed.description).join(' ') ||
      (item.body ? plainText(item.body) : 'More information from your firm.'),
    requirements: cleanLines(parsed.requirements, true),
    steps: cleanLines(parsed.steps),
  };
}

function rowsFor(items: MyContentItem[]): GuideRow[] {
  const used = new Set<string>();
  const knownRows = guideRows.flatMap((row) => {
    const matches = items.filter((item) => matchesRow(item.title, row));
    matches.forEach((item) => used.add(item.id));
    return matches.length ? matches.map((item) => fromContent(row, item)) : [row];
  });
  return [...knownRows, ...items.filter((item) => !used.has(item.id)).map(fromAdditionalContent)];
}

function GuideCell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0 lg:border-l lg:border-folder-border lg:px-3">
      <h3 className="mb-2 rounded-control bg-folder-surface px-2 py-1 text-sm font-bold text-heading">
        {title}
      </h3>
      {children}
    </div>
  );
}

function GuideRowCard({ row }: { row: GuideRow }) {
  const Icon = row.icon;
  return (
    <Card
      data-testid="resource-section"
      className="grid min-w-0 gap-3 p-3! lg:grid-cols-4 lg:gap-0"
    >
      <div className="flex min-w-0 items-start gap-3 lg:pr-3">
        <span className="grid size-14 shrink-0 place-items-center rounded-full bg-folder-surface text-firm-primary">
          <Icon aria-hidden className="size-8" />
        </span>
        <div className="min-w-0">
          <h2 className="font-display text-lg leading-tight font-bold text-heading">{row.title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-text">{row.summary}</p>
        </div>
      </div>
      <GuideCell title="Description">
        <p className="text-sm leading-relaxed text-text">{row.description}</p>
      </GuideCell>
      <GuideCell title="Requirements">
        <ul className="grid gap-1.5">
          {row.requirements.map((requirement) => (
            <li
              key={requirement}
              className="flex items-start gap-1.5 text-sm leading-snug text-text"
            >
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-firm-primary" />
              <span>{requirement}</span>
            </li>
          ))}
        </ul>
      </GuideCell>
      <GuideCell title="Process to Start">
        <ol className="grid gap-1.5">
          {row.steps.map((step, index) => (
            <li key={step} className="flex items-start gap-1.5 text-sm leading-snug text-text">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-firm-primary text-xs font-bold text-on-action">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </GuideCell>
    </Card>
  );
}

export function StartupGuideScreen() {
  const { firmSlug: slug } = useParams<{ firmSlug: string }>();
  const content = useApiQuery(['my-content', slug, 'RESOURCE', 'startup-guide'], () =>
    api.myContent(slug).list({ kind: 'RESOURCE', category: 'startup-guide' }),
  );
  return (
    <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-4">
      <header className="min-w-0 lg:col-span-3">
        <Link
          href={`/${slug}/business`}
          className="inline-flex items-center gap-2 text-firm-primary hover:underline"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to Resources
        </Link>
        <h1 className="mt-1 font-display text-4xl leading-tight font-bold text-heading md:text-5xl">
          Business Startup <span className="text-firm-accent">Guide</span>
        </h1>
        <p className="mt-1 text-sm leading-relaxed text-text md:text-base">
          Starting a business is an exciting step toward financial freedom. This guide provides a
          quick overview of the most common business classifications, along with the basic
          requirements and step-by-step process to get started.
        </p>
      </header>

      <Card className="grid content-start gap-3 border-folder-border! bg-folder-surface! p-4! lg:col-span-1">
        <div className="flex items-start gap-3">
          <Lightbulb aria-hidden className="size-10 shrink-0 text-firm-primary" />
          <div>
            <h2 className="font-display text-xl font-bold text-heading">Need Professional Help?</h2>
            <p className="mt-1 text-sm leading-relaxed text-text">
              Our team is here to help you choose the right business structure and guide you through
              the process.
            </p>
          </div>
        </div>
        <ButtonLink
          href={`/${slug}/appointments`}
          className="bg-firm-primary! hover:bg-navigation-hover!"
        >
          Schedule an Appointment
        </ButtonLink>
      </Card>

      <section aria-label="Business structures" className="grid min-w-0 gap-3 lg:col-span-4">
        {isBusinessOnly(content.error) ? (
          <BusinessOnly slug={slug} />
        ) : (
          <PageState query={content} empty="Your firm hasn't added anything here yet.">
            {(items) => (
              <div className="grid min-w-0 gap-3">
                {rowsFor(items).map((row) => (
                  <GuideRowCard key={row.key} row={row} />
                ))}
              </div>
            )}
          </PageState>
        )}
      </section>

      <Card className="flex min-w-0 flex-col gap-3 border-folder-border! bg-folder-surface! p-4! sm:flex-row sm:items-center lg:col-span-4">
        <GraduationCap aria-hidden className="size-12 shrink-0 text-firm-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-2xl font-bold text-heading">Still Have Questions?</h2>
          <p className="text-sm text-text">
            Our team is here to help you choose the right business structure and guide you through
            the entire process.
          </p>
        </div>
        <ButtonLink
          href={`/${slug}/appointments`}
          className="bg-firm-primary! hover:bg-navigation-hover! sm:max-w-64"
        >
          Schedule an Appointment
        </ButtonLink>
      </Card>
    </div>
  );
}
