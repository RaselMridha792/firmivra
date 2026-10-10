'use client';

import type { MyDocumentRequest } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import {
  BookOpen,
  ChevronRight,
  CloudUpload,
  FolderOpen,
  Landmark,
  ListChecks,
  type LucideIcon,
  Percent,
  Rocket,
  ChartColumn,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';
import { STATUS } from '../../../services/_components/service-card';

const open = (r: MyDocumentRequest) => r.status === 'REQUESTED' || r.status === 'REJECTED';
const due = (date: string) =>
  new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

function Panel({
  id,
  icon: Icon,
  title,
  intro,
  more,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  intro: string;
  more?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <Card className="grid min-w-0 content-start gap-3">
      <header className="flex items-start gap-3">
        <Icon aria-hidden className="size-8 shrink-0 text-firm-primary" />
        <div className="flex-1">
          <h2 id={id} className="font-display text-xl font-bold text-heading">
            {title}
          </h2>
          <p className="text-sm text-muted">{intro}</p>
        </div>
        {more ? (
          <Link className="text-sm text-link underline" href={more.href}>
            {more.label}
          </Link>
        ) : null}
      </header>
      {children}
    </Card>
  );
}

/** "Business Action Items": the firm's open document requests, each with Upload Now. */
export function ActionItems({ slug }: { slug: string }) {
  const requests = useApiQuery(['my-documents', slug, 'requests'], () =>
    api.myDocuments(slug).requests(),
  );
  return (
    <Panel
      id="action-items"
      icon={ListChecks}
      title="Business Action Items"
      intro="Items that need your attention."
      more={{ href: `/${slug}/documents`, label: 'View All' }}
    >
      <PageState query={requests}>
        {(items) => {
          const todo = items.filter(open);
          return todo.length === 0 ? (
            <p className="text-sm text-text">You&apos;re all caught up.</p>
          ) : (
            <ul aria-labelledby="action-items" className="grid gap-2">
              {todo.map((r) => (
                <li key={r.id} className="flex gap-2">
                  <CloudUpload aria-hidden className="size-5 shrink-0 text-firm-primary" />
                  <div className="grid flex-1 gap-1">
                    <span className="text-sm text-text">{r.title}</span>
                    <span className="flex flex-wrap gap-x-4 text-sm">
                      {r.dueOn ? <span className="text-danger">Due {due(r.dueOn)}</span> : null}
                      <Link className="text-link underline" href={`/${slug}/documents`}>
                        Upload Now
                      </Link>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          );
        }}
      </PageState>
    </Panel>
  );
}

/** "My Business Services": the active and pending services, with their status. */
export function BusinessServices({ slug }: { slug: string }) {
  const services = useApiQuery(['my-services', slug], () => api.myServices(slug).list());
  return (
    <Panel
      id="business-services"
      icon={ChartColumn}
      title="My Business Services"
      intro="Track the status of your active services."
      more={{ href: `/${slug}/services`, label: 'View All' }}
    >
      <PageState query={services}>
        {(items) => (
          <ul aria-labelledby="business-services" className="grid gap-2">
            {items
              .filter((s) => s.status === 'ACTIVE' || s.status === 'PENDING')
              .map((s) => {
                const [label, tone] = STATUS[s.status];
                return (
                  <li key={s.id}>
                    <Link
                      href={`/${slug}/services`}
                      className="flex flex-wrap items-center gap-2 rounded-control p-1 hover:bg-folder-hover"
                    >
                      <span className="flex-1 text-sm font-medium text-heading">{s.title}</span>
                      {s.stage ? <span className="text-sm text-muted">{s.stage}</span> : null}
                      <Badge tone={tone}>{label}</Badge>
                      <ChevronRight aria-hidden className="size-4 text-firm-accent" />
                    </Link>
                  </li>
                );
              })}
          </ul>
        )}
      </PageState>
    </Panel>
  );
}

const RESOURCES: [LucideIcon, string, string, string][] = [
  [
    Landmark,
    'IRS & Business Taxes',
    'Official IRS tools and information for businesses.',
    'external-links',
  ],
  [
    Rocket,
    'Business Setup & Compliance',
    'Resources to start, register, and stay compliant.',
    'startup-guide',
  ],
  [
    FolderOpen,
    'Record Keeping Resources',
    'Best practices, tools, and guides for business record keeping.',
    'record-keeping',
  ],
  [
    Users,
    'Payroll Resources',
    'Information and tools for payroll setup, tax filings, and compliance.',
    'payroll',
  ],
  [
    Percent,
    'Tax Deductions for Small Business',
    'Learn about eligible deductions and expense categories.',
    'tax-deductions',
  ],
];

/** "Helpful Resources": the resource pages and the external links. */
export function HelpfulResources({ slug }: { slug: string }) {
  return (
    <Panel
      id="helpful-resources"
      icon={BookOpen}
      title="Helpful Resources"
      intro="Guides and trusted links for your business."
    >
      <ul aria-labelledby="helpful-resources" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {RESOURCES.map(([Icon, title, text, path]) => (
          <li key={path}>
            <Link
              href={`/${slug}/resources/${path}`}
              className="flex h-full gap-3 rounded-card border border-folder-border p-3 hover:bg-folder-hover"
            >
              <Icon aria-hidden className="size-8 shrink-0 text-firm-primary" />
              <span>
                <span className="block font-semibold text-heading">{title}</span>
                <span className="block text-sm text-text">{text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
