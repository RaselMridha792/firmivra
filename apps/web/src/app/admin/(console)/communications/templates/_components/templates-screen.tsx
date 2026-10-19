'use client';

import {
  Badge,
  Button,
  Card,
  IconButton,
  Modal,
  PageHeader,
  Pagination,
  SearchField,
  Select,
  Table,
  Tabs,
  type Column,
  type TableSort,
} from '@firmivra/ui';
import {
  CaretDown,
  Copy,
  DotsThreeVertical,
  Eye,
  PencilSimple,
  Plus,
  Trash,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  ADMIN_COMM_ERRORS,
  type CommTemplateStatus,
  type ListAdminCommTemplatesQuery,
} from '@firmivra/types';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiQuery } from '../../../../../../lib/query';
import {
  CategoryBadge,
  TemplateChannel,
  TemplateMessage,
  TemplatePanels,
  templateDate,
  rowOf,
  type TemplateRow,
} from './template-panels';

const basePath = '/communications/templates';
const pageSize = 10;

const TEMPLATES = ['admin-communications', 'templates'] as const;
const statusOptions: { value: 'ALL' | CommTemplateStatus; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'ARCHIVED', label: 'Archived' },
];

export function TemplatesScreen() {
  const router = useRouter();
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const [searchText, setSearchText] = useState('');
  const [category, setCategory] = useState('ALL');
  const [channel, setChannel] = useState<'ALL' | 'EMAIL' | 'SMS'>('ALL');
  const [status, setStatus] = useState<'ALL' | CommTemplateStatus>('ALL');
  const [sort, setSort] = useState<TableSort>({ id: 'updatedAt', descending: true });
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{
    mode: 'preview' | 'actions' | 'archive';
    template: TemplateRow;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchText(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const categories = useApiQuery(['admin-communications', 'categories'], () =>
    api.adminCommunications.categories.list(),
  );
  const filters: ListAdminCommTemplatesQuery = {
    ...(category !== 'ALL' ? { categoryId: category } : {}),
    ...(channel !== 'ALL' ? { channel } : {}),
    ...(status !== 'ALL' ? { status } : {}),
    ...(searchText ? { search: searchText } : {}),
    sort: sort.id === 'name' ? 'NAME' : 'UPDATED',
    page,
    pageSize,
  };
  const query = useApiQuery([...TEMPLATES, filters], () =>
    api.adminCommunications.templates.list(filters),
  );
  const visibleRows = (query.data?.items ?? []).map(rowOf);
  const total = query.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, pageCount);
  const activeTemplate = visibleRows.find((item) => item.id === activeId) ?? visibleRows[0] ?? null;
  const categoryItems = (categories.data?.items ?? []).filter((c) => c.isActive);
  const allCount = categoryItems.reduce((n, c) => n + c.templateCount, 0);
  const sortValue = sort.id === 'name' ? 'name' : 'updated';

  function selectTemplate(template: TemplateRow) {
    setActiveId(template.id);
    setSelectedIds([template.id]);
  }
  function edit(template: TemplateRow | null) {
    if (template) router.push(`${basePath}/${template.id}/edit`);
  }
  async function change(work: () => Promise<string>) {
    setBusy(true);
    try {
      setNotice(await work());
    } catch (error) {
      setNotice(errorMessage(error, ADMIN_COMM_ERRORS));
    } finally {
      setBusy(false);
      setDialog(null);
      await client.invalidateQueries({ queryKey: ['admin-communications'] });
    }
  }
  function duplicate(template: TemplateRow) {
    void change(async () => {
      const copy = await api.adminCommunications.templates.duplicate(template.id);
      setSearch('');
      setSearchText('');
      setCategory('ALL');
      setChannel('ALL');
      setStatus('ALL');
      setSort({ id: 'updatedAt', descending: true });
      setPage(1);
      setActiveId(copy.id);
      setSelectedIds([copy.id]);
      return `Template duplicated as ${copy.name}.`;
    });
  }
  function archive() {
    if (!dialog) return;
    const { template } = dialog;
    void change(async () => {
      await api.adminCommunications.templates.archive(template.id);
      return `${template.name} archived.`;
    });
  }

  const filtered = category !== 'ALL' || channel !== 'ALL' || status !== 'ALL' || searchText !== '';
  const columns: Column<TemplateRow>[] = [
    {
      id: 'name',
      label: 'Template Name',
      className: 'min-w-44',
      cell: (item) => (
        <button
          type="button"
          onClick={() => selectTemplate(item)}
          className="block w-full max-w-52 rounded text-left focus-visible:outline-2 focus-visible:outline-focus"
        >
          <span className="block truncate text-sm font-semibold text-heading" title={item.name}>
            {item.name}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted" title={item.excerpt}>
            {item.excerpt}
          </span>
        </button>
      ),
    },
    {
      id: 'category',
      label: 'Category',
      cell: (item) => <CategoryBadge category={item.category} />,
    },
    { id: 'channel', label: 'Channel', cell: (item) => <TemplateChannel channel={item.channel} /> },
    {
      id: 'status',
      label: 'Status',
      cell: (item) => (
        <span className="[&>span]:px-2 [&>span]:font-normal">
          <Badge
            tone={
              item.status === 'Active'
                ? 'success'
                : item.status === 'Inactive'
                  ? 'warning'
                  : 'neutral'
            }
          >
            {item.status}
          </Badge>
        </span>
      ),
    },
    {
      id: 'updatedAt',
      label: 'Last Updated',
      sortable: true,
      className: 'whitespace-nowrap',
      cell: (item) => templateDate(item.updatedAt),
    },
    {
      id: 'createdBy',
      label: 'Created By',
      className: 'whitespace-nowrap',
      cell: (item) => item.createdBy,
    },
    {
      id: 'actions',
      label: '',
      cell: (item) => (
        <IconButton
          icon={DotsThreeVertical}
          weight="bold"
          tone="action"
          label={`Actions for ${item.name}`}
          className="border-transparent! bg-transparent!"
          onClick={() => {
            selectTemplate(item);
            setDialog({ mode: 'actions', template: item });
          }}
        />
      ),
    },
  ];

  return (
    <div className="min-w-0 space-y-4 xl:-mt-4">
      <PageHeader
        title="Templates"
        subtitle="Create, manage, and use message templates for email and SMS across all communications."
        actions={
          <div className="flex items-stretch">
            <Button className="rounded-r-none!" onClick={() => router.push(`${basePath}/new`)}>
              <Plus aria-hidden weight="bold" className="size-4" />
              Create Template
            </Button>
            <details className="group relative">
              <summary
                aria-label="Choose template channel"
                className="flex h-full min-h-11 cursor-pointer list-none items-center rounded-r-control border-l border-on-action/20 bg-action px-3 text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden"
              >
                <CaretDown aria-hidden weight="bold" className="size-4" />
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-48 rounded-control border border-border bg-surface p-1 text-sm shadow-card">
                <Link
                  href={`${basePath}/new?channel=EMAIL`}
                  className="block rounded px-3 py-2 text-heading hover:bg-info-soft"
                >
                  Email template
                </Link>
                <Link
                  href={`${basePath}/new?channel=SMS`}
                  className="block rounded px-3 py-2 text-heading hover:bg-info-soft"
                >
                  SMS template
                </Link>
              </div>
            </details>
          </div>
        }
      />

      <div className="pt-1 [&_[role=tablist]]:gap-1 [&_[role=tablist]]:overflow-y-hidden [&_[role=tab]]:mb-0 [&_[role=tab]]:px-4 [&_[role=tab]]:text-xs [&_[role=tab][aria-selected=true]]:bg-surface [&_[role=tab][aria-selected=true]]:font-bold">
        <Tabs
          label="Template categories"
          variant="underline"
          value={category}
          onChange={(value) => {
            setCategory(value);
            setPage(1);
          }}
          items={[
            { id: 'ALL', label: `All Templates (${categories.data ? allCount : '—'})` },
            ...categoryItems.map((c) => ({ id: c.id, label: `${c.name} (${c.templateCount})` })),
          ]}
        />
      </div>

      <div className="grid min-w-0 grid-cols-2 items-end gap-3 lg:grid-cols-6 xl:grid-cols-8">
        <div className="col-span-2 min-w-0 xl:col-span-3">
          <SearchField
            label="Search templates"
            placeholder="Search templates..."
            className="min-w-0! rounded-control! border-border! bg-surface!"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="min-w-0">
          <Select
            label="Category"
            value={category}
            className="text-sm!"
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
            options={[
              { value: 'ALL', label: 'All' },
              ...categoryItems.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <Select
          label="Channel"
          value={channel}
          className="text-sm!"
          onChange={(event) => {
            setChannel(event.target.value as 'ALL' | 'EMAIL' | 'SMS');
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'EMAIL', label: 'Email' },
            { value: 'SMS', label: 'SMS' },
          ]}
        />
        <Select
          label="Status"
          value={status}
          className="text-sm!"
          onChange={(event) => {
            setStatus(event.target.value as 'ALL' | CommTemplateStatus);
            setPage(1);
          }}
          options={statusOptions}
        />
        <Select
          label="Sort by"
          value={sortValue}
          className="text-sm!"
          onChange={(event) => {
            const value = event.target.value;
            setSort({ id: value === 'name' ? 'name' : 'updatedAt', descending: value !== 'name' });
            setPage(1);
          }}
          options={[
            { value: 'updated', label: 'Last Updated' },
            { value: 'name', label: 'Name A–Z' },
          ]}
        />
      </div>

      <p
        role="status"
        className="rounded-control bg-info-soft px-3 py-2 text-sm text-heading empty:hidden"
      >
        {notice}
      </p>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-10">
        <Card
          aria-label="Templates library"
          data-testid="templates-library"
          className="min-w-0 overflow-hidden p-1! shadow-none! xl:col-span-7"
        >
          <div className={visibleRows.length || query.isPending ? '' : 'min-h-96'}>
            <Table
              rows={visibleRows}
              columns={columns}
              rowKey={(item) => item.id}
              caption="Communication templates"
              dense
              loading={query.isPending}
              showPagination={false}
              tableClassName="min-w-192 [&_th]:px-2 [&_td]:px-2 [&_td]:py-3 [&_th]:font-semibold [&_input]:accent-action"
              selection={{
                selected: selectedIds,
                onChange: (ids) => {
                  const added = ids.find((id) => !selectedIds.includes(id));
                  setSelectedIds(ids);
                  if (added) setActiveId(added);
                },
              }}
              server={{
                page: currentPage,
                hasNext: currentPage < pageCount,
                hasPrevious: currentPage > 1,
                onNext: () => setPage(currentPage + 1),
                onPrevious: () => setPage(currentPage - 1),
                onPage: setPage,
                sort,
                onSort: (value) => {
                  setSort(value);
                  setPage(1);
                },
                total,
              }}
              emptyTitle={
                query.isError
                  ? 'Templates unavailable'
                  : filtered
                    ? 'No matching templates'
                    : 'No templates yet'
              }
              emptyText={
                query.isError
                  ? 'The library will appear here when it is available.'
                  : filtered
                    ? 'Try another search or change the filters.'
                    : 'Create a template to get started.'
              }
            />
          </div>
          <div className="px-3 py-4 [&_nav]:flex-col [&_nav]:items-start [&_nav>div]:ml-0">
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              onPage={setPage}
              summary={`${total ? (currentPage - 1) * pageSize + 1 : 0} – ${Math.min(currentPage * pageSize, total)} of ${total} templates`}
            />
          </div>
        </Card>
        <div className="min-w-0 xl:col-span-3">
          <TemplatePanels
            key={activeTemplate?.id ?? 'empty'}
            template={activeTemplate}
            onEdit={() => edit(activeTemplate)}
            onPreview={() => {
              if (activeTemplate) setDialog({ mode: 'preview', template: activeTemplate });
            }}
            onDuplicate={() => {
              if (activeTemplate) duplicate(activeTemplate);
            }}
            onArchive={() => {
              if (activeTemplate) setDialog({ mode: 'archive', template: activeTemplate });
            }}
          />
        </div>
      </div>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={
          dialog?.mode === 'archive'
            ? 'Archive template?'
            : dialog?.mode === 'actions'
              ? 'Template actions'
              : 'Template Preview'
        }
        subtitle={dialog?.template.name}
        footer={
          dialog?.mode === 'archive' ? (
            <>
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={archive}>
                Archive
              </Button>
            </>
          ) : undefined
        }
      >
        {dialog?.mode === 'preview' && <TemplateMessage template={dialog.template} />}
        {dialog?.mode === 'archive' && (
          <p className="text-sm text-muted">
            Archive this template? It stays in the library under Archived and can no longer be used
            in new messages.
          </p>
        )}
        {dialog?.mode === 'actions' && (
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={() => edit(dialog.template)}>
              <PencilSimple aria-hidden weight="fill" className="size-4" />
              Edit
            </Button>
            <Button variant="secondary" onClick={() => setDialog({ ...dialog, mode: 'preview' })}>
              <Eye aria-hidden weight="fill" className="size-4" />
              Preview
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => duplicate(dialog.template)}>
              <Copy aria-hidden weight="fill" className="size-4" />
              Duplicate
            </Button>
            <Button
              variant="secondary"
              disabled={dialog.template.status === 'Archived'}
              onClick={() => setDialog({ ...dialog, mode: 'archive' })}
            >
              <Trash aria-hidden weight="fill" className="size-4" />
              Archive
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
