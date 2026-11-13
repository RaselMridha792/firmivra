'use client';

import type { AdvisoryGoalDetail, AdvisoryGoalRow, AdvisoryMilestone } from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
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
import { FIELD_HELP } from './field-help';
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
  GOAL_STATUS_OPTIONS,
  progressFor,
} from './ba-shared';

const SIZE = 10;

/** /business-advisory/goals: every client goal with its progress and milestones. */
export function GoalsAndMilestones() {
  return (
    <BaShell>
      <GoalsList />
    </BaShell>
  );
}

/**
 * The goals list: every client's (the module's Goals & Milestones tab) or one client's (that
 * client's Goals & Milestones tab: no client filter or column, and new goals are theirs).
 */
export function GoalsList({ advisoryClientId: fixed }: { advisoryClientId?: string }) {
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
  const [clientId, setClientId] = useState(fixed ?? '');
  const [dueBefore, setDueBefore] = useState('');
  // B25 (Octavia, Oct 25): Active, Archived or All; '' is Active.
  const [view, setView] = useState('');
  // B25: Mark Completed, Archive and Restore ask first, naming the goal and what happens.
  const [confirm, setConfirm] = useState<{
    kind: 'complete' | 'archive' | 'restore';
    goal: AdvisoryGoalRow;
  }>();
  const [sort, setSort] = useState('targetDate');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState<{ kind: 'add' } | { kind: 'edit'; goalId: string }>();
  const term = useDeferredValue(search.trim());
  const q = useApiQuery(
    [...BA_KEY, 'goals', term, status, area, owner, clientId, dueBefore, view, sort, page],
    () =>
      api.advisory.goals({
        ...(term ? { search: term } : {}),
        ...(status ? { status: status as never } : {}),
        ...(area ? { area } : {}),
        ...(owner ? { ownerUserId: owner } : {}),
        ...(clientId ? { advisoryClientId: clientId } : {}),
        ...(dueBefore ? { dueBefore } : {}),
        ...(view ? { view: view as 'archived' | 'all' } : {}),
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
  const colsShown = fixed ? cols.filter((c) => c.id !== 'client') : cols;

  return (
    <>
      {toast}
      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Goals and milestones"
        data-testid="ba-goals"
      >
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox value={search} onChange={filter(setSearch)} label="Search goals" />
          {fixed ? null : (
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
          )}
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
          <FilterSelect
            label="View"
            all="Active goals"
            value={view}
            onChange={filter(setView)}
            options={[
              { value: 'archived', label: 'Archived goals' },
              { value: 'all', label: 'All goals' },
            ]}
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
          columns={colsShown}
          rowKey={(r) => r.id}
          caption="Goals and milestones"
          dense
          noun="goals"
          pageSize={SIZE}
          loading={q.isPending}
          emptyTitle={
            q.isError
              ? 'Goals are not available'
              : view === 'archived'
                ? 'No archived goals'
                : 'No goals'
          }
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
                            onSelect: () => setConfirm({ kind: 'complete', goal: r }),
                          },
                        ]
                      : []),
                    ...(fixed
                      ? []
                      : [
                          {
                            label: 'Open Client',
                            icon: Eye,
                            onSelect: () =>
                              router.push(`${BASE}/clients/${r.advisoryClientId}/goals`),
                          },
                        ]),
                  ],
                },
                {
                  items: [
                    r.archived
                      ? {
                          label: 'Restore',
                          icon: ArrowCounterClockwise,
                          onSelect: () => setConfirm({ kind: 'restore', goal: r }),
                        }
                      : {
                          label: 'Archive',
                          icon: Archive,
                          danger: true,
                          onSelect: () => setConfirm({ kind: 'archive', goal: r }),
                        },
                  ],
                },
              ]}
            />
          )}
          server={serverPaging(q.data, SIZE, page, setPage)}
        />
      </section>
      {confirm ? (
        <Modal
          open
          title={
            confirm.kind === 'complete'
              ? 'Mark this goal completed?'
              : confirm.kind === 'archive'
                ? 'Archive this goal?'
                : 'Restore this goal?'
          }
          subtitle={`${confirm.goal.title} · ${confirm.goal.client.name}`}
          onClose={() => setConfirm(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirm(undefined)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const { kind, goal } = confirm;
                  setConfirm(undefined);
                  if (kind === 'complete') complete(goal);
                  else if (kind === 'archive')
                    void act(() => api.advisory.archiveGoal(goal.id), 'Goal archived.');
                  else void act(() => api.advisory.restoreGoal(goal.id), 'Goal restored.');
                }}
              >
                {confirm.kind === 'complete'
                  ? 'Mark Completed'
                  : confirm.kind === 'archive'
                    ? 'Archive Goal'
                    : 'Restore Goal'}
              </Button>
            </>
          }
        >
          <p className="text-sm text-text" data-testid="goal-confirm">
            {confirm.kind === 'complete'
              ? 'The goal is marked Completed with its progress at 100%. It can be reopened later by changing its status.'
              : confirm.kind === 'archive'
                ? 'The goal leaves the active list. Nothing is deleted: its milestones, history and plan link stay, and it can be restored from the Archived view.'
                : 'The goal returns to the active list as it was, with its milestones, history and plan link.'}
          </p>
        </Modal>
      ) : null}
      {dialog?.kind === 'add' ? (
        <AddGoalDialog
          {...(fixed ? { advisoryClientId: fixed } : {})}
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
    </>
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
          onChange={(e) => {
            const next = progressFor(e.target.value, status, progress);
            setStatus(e.target.value);
            setProgress(next.progress);
          }}
          options={GOAL_STATUS_OPTIONS}
        />
        <Input
          label="Progress (%)"
          type="number"
          min={0}
          max={100}
          value={progress}
          readOnly={progressFor(status, status, progress).locked}
          title={
            progressFor(status, status, progress).locked
              ? 'Set by the status: Completed is 100%, Not Started 0%'
              : undefined
          }
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
        hint={FIELD_HELP.goalDescription}
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

/**
 * The goal's milestones (Octavia's B8: owner, status and progress, under their goal): change
 * any of them, move one up or down, add one. Each change saves at once; progress follows the
 * status as a goal's does (Completed 100%, Not Started 0%).
 */
function Milestones({
  goal,
  onError,
}: {
  goal: AdvisoryGoalDetail;
  onError: (text: string) => void;
}) {
  const qc = useQueryClient();
  const members = useMembers();
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
      className="grid grid-cols-2 items-center gap-2 py-2 sm:grid-cols-[1fr_9rem_9rem_7rem_auto]"
      data-testid="milestone-row"
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
        value={m.status}
        onChange={(e) => {
          const next = progressFor(e.target.value, m.status, String(m.progressPercent));
          void run(() =>
            api.advisory.updateMilestone(m.id, {
              status: e.target.value as never,
              ...(next.locked ? {} : { progressPercent: Number(next.progress) }),
            }),
          );
        }}
        options={GOAL_STATUS_OPTIONS}
      />
      <Select
        label={`Owner of ${m.title}`}
        hideLabel
        value={m.owner?.userId ?? ''}
        onChange={(e) =>
          void run(() =>
            api.advisory.updateMilestone(m.id, { ownerUserId: e.target.value || null }),
          )
        }
        options={[
          { value: '', label: 'No owner' },
          ...members,
          ...(m.owner && !members.some((x) => x.value === m.owner!.userId)
            ? [{ value: m.owner.userId, label: m.owner.name }]
            : []),
        ]}
      />
      <Select
        label={`Progress of ${m.title}`}
        hideLabel
        disabled={progressFor(m.status, m.status, String(m.progressPercent)).locked}
        value={String(m.progressPercent)}
        onChange={(e) =>
          void run(() =>
            api.advisory.updateMilestone(m.id, { progressPercent: Number(e.target.value) }),
          )
        }
        options={[...new Set([...Array.from({ length: 11 }, (_, k) => k * 10), m.progressPercent])]
          .sort((a, b) => a - b)
          .map((v) => ({ value: String(v), label: `${v}%` }))}
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
