'use client';

import type { SegmentDetail, SegmentField, SegmentRow } from '@firmivra/types';
import {
  ActionMenu,
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
  Table,
  type Column,
} from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  Copy,
  DotsThreeVertical,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  UsersThree,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { useAct, type Notice } from './communication-actions';
import { COMM_ERRORS, COMM_KEY, card, dayText, gold, quiet } from './communications-shared';

type Cond = { field: string; op: SegmentField['operators'][number]; value: string | string[] };
const OP_LABEL: Record<string, string> = {
  IS: 'is',
  IS_NOT: 'is not',
  IS_ANY_OF: 'is any of',
  IS_NONE_OF: 'is none of',
  CONTAINS: 'contains',
  BEFORE: 'is before',
  AFTER: 'is after',
  BETWEEN: 'is between',
  GREATER_THAN: 'is greater than',
  LESS_THAN: 'is less than',
  EXISTS: 'exists',
  NOT_EXISTS: 'does not exist',
};

/** Create or change a segment (a rule-based group) or a list (chosen people), with a live count. */
function SegmentDialog({
  segment,
  canManage,
  onClose,
  onNotice,
}: {
  segment?: SegmentDetail;
  canManage: boolean;
  onClose: () => void;
  onNotice: Notice;
}) {
  const qc = useQueryClient();
  const fields = useApiQuery([...COMM_KEY, 'segment-fields'], () =>
    api.communications.segmentFields(),
  );
  const [name, setName] = useState(segment?.name ?? '');
  const [description, setDescription] = useState(segment?.description ?? '');
  const [type, setType] = useState<'DYNAMIC' | 'STATIC'>(segment?.type ?? 'DYNAMIC');
  const [audience, setAudience] = useState<'CLIENTS' | 'LEADS' | 'BOTH'>(
    segment?.audience ?? 'CLIENTS',
  );
  const [conds, setConds] = useState<Cond[]>(
    (segment?.criteria?.conditions ?? []).map((c) => ({
      field: c.field,
      op: c.op,
      value: (c.value as string | string[] | undefined) ?? '',
    })),
  );
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const list = (fields.data ?? []).filter(
    (f) => f.audience === 'BOTH' || audience === 'BOTH' || f.audience === audience,
  );
  const criteria = {
    logic: 'AND' as const,
    conditions: conds.filter((c) => c.field && c.value !== ''),
  };
  const preview = useApiQuery(
    [...COMM_KEY, 'segment-preview', type, audience, JSON.stringify(criteria)],
    () =>
      api.communications.previewSegment({
        audience,
        criteria: type === 'STATIC' ? { conditions: [] } : criteria,
        sample: 25,
      }),
  );
  const first = list[0];
  return (
    <Modal
      open
      title={segment ? 'Edit Segment' : 'New Segment or List'}
      subtitle="A segment updates itself from rules. A list is people you choose."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              !canManage ||
              !name.trim() ||
              (type === 'STATIC' && !segment && picked.length === 0)
            }
            onClick={async () => {
              setBusy(true);
              setError(undefined);
              try {
                if (segment) {
                  await api.communications.updateSegment(segment.id, {
                    name: name.trim(),
                    description: description.trim() || null,
                    audience,
                    ...(type === 'DYNAMIC' ? { criteria } : {}),
                    etag: segment.etag,
                  });
                } else {
                  await api.communications.createSegment({
                    name: name.trim(),
                    description: description.trim() || null,
                    type,
                    audience,
                    ...(type === 'DYNAMIC'
                      ? { criteria }
                      : {
                          clientIds: (preview.data?.sample ?? [])
                            .filter((s) => picked.includes(s.id) && s.kind === 'CLIENT')
                            .map((s) => s.id),
                          leadIds: (preview.data?.sample ?? [])
                            .filter((s) => picked.includes(s.id) && s.kind === 'LEAD')
                            .map((s) => s.id),
                        }),
                  });
                }
                await qc.invalidateQueries({ queryKey: [...COMM_KEY] });
                onNotice(segment ? 'Segment saved.' : 'Segment created.', 'success');
                onClose();
              } catch (e) {
                setError(errorMessage(e, COMM_ERRORS));
                setBusy(false);
              }
            }}
          >
            {segment ? 'Save Segment' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="segment-dialog">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Kind"
            value={type}
            disabled={!!segment}
            onChange={(e) => setType(e.target.value as 'DYNAMIC' | 'STATIC')}
            options={[
              { value: 'DYNAMIC', label: 'Segment (rules)' },
              { value: 'STATIC', label: 'List (chosen people)' },
            ]}
          />
          <Select
            label="Who"
            value={audience}
            onChange={(e) => setAudience(e.target.value as 'CLIENTS' | 'LEADS' | 'BOTH')}
            options={[
              { value: 'CLIENTS', label: 'Clients' },
              { value: 'LEADS', label: 'Leads' },
              { value: 'BOTH', label: 'Clients and leads' },
            ]}
          />
        </div>
        {type === 'DYNAMIC' ? (
          <div className="flex flex-col gap-2" data-testid="criteria">
            <h3 className="text-sm font-semibold text-heading">
              Include people where all of these are true
            </h3>
            {conds.length === 0 ? (
              <p className={quiet}>No rules yet: everyone in the group is included.</p>
            ) : null}
            {conds.map((c, i) => {
              const f = list.find((x) => x.field === c.field);
              return (
                <div key={i} className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
                  <Select
                    label="Field"
                    value={c.field}
                    onChange={(e) => {
                      const nf = list.find((x) => x.field === e.target.value);
                      setConds(
                        conds.map((x, j) =>
                          j === i
                            ? { field: e.target.value, op: nf?.operators[0] ?? 'IS', value: '' }
                            : x,
                        ),
                      );
                    }}
                    options={list.map((x) => ({ value: x.field, label: x.label }))}
                  />
                  <Select
                    label="Condition"
                    value={c.op}
                    onChange={(e) =>
                      setConds(
                        conds.map((x, j) =>
                          j === i ? { ...x, op: e.target.value as Cond['op'] } : x,
                        ),
                      )
                    }
                    options={(f?.operators ?? ['IS']).map((o) => ({
                      value: o,
                      label: OP_LABEL[o] ?? o,
                    }))}
                  />
                  {f && f.options.length > 0 ? (
                    <Select
                      label="Value"
                      value={Array.isArray(c.value) ? (c.value[0] ?? '') : c.value}
                      onChange={(e) =>
                        setConds(
                          conds.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  value: x.op.endsWith('OF') ? [e.target.value] : e.target.value,
                                }
                              : x,
                          ),
                        )
                      }
                      options={[{ value: '', label: 'Choose…' }, ...f.options]}
                    />
                  ) : (
                    <Input
                      label="Value"
                      value={Array.isArray(c.value) ? c.value.join(', ') : c.value}
                      onChange={(e) =>
                        setConds(
                          conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)),
                        )
                      }
                    />
                  )}
                  <button
                    type="button"
                    aria-label={`Remove rule ${i + 1}`}
                    onClick={() => setConds(conds.filter((_, j) => j !== i))}
                    className="flex size-10 items-center justify-center rounded-control text-danger hover:bg-danger-soft"
                  >
                    <Trash aria-hidden weight="bold" className="size-4" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="inline-flex w-fit items-center gap-1 text-sm font-medium text-link disabled:opacity-50"
              disabled={!first || conds.length >= 20}
              onClick={() =>
                first &&
                setConds([
                  ...conds,
                  { field: first.field, op: first.operators[0] ?? 'IS', value: '' },
                ])
              }
            >
              <Plus aria-hidden weight="bold" className="size-4" /> Add rule
            </button>
          </div>
        ) : segment ? (
          <p className={quiet}>
            The people on a list are changed from the list&apos;s members view.
          </p>
        ) : (
          <div className="flex flex-col gap-1" data-testid="list-picker">
            <h3 className="text-sm font-semibold text-heading">Choose people for this list</h3>
            {(preview.data?.sample ?? []).map((s) => (
              <Checkbox
                key={s.id}
                label={`${s.label}${s.secondary ? ` · ${s.secondary}` : ''}`}
                checked={picked.includes(s.id)}
                onChange={(e) =>
                  setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))
                }
              />
            ))}
          </div>
        )}
        <p
          role="status"
          className="rounded-lg bg-info-soft p-3 text-sm text-info"
          data-testid="segment-count"
        >
          {preview.data
            ? type === 'STATIC'
              ? `${picked.length} chosen`
              : `${preview.data.count} ${preview.data.count === 1 ? 'person matches' : 'people match'} right now.`
            : preview.isError
              ? 'The count is not available right now.'
              : 'Counting…'}
        </p>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function MembersDialog({ segment, onClose }: { segment: SegmentRow; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const members = useApiQuery([...COMM_KEY, 'segment-members', segment.id, term], () =>
    api.communications.segmentMembers(segment.id, {
      ...(term ? { search: term } : {}),
      page: 1,
      pageSize: 50,
    }),
  );
  return (
    <Modal
      open
      title={segment.name}
      subtitle={`${segment.memberCount} members`}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-3" data-testid="members-dialog">
        <Input label="Search members" value={search} onChange={(e) => setSearch(e.target.value)} />
        {members.data?.items.length === 0 ? <p className={quiet}>No members match.</p> : null}
        <ul className="max-h-72 overflow-auto">
          {(members.data?.items ?? []).map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
            >
              <span className="font-medium text-heading">{m.label}</span>
              <span className="text-muted">{m.secondary}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

/** The Segments & Lists tab. */
export function SegmentsPanel({ canManage, onNotice }: { canManage: boolean; onNotice: Notice }) {
  const act = useAct(onNotice);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<SegmentDetail | 'new'>();
  const [members, setMembers] = useState<SegmentRow>();
  const term = useDeferredValue(search.trim());
  const list = useApiQuery([...COMM_KEY, 'segments', term, type, archived, page], () =>
    api.communications.segments({
      ...(term ? { search: term } : {}),
      ...(type ? { type: type as 'DYNAMIC' | 'STATIC' } : {}),
      ...(archived ? { archived: true } : {}),
      page,
      pageSize: 10,
    }),
  );
  const columns: Column<SegmentRow>[] = [
    {
      id: 'name',
      label: 'Name',
      cell: (r) => (
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info"
          >
            <UsersThree weight="fill" className="size-4" />
          </span>
          <span className="min-w-0">
            <button
              type="button"
              onClick={() => setMembers(r)}
              className="block font-medium text-link hover:underline"
            >
              {r.name}
            </button>
            <span className="block text-xs text-muted">
              {r.criteriaSummary ?? r.description ?? 'Chosen people'}
            </span>
          </span>
        </span>
      ),
    },
    { id: 'type', label: 'Kind', cell: (r) => (r.type === 'DYNAMIC' ? 'Segment' : 'List') },
    { id: 'count', label: 'Members', cell: (r) => r.memberCount },
    { id: 'used', label: 'Used By', cell: (r) => (r.usedBy ? `${r.usedBy} scheduled` : '—') },
    { id: 'upd', label: 'Updated', cell: (r) => dayText(r.updatedAt) },
  ];
  return (
    <section
      className={`${card} flex flex-col gap-3`}
      aria-label="Segments and lists"
      data-testid="segments-panel"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex h-10 w-64 items-center gap-2 rounded-lg border border-divider bg-surface px-3 text-muted focus-within:outline-2 focus-within:outline-focus">
            <MagnifyingGlass aria-hidden weight="bold" className="size-4 shrink-0" />
            <span className="sr-only">Search segments</span>
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search segments..."
              className="w-full bg-transparent text-sm text-text outline-none placeholder:text-muted"
            />
          </label>
          <div className="w-40">
            <Select
              label="Kind"
              hideLabel
              value={type}
              onChange={(e) => {
                setType(e.target.value);
                setPage(1);
              }}
              options={[
                { value: '', label: 'All kinds' },
                { value: 'DYNAMIC', label: 'Segments' },
                { value: 'STATIC', label: 'Lists' },
              ]}
            />
          </div>
          <Checkbox
            label="Show archived"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
        </div>
        {canManage ? (
          <button type="button" className={gold} onClick={() => setEdit('new')}>
            <Plus aria-hidden weight="bold" className="size-5" /> New Segment
          </button>
        ) : null}
      </div>
      <div className="relative">
        <Table
          rows={list.data?.items ?? []}
          columns={columns}
          rowKey={(r) => r.id}
          caption="Segments and lists"
          dense
          noun="segments"
          pageSize={10}
          loading={list.isPending}
          emptyTitle={list.isError ? 'Segments are not available' : 'No segments yet'}
          emptyText={
            list.isError
              ? 'We could not load the segments. Try again in a moment.'
              : 'Create a segment to send to a group of clients in one step.'
          }
          rowActions={(r) => (
            <ActionMenu
              label={`Actions for ${r.name}`}
              trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
              align="right"
              sections={[
                {
                  items: [
                    { label: 'View Members', icon: UsersThree, onSelect: () => setMembers(r) },
                    ...(canManage
                      ? [
                          {
                            label: 'Edit',
                            icon: PencilSimple,
                            onSelect: () => void api.communications.segment(r.id).then(setEdit),
                          },
                          {
                            label: 'Duplicate',
                            icon: Copy,
                            onSelect: () =>
                              void act(
                                () => api.communications.duplicateSegment(r.id),
                                'Segment duplicated.',
                              ),
                          },
                          r.archived
                            ? {
                                label: 'Restore',
                                icon: ArrowCounterClockwise,
                                onSelect: () =>
                                  void act(
                                    () => api.communications.restoreSegment(r.id),
                                    'Segment restored.',
                                  ),
                              }
                            : {
                                label: 'Archive',
                                icon: Archive,
                                danger: true,
                                onSelect: () =>
                                  void act(
                                    () => api.communications.archiveSegment(r.id),
                                    'Segment archived.',
                                  ),
                              },
                        ]
                      : []),
                  ],
                },
              ]}
            />
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
      {edit ? (
        <SegmentDialog
          segment={edit === 'new' ? undefined : edit}
          canManage={canManage}
          onClose={() => setEdit(undefined)}
          onNotice={onNotice}
        />
      ) : null}
      {members ? <MembersDialog segment={members} onClose={() => setMembers(undefined)} /> : null}
    </section>
  );
}
