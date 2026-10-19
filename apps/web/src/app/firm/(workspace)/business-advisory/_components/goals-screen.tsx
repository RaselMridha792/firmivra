'use client';

import type { AdvisoryGoalDetail, AdvisoryGoalRow, AdvisoryMilestone } from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  Checkbox,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
  type Column,
} from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowUp,
  CheckCircle,
  DotsThreeVertical,
  Eye,
  PencilSimple,
  Plus,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { AddGoalDialog, ErrorLine, useMembers } from './ba-dialogs';
import { FilterSelect, SearchBox, serverPaging, useAct } from './ba-list-kit';
import { BaShell } from './ba-shell';
import {
  AREA_LABEL,
  BASE,
  BA_KEY,
  GOAL_STATUS,
  GoalStatusPill,
  ProgressBar,
  card,
  dayText,
  primary,
  errorText,
} from './ba-shared';

const SIZE = 10;

/** /business-advisory/goals: every client goal with its progress and milestones. */
export function GoalsAndMilestones() {
  const router = useRouter();
  const { act, toast, say } = useAct();
  const members = useMembers();
  const clients = useApiQuery([...BA_KEY, 'pick-clients'], () =>
    api.advisory.clients({ pageSize: 100 }),
  );
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [area, setArea] = useState('');
  const [owner, setOwner] = useState('');
  const [clientId, setClientId] = useState('');
  const [dueBefore, setDueBefore] = useState('');
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState('targetDate');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ kind: 'add' } | { kind: 'edit'; goalId: string }>();
  const term = useDeferredValue(search.trim());
  const q = useApiQuery(
    [...BA_KEY, 'goals', term, status, area, owner, clientId, dueBefore, archived, sort, page],
    () =>
      api.advisory.goals({
        ...(term ? { search: term } : {}),
        ...(status ? { status: status as never } : {}),
        ...(area ? { area } : {}),
        ...(owner ? { ownerUserId: owner } : {}),
        ...(clientId ? { advisoryClientId: clientId } : {}),
        ...(dueBefore ? { dueBefore } : {}),
        ...(archived ? { includeArchived: true } : {}),
        sort: sort as never,
        direction: sort === 'progress' || sort === 'updated' ? 'desc' : 'asc',
        page,
        pageSize: SIZE,
      }),
  );
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };
  const complete = (g: AdvisoryGoalRow) =>
    void act(async () => {
      const d = await api.advisory.goal(g.id);
      return api.advisory.updateGoal(g.id, { status: 'COMPLETED', etag: d.etag });
    }, `Goal completed: ${g.title}`);

  const cols: Column<AdvisoryGoalRow>[] = [
    {
      id: 'goal',
      label: 'Goal',
      cell: (r) => (
        <span className="flex flex-col">
          <button
            type="button"
            data-testid="goal-link"
            className="text-left font-semibold text-link hover:underline"
            onClick={() => setDialog({ kind: 'edit', goalId: r.id })}
          >
            {r.title}
          </button>
          {r.archived ? (
            <span>
              <Badge tone="neutral">Archived</Badge>
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'client',
      label: 'Client',
      cell: (r) => (
        <Link href={`${BASE}/clients/${r.advisoryClientId}/goals`} className="hover:underline">
          {r.client.name}
        </Link>
      ),
    },
    { id: 'area', label: 'Area', cell: (r) => (r.area ? (AREA_LABEL[r.area] ?? r.area) : '—') },
    {
      id: 'target',
      label: 'Target Date',
      className: 'whitespace-nowrap',
      cell: (r) => dayText(r.targetDate),
    },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (r) => <GoalStatusPill status={r.status} />,
    },
    {
      id: 'progress',
      label: 'Progress',
      cell: (r) => <ProgressBar value={r.progressPercent} label={`Progress of ${r.title}`} />,
    },
    {
      id: 'milestones',
      label: 'Milestones',
      className: 'whitespace-nowrap',
      cell: (r) => (r.milestoneCount ? `${r.milestonesDone} of ${r.milestoneCount} done` : '—'),
    },
    { id: 'owner', label: 'Owner', cell: (r) => r.owner?.name ?? '—' },
  ];

  return (
    <BaShell>
      {toast}
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Goals and milestones"
        data-testid="ba-goals"
      >
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={search} onChange={filter(setSearch)} label="Search goals" />
          <FilterSelect
            label="Client"
            all="All Clients"
            value={clientId}
            onChange={filter(setClientId)}
            options={(clients.data?.items ?? []).map((c) => ({
              value: c.id,
              label: c.client.name,
            }))}
          />
          <FilterSelect
            label="Status"
            all="All Statuses"
            value={status}
            onChange={filter(setStatus)}
            options={Object.entries(GOAL_STATUS).map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            label="Area"
            all="All Areas"
            value={area}
            onChange={filter(setArea)}
            options={Object.entries(AREA_LABEL).map(([value, label]) => ({ value, label }))}
          />
          {members.length ? (
            <FilterSelect
              label="Owner"
              all="All Owners"
              value={owner}
              onChange={filter(setOwner)}
              options={members}
            />
          ) : null}
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-sm text-muted">
              Due by
            </span>
            <Input
              label="Due by"
              hideLabel
              type="date"
              value={dueBefore}
              onChange={(e) => filter(setDueBefore)(e.target.value)}
            />
          </div>
          <FilterSelect
            label="Sort by"
            all="Sort: Target Date"
            value={sort === 'targetDate' ? '' : sort}
            onChange={(v) => filter(setSort)(v || 'targetDate')}
            options={[
              { value: 'title', label: 'Sort: Goal' },
              { value: 'status', label: 'Sort: Status' },
              { value: 'progress', label: 'Sort: Progress' },
              { value: 'updated', label: 'Sort: Last Updated' },
            ]}
          />
          <Checkbox
            label="Show archived"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setPage(1);
            }}
          />
          <button
            type="button"
            className={`${primary} ml-auto`}
            disabled={q.isError}
            onClick={() => setDialog({ kind: 'add' })}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add Business Goal
          </button>
        </div>
        <Table
          rows={q.data?.items ?? []}
          columns={cols}
          rowKey={(r) => r.id}
          caption="Goals and milestones"
          dense
          noun="goals"
          pageSize={SIZE}
          loading={q.isPending}
          emptyTitle={q.isError ? 'Goals are not available' : 'No goals'}
          emptyText={
            q.isError
              ? 'We could not load them. Try again in a moment.'
              : term || status || area || owner || clientId || dueBefore
                ? 'Try another search or filter.'
                : 'Add a business goal for an advisory client.'
          }
          rowActions={(r) => (
            <ActionMenu
              label={`Actions for ${r.title}`}
              trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
              sections={[
                {
                  items: [
                    {
                      label: 'Edit Goal',
                      icon: PencilSimple,
                      onSelect: () => setDialog({ kind: 'edit', goalId: r.id }),
                    },
                    ...(r.status !== 'COMPLETED' && !r.archived
                      ? [
                          {
                            label: 'Mark Completed',
                            icon: CheckCircle,
                            onSelect: () => complete(r),
                          },
                        ]
                      : []),
                    {
                      label: 'Open Client',
                      icon: Eye,
                      onSelect: () => router.push(`${BASE}/clients/${r.advisoryClientId}/goals`),
                    },
                  ],
                },
                {
                  items: [
                    r.archived
                      ? {
                          label: 'Restore',
                          icon: ArrowCounterClockwise,
                          onSelect: () =>
                            void act(() => api.advisory.restoreGoal(r.id), 'Goal restored.'),
                        }
                      : {
                          label: 'Archive',
                          icon: Archive,
                          danger: true,
                          onSelect: () =>
                            void act(() => api.advisory.archiveGoal(r.id), 'Goal archived.'),
                        },
                  ],
                },
              ]}
            />
          )}
          server={serverPaging(q.data, SIZE, page, setPage)}
        />
      </section>
      {dialog?.kind === 'add' ? (
        <AddGoalDialog
          onClose={() => setDialog(undefined)}
          onAdded={(title) => {
            setDialog(undefined);
            say(`Goal added: ${title}`);
          }}
        />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <EditGoalDialog
          goalId={dialog.goalId}
          onClose={() => setDialog(undefined)}
          onSaved={(title) => {
            setDialog(undefined);
            say(`Goal saved: ${title}`);
          }}
        />
      ) : null}
    </BaShell>
  );
}

/** Edit a goal and track its milestones: status, order and new ones. */
export function EditGoalDialog({
  goalId,
  onClose,
  onSaved,
}: {
  goalId: string;
  onClose: () => void;
  onSaved: (title: string) => void;
}) {
  const q = useApiQuery([...BA_KEY, 'goal', goalId], () => api.advisory.goal(goalId));
  return (
    <Modal
      open
      title="Edit Business Goal"
      subtitle={q.data ? `${q.data.client.name}` : 'Loading the goal…'}
      onClose={onClose}
    >
      {q.isError ? (
        <p className="text-sm text-muted">The goal could not be loaded. Try again in a moment.</p>
      ) : q.data ? (
        <GoalForm goal={q.data} onClose={onClose} onSaved={onSaved} />
      ) : null}
    </Modal>
  );
}

function GoalForm({
  goal,
  onClose,
  onSaved,
}: {
  goal: AdvisoryGoalDetail;
  onClose: () => void;
  onSaved: (title: string) => void;
}) {
  const qc = useQueryClient();
  const members = useMembers();
  const [title, setTitle] = useState(goal.title);
  const [area, setArea] = useState(goal.area ?? '');
  const [targetDate, setTargetDate] = useState(goal.targetDate ?? '');
  const [status, setStatus] = useState<string>(
    goal.status === 'OVERDUE' ? 'IN_PROGRESS' : goal.status,
  );
  const [progress, setProgress] = useState(String(goal.progressPercent));
  const [owner, setOwner] = useState(goal.owner?.userId ?? '');
  const [description, setDescription] = useState(goal.description ?? '');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: [...BA_KEY] });

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const pct = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
      await api.advisory.updateGoal(goal.id, {
        etag: goal.etag,
        title: title.trim(),
        area: area || null,
        targetDate: targetDate || null,
        status: status as never,
        progressPercent: pct,
        description: description.trim() || null,
        ...(owner ? { ownerUserId: owner } : {}),
      });
      await refresh();
      onSaved(title.trim());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3" data-testid="edit-goal">
      <ErrorLine text={error} />
      <Input
        label="Goal"
        required
        value={title}
        maxLength={300}
        onChange={(e) => setTitle(e.target.value)}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="Area"
          value={area}
          onChange={(e) => setArea(e.target.value)}
          options={[
            { value: '', label: 'Not set' },
            ...Object.entries(AREA_LABEL).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Input
          label="Target date"
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
        />
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={Object.entries(GOAL_STATUS)
            .filter(([v]) => v !== 'OVERDUE')
            .map(([value, label]) => ({ value, label }))}
        />
        <Input
          label="Progress (%)"
          type="number"
          min={0}
          max={100}
          value={progress}
          onChange={(e) => setProgress(e.target.value)}
        />
        {members.length ? (
          <Select
            label="Owner"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            options={[{ value: '', label: goal.owner?.name ?? 'Not set' }, ...members]}
          />
        ) : null}
      </div>
      <Textarea
        label="Description"
        rows={3}
        maxLength={2000}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <Milestones goal={goal} onError={setError} />
      <div className="flex justify-end gap-2 border-t border-divider pt-3">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!title.trim() || saving} onClick={() => void save()}>
          Save Goal
        </Button>
      </div>
    </div>
  );
}

/** The goal's milestones: change a status, move one up or down, add one. Each change saves at once. */
function Milestones({
  goal,
  onError,
}: {
  goal: AdvisoryGoalDetail;
  onError: (text: string) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const run = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
    } catch (e) {
      onError(errorText(e));
    }
  };
  const ids = goal.milestones.map((m) => m.id);
  const swap = (i: number, j: number) => {
    const next = [...ids];
    [next[i], next[j]] = [next[j]!, next[i]!];
    void run(() => api.advisory.reorderMilestones(goal.id, { ids: next }));
  };
  const row = (m: AdvisoryMilestone, i: number) => (
    <li
      key={m.id}
      className="grid grid-cols-[1fr_auto] items-center gap-2 py-2 sm:grid-cols-[1fr_10rem_auto]"
    >
      <span className="flex flex-col text-sm">
        <span className="font-medium text-heading">{m.title}</span>
        <span className="text-xs text-muted">
          {m.targetDate ? `Target ${dayText(m.targetDate)}` : 'No target date'}
          {m.owner ? ` · ${m.owner.name}` : ''}
        </span>
      </span>
      <Select
        label={`Status of ${m.title}`}
        hideLabel
        value={m.status === 'OVERDUE' ? 'IN_PROGRESS' : m.status}
        onChange={(e) =>
          void run(() => api.advisory.updateMilestone(m.id, { status: e.target.value as never }))
        }
        options={Object.entries(GOAL_STATUS)
          .filter(([v]) => v !== 'OVERDUE')
          .map(([value, label]) => ({ value, label }))}
      />
      <span className="col-span-2 flex justify-end gap-1 sm:col-span-1">
        <Button
          variant="secondary"
          aria-label={`Move ${m.title} up`}
          disabled={i === 0}
          onClick={() => swap(i, i - 1)}
        >
          <ArrowUp aria-hidden weight="bold" className="size-4" />
        </Button>
        <Button
          variant="secondary"
          aria-label={`Move ${m.title} down`}
          disabled={i === ids.length - 1}
          onClick={() => swap(i, i + 1)}
        >
          <ArrowDown aria-hidden weight="bold" className="size-4" />
        </Button>
      </span>
    </li>
  );
  return (
    <fieldset className="flex flex-col gap-1" data-testid="milestones">
      <legend className="text-sm font-medium text-text">
        Milestones ({goal.milestones.filter((m) => m.status === 'COMPLETED').length} of{' '}
        {goal.milestones.length} done)
      </legend>
      {goal.milestones.length ? (
        <ul className="divide-y divide-divider">{goal.milestones.map(row)}</ul>
      ) : (
        <p className="text-sm text-muted">No milestones yet.</p>
      )}
      <div className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
        <Input
          label="New milestone"
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input
          label="Target date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <Button
          variant="secondary"
          disabled={!title.trim()}
          onClick={() =>
            void run(async () => {
              await api.advisory.addMilestone(goal.id, {
                title: title.trim(),
                ...(date ? { targetDate: date } : {}),
              });
              setTitle('');
              setDate('');
            })
          }
        >
          <Plus aria-hidden weight="bold" className="size-4" /> Add
        </Button>
      </div>
    </fieldset>
  );
}
