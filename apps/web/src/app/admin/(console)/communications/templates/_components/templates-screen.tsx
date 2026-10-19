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
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { useApiQuery } from '../../../../../../lib/query';
import {
  listCommunicationTemplates,
  templateCategories,
  type CommunicationTemplate,
} from '../../../../../../mocks/admin-communications-templates';
import {
  CategoryBadge,
  TemplateChannel,
  TemplateMessage,
  TemplatePanels,
  templateDate,
} from './template-panels';

const basePath = '/communications/templates';
const pageSize = 10;

export function TemplatesScreen() {
  const router = useRouter();
  const query = useApiQuery(['admin-communications', 'templates'], listCommunicationTemplates);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [channel, setChannel] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [sort, setSort] = useState<TableSort>({ id: 'updatedAt', descending: true });
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState('template-1');
  const [selectedIds, setSelectedIds] = useState(['template-1']);
  const [copies, setCopies] = useState<CommunicationTemplate[]>([]);
  const [archivedIds, setArchivedIds] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{
    mode: 'preview' | 'actions' | 'archive';
    template: CommunicationTemplate;
  } | null>(null);
  const [notice, setNotice] = useState('');

  const templates = query.isSuccess
    ? [...copies, ...query.data].map((item): CommunicationTemplate =>
        archivedIds.includes(item.id) ? { ...item, status: 'Archived' } : item,
      )
    : [];
  const filtered = templates
    .filter(
      (item) =>
        (category === 'ALL' || item.category === category) &&
        (channel === 'ALL' || item.channel === channel) &&
        (status === 'ALL' || item.status === status) &&
        `${item.name} ${item.excerpt} ${item.body}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) => {
      const left = sort.id === 'name' ? a.name : a.updatedAt;
      const right = sort.id === 'name' ? b.name : b.updatedAt;
      return left.localeCompare(right) * (sort.descending ? -1 : 1);
    });
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const activeTemplate = visibleRows.find((item) => item.id === activeId) ?? visibleRows[0] ?? null;
  const sortValue =
    sort.id === 'name'
      ? sort.descending
        ? 'name-desc'
        : 'name'
      : sort.descending
        ? 'updated'
        : 'oldest';

  function selectTemplate(template: CommunicationTemplate) {
    setActiveId(template.id);
    setSelectedIds([template.id]);
  }
  function edit(template: CommunicationTemplate | null) {
    if (template) router.push(`${basePath}/${template.id}/edit`);
  }
  function duplicate(template: CommunicationTemplate) {
    const today = new Date().toISOString().slice(0, 10);
    const copy: CommunicationTemplate = {
      ...template,
      id: `template-copy-${crypto.randomUUID()}`,
      name: `${template.name} (Copy)`,
      status: 'Active',
      createdAt: today,
      updatedAt: today,
    };
    setCopies((items) => [copy, ...items]);
    setSearch('');
    setCategory('ALL');
    setChannel('ALL');
    setStatus('ALL');
    setSort({ id: 'updatedAt', descending: true });
    setPage(1);
    selectTemplate(copy);
    setDialog(null);
    setNotice('Template duplicated in this preview. Changes are not saved to the server.');
  }
  function archive() {
    if (!dialog) return;
    setArchivedIds((ids) => [...ids, dialog.template.id]);
    setNotice('Template archived in this preview. Changes are not saved to the server.');
    setDialog(null);
  }

  const columns: Column<CommunicationTemplate>[] = [
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
          <Badge tone={item.status === 'Active' ? 'success' : 'neutral'}>{item.status}</Badge>
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
            { id: 'ALL', label: `All Templates (${templates.length})` },
            ...templateCategories.map((name) => ({
              id: name,
              label: `${name} (${templates.filter((item) => item.category === name).length})`,
            })),
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
              ...templateCategories.map((name) => ({ value: name, label: name })),
            ]}
          />
        </div>
        <Select
          label="Channel"
          value={channel}
          className="text-sm!"
          onChange={(event) => {
            setChannel(event.target.value);
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
            setStatus(event.target.value);
            setPage(1);
          }}
          options={[
            { value: 'ALL', label: 'All' },
            { value: 'Active', label: 'Active' },
            { value: 'Archived', label: 'Archived' },
          ]}
        />
        <Select
          label="Sort by"
          value={sortValue}
          className="text-sm!"
          onChange={(event) => {
            const value = event.target.value;
            setSort({
              id: value.startsWith('name') ? 'name' : 'updatedAt',
              descending: value === 'updated' || value === 'name-desc',
            });
            setPage(1);
          }}
          options={[
            { value: 'updated', label: 'Last Updated' },
            { value: 'oldest', label: 'Oldest Updated' },
            { value: 'name', label: 'Name A–Z' },
            { value: 'name-desc', label: 'Name Z–A' },
          ]}
        />
      </div>

      <PageState query={query} empty="No templates yet. Create a template to get started.">
        {() => null}
      </PageState>
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
                total: filtered.length,
              }}
              emptyTitle={
                query.isError
                  ? 'Templates unavailable'
                  : templates.length
                    ? 'No matching templates'
                    : 'No templates yet'
              }
              emptyText={
                query.isError
                  ? 'The library will appear here when it is available.'
                  : templates.length
                    ? 'Try another search or change the filters.'
                    : 'Your templates will appear here when available.'
              }
            />
          </div>
          <div className="px-3 py-4 [&_nav]:flex-col [&_nav]:items-start [&_nav>div]:ml-0">
            <Pagination
              page={currentPage}
              pageCount={pageCount}
              onPage={setPage}
              summary={`${filtered.length ? (currentPage - 1) * pageSize + 1 : 0} – ${Math.min(currentPage * pageSize, filtered.length)} of ${filtered.length} templates`}
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
              <Button onClick={archive}>Archive in preview</Button>
            </>
          ) : undefined
        }
      >
        {dialog?.mode === 'preview' && <TemplateMessage template={dialog.template} />}
        {dialog?.mode === 'archive' && (
          <p className="text-sm text-muted">
            Archive this template in the local preview? No server data will be changed.
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
            <Button variant="secondary" onClick={() => duplicate(dialog.template)}>
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
