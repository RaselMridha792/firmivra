'use client';

import type { MessageTemplateRow, MessageTemplatesQuery } from '@firmivra/types';
import { BulkBar, Button, type Column, Input, Modal, Select, Table, Toast } from '@firmivra/ui';
import {
  Archive,
  ArrowLeft,
  Eye,
  FolderOpen,
  MagnifyingGlass,
  Plus,
  Star,
  Tag,
  UploadSimple,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { TemplateMenu } from './template-actions';
import { CategoriesDialog, ImportDialog, PreviewDialog } from './template-dialogs';
import {
  KindTile,
  StatusPill,
  TEMPLATES_KEY,
  TEMPLATE_ERRORS,
  card,
  dayText,
  gold,
  kindBySlug,
  outlined,
  quiet,
} from './templates-shared';

const SORTS: {
  value: string;
  label: string;
  sort: NonNullable<MessageTemplatesQuery['sort']>;
  direction: 'asc' | 'desc';
}[] = [
  { value: 'updated', label: 'Sort: Last Updated', sort: 'updated', direction: 'desc' },
  { value: 'name', label: 'Sort: Name', sort: 'name', direction: 'asc' },
  { value: 'uses', label: 'Sort: Most Used', sort: 'uses', direction: 'desc' },
  { value: 'category', label: 'Sort: Category', sort: 'category', direction: 'asc' },
  { value: 'status', label: 'Sort: Status', sort: 'status', direction: 'asc' },
];

/** /templates/library/[kind]: the library of one kind: categories, filters, the table and bulk actions. */
export function LibraryScreen({ slug }: { slug: string }) {
  const meta = kindBySlug(slug);
  const kind = meta?.kind ?? 'EMAIL';
  const [categoryId, setCategoryId] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [owner, setOwner] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState('updated');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<MessageTemplateRow>();
  const [dialog, setDialog] = useState<'import' | 'categories' | 'category' | 'tag' | undefined>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const term = useDeferredValue(search.trim());
  const notice = (text: string, tone: 'success' | 'error') => setMessage({ text, tone });
  const picked = SORTS.find((x) => x.value === sort) ?? SORTS[0]!;
  const query: MessageTemplatesQuery = {
    tab: 'all',
    kind,
    ...(categoryId ? { categoryId } : {}),
    ...(status ? { status: status as 'ACTIVE' } : {}),
    ...(owner ? { ownerUserId: owner } : {}),
    ...(tag ? { tag } : {}),
    ...(term ? { search: term } : {}),
    sort: picked.sort,
    direction: picked.direction,
    page,
    pageSize: 10,
  };
  const list = useApiQuery([...TEMPLATES_KEY, 'library', query], () => api.templates.list(query));
  const cats = useApiQuery([...TEMPLATES_KEY, 'categories', kind], () =>
    api.templates.categories({ kind }),
  );
  const everything = useApiQuery([...TEMPLATES_KEY, 'library-tags', kind], () =>
    api.templates.list({ kind, pageSize: 100 }),
  );
  const team = useApiQuery([...TEMPLATES_KEY, 'members'], () => api.team.list());
  const options = { invalidate: [...TEMPLATES_KEY] };
  const favorite = useApiMutation(
    (r: MessageTemplateRow) =>
      r.favorite ? api.templates.unfavorite(r.id) : api.templates.favorite(r.id),
    options,
  );
  const bulk = useApiMutation(
    (body: Parameters<typeof api.templates.bulk>[0]) => api.templates.bulk(body),
    options,
  );

  if (!meta) {
    return (
      <div className="flex flex-col gap-3">
        <Link href="/templates" className="text-sm font-medium text-link">
          Back to Templates
        </Link>
        <p className={`${card} ${quiet}`}>That kind of template does not exist.</p>
      </div>
    );
  }
  const categories = cats.data ?? [];
  const total = categories.reduce((n, c) => n + c.templateCount, 0);
  const tags = [...new Set((everything.data?.items ?? []).flatMap((r) => r.tags))].sort();
  const rows = list.data?.items ?? [];
  const reset = () => {
    setSearch('');
    setStatus('');
    setOwner('');
    setTag('');
    setPage(1);
  };
  const run = (body: Parameters<typeof api.templates.bulk>[0], done: string) =>
    bulk.mutate(body, {
      onSuccess: (r) => {
        setSelected([]);
        setDialog(undefined);
        notice(
          `${r.updated} ${done}${r.skipped.length ? `, ${r.skipped.length} skipped (${r.skipped[0]?.reason})` : ''}.`,
          'success',
        );
      },
      onError: (e) => notice(errorMessage(e, TEMPLATE_ERRORS), 'error'),
    });

  const columns: Column<MessageTemplateRow>[] = [
    {
      id: 'name',
      label: 'Template Name',
      cell: (r) => (
        <span className="flex min-w-48 items-start gap-1">
          <button
            type="button"
            aria-label={
              r.favorite ? `Remove ${r.name} from favorites` : `Add ${r.name} to favorites`
            }
            aria-pressed={r.favorite}
            onClick={() =>
              favorite.mutate(r, {
                onError: (e) => notice(errorMessage(e, TEMPLATE_ERRORS), 'error'),
              })
            }
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg hover:bg-canvas"
          >
            <Star
              aria-hidden
              weight={r.favorite ? 'fill' : 'regular'}
              className={`size-5 ${r.favorite ? 'text-gold' : 'text-muted'}`}
            />
          </button>
          <span className="block">
            <Link
              href={`/templates/${r.id}/edit`}
              data-testid="template-link"
              className="font-semibold text-heading hover:underline"
            >
              {r.name}
            </Link>
            {r.description ? (
              <span className="block text-xs text-muted">{r.description}</span>
            ) : null}
          </span>
        </span>
      ),
    },
    {
      id: 'subject',
      label: 'Subject Line',
      cell: (r) => <span className="block min-w-40 text-xs text-text">{r.subject ?? '—'}</span>,
    },
    {
      id: 'category',
      label: 'Category',
      cell: (r) =>
        r.category ? (
          <span className="rounded-md bg-info-soft px-2 py-0.5 text-xs font-medium text-heading">
            {r.category.name}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'tags',
      label: 'Tags',
      className: 'hidden 2xl:table-cell',
      cell: (r) =>
        r.tags.length ? (
          <span className="flex min-w-28 flex-wrap gap-1">
            {r.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="rounded-md bg-warning-soft px-1.5 py-0.5 text-xs text-heading"
              >
                {t}
              </span>
            ))}
          </span>
        ) : (
          '—'
        ),
    },
    {
      id: 'updated',
      label: 'Last Updated',
      cell: (r) => <span className="whitespace-nowrap">{dayText(r.updatedAt)}</span>,
    },
    {
      id: 'owner',
      label: 'Owner',
      cell: (r) => <span className="whitespace-nowrap">{r.owner.name}</span>,
    },
    { id: 'uses', label: 'Uses', cell: (r) => r.useCount },
    { id: 'status', label: 'Status', cell: (r) => <StatusPill status={r.status} /> },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="library-page">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/templates" aria-label="Back to Templates" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/templates" className="text-link">
          Templates
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">{meta.title}</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <KindTile kind={kind} size="lg" />
          <div className="min-w-0">
            <h1 className="font-display text-4xl font-bold text-heading">{meta.title}</h1>
            <p className="text-base text-muted">{meta.blurb}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={outlined} onClick={() => setDialog('import')}>
            <UploadSimple aria-hidden weight="bold" className="size-4" /> Import Template
          </button>
          <Link href={`/templates/new?kind=${kind}`} className={gold} data-testid="create-template">
            <Plus aria-hidden weight="bold" className="size-5" /> Create {meta.noun} Template
          </Link>
        </div>
      </header>
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}

      <nav
        aria-label="Subcategories"
        role="tablist"
        className="relative flex overflow-x-auto border-b border-divider"
      >
        {[{ id: '', name: 'All Templates' }, ...categories].map((c) => (
          <button
            key={c.id || 'all'}
            type="button"
            role="tab"
            aria-selected={categoryId === c.id}
            onClick={() => {
              setCategoryId(c.id);
              setPage(1);
              setSelected([]);
            }}
            className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${categoryId === c.id ? 'border-gold font-semibold text-heading' : 'border-transparent font-medium text-link hover:text-heading'}`}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <div className="grid items-start gap-4 xl:grid-cols-[15rem_minmax(0,1fr)]">
        <aside aria-label="Categories" className={card} data-testid="category-sidebar">
          <h2 className="mb-2 font-display text-lg font-bold text-heading">Categories</h2>
          <ul className="flex flex-col gap-1">
            {[{ id: '', name: 'All Categories', templateCount: total }, ...categories].map((c) => (
              <li key={c.id || 'all'}>
                <button
                  type="button"
                  aria-pressed={categoryId === c.id}
                  onClick={() => {
                    setCategoryId(c.id);
                    setPage(1);
                    setSelected([]);
                  }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${categoryId === c.id ? 'bg-warning-soft font-semibold text-heading' : 'text-text hover:bg-canvas'}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FolderOpen aria-hidden weight="fill" className="size-4 shrink-0 text-action" />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className="rounded-pill bg-canvas px-2 py-0.5 text-xs font-semibold text-heading">
                    {c.templateCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {categories.length === 0 && !cats.isPending ? (
            <p className="mt-2 text-xs text-muted">
              {cats.isError ? 'Categories are not available right now.' : 'No categories yet.'}
            </p>
          ) : null}
          <button
            type="button"
            className={`${outlined} mt-3 w-full`}
            onClick={() => setDialog('categories')}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add New Category
          </button>
        </aside>

        <section className={card} aria-label="Templates">
          <form
            aria-label="Template filters"
            className="mb-3 flex flex-wrap items-end gap-3"
            onSubmit={(e) => e.preventDefault()}
          >
            <label className="flex h-10 min-w-48 flex-1 items-center gap-2 rounded-lg border border-divider bg-canvas px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
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
            <div className="w-36">
              <Select
                label="Status"
                hideLabel
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'ACTIVE', label: 'Active' },
                  { value: 'DRAFT', label: 'Draft' },
                  { value: 'ARCHIVED', label: 'Archived' },
                ]}
              />
            </div>
            <div className="w-40">
              <Select
                label="Owner"
                hideLabel
                value={owner}
                onChange={(e) => {
                  setOwner(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All Owners' },
                  ...(team.data ?? [])
                    .filter((m) => m.status === 'ACTIVE')
                    .map((m) => ({ value: m.user.id, label: m.user.name })),
                ]}
              />
            </div>
            <div className="w-36">
              <Select
                label="Tag"
                hideLabel
                value={tag}
                onChange={(e) => {
                  setTag(e.target.value);
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'Tag' },
                  ...tags.map((t) => ({ value: t, label: t })),
                ]}
              />
            </div>
            <div className="w-48">
              <Select
                label="Sort"
                hideLabel
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                }}
                options={SORTS.map((x) => ({ value: x.value, label: x.label }))}
              />
            </div>
            <button type="button" className="text-sm font-medium text-link" onClick={reset}>
              Clear
            </button>
          </form>
          {selected.length > 0 ? (
            <div className="mb-3">
              <BulkBar
                count={selected.length}
                noun="templates"
                actions={[
                  { label: 'Category', icon: FolderOpen, onClick: () => setDialog('category') },
                  { label: 'Add Tag', icon: Tag, onClick: () => setDialog('tag') },
                  {
                    label: 'Archive',
                    icon: Archive,
                    danger: true,
                    onClick: () =>
                      run({ action: 'ARCHIVE', ids: selected, confirm: true }, 'archived'),
                  },
                ]}
              />
            </div>
          ) : null}
          <div className="relative" data-testid="library-table">
            <Table
              rows={rows}
              columns={columns}
              rowKey={(r) => r.id}
              caption={meta.title}
              dense
              noun="templates"
              pageSize={10}
              loading={list.isPending}
              emptyTitle={list.isError ? 'Templates are not available' : 'No templates'}
              emptyText={
                list.isError
                  ? 'We could not load the templates. Try again in a moment.'
                  : `Create a ${meta.noun} template to get started.`
              }
              emptyAction={
                <Link
                  href={`/templates/new?kind=${kind}`}
                  className="inline-flex min-h-11 items-center rounded-control bg-gold px-4 text-sm font-semibold text-on-action"
                >
                  Create {meta.noun} Template
                </Link>
              }
              selection={{ selected, onChange: setSelected }}
              rowActions={(r) => (
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPreview(r)}
                    aria-label={`Preview ${r.name}`}
                    className="inline-flex min-h-9 items-center gap-1 rounded-control border border-border bg-surface px-3 text-sm font-medium text-heading hover:bg-canvas"
                  >
                    <Eye aria-hidden weight="fill" className="size-4" /> Preview
                  </button>
                  <Link
                    href={`/modules/communications?template=${r.id}`}
                    aria-label={`Use ${r.name}`}
                    className="inline-flex min-h-9 items-center rounded-control bg-gold px-4 text-sm font-semibold text-on-action hover:opacity-90"
                  >
                    Use
                  </Link>
                  <TemplateMenu row={r} onNotice={notice} />
                </span>
              )}
              server={{
                page: list.data?.page ?? 1,
                total: list.data?.total ?? 0,
                hasNext: (list.data?.page ?? 1) * 10 < (list.data?.total ?? 0),
                hasPrevious: (list.data?.page ?? 1) > 1,
                onNext: () => setPage(page + 1),
                onPrevious: () => setPage(Math.max(1, page - 1)),
                onPage: (n: number) => setPage(n),
                onSort: () => undefined,
              }}
            />
          </div>
        </section>
      </div>

      {preview ? <PreviewDialog template={preview} onClose={() => setPreview(undefined)} /> : null}
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
      {dialog === 'categories' ? (
        <CategoriesDialog initialKind={kind} onClose={() => setDialog(undefined)} />
      ) : null}
      {dialog === 'category' ? (
        <PickDialog
          title="Set Category"
          label="Category"
          options={[
            { value: '', label: 'No category' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
          onClose={() => setDialog(undefined)}
          onApply={(v) =>
            run({ action: 'SET_CATEGORY', ids: selected, categoryId: v || null }, 'updated')
          }
        />
      ) : null}
      {dialog === 'tag' ? (
        <TagDialog
          onClose={() => setDialog(undefined)}
          onApply={(t) => run({ action: 'ADD_TAG', ids: selected, tag: t }, 'tagged')}
        />
      ) : null}
    </div>
  );
}

function PickDialog({
  title,
  label,
  options,
  onClose,
  onApply,
}: {
  title: string;
  label: string;
  options: { value: string; label: string }[];
  onClose: () => void;
  onApply: (value: string) => void;
}) {
  const [v, setV] = useState('');
  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(v)}>Apply</Button>
        </>
      }
    >
      <Select label={label} value={v} onChange={(e) => setV(e.target.value)} options={options} />
    </Modal>
  );
}
function TagDialog({ onClose, onApply }: { onClose: () => void; onApply: (tag: string) => void }) {
  const [v, setV] = useState('');
  return (
    <Modal
      open
      title="Add Tag"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!v.trim()} onClick={() => onApply(v.trim())}>
            Apply
          </Button>
        </>
      }
    >
      <Input label="Tag" value={v} maxLength={40} onChange={(e) => setV(e.target.value)} />
    </Modal>
  );
}
