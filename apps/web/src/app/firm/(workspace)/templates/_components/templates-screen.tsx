'use client';

import type { MessageTemplateRow, TemplatesSummary } from '@firmivra/types';
import { Button, type Column, Select, Table, Toast } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  PaintBrush,
  CaretRight,
  Clock,
  Code,
  FileText,
  FolderOpen,
  Lightbulb,
  MagnifyingGlass,
  Plus,
  UploadSimple,
  UsersThree,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { TemplateMenu } from './template-actions';
import {
  BrandingDialog,
  CategoriesDialog,
  ImportDialog,
  MergeFieldsDialog,
} from './template-dialogs';
import {
  KINDS,
  KindTile,
  StatusPill,
  TEMPLATES_KEY,
  TEMPLATE_ERRORS,
  card,
  dayText,
  gold,
  kindOf,
  linkBtn,
  quiet,
  type KindMeta,
} from './templates-shared';

const TABS = [
  { id: 'all', label: 'All Templates' },
  { id: 'mine', label: 'My Templates' },
  { id: 'shared', label: 'Shared with Me' },
  { id: 'favorites', label: 'Favorites' },
] as const;
type TabId = (typeof TABS)[number]['id'];

const countOf = (s: TemplatesSummary | undefined, kind: KindMeta['kind']) =>
  s
    ? s.categories.filter((c) => c.kind === kind).reduce((n, c) => n + c.templateCount, 0) +
      (s.uncategorized.find((u) => u.kind === kind)?.templateCount ?? 0)
    : undefined;

const TIPS: [typeof Lightbulb, string][] = [
  [FileText, 'Use merge fields to personalize messages automatically.'],
  [Clock, 'Keep templates short, clear, and client-friendly.'],
  [FolderOpen, 'Organize templates into categories for easy access.'],
  [MagnifyingGlass, 'Preview with sample data before saving.'],
];

/** /templates: the library home: kinds, recent templates, tools and tips. */
export function TemplatesScreen() {
  const [tab, setTab] = useState<TabId>('all');
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [showAll, setShowAll] = useState(false);
  const [dialog, setDialog] = useState<
    'import' | 'fields' | 'branding' | 'categories' | undefined
  >();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const term = useDeferredValue(search.trim());
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const summary = useApiQuery([...TEMPLATES_KEY, 'summary'], () => api.templates.summary());
  const starters = useApiQuery([...TEMPLATES_KEY, 'starters'], () => api.templates.starters());
  const s = summary.data;
  const filtering = tab !== 'all' || categoryId !== '' || term !== '' || showAll;
  const results = useApiQuery([...TEMPLATES_KEY, 'home-results', tab, categoryId, term, page], () =>
    api.templates.list({
      tab,
      ...(categoryId ? { categoryId } : {}),
      ...(term ? { search: term } : {}),
      page,
      pageSize: 10,
    }),
  );
  const install = useApiMutation(() => api.templates.installStarters(), {
    invalidate: [...TEMPLATES_KEY],
  });
  const empty = s !== undefined && s.total === 0 && !filtering;

  const columns: Column<MessageTemplateRow>[] = [
    {
      id: 'name',
      label: 'Name',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <KindTile kind={r.kind} size="sm" />
          <Link
            href={`/templates/${r.id}/edit`}
            data-testid="template-link"
            className="font-medium text-link hover:underline"
          >
            {r.name}
          </Link>
        </span>
      ),
    },
    { id: 'kind', label: 'Type', cell: (r) => kindOf(r.kind).noun },
    { id: 'category', label: 'Category', cell: (r) => r.category?.name ?? '—' },
    { id: 'updated', label: 'Last Edited', cell: (r) => dayText(r.updatedAt) },
    { id: 'by', label: 'Updated By', cell: (r) => r.updatedBy?.name ?? r.owner.name },
    { id: 'status', label: 'Status', cell: (r) => <StatusPill status={r.status} /> },
  ];

  const tool = (
    icon: typeof Plus,
    title: string,
    text: string,
    action: { href: string } | { onClick: () => void },
  ) => {
    const Glyph = icon;
    const body = (
      <>
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-info-soft text-action"
        >
          <Glyph weight="fill" className="size-6" />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block text-sm font-semibold text-heading">{title}</span>
          <span className="block text-xs text-muted">{text}</span>
        </span>
        <CaretRight aria-hidden weight="bold" className="size-4 shrink-0 text-muted" />
      </>
    );
    const cls =
      'flex w-full items-center gap-3 border-t border-divider py-2 first:border-t-0 hover:bg-canvas';
    return 'href' in action ? (
      <Link key={title} href={action.href} className={cls}>
        {body}
      </Link>
    ) : (
      <button key={title} type="button" onClick={action.onClick} className={cls}>
        {body}
      </button>
    );
  };

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="templates-page">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/" aria-label="Home" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/" className="text-link">
          Home
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Templates</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <FileText aria-hidden weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-bold text-heading">Templates</h1>
            <p className="text-xl font-semibold text-action">Create once. Use everywhere.</p>
            <p className="text-base text-muted">
              Save time, maintain consistency, and deliver a professional client experience.
            </p>
          </div>
        </div>
        <Link href="/templates/new" className={gold}>
          <Plus aria-hidden weight="bold" className="size-5" /> Create Template
        </Link>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="Template views"
          role="tablist"
          className="flex overflow-x-auto border-b border-divider"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => {
                setTab(t.id);
                setPage(1);
              }}
              className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${tab === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
            >
              {t.label}
              {s ? <span className="sr-only"> ({t.id === 'all' ? s.total : s[t.id]})</span> : null}
            </button>
          ))}
        </nav>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Select
              label="Category"
              hideLabel
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All Categories' },
                ...(s?.categories ?? []).map((c) => ({
                  value: c.id,
                  label: `${kindOf(c.kind).noun} · ${c.name}`,
                })),
              ]}
            />
          </div>
          <label className="flex h-10 w-64 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
            <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
            <span className="sr-only">Search templates</span>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search templates..."
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
          </label>
        </div>
      </div>

      {empty && (starters.data?.available ?? 0) > starters.data!.installed ? (
        <section
          className={`${card} flex flex-wrap items-center justify-between gap-3`}
          data-testid="starters-callout"
        >
          <div>
            <h2 className="font-display text-lg font-bold text-heading">
              Start with {starters.data?.available} ready-made templates
            </h2>
            <p className="text-sm text-text">
              Welcome emails, reminders, invoices and more. You can edit every one of them.
            </p>
          </div>
          <Button
            disabled={install.isPending}
            onClick={() =>
              install.mutate(undefined, {
                onSuccess: (r) => notice(`${r.installed} starter templates installed.`, 'success'),
                onError: (e) => notice(errorMessage(e, TEMPLATE_ERRORS), 'error'),
              })
            }
          >
            Install starter templates
          </Button>
        </section>
      ) : null}

      {filtering ? (
        <section className={card} aria-label="Matching templates" data-testid="home-results">
          {showAll ? (
            <button type="button" className={`${linkBtn} mb-3`} onClick={() => setShowAll(false)}>
              <ArrowLeft aria-hidden weight="bold" className="size-3" /> Back to all kinds
            </button>
          ) : null}
          <div className="relative">
            <Table
              rows={results.data?.items ?? []}
              columns={columns}
              rowKey={(r) => r.id}
              caption="Matching templates"
              dense
              noun="templates"
              pageSize={10}
              loading={results.isPending}
              emptyTitle={results.isError ? 'Templates are not available' : 'No templates match'}
              emptyText={
                results.isError
                  ? 'We could not load the templates. Try again in a moment.'
                  : 'Try another tab, category or search.'
              }
              rowActions={(r) => <TemplateMenu row={r} onNotice={notice} />}
              server={{
                page: results.data?.page ?? 1,
                total: results.data?.total ?? 0,
                hasNext: (results.data?.page ?? 1) * 10 < (results.data?.total ?? 0),
                hasPrevious: (results.data?.page ?? 1) > 1,
                onNext: () => setPage(page + 1),
                onPrevious: () => setPage(Math.max(1, page - 1)),
                onPage: (n: number) => setPage(n),
                onSort: () => undefined,
              }}
            />
          </div>
        </section>
      ) : (
        <ul
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
          data-testid="kind-cards"
          aria-label="Template kinds"
        >
          {KINDS.map((k) => {
            const n = countOf(s, k.kind);
            return (
              <li key={k.kind}>
                <Link
                  href={`/templates/library/${k.slug}`}
                  data-testid={`kind-${k.slug}`}
                  className="flex h-full flex-col gap-3 rounded-xl bg-surface p-4 shadow-md hover:ring-2 hover:ring-action"
                >
                  <span className="flex items-start gap-3">
                    <KindTile kind={k.kind} />
                    <span className="min-w-0">
                      <span className="block text-base font-bold text-heading">{k.title}</span>
                      <span className="block text-sm text-muted">{k.blurb}</span>
                    </span>
                  </span>
                  <span className="mt-auto flex items-center justify-between text-sm text-text">
                    {n === undefined
                      ? summary.isError
                        ? 'Not available'
                        : '…'
                      : `${n} ${n === 1 ? 'template' : 'templates'}`}
                    <span
                      aria-hidden
                      className="flex size-9 items-center justify-center rounded-full border border-action text-action"
                    >
                      <ArrowRight weight="bold" className="size-4" />
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <section className={card} aria-label="Recent Templates" data-testid="recent">
          <header className="mb-3 flex items-center justify-between">
            <h2 className="font-display text-lg font-bold text-heading">Recent Templates</h2>
            <button type="button" className={linkBtn} onClick={() => setShowAll(true)}>
              View All <ArrowRight aria-hidden weight="bold" className="size-3" />
            </button>
          </header>
          {(s?.recent ?? []).length === 0 ? (
            <p className={quiet}>
              {summary.isPending
                ? 'Loading…'
                : summary.isError
                  ? 'Recent templates are not available right now.'
                  : 'No templates yet. Create one to see it here.'}
            </p>
          ) : (
            <ul>
              {(s?.recent ?? []).map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 border-t border-divider py-2 text-sm first:border-t-0"
                >
                  <KindTile kind={r.kind} size="sm" />
                  <Link
                    href={`/templates/${r.id}/edit`}
                    className="min-w-0 flex-1 truncate font-medium text-link hover:underline"
                  >
                    {r.name}
                  </Link>
                  <span className="hidden w-24 shrink-0 text-text md:block">
                    {kindOf(r.kind).noun}
                  </span>
                  <span className="hidden w-28 shrink-0 text-text md:block">
                    {dayText(r.updatedAt)}
                  </span>
                  <span className="hidden w-28 shrink-0 truncate text-text lg:block">
                    {r.updatedBy?.name ?? r.owner.name}
                  </span>
                  <Link
                    href={`/modules/communications?template=${r.id}`}
                    className="inline-flex min-h-9 items-center rounded-control bg-info-soft px-4 text-sm font-semibold text-action hover:bg-accent-soft"
                  >
                    Use<span className="sr-only"> {r.name}</span>
                  </Link>
                  <TemplateMenu row={r} onNotice={notice} />
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={card} aria-label="Template Tools" data-testid="tools">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Template Tools</h2>
          {tool(Plus, 'Create Template', 'Build a new template from scratch.', {
            href: '/templates/new',
          })}
          {tool(UploadSimple, 'Import Template', 'Import from HTML or text.', {
            onClick: () => setDialog('import'),
          })}
          {tool(Code, 'Merge Fields', 'Use dynamic fields like [Client Name].', {
            onClick: () => setDialog('fields'),
          })}
          {tool(PaintBrush, 'Branding & Letterhead', 'Use your company footer and signature.', {
            onClick: () => setDialog('branding'),
          })}
          {tool(FolderOpen, 'Template Categories', 'Manage and reorder categories.', {
            onClick: () => setDialog('categories'),
          })}
        </section>
        <section className={`${card} bg-surface`} aria-label="Quick Tips" data-testid="tips">
          <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading">
            <Lightbulb aria-hidden weight="fill" className="size-5 text-gold" /> Quick Tips
          </h2>
          <ul className="flex flex-col">
            {TIPS.map(([Glyph, text]) => (
              <li
                key={text}
                className="flex items-start gap-3 border-t border-divider py-2 text-sm text-text first:border-t-0"
              >
                <Glyph
                  aria-hidden
                  weight="regular"
                  className="mt-0.5 size-5 shrink-0 text-action"
                />
                {text}
              </li>
            ))}
          </ul>
          <p className="mt-3 flex items-center gap-2 rounded-lg bg-info-soft p-3 text-sm font-semibold text-heading">
            <UsersThree aria-hidden weight="fill" className="size-5 text-action" />
            Templates save time. Consistency builds trust.
          </p>
        </section>
      </div>

      {dialog === 'import' ? (
        <ImportDialog
          onClose={() => setDialog(undefined)}
          onDone={(name, removed) => {
            setDialog(undefined);
            notice(
              `${name} imported as a draft${removed ? `; ${removed} unsafe part(s) were removed` : ''}.`,
              'success',
            );
          }}
        />
      ) : null}
      {dialog === 'fields' ? <MergeFieldsDialog onClose={() => setDialog(undefined)} /> : null}
      {dialog === 'branding' ? (
        <BrandingDialog
          onClose={() => setDialog(undefined)}
          onDone={() => {
            setDialog(undefined);
            notice('Branding saved.', 'success');
          }}
        />
      ) : null}
      {dialog === 'categories' ? <CategoriesDialog onClose={() => setDialog(undefined)} /> : null}
    </div>
  );
}
