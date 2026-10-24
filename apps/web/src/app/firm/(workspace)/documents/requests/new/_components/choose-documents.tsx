'use client';

import type { DocumentCategory, RequestTemplate } from '@firmivra/types';
import { Avatar, Callout, IconTile, type KpiTone, Skeleton, Tabs, Toggle } from '@firmivra/ui';
import {
  CalendarBlank,
  CheckCircle,
  DotsSixVertical,
  Eye,
  FileText,
  Files,
  Info,
  MagnifyingGlass,
  Plus,
  User,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import {
  CUSTOM,
  type DraftErrors,
  type DraftItem,
  formatDue,
  itemKey,
  type RequestDraft,
  selectedItems,
} from './request-draft';
import { DocIcon, ItemDialog, itemMenu, moveItem, newItem, Section } from './request-sections';

const TONES: KpiTone[] = ['purple', 'green', 'blue', 'amber', 'purple', 'red', 'green', 'blue'];

const count = (n: number) => `${n} ${n === 1 ? 'document' : 'documents'}`;

function TemplateCard({
  title,
  description,
  documents,
  tone,
  chosen,
  action,
  onUse,
}: {
  title: string;
  description: string;
  documents: number;
  tone: KpiTone;
  chosen: boolean;
  action: string;
  onUse: () => void;
}) {
  return (
    <li
      data-testid="template-card"
      className={`relative flex flex-col items-center gap-2 rounded-card border p-3 text-center ${chosen ? 'border-action bg-info-soft' : 'border-border bg-surface'}`}
    >
      {chosen ? (
        <CheckCircle
          aria-label="Chosen"
          weight="fill"
          className="absolute top-2 right-2 size-6 text-action"
        />
      ) : null}
      <IconTile icon={FileText} tone={tone} />
      <span className="font-semibold text-heading">{title}</span>
      <span className="line-clamp-2 min-h-10 text-sm text-muted">{description}</span>
      <span className="mt-auto flex w-full items-center justify-between gap-2 pt-1">
        <span className="text-xs whitespace-nowrap text-muted">{count(documents)}</span>
        <button
          type="button"
          onClick={onUse}
          aria-label={`${action}: ${title}`}
          className="min-h-8 rounded-control border border-action bg-surface px-2 text-xs font-medium whitespace-nowrap text-action hover:bg-accent-soft"
        >
          {action}
        </button>
      </span>
    </li>
  );
}

function TemplateGrid({
  templates,
  chosen,
  onUse,
  custom,
  empty,
}: {
  templates: RequestTemplate[] | null;
  chosen: string;
  onUse: (t: RequestTemplate) => void;
  custom?: ReactNode;
  empty: string;
}) {
  if (!templates)
    return (
      <p className="py-6 text-center text-sm text-muted">
        Templates could not be loaded right now.
      </p>
    );
  if (!templates.length && !custom)
    return <p className="py-6 text-center text-sm text-muted">{empty}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {templates.map((t, n) => (
        <TemplateCard
          key={t.id}
          title={t.name}
          description={t.description ?? `${count(t.items.length)} to request.`}
          documents={t.items.length}
          tone={TONES[n % TONES.length]!}
          chosen={chosen === t.id}
          action="Use Template"
          onUse={() => onUse(t)}
        />
      ))}
      {custom}
    </ul>
  );
}

/**
 * "Add Individual Documents": the firm's document types and every template's documents, one
 * line each; Add puts one on the request.
 */
function IndividualDocuments({
  categories,
  templates,
  items,
  term,
  onAdd,
}: {
  categories: DocumentCategory[] | null;
  templates: RequestTemplate[];
  items: DraftItem[];
  term: string;
  onAdd: (item: DraftItem) => void;
}) {
  const seen = new Set<string>();
  const pool: { title: string; description: string; categoryId: string | null }[] = [];
  const add = (title: string, description: string | null, categoryId: string | null) => {
    const k = title.trim().toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    pool.push({ title, description: description ?? '', categoryId });
  };
  for (const t of templates)
    for (const i of t.items) add(i.title, i.description, i.category?.id ?? null);
  for (const c of categories ?? []) add(c.name, null, c.id);
  const have = new Set(items.map((i) => i.title.trim().toLowerCase()));
  const shown = pool
    .filter((p) => !term || p.title.toLowerCase().includes(term))
    .sort((a, b) => a.title.localeCompare(b.title));
  if (!shown.length)
    return (
      <p className="py-6 text-center text-sm text-muted">
        {pool.length
          ? 'No documents match your search.'
          : 'No document types or templates yet. Add a custom document below.'}
      </p>
    );
  return (
    <ul
      aria-label="Documents to add"
      className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2"
    >
      {shown.map((p) => {
        const added = have.has(p.title.trim().toLowerCase());
        return (
          <li
            key={p.title}
            className="flex items-center gap-3 rounded-control border border-border px-3 py-2"
          >
            <DocIcon />
            <span className="min-w-0 flex-1 truncate text-sm text-heading">{p.title}</span>
            <button
              type="button"
              disabled={added}
              onClick={() =>
                onAdd({
                  key: itemKey(),
                  title: p.title,
                  description: p.description,
                  required: true,
                  categoryId: p.categoryId,
                  selected: true,
                  templateId: null,
                })
              }
              aria-label={added ? `${p.title} is on the request` : `Add ${p.title}`}
              className="min-h-9 rounded-control px-3 text-sm font-medium text-action hover:bg-accent-soft disabled:text-muted disabled:hover:bg-transparent"
            >
              {added ? 'Added' : 'Add'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** 2. Selected Documents: the ticked documents in order (drag, or Move Up and Down). */
function SelectedDocuments({
  draft,
  onItems,
  errors,
}: {
  draft: RequestDraft;
  onItems: (items: DraftItem[]) => void;
  errors: DraftErrors;
}) {
  const [editing, setEditing] = useState<DraftItem | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const rows = draft.items.filter((i) => i.selected);
  const set = (key: string, next: Partial<DraftItem>) =>
    onItems(draft.items.map((i) => (i.key === key ? { ...i, ...next } : i)));
  return (
    <Section
      title="2. Selected Documents"
      subtitle="Review the documents that will be requested."
      testId="selected-documents"
      action={
        rows.length ? (
          <button
            type="button"
            onClick={() => onItems(draft.items.map((i) => ({ ...i, selected: false })))}
            className="text-sm font-medium text-action underline"
          >
            Clear All
          </button>
        ) : null
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="bg-canvas text-left text-xs font-semibold text-heading">
              <th scope="col" className="w-8 px-2 py-2">
                <span className="sr-only">Order</span>
              </th>
              <th scope="col" className="px-3 py-2">
                Document Name
              </th>
              <th scope="col" className="px-3 py-2">
                Description (optional)
              </th>
              <th scope="col" className="w-24 px-3 py-2">
                Required
              </th>
              <th scope="col" className="w-20 px-3 py-2 text-center">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted">
                  No documents selected yet. Use a template or add documents above.
                </td>
              </tr>
            ) : (
              rows.map((item) => (
                <tr
                  key={item.key}
                  data-testid="selected-item"
                  draggable
                  onDragStart={() => setDragging(item.key)}
                  onDragEnd={() => setDragging(null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging)
                      onItems(
                        moveItem(
                          draft.items,
                          dragging,
                          draft.items.findIndex((i) => i.key === item.key),
                        ),
                      );
                    setDragging(null);
                  }}
                  className={`border-b border-divider ${dragging === item.key ? 'opacity-50' : ''}`}
                >
                  <td className="px-2 py-2 text-muted">
                    <DotsSixVertical aria-hidden weight="bold" className="size-5 cursor-grab" />
                  </td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-3">
                      <DocIcon />
                      <span className="text-heading">{item.title}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-text">
                    {item.description || <span className="text-muted">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <Toggle
                      label={`${item.title} is required`}
                      checked={item.required}
                      onChange={(required) => set(item.key, { required })}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    {itemMenu(draft.items, item, onItems, setEditing)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {errors['items'] ? (
        <p role="alert" className="text-sm font-medium text-danger">
          {errors['items']}
        </p>
      ) : null}
      <button
        type="button"
        onClick={() => setEditing(newItem())}
        className="inline-flex items-center gap-2 self-start font-medium text-action underline"
      >
        <Plus aria-hidden weight="bold" className="size-4" />
        Add Custom Document
      </button>
      <ItemDialog
        item={editing}
        onClose={() => setEditing(null)}
        onSave={(saved) => {
          onItems(
            draft.items.some((i) => i.key === saved.key)
              ? draft.items.map((i) => (i.key === saved.key ? saved : i))
              : [...draft.items, saved],
          );
          setEditing(null);
        }}
      />
    </Section>
  );
}

function SummaryRow({
  icon: Glyph,
  label,
  children,
}: {
  icon: typeof User;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1.5rem_6rem_minmax(0,1fr)] items-start gap-2">
      <Glyph aria-hidden weight="fill" className="mt-0.5 size-5 text-action" />
      <dt className="font-semibold text-heading">{label}</dt>
      <dd className="min-w-0 text-text">{children}</dd>
    </div>
  );
}

/** The right column: Request Summary, the tip, and the chosen template's documents. */
function SummaryRail({ draft, types }: { draft: RequestDraft; types: RequestTemplate[] }) {
  const type = types.find((t) => t.id === draft.typeId);
  const typeName = draft.typeId === CUSTOM ? 'Custom' : (type?.name ?? '—');
  return (
    <aside className="flex min-w-0 flex-col gap-4" aria-label="Request summary">
      <section
        className="rounded-card border border-border bg-surface p-4"
        data-testid="request-summary"
      >
        <h2 className="mb-3 flex items-center gap-2 font-display text-xl font-bold text-heading">
          <Files aria-hidden weight="fill" className="size-6 text-action" />
          Request Summary
        </h2>
        <dl className="flex flex-col gap-3 text-sm">
          <SummaryRow icon={FileText} label="Template">
            {typeName}
          </SummaryRow>
          <SummaryRow icon={FileText} label="Documents Selected">
            {selectedItems(draft).length}
          </SummaryRow>
          <SummaryRow icon={User} label="Recipient">
            {draft.client ? (
              <span className="flex items-center gap-2">
                <Avatar name={draft.client.displayName} size="sm" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-heading">
                    {draft.client.displayName}
                  </span>
                  {draft.client.email ? (
                    <span className="block truncate text-xs text-muted">{draft.client.email}</span>
                  ) : null}
                </span>
              </span>
            ) : (
              '—'
            )}
          </SummaryRow>
          <SummaryRow icon={CalendarBlank} label="Due Date">
            {formatDue(draft.dueOn) || '—'}
          </SummaryRow>
        </dl>
      </section>
      <Callout icon={Info} iconStyle="disc" tone="blue" surface="info" title="Tip">
        You can always add or remove documents before sending. Each document can be marked as
        required or optional.
      </Callout>
      <section
        className="rounded-card border border-border bg-surface p-4"
        data-testid="template-preview"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-base font-bold whitespace-nowrap text-heading">
            <Eye aria-hidden weight="bold" className="size-5 text-action" />
            Template Preview
          </h2>
          <Link
            href="/documents/requests"
            className="text-xs font-medium whitespace-nowrap text-action underline"
          >
            View All Templates
          </Link>
        </div>
        {type?.items.length ? (
          <ul className="flex flex-col divide-y divide-divider">
            {type.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2 text-sm text-heading">
                <DocIcon />
                {i.title}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            {draft.typeId === CUSTOM
              ? 'A custom request starts with no documents.'
              : 'Choose a template to see its documents.'}
          </p>
        )}
      </section>
    </aside>
  );
}

/** Step 2, Select Documents (Frame 4, second image). */
export function ChooseDocumentsStep({
  draft,
  types,
  saved,
  categories,
  loading,
  onType,
  onUseTemplate,
  onItems,
  errors,
}: {
  draft: RequestDraft;
  /** The firm's request types, or null when they could not be loaded. */
  types: RequestTemplate[] | null;
  /** The signed-in member's saved lists. */
  saved: RequestTemplate[] | null;
  categories: DocumentCategory[] | null;
  loading: boolean;
  onType: (typeId: string) => void;
  onUseTemplate: (id: string) => void;
  onItems: (items: DraftItem[]) => void;
  errors: DraftErrors;
}) {
  const [tab, setTab] = useState('templates');
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const match = (list: RequestTemplate[] | null) =>
    list && term ? list.filter((t) => t.name.toLowerCase().includes(term)) : list;
  const panel = loading ? (
    <Skeleton className="h-48" />
  ) : tab === 'templates' ? (
    <TemplateGrid
      templates={match(types)}
      chosen={draft.typeId}
      onUse={(t) => onType(t.id)}
      empty="No templates match your search."
      custom={
        !term ? (
          <TemplateCard
            title="Custom Form"
            description="Start with a blank list and add your own documents."
            documents={0}
            tone="grey"
            chosen={draft.typeId === CUSTOM}
            action="Create Custom"
            onUse={() => onType(CUSTOM)}
          />
        ) : undefined
      }
    />
  ) : tab === 'individual' ? (
    <IndividualDocuments
      categories={categories}
      templates={[...(types ?? []), ...(saved ?? [])]}
      items={draft.items}
      term={term}
      onAdd={(item) => onItems([...draft.items, item])}
    />
  ) : (
    <TemplateGrid
      templates={match(saved)}
      chosen=""
      onUse={(t) => onUseTemplate(t.id)}
      empty={term ? 'No saved lists match your search.' : 'No saved lists yet.'}
    />
  );

  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <Section
          title="1. Choose Documents"
          subtitle="Select from a template or choose individual documents. You can add custom items if needed."
          testId="choose-documents"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Tabs
              label="Choose documents by"
              variant="segmented"
              value={tab}
              onChange={setTab}
              items={[
                { id: 'templates', label: 'Use a Template' },
                { id: 'individual', label: 'Add Individual Documents' },
                { id: 'saved', label: 'My Saved Lists' },
              ]}
            />
            <label className="flex min-h-11 w-full items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm sm:w-64">
              <MagnifyingGlass aria-hidden weight="bold" className="size-4 text-muted" />
              <span className="sr-only">
                {tab === 'individual' ? 'Search documents' : 'Search templates'}
              </span>
              <input
                type="search"
                maxLength={100}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tab === 'individual' ? 'Search documents…' : 'Search templates…'}
                className="min-h-0 w-full bg-transparent text-text outline-none"
              />
            </label>
          </div>
          {panel}
        </Section>
        <SelectedDocuments draft={draft} onItems={onItems} errors={errors} />
      </div>
      <SummaryRail draft={draft} types={types ?? []} />
    </div>
  );
}
