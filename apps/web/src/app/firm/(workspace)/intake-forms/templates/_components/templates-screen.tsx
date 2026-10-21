'use client';

import {
  CaretRight,
  ChartBar,
  Clock,
  Copy,
  Eye,
  FileText,
  GearSix,
  type Icon,
  Plus,
  PlusCircle,
  UploadSimple,
  UsersThree,
} from '@phosphor-icons/react';
import {
  FORM_CATEGORY_LABELS,
  FormCategory,
  type IntakeFormListItem,
  type IntakeFormsQuery,
} from '@firmivra/types';
import {
  Button,
  Card,
  FilterBar,
  FilterChip,
  FilterGroup,
  KpiCard,
  type KpiTone,
  PageHeader,
  SearchField,
  Select,
  Tabs,
  Toast,
} from '@firmivra/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { TemplateCard, TemplateCardSkeleton, type TemplateActions } from './template-card';
import {
  ArchiveTemplateDialog,
  ChooseTemplateDialog,
  CreateTemplateDialog,
  ImportTemplateDialog,
  type NewTemplateService,
} from './template-dialogs';
import { INTAKE_KEY, LIBRARY_KEY, LoadFailed, Quiet, TAB_CATEGORIES } from './template-look';
import { TemplatePreview } from './template-preview';
import { RecentlyUsed, TemplateCategories, TemplatesProTip } from './template-side';

type Sort = NonNullable<IntakeFormsQuery['sort']>;
type Status = '' | 'DRAFT' | 'PUBLISHED';
interface Filters {
  sort: Sort;
  status: Status;
}
const NO_FILTERS: Filters = { sort: 'updated', status: '' };

/** More Filters: what GET /business/intake-forms can sort and filter by. */
const SORTS: { value: Sort; label: string }[] = [
  { value: 'updated', label: 'Last updated' },
  { value: 'name', label: 'Name (A to Z)' },
  { value: 'used', label: 'Most used' },
  { value: 'recent', label: 'Recently used' },
];
const STATUSES: { value: Status; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'DRAFT', label: 'Draft' },
];

/** The four cards of form-templates-dashboard.jpg, from the library summary. */
const KPIS: {
  key: 'total' | 'mostUsed' | 'custom' | 'updatedLast30Days';
  label: string;
  note: string;
  icon: Icon;
  tone: KpiTone;
  testId: string;
}[] = [
  {
    key: 'total',
    label: 'Total Templates',
    note: 'Ready to use and customize',
    icon: FileText,
    tone: 'purple',
    testId: 'kpi-total',
  },
  {
    key: 'mostUsed',
    label: 'Most Used',
    note: 'Templates used frequently',
    icon: ChartBar,
    tone: 'green',
    testId: 'kpi-most-used',
  },
  {
    key: 'custom',
    label: 'Custom Templates',
    note: 'Created by your team',
    icon: UsersThree,
    tone: 'amber',
    testId: 'kpi-custom',
  },
  {
    key: 'updatedLast30Days',
    label: 'Recently Updated',
    note: 'In the last 30 days',
    icon: Clock,
    tone: 'red',
    testId: 'kpi-updated',
  },
];

const GRID = 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4';

/**
 * Intake Forms > Form Templates (form-templates-dashboard.jpg; guide Frame 4): the template
 * library with its numbers, category tabs, search and More Filters, the cards, Template
 * Categories, Recently Used, Pro Tip and Quick Actions. Every frame keeps its place while it
 * loads, when the library is empty and when the API can't be reached.
 */
export function TemplatesScreen() {
  const router = useRouter();
  const [category, setCategory] = useState<FormCategory | null>(null);
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [draft, setDraft] = useState<Filters>(NO_FILTERS);
  const [preview, setPreview] = useState<IntakeFormListItem | null>(null);
  const [archiving, setArchiving] = useState<IntakeFormListItem | null>(null);
  const [choosing, setChoosing] = useState<'preview' | 'duplicate' | null>(null);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  // Search once typing pauses, not on every key.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchText.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchText]);

  // Every template the firm keeps (its service forms, custom ones, drafts and duplicates), so
  // the cards, the numbers and the categories all count the same rows (Octavia's review, I1).
  const query: IntakeFormsQuery = {
    templates: 'all',
    category: category ?? undefined,
    search: search || undefined,
    sort: filters.sort,
    status: filters.status || undefined,
  };
  const summary = useApiQuery([...LIBRARY_KEY, 'summary'], () => api.intakeForms.librarySummary());
  const list = useApiQuery([...LIBRARY_KEY, 'list', query], () => api.intakeForms.forms(query));
  // The whole library by last use: Recently Used, the Quick Actions' template choice and the
  // services a new template can be for.
  const library = useApiQuery([...LIBRARY_KEY, 'recent'], () =>
    api.intakeForms.forms({ templates: 'all', sort: 'recent' }),
  );
  const [creating, setCreating] = useState(false);

  const create = useApiMutation(
    (service: NewTemplateService) =>
      api.intakeForms.createForm({
        name: 'Untitled Form Template',
        category: service.category,
        serviceId: service.id,
        isTemplate: true,
        startFrom: { kind: 'SCRATCH' },
      }),
    { invalidate: INTAKE_KEY },
  );
  const duplicate = useApiMutation((id: string) => api.intakeForms.duplicateForm(id, true), {
    invalidate: INTAKE_KEY,
  });
  const archive = useApiMutation((id: string) => api.intakeForms.archiveForm(id), {
    invalidate: INTAKE_KEY,
  });
  const failed = (error: unknown) => setNotice({ message: errorMessage(error), tone: 'error' });

  /** Create Template asks which service the template is for (every form belongs to one). */
  function createTemplate() {
    setNotice(null);
    setImporting(false);
    setCreating(true);
  }

  /** A blank template draft for the chosen service, then the builder (Frame 1). */
  function createFor(service: NewTemplateService) {
    create.mutate(service, {
      onSuccess: (form) => router.push(`/intake-forms/builder/${form.id}`),
      onError: (error) => {
        setCreating(false);
        failed(error);
      },
    });
  }

  function duplicateTemplate(template: IntakeFormListItem) {
    setNotice(null);
    duplicate.mutate(template.id, {
      onSuccess: (copy) =>
        setNotice({ message: `"${copy.name}" was added as a draft template.`, tone: 'success' }),
      onError: failed,
    });
  }

  function archiveTemplate(template: IntakeFormListItem) {
    setNotice(null);
    archive.mutate(template.id, {
      onSuccess: () => {
        setArchiving(null);
        setNotice({
          message: `"${template.name}" was archived. Forms already sent with it keep their answers.`,
          tone: 'success',
        });
      },
      onError: (error) => {
        setArchiving(null);
        failed(error);
      },
    });
  }

  const actions: TemplateActions = {
    onPreview: setPreview,
    onEdit: (template) => router.push(`/intake-forms/builder/${template.id}`),
    onUse: (template) =>
      router.push(`/intake-forms/send?formId=${encodeURIComponent(template.id)}`),
    onDuplicate: duplicateTemplate,
    onArchive: setArchiving,
    busy: duplicate.isPending || archive.isPending,
  };

  // Archived templates leave the library (the summary counts them out too).
  const templates = (list.data ?? []).filter((template) => template.status !== 'RETIRED');
  const narrowed = category !== null || search !== '' || filters.status !== '';
  // The design's six category tabs; a category chosen in the sidebar outside them gets its own.
  const tabCategories =
    category && !TAB_CATEGORIES.includes(category) ? [...TAB_CATEGORIES, category] : TAB_CATEGORIES;
  const tabs = [
    { id: 'all', label: 'All Templates' },
    ...tabCategories.map((id) => ({ id, label: FORM_CATEGORY_LABELS[id] })),
  ];
  const sortLabel = SORTS.find((sort) => sort.value === filters.sort)?.label;
  const statusLabel = STATUSES.find((status) => status.value === filters.status)?.label;
  // The built-in forms' categories the firm has no service for: their forms can't exist yet.
  const missing = summary.data
    ? SERVICE_FORM_CATEGORIES.filter(
        (id) => !summary.data.byCategory.some((c) => c.category === id && c.count > 0),
      )
    : [];

  return (
    <div className="flex flex-col gap-4" data-testid="templates-page">
      <PageHeader
        title="Form Templates"
        subtitle="Create, organize, and reuse intake form templates for tax, bookkeeping, payroll, and advisory services."
        above={
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
            <Link href="/intake-forms" className="text-muted hover:text-link">
              Intake Forms
            </Link>
            <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
            <span aria-current="page" className="font-medium text-heading">
              Form Templates
            </span>
          </nav>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <UploadSimple aria-hidden weight="fill" className="size-5" />
              Import Template
            </Button>
            <Button disabled={create.isPending} onClick={createTemplate}>
              <Plus aria-hidden weight="bold" className="size-5" />
              Create Template
            </Button>
          </>
        }
      />

      {notice ? (
        <Toast message={notice.message} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}

      <section
        aria-label="Template summary"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="template-kpis"
      >
        {KPIS.map((kpi) => (
          <div key={kpi.key} className="min-w-0" data-testid={kpi.testId}>
            <KpiCard
              icon={kpi.icon}
              tone={kpi.tone}
              label={kpi.label}
              loading={summary.isPending}
              value={summary.data ? summary.data[kpi.key] : '—'}
              note={summary.isError && !summary.data ? 'Could not load this right now' : kpi.note}
            />
          </div>
        ))}
      </section>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <section aria-label="Template library" className="flex min-w-0 flex-1 flex-col gap-3">
          <FilterBar
            more={
              <>
                <FilterGroup title="Sort by">
                  <Select
                    label="Sort templates by"
                    hideLabel
                    value={draft.sort}
                    onChange={(event) => {
                      const sort = SORTS.find((s) => s.value === event.target.value)?.value;
                      setDraft((current) => ({ ...current, sort: sort ?? 'updated' }));
                    }}
                    options={SORTS}
                  />
                </FilterGroup>
                <FilterGroup title="Status">
                  <Select
                    label="Template status"
                    hideLabel
                    value={draft.status}
                    onChange={(event) => {
                      const status = STATUSES.find((s) => s.value === event.target.value)?.value;
                      setDraft((current) => ({ ...current, status: status ?? '' }));
                    }}
                    options={STATUSES}
                  />
                </FilterGroup>
              </>
            }
            onApply={() => setFilters(draft)}
            onClear={() => {
              setDraft(NO_FILTERS);
              setFilters(NO_FILTERS);
            }}
          >
            <div className="mr-auto max-w-full min-w-0 overflow-x-auto">
              <Tabs
                items={tabs}
                value={category ?? 'all'}
                onChange={(id) => {
                  const picked = FormCategory.safeParse(id);
                  setCategory(picked.success ? picked.data : null);
                }}
                label="Template categories"
                variant="segmented"
              />
            </div>
            <SearchField
              label="Search templates"
              placeholder="Search templates..."
              value={searchText}
              maxLength={100}
              minWidth="10rem"
              className="sm:max-w-xs"
              onChange={(event) => setSearchText(event.target.value)}
            />
          </FilterBar>

          {filters.sort !== NO_FILTERS.sort || filters.status !== NO_FILTERS.status ? (
            <div role="group" aria-label="Applied filters" className="flex flex-wrap gap-2">
              {filters.sort !== NO_FILTERS.sort ? (
                <FilterChip
                  label={`Sort: ${sortLabel ?? ''}`}
                  onRemove={() => {
                    setFilters((current) => ({ ...current, sort: NO_FILTERS.sort }));
                    setDraft((current) => ({ ...current, sort: NO_FILTERS.sort }));
                  }}
                />
              ) : null}
              {filters.status !== NO_FILTERS.status ? (
                <FilterChip
                  label={`Status: ${statusLabel ?? ''}`}
                  onRemove={() => {
                    setFilters((current) => ({ ...current, status: NO_FILTERS.status }));
                    setDraft((current) => ({ ...current, status: NO_FILTERS.status }));
                  }}
                />
              ) : null}
            </div>
          ) : null}

          <div data-testid="template-grid">
            {list.isPending ? (
              <div aria-busy="true" className={GRID}>
                <span className="sr-only">Loading templates…</span>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((slot) => (
                  <TemplateCardSkeleton key={slot} />
                ))}
              </div>
            ) : list.isError && !list.data ? (
              <Card variant="elevated" className="p-4!">
                <LoadFailed error={list.error} onRetry={() => void list.refetch()} />
              </Card>
            ) : templates.length === 0 ? (
              <Card variant="elevated" className="p-4!">
                <Quiet>
                  {narrowed
                    ? 'No templates match this search or category.'
                    : 'No templates yet. Create Template starts a new one.'}
                </Quiet>
              </Card>
            ) : (
              <ul className={GRID}>
                {templates.map((template) => (
                  <li key={template.id} className="min-w-0">
                    <TemplateCard template={template} actions={actions} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          {!narrowed && missing.length > 0 ? (
            <p className="text-sm text-muted" data-testid="missing-service-forms">
              The built-in {listOf(missing.map((id) => FORM_CATEGORY_LABELS[id]))}{' '}
              {missing.length === 1 ? 'form appears' : 'forms appear'} here once your firm offers{' '}
              {missing.length === 1 ? 'that service' : 'those services'}.{' '}
              <Link href="/services-pricing" className="font-medium text-link underline">
                Open Services &amp; Pricing
              </Link>
            </p>
          ) : null}
        </section>

        <aside
          aria-label="Categories and recent templates"
          className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3 xl:w-60 xl:shrink-0 xl:grid-cols-1"
        >
          <TemplateCategories
            summary={summary}
            selected={category}
            onSelect={(picked) => setCategory((current) => (current === picked ? null : picked))}
          />
          <RecentlyUsed recent={library} onOpen={setPreview} />
          <TemplatesProTip />
        </aside>
      </div>

      <section
        aria-labelledby="template-quick-actions-title"
        className="rounded-xl bg-info-soft px-4 py-3"
        data-testid="template-quick-actions"
      >
        <h2 id="template-quick-actions-title" className="text-base font-bold text-heading">
          Quick Actions
        </h2>
        <div className="mt-1 grid grid-cols-1 divide-y divide-folder-border sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-4 xl:divide-x">
          <QuickAction
            icon={PlusCircle}
            label="Create Template"
            disabled={create.isPending}
            onClick={createTemplate}
          />
          <QuickAction icon={Eye} label="Preview Template" onClick={() => setChoosing('preview')} />
          <QuickAction
            icon={Copy}
            label="Duplicate Template"
            onClick={() => setChoosing('duplicate')}
          />
          <QuickAction icon={GearSix} label="Template Settings" href="/intake-forms/settings" />
        </div>
      </section>

      {preview ? (
        <TemplatePreview
          template={preview}
          onClose={() => setPreview(null)}
          onEdit={() => actions.onEdit(preview)}
          onUse={() => actions.onUse(preview)}
        />
      ) : null}
      {choosing ? (
        <ChooseTemplateDialog
          mode={choosing}
          library={library}
          busy={duplicate.isPending}
          onClose={() => setChoosing(null)}
          onChoose={(template) => {
            setChoosing(null);
            if (choosing === 'preview') setPreview(template);
            else duplicateTemplate(template);
          }}
        />
      ) : null}
      <ArchiveTemplateDialog
        template={archiving}
        busy={archive.isPending}
        onClose={() => setArchiving(null)}
        onConfirm={archiveTemplate}
      />
      <ImportTemplateDialog
        open={importing}
        onClose={() => setImporting(false)}
        onCreate={createTemplate}
      />
      {creating ? (
        <CreateTemplateDialog
          library={library}
          category={category}
          busy={create.isPending}
          onClose={() => setCreating(false)}
          onCreate={createFor}
        />
      ) : null}
    </div>
  );
}

/** The categories of the six built-in (Begin Online) forms, one per service kind. */
const SERVICE_FORM_CATEGORIES: FormCategory[] = [
  'PERSONAL_TAX',
  'BUSINESS_TAX',
  'BOOKKEEPING',
  'PAYROLL',
  'TAX_PLANNING',
  'ADVISORY',
];

/** "A", "A and B", "A, B and C". */
function listOf(words: string[]): string {
  return words.length <= 2
    ? words.join(' and ')
    : `${words.slice(0, -1).join(', ')} and ${words.at(-1) ?? ''}`;
}

const quickAction =
  'flex min-h-10 items-center gap-3 px-3 py-2 text-left text-sm text-heading hover:bg-folder-hover disabled:cursor-not-allowed disabled:text-muted xl:justify-center';

/** One of the four Quick Actions: a solid icon and its words, as a button or a link. */
function QuickAction({
  icon: Glyph,
  label,
  onClick,
  href,
  disabled,
}: {
  icon: Icon;
  label: string;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
}) {
  const content = (
    <>
      <Glyph aria-hidden weight="fill" className="size-6 shrink-0 text-heading" />
      <span>{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className={quickAction}>
      {content}
    </Link>
  ) : (
    <button type="button" disabled={disabled} onClick={onClick} className={quickAction}>
      {content}
    </button>
  );
}
