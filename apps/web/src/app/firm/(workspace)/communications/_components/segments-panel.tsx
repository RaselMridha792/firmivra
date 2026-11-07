'use client';

import type { SegmentDetail, SegmentField, SegmentMemberPage, SegmentRow } from '@firmivra/types';
import {
  ActionMenu,
  Button,
  Callout,
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
  Lightbulb,
  Trash,
  UsersThree,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { useAct, type Notice } from './communication-actions';
import {
  COMM_ERRORS,
  COMM_KEY,
  card,
  dateTimeText,
  dayText,
  gold,
  quiet,
  timeText,
} from './communications-shared';

type Cond = { field: string; op: SegmentField['operators'][number]; value: string | string[] };
type Person = SegmentMemberPage['items'][number];
/** A member whose role only views Communications (CM-F17, CM-F18): the exact reason. */
const VIEW_ONLY = 'Your role can view segments but not change them. Ask an Owner or Admin.';
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
export function SegmentDialog({
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
  // CM-F15: all of the rules (AND) or any of them (OR); saved groups are kept as they are.
  const [logic, setLogic] = useState<'AND' | 'OR'>(segment?.criteria?.logic ?? 'AND');
  const groups = segment?.criteria?.groups ?? [];
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const list = (fields.data ?? []).filter(
    (f) => f.audience === 'BOTH' || audience === 'BOTH' || f.audience === audience,
  );
  const criteria = {
    logic,
    conditions: conds.filter((c) => c.field && c.value !== ''),
    ...(groups.length ? { groups } : {}),
  };
  // What the saved segment held, in the same shape, to send only what changed (CM-F13: a name or
  // description edit never re-evaluates who belongs).
  const saved = segment?.criteria
    ? {
        logic: segment.criteria.logic ?? 'AND',
        conditions: (segment.criteria.conditions ?? []).filter(
          (c) => c.field && c.value !== '' && c.value !== undefined,
        ),
        ...(groups.length ? { groups } : {}),
      }
    : null;
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
                  const changes = {
                    ...(name.trim() !== segment.name ? { name: name.trim() } : {}),
                    ...((description.trim() || null) !== segment.description
                      ? { description: description.trim() || null }
                      : {}),
                    ...(audience !== segment.audience ? { audience } : {}),
                    ...(type === 'DYNAMIC' && JSON.stringify(criteria) !== JSON.stringify(saved)
                      ? { criteria }
                      : {}),
                  };
                  if (Object.keys(changes).length === 0) {
                    onNotice('Nothing changed.', 'success');
                    onClose();
                    return;
                  }
                  await api.communications.updateSegment(segment.id, {
                    ...changes,
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
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h3 className="text-sm font-semibold text-heading">
                Include people where {logic === 'OR' ? 'any' : 'all'} of these are true
              </h3>
              <div className="w-56">
                <Select
                  label="Match"
                  value={logic}
                  onChange={(e) => setLogic(e.target.value as 'AND' | 'OR')}
                  options={[
                    { value: 'AND', label: 'All of these rules (AND)' },
                    { value: 'OR', label: 'Any of these rules (OR)' },
                  ]}
                />
              </div>
            </div>
            {groups.length ? (
              <p className="text-xs text-muted">
                This segment also has {groups.length} saved rule group
                {groups.length === 1 ? '' : 's'}, kept as they are.
              </p>
            ) : null}
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
        {/* CM-F16: the live count and who matches, recalculated as the rules change; a count for
            the old rules is never shown as the current one. Nothing is saved or sent. */}
        <div
          role="status"
          className="rounded-lg bg-info-soft p-3 text-sm text-info"
          data-testid="segment-count"
        >
          {type === 'STATIC' ? (
            `${picked.length} chosen`
          ) : preview.data ? (
            preview.data.count === 0 ? (
              'No one matches these rules right now.'
            ) : (
              <>
                {preview.data.count} {preview.data.count === 1 ? 'person matches' : 'people match'}{' '}
                right now (at {timeText(preview.data.calculatedAt)}).
                <span className="mt-1 block text-xs" data-testid="segment-sample">
                  For example:{' '}
                  {preview.data.sample
                    .slice(0, 3)
                    .map((p) => p.label)
                    .join(', ')}
                  {preview.data.count > 3 ? ' and others' : ''}. {preview.data.criteriaSummary}.
                </span>
              </>
            )
          ) : preview.isError ? (
            'The count is not available right now.'
          ) : (
            'Counting…'
          )}
        </div>
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/**
 * View Members. A list's people are added and removed here by whoever may change segments
 * (CM-F18), saved together; a segment's members follow its rules. Others see the exact reason.
 */
function MembersDialog({
  segment,
  canManage,
  onClose,
  onNotice,
}: {
  segment: SegmentRow;
  canManage: boolean;
  onClose: () => void;
  onNotice: Notice;
}) {
  const qc = useQueryClient();
  const editable = canManage && segment.type === 'STATIC' && !segment.archived;
  const [search, setSearch] = useState('');
  const term = useDeferredValue(search.trim());
  const members = useApiQuery([...COMM_KEY, 'segment-members', segment.id, term], () =>
    api.communications.segmentMembers(segment.id, {
      ...(term ? { search: term } : {}),
      page: 1,
      pageSize: 50,
    }),
  );
  // Editing a list: every member (page by page) and the list's etag, then changes held here.
  const everyone = useApiQuery([...COMM_KEY, 'segment-members-all', segment.id], async () => {
    const all: Person[] = [];
    for (let page = 1; page <= 50; page++) {
      const p = await api.communications.segmentMembers(segment.id, { page, pageSize: 100 });
      all.push(...p.items);
      if (all.length >= p.total || p.items.length === 0) break;
    }
    const detail = await api.communications.segment(segment.id);
    return { all, etag: detail.etag };
  });
  const [chosen, setChosen] = useState<Person[]>();
  const current = chosen ?? everyone.data?.all ?? [];
  const [find, setFind] = useState('');
  const findTerm = useDeferredValue(find.trim());
  const people = useApiQuery([...COMM_KEY, 'segment-people', segment.audience, findTerm], () =>
    api.communications.segmentPeople({
      audience: segment.audience,
      ...(findTerm ? { search: findTerm } : {}),
      pageSize: 10,
    }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const shown = editable
    ? current.filter((m) => !term || m.label.toLowerCase().includes(term.toLowerCase()))
    : (members.data?.items ?? []);
  const save = async () => {
    if (!everyone.data) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.communications.setSegmentMembers(segment.id, {
        clientIds: current.filter((m) => m.kind === 'CLIENT').map((m) => m.id),
        leadIds: current.filter((m) => m.kind === 'LEAD').map((m) => m.id),
        etag: everyone.data.etag,
      });
      await qc.invalidateQueries({ queryKey: [...COMM_KEY] });
      onNotice(`${segment.name} saved: ${current.length} members.`, 'success');
      onClose();
    } catch (e) {
      setError(errorMessage(e, COMM_ERRORS));
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={segment.name}
      subtitle={`${editable ? current.length : segment.memberCount} members`}
      onClose={onClose}
      footer={
        editable ? (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={busy || chosen === undefined || !everyone.data} onClick={save}>
              Save Members
            </Button>
          </>
        ) : (
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-3" data-testid="members-dialog">
        {segment.type === 'STATIC' && !canManage ? (
          <p className={quiet} data-testid="members-reason">
            {VIEW_ONLY}
          </p>
        ) : null}
        <Input label="Search members" value={search} onChange={(e) => setSearch(e.target.value)} />
        {shown.length === 0 ? (
          <p className={quiet}>
            {(editable ? everyone.isPending : members.isPending) ? 'Loading…' : 'No members match.'}
          </p>
        ) : null}
        <ul className="max-h-72 overflow-auto" aria-label="Members">
          {shown.map((m) => (
            <li
              key={m.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
            >
              <span>
                <span className="font-medium text-heading">{m.label}</span>{' '}
                <span className="text-muted">{m.secondary}</span>
              </span>
              {editable ? (
                <button
                  type="button"
                  aria-label={`Remove ${m.label}`}
                  onClick={() => setChosen(current.filter((x) => x.id !== m.id))}
                  className="inline-flex min-h-9 items-center gap-1 rounded-control px-2 text-sm font-medium text-danger hover:bg-danger-soft"
                >
                  <Trash aria-hidden weight="bold" className="size-4" /> Remove
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {editable ? (
          <section
            aria-label="Add people"
            className="flex flex-col gap-2 border-t border-divider pt-3"
            data-testid="add-people"
          >
            <h3 className="text-sm font-semibold text-heading">Add people</h3>
            <Input label="Find by name" value={find} onChange={(e) => setFind(e.target.value)} />
            <ul className="max-h-48 overflow-auto">
              {(people.data?.items ?? []).map((p) => {
                const on = current.some((m) => m.id === p.id);
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-divider py-1.5 text-sm first:border-t-0"
                  >
                    <span>
                      <span className="font-medium text-heading">{p.label}</span>{' '}
                      <span className="text-muted">{p.secondary}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Add ${p.label}`}
                      disabled={on}
                      onClick={() => setChosen([...current, p])}
                      className="inline-flex min-h-9 items-center gap-1 rounded-control px-2 text-sm font-medium text-link hover:bg-canvas disabled:text-muted"
                    >
                      <Plus aria-hidden weight="bold" className="size-4" />{' '}
                      {on ? 'On the list' : 'Add'}
                    </button>
                  </li>
                );
              })}
            </ul>
            {people.isError ? (
              <p className="text-xs text-danger">People are not available right now.</p>
            ) : null}
          </section>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
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
    // CM-F14: the assigned owner (not necessarily who made it).
    {
      id: 'owner',
      label: 'Owner',
      cell: (r) => <span className="whitespace-nowrap">{r.owner.name}</span>,
    },
    { id: 'used', label: 'Used By', cell: (r) => (r.usedBy ? `${r.usedBy} scheduled` : '—') },
    // CM-F13: when who belongs was last evaluated, apart from a name or description edit.
    {
      id: 'refreshed',
      label: 'Last Refreshed',
      cell: (r) =>
        r.lastRefreshedAt ? (
          <span className="whitespace-nowrap">{dateTimeText(r.lastRefreshedAt)}</span>
        ) : (
          '—'
        ),
    },
    { id: 'upd', label: 'Updated', cell: (r) => dayText(r.updatedAt) },
  ];
  return (
    <section
      className={`${card} flex flex-col gap-3`}
      aria-label="Segments and lists"
      data-testid="segments-panel"
    >
      {/* CM-F02: what these are and what must exist first; nothing is chosen from here. */}
      <Callout
        icon={Lightbulb}
        iconStyle="tile"
        tone="blue"
        surface="info"
        title="How to build an audience"
      >
        <span data-testid="segments-guide" className="block">
          A <strong>segment</strong> follows rules (for example, Client Status is Active) and
          updates itself as clients change. A <strong>list</strong> holds the people you pick. Your
          clients and leads must be in Firmivra first, with an email address for email or a mobile
          number and consent for texts. Then use them in Choose Recipients on a draft.
        </span>
      </Callout>
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
                    ...(!canManage
                      ? [
                          {
                            label: 'Edit',
                            icon: PencilSimple,
                            restricted: 'View only',
                            onSelect: () => onNotice(VIEW_ONLY, 'error'),
                          },
                        ]
                      : []),
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
      {members ? (
        <MembersDialog
          segment={members}
          canManage={canManage}
          onClose={() => setMembers(undefined)}
          onNotice={onNotice}
        />
      ) : null}
    </section>
  );
}
