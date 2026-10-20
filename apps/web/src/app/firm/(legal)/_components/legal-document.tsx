import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card, PageContainer } from '@firmivra/ui';
import { BrandLockup } from '../../../../components/app-shell/brand-lockup';
import { COMPANY, isPending, LEGAL_PATHS } from '../../../../lib/company';

export type LegalBlock =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  /** A boxed paragraph (a one-cell table in the docx). */
  | { kind: 'note'; text: string }
  /** The contact details, from lib/company.ts. */
  | { kind: 'contact' }
  /** The governing law and venue, from lib/company.ts. */
  | { kind: 'venue' };

export interface LegalDocumentText {
  title: string;
  subtitle: string;
  effective: string;
  updated: string;
  sections: { id: string; title: string; blocks: LegalBlock[] }[];
}

type LegalPage = keyof typeof LEGAL_PATHS;

const PAGES: { id: LegalPage; label: string }[] = [
  { id: 'privacy', label: 'Privacy Policy' },
  { id: 'terms', label: 'Terms of Service' },
];

const { address } = COMPANY;
const MAILING_ADDRESS = [
  address.line1,
  address.line2,
  address.city,
  `${address.state} ${address.postalCode}`,
  address.country,
].join(', ');

function Email({ value }: { value: string }) {
  return (
    <a href={`mailto:${value}`} className="text-link hover:underline">
      {value}
    </a>
  );
}

/** The docx's contact fields, with the details Octavia confirmed; pending ones are left out. */
function contactRows(page: LegalPage): [string, ReactNode][] {
  const rows: [string, ReactNode | null][] =
    page === 'privacy'
      ? [
          ['Legal entity name', isPending(COMPANY.legalName) ? null : COMPANY.legalName],
          ['Privacy email', <Email key="privacy" value={COMPANY.privacyEmail} />],
          ['Support email', <Email key="support" value={COMPANY.supportEmail} />],
          ['Mailing address', MAILING_ADDRESS],
          ['Telephone', COMPANY.phone],
        ]
      : [
          ['Legal entity', isPending(COMPANY.legalName) ? null : COMPANY.legalName],
          ['Legal email', <Email key="legal" value={COMPANY.legalEmail} />],
          ['Support email', <Email key="support" value={COMPANY.supportEmail} />],
          ['Mailing address', MAILING_ADDRESS],
          ['Phone', COMPANY.phone],
        ];
  return rows.filter((row): row is [string, ReactNode] => row[1] !== null);
}

function venueRows(): [string, ReactNode][] {
  return [
    ['Governing law', COMPANY.governingLaw],
    ...(isPending(COMPANY.county)
      ? []
      : ([['Exclusive courts/venue', COMPANY.county]] as [string, ReactNode][])),
  ];
}

function Fields({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 rounded-control border border-divider p-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="font-semibold text-heading">{label}</dt>
          <dd className="mb-2 text-text sm:mb-0">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ block, page, caption }: { block: LegalBlock; page: LegalPage; caption: string }) {
  switch (block.kind) {
    case 'paragraph':
      return <p>{block.text}</p>;
    case 'list':
      return (
        <ul className="flex list-disc flex-col gap-2 pl-6 marker:text-muted">
          {block.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      );
    case 'note':
      return (
        <p className="rounded-control border-l-4 border-action bg-info-soft p-4 text-heading">
          {block.text}
        </p>
      );
    case 'table':
      return (
        <div className="relative w-full max-w-full overflow-x-auto rounded-control border border-divider">
          <table
            className={`w-full text-left text-sm ${block.head.length > 2 ? 'min-w-[36rem]' : ''}`}
          >
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="bg-table-head text-heading">
                {block.head.map((cell) => (
                  <th key={cell} scope="col" className="px-4 py-3 font-semibold">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {block.rows.map((row) => (
                <tr key={row[0]} className="align-top">
                  {block.head.map((column) => {
                    const cell = row[block.head.indexOf(column)];
                    return column === block.head[0] ? (
                      <th key={column} scope="row" className="px-4 py-3 font-semibold text-heading">
                        {cell}
                      </th>
                    ) : (
                      <td key={column} className="px-4 py-3 text-text">
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'contact':
      return <Fields rows={contactRows(page)} />;
    case 'venue':
      return <Fields rows={venueRows()} />;
  }
}

/** Blocks never repeat inside a section, so their text keys them. */
function blockKey(block: LegalBlock): string {
  switch (block.kind) {
    case 'paragraph':
    case 'note':
      return block.text;
    case 'list':
      return block.items.join();
    case 'table':
      return block.head.join();
    default:
      return block.kind;
  }
}

function Contents({ doc }: { doc: LegalDocumentText }) {
  return (
    <ol className="flex flex-col gap-0.5 text-sm">
      {doc.sections.map((section) => (
        <li key={section.id}>
          <a
            href={`#${section.id}`}
            className="block rounded-control px-2 py-1.5 text-text hover:bg-accent-soft hover:text-heading"
          >
            {section.title}
          </a>
        </li>
      ))}
    </ol>
  );
}

/**
 * One of Firmivra's own legal pages (Privacy Policy, Terms of Service), public on the firm
 * workspace host. The text is the docx's, word for word; the contact and venue details come from
 * lib/company.ts.
 */
export function LegalDocument({ doc, page }: { doc: LegalDocumentText; page: LegalPage }) {
  return (
    <main className="min-h-screen bg-canvas py-6 sm:py-10">
      <PageContainer>
        <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <BrandLockup subtitle="Legal" />
          <nav aria-label="Legal" className="flex flex-wrap gap-2">
            {PAGES.map((item) => (
              <Link
                key={item.id}
                href={LEGAL_PATHS[item.id]}
                aria-current={item.id === page ? 'page' : undefined}
                className={`inline-flex min-h-10 items-center rounded-control px-3 text-base font-medium ${item.id === page ? 'bg-accent-soft text-heading' : 'text-link hover:underline'}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>

        <header className="mb-6">
          <h1
            data-testid="page-title"
            className="font-display text-4xl font-bold tracking-tight text-heading md:text-5xl"
          >
            {doc.title}
          </h1>
          <p className="mt-1 text-lg text-muted">{doc.subtitle}</p>
          <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm text-text">
            <div className="flex gap-1">
              <dt className="font-semibold text-heading">Effective date:</dt>
              <dd>{doc.effective}</dd>
            </div>
            <div className="flex gap-1">
              <dt className="font-semibold text-heading">Last updated:</dt>
              <dd>{doc.updated}</dd>
            </div>
          </dl>
        </header>

        <div className="grid gap-6 lg:grid-cols-[17rem_minmax(0,1fr)] lg:items-start">
          <details className="rounded-card bg-surface p-4 shadow-sm lg:hidden">
            <summary className="cursor-pointer font-semibold text-heading">Contents</summary>
            <nav aria-label="Contents" className="mt-3">
              <Contents doc={doc} />
            </nav>
          </details>
          <nav
            aria-label="Contents"
            className="sticky top-6 hidden max-h-[calc(100vh-3rem)] overflow-y-auto rounded-card bg-surface p-4 shadow-sm lg:block"
          >
            <h2 className="mb-2 px-2 font-semibold text-heading">Contents</h2>
            <Contents doc={doc} />
          </nav>

          <Card variant="elevated" className="flex min-w-0 flex-col gap-10 sm:p-8">
            {doc.sections.map((section) => (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="flex scroll-mt-6 flex-col gap-4 text-base leading-7 text-text"
              >
                <h2 id={`${section.id}-title`} className="text-xl font-bold text-heading">
                  {section.title}
                </h2>
                {section.blocks.map((block) => (
                  <Block key={blockKey(block)} block={block} page={page} caption={section.title} />
                ))}
              </section>
            ))}
          </Card>
        </div>
      </PageContainer>
    </main>
  );
}
