'use client';

import type { AdvisoryActionItemRow, AdvisoryRecommendationRow } from '@firmivra/types';
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
  type ActionMenuItem,
  type Column,
} from '@firmivra/ui';
import {
  ArrowRight,
  CheckCircle,
  DotsThreeVertical,
  Eye,
  EyeSlash,
  Flag,
  ListChecks,
  Play,
  Plus,
  Prohibit,
  Target,
  XCircle,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useDeferredValue, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { ErrorLine, useMembers } from './ba-dialogs';
import { FilterSelect, SearchBox, serverPaging, useAct } from './ba-list-kit';
import { BaShell } from './ba-shell';
import {
  ACTION_STATUS,
  ASSIGNEE_KIND,
  ActionStatusPill,
  BASE,
  BA_KEY,
  PRIORITY,
  PriorityPill,
  REC_STATUS,
  RecStatusPill,
  SectionHead,
  card,
  centsOf,
  dayText,
  errorText,
  money,
  primary,
} from './ba-shared';

const SIZE = 8;

/** /business-advisory/action-plans: recommendations and the action items that carry them out. */
export function ActionPlans() {
  const { act, toast, say } = useAct();
  const members = useMembers();
  const clients = useApiQuery([...BA_KEY, 'pick-clients'], () =>
    api.advisory.clients({ pageSize: 100 }),
  );
  const nameOf = (advisoryClientId: string) =>
    clients.data?.items.find((c) => c.id === advisoryClientId)?.client.name ?? '—';
  const [clientId, setClientId] = useState('');
  const [dialog, setDialog] = useState<'rec' | 'action'>();

  // Recommendations.
  const [recSearch, setRecSearch] = useState('');
  const [recStatus, setRecStatus] = useState('');
  const [visible, setVisible] = useState('');
  const [recPage, setRecPage] = useState(1);
  const recTerm = useDeferredValue(recSearch.trim());
  const recs = useApiQuery(
    [...BA_KEY, 'recommendations', clientId, recTerm, recStatus, visible, recPage],
    () =>
      api.advisory.recommendations({
        ...(clientId ? { advisoryClientId: clientId } : {}),
        ...(recTerm ? { search: recTerm } : {}),
        ...(recStatus ? { status: recStatus as never } : {}),
        ...(visible ? { clientVisible: visible === 'yes' } : {}),
        page: recPage,
        pageSize: SIZE,
      }),
  );

  // Action items.
  const [taskSearch, setTaskSearch] = useState('');
  const [taskStatus, setTaskStatus] = useState('');
  const [kind, setKind] = useState('');
  const [assignee, setAssignee] = useState('');
  const [dueBefore, setDueBefore] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [taskPage, setTaskPage] = useState(1);
  const taskTerm = useDeferredValue(taskSearch.trim());
  const tasks = useApiQuery(
    [
      ...BA_KEY,
      'action-items',
      clientId,
      taskTerm,
      taskStatus,
      kind,
      assignee,
      dueBefore,
      overdue,
      taskPage,
    ],
    () =>
      api.advisory.actionItems({
        ...(clientId ? { advisoryClientId: clientId } : {}),
        ...(taskTerm ? { search: taskTerm } : {}),
        ...(taskStatus ? { status: taskStatus as never } : {}),
        ...(kind ? { assigneeKind: kind as never } : {}),
        ...(assignee ? { assigneeUserId: assignee } : {}),
        ...(dueBefore ? { dueBefore } : {}),
        ...(overdue ? { overdue: true } : {}),
        page: taskPage,
        pageSize: SIZE,
      }),
  );
  const recFilter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setRecPage(1);
  };
  const taskFilter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setTaskPage(1);
  };

  const recMoves = (r: AdvisoryRecommendationRow): ActionMenuItem[] => {
    const to = (status: string, label: string, icon: ActionMenuItem['icon']) => ({
      label,
      icon,
      onSelect: () =>
        void act(
          () => api.advisory.updateRecommendation(r.id, { status: status as never }),
          `${r.title}: ${REC_STATUS[status]?.toLowerCase()}.`,
        ),
    });
    const moves: ActionMenuItem[] = [];
    if (r.status === 'PROPOSED')
      moves.push(to('ACCEPTED', 'Accept', CheckCircle), to('DECLINED', 'Decline', XCircle));
    if (r.status === 'ACCEPTED') moves.push(to('IN_PROGRESS', 'Start', Play));
    if (r.status === 'ACCEPTED' || r.status === 'IN_PROGRESS')
      moves.push(to('IMPLEMENTED', 'Mark Implemented', Flag));
    if (r.status !== 'NOT_APPLICABLE' && r.status !== 'IMPLEMENTED')
      moves.push(to('NOT_APPLICABLE', 'Not Applicable', Prohibit));
    if (r.status !== 'PROPOSED') moves.push(to('PROPOSED', 'Back to Proposed', ArrowRight));
    return moves;
  };
  const taskMoves = (a: AdvisoryActionItemRow): ActionMenuItem[] => {
    const to = (status: string, label: string, icon: ActionMenuItem['icon']) => ({
      label,
      icon,
      onSelect: () =>
        void act(
          () => api.advisory.updateActionItem(a.id, { status: status as never }),
          `${a.title}: ${ACTION_STATUS[status]?.toLowerCase()}.`,
        ),
    });
    const moves: ActionMenuItem[] = [];
    if (a.status === 'NOT_STARTED') moves.push(to('IN_PROGRESS', 'Start', Play));
    if (a.status === 'NOT_STARTED' || a.status === 'IN_PROGRESS')
      moves.push(to('DONE', 'Mark Done', CheckCircle), to('CANCELLED', 'Cancel', XCircle));
    if (a.status === 'DONE' || a.status === 'CANCELLED')
      moves.push(to('IN_PROGRESS', 'Reopen', ArrowRight));
    return moves;
  };
  const visibility = (
    label: string,
    on: boolean,
    work: (clientVisible: boolean) => Promise<unknown>,
  ): ActionMenuItem =>
    on
      ? {
          label: 'Hide from Client Portal',
          icon: EyeSlash,
          onSelect: () => void act(() => work(false), `${label} hidden from the client.`),
        }
      : {
          label: 'Show on Client Portal',
          icon: Eye,
          onSelect: () => void act(() => work(true), `${label} shown to the client.`),
        };

  const recCols: Column<AdvisoryRecommendationRow>[] = [
    {
      id: 'title',
      label: 'Recommendation',
      cell: (r) => (
        <span className="flex max-w-80 flex-col">
          <span className="font-semibold text-heading">{r.title}</span>
          {r.rationale ? <span className="line-clamp-2 text-muted">{r.rationale}</span> : null}
        </span>
      ),
    },
    {
      id: 'client',
      label: 'Client',
      cell: (r) => (
        <Link
          href={`${BASE}/clients/${r.advisoryClientId}/recommendations`}
          className="hover:underline"
        >
          {nameOf(r.advisoryClientId)}
        </Link>
      ),
    },
    { id: 'category', label: 'Category', cell: (r) => r.category ?? '—' },
    {
      id: 'impact',
      label: 'Potential Impact',
      className: 'whitespace-nowrap',
      cell: (r) => r.impactLabel ?? (r.impactCents === null ? '—' : money(r.impactCents)),
    },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (r) => <RecStatusPill status={r.status} />,
    },
    {
      id: 'visible',
      label: 'Client Portal',
      className: 'whitespace-nowrap',
      cell: (r) =>
        r.clientVisible ? (
          <Badge tone="success">Visible</Badge>
        ) : (
          <Badge tone="neutral">Staff only</Badge>
        ),
    },
    {
      id: 'updated',
      label: 'Updated',
      className: 'whitespace-nowrap',
      cell: (r) => dayText(r.updatedAt),
    },
  ];
  const taskCols: Column<AdvisoryActionItemRow>[] = [
    {
      id: 'title',
      label: 'Action Item',
      cell: (a) => (
        <span className="flex max-w-80 flex-col">
          <span className="font-semibold text-heading">{a.title}</span>
          {a.details ? <span className="line-clamp-2 text-muted">{a.details}</span> : null}
        </span>
      ),
    },
    {
      id: 'client',
      label: 'Client',
      cell: (a) => (
        <Link href={`${BASE}/clients/${a.advisoryClientId}/tasks`} className="hover:underline">
          {a.client.name}
        </Link>
      ),
    },
    {
      id: 'assignee',
      label: 'Assigned To',
      cell: (a) => (
        <span className="flex flex-col leading-snug">
          <span>
            {a.assignee?.name ?? (a.assigneeKind === 'CLIENT' ? a.client.name : 'Advisory team')}
          </span>
          <span className="text-muted">{ASSIGNEE_KIND[a.assigneeKind]}</span>
        </span>
      ),
    },
    {
      id: 'due',
      label: 'Due Date',
      className: 'whitespace-nowrap',
      cell: (a) => (
        <span className="flex flex-col items-start gap-1">
          <span>{dayText(a.dueOn)}</span>
          {a.overdue ? <Badge tone="danger">Overdue</Badge> : null}
        </span>
      ),
    },
    { id: 'priority', label: 'Priority', cell: (a) => <PriorityPill priority={a.priority} /> },
    {
      id: 'status',
      label: 'Status',
      className: 'whitespace-nowrap',
      cell: (a) => <ActionStatusPill status={a.status} />,
    },
    {
      id: 'visible',
      label: 'Client Portal',
      className: 'whitespace-nowrap',
      cell: (a) =>
        a.clientVisible ? (
          <Badge tone="success">Visible</Badge>
        ) : (
          <Badge tone="neutral">Staff only</Badge>
        ),
    },
  ];

  return (
    <BaShell>
      {toast}
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          label="Client"
          all="All Clients"
          value={clientId}
          onChange={(v) => {
            setClientId(v);
            setRecPage(1);
            setTaskPage(1);
          }}
          options={(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.client.name }))}
          width="w-56"
        />
      </div>

      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Recommendations"
        data-testid="ba-recommendations"
      >
        <SectionHead
          icon={Target}
          title="Recommendations"
          subtitle="What the advisor proposes, its potential impact and where it stands."
        />
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox
            value={recSearch}
            onChange={recFilter(setRecSearch)}
            label="Search recommendations"
          />
          <FilterSelect
            label="Recommendation status"
            all="All Statuses"
            value={recStatus}
            onChange={recFilter(setRecStatus)}
            options={Object.entries(REC_STATUS).map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            label="Client portal"
            all="Visible or Not"
            value={visible}
            onChange={recFilter(setVisible)}
            options={[
              { value: 'yes', label: 'Visible to client' },
              { value: 'no', label: 'Staff only' },
            ]}
          />
          <button
            type="button"
            className={`${primary} ml-auto`}
            disabled={recs.isError}
            onClick={() => setDialog('rec')}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add Recommendation
          </button>
        </div>
        <Table
          rows={recs.data?.items ?? []}
          columns={recCols}
          rowKey={(r) => r.id}
          caption="Recommendations"
          dense
          noun="recommendations"
          pageSize={SIZE}
          loading={recs.isPending}
          emptyTitle={recs.isError ? 'Recommendations are not available' : 'No recommendations'}
          emptyText={
            recs.isError
              ? 'We could not load them. Try again in a moment.'
              : 'Add a recommendation for an advisory client.'
          }
          rowActions={(r) => (
            <ActionMenu
              label={`Actions for ${r.title}`}
              trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
              sections={[
                { items: recMoves(r) },
                {
                  items: [
                    visibility(r.title, r.clientVisible, (clientVisible) =>
                      api.advisory.updateRecommendation(r.id, { clientVisible }),
                    ),
                  ],
                },
              ]}
            />
          )}
          server={serverPaging(recs.data, SIZE, recPage, setRecPage)}
        />
      </section>

      <section
        className={`${card} flex flex-col gap-3`}
        aria-label="Action items"
        data-testid="ba-action-items"
      >
        <SectionHead
          icon={ListChecks}
          title="Action Items & Tasks"
          subtitle="Who does what by when: staff, the client or the advisory team."
        />
        <div className="flex flex-wrap items-center gap-3">
          <SearchBox
            value={taskSearch}
            onChange={taskFilter(setTaskSearch)}
            label="Search action items"
          />
          <FilterSelect
            label="Action item status"
            all="All Statuses"
            value={taskStatus}
            onChange={taskFilter(setTaskStatus)}
            options={Object.entries(ACTION_STATUS).map(([value, label]) => ({ value, label }))}
          />
          <FilterSelect
            label="Assigned to"
            all="Anyone"
            value={kind}
            onChange={taskFilter(setKind)}
            options={Object.entries(ASSIGNEE_KIND).map(([value, label]) => ({ value, label }))}
            width="w-36"
          />
          {members.length ? (
            <FilterSelect
              label="Advisor"
              all="All Staff"
              value={assignee}
              onChange={taskFilter(setAssignee)}
              options={members}
            />
          ) : null}
          <span className="flex items-center gap-2">
            <span aria-hidden className="text-sm text-muted">
              Due by
            </span>
            <Input
              label="Due by"
              hideLabel
              type="date"
              value={dueBefore}
              onChange={(e) => taskFilter(setDueBefore)(e.target.value)}
            />
          </span>
          <Checkbox
            label="Overdue only"
            checked={overdue}
            onChange={(e) => {
              setOverdue(e.target.checked);
              setTaskPage(1);
            }}
          />
          <button
            type="button"
            className={`${primary} ml-auto`}
            disabled={tasks.isError}
            onClick={() => setDialog('action')}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add Action Item
          </button>
        </div>
        <Table
          rows={tasks.data?.items ?? []}
          columns={taskCols}
          rowKey={(a) => a.id}
          caption="Action items"
          dense
          noun="action items"
          pageSize={SIZE}
          loading={tasks.isPending}
          emptyTitle={tasks.isError ? 'Action items are not available' : 'No action items'}
          emptyText={
            tasks.isError
              ? 'We could not load them. Try again in a moment.'
              : 'Add an action item to carry out a plan or a recommendation.'
          }
          rowActions={(a) => (
            <ActionMenu
              label={`Actions for ${a.title}`}
              trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-5" />}
              sections={[
                { items: taskMoves(a) },
                {
                  items: [
                    visibility(a.title, a.clientVisible, (clientVisible) =>
                      api.advisory.updateActionItem(a.id, { clientVisible }),
                    ),
                  ],
                },
              ]}
            />
          )}
          server={serverPaging(tasks.data, SIZE, taskPage, setTaskPage)}
        />
      </section>

      <section
        className={`${card} flex flex-wrap items-center justify-between gap-3`}
        aria-label="Milestones"
        data-testid="ba-milestones-note"
      >
        <SectionHead
          icon={Flag}
          title="Milestones"
          subtitle="Milestones are tracked with their goals: target dates, owners, status and progress."
        />
        <Link
          href={`${BASE}/goals`}
          className="inline-flex items-center gap-1 text-sm font-medium text-link hover:underline"
        >
          Open Goals &amp; Milestones <ArrowRight aria-hidden weight="bold" className="size-4" />
        </Link>
      </section>

      {dialog === 'rec' ? (
        <AddRecommendationDialog
          {...(clientId ? { advisoryClientId: clientId } : {})}
          onClose={() => setDialog(undefined)}
          onAdded={(title) => {
            setDialog(undefined);
            say(`Recommendation added: ${title}`);
          }}
        />
      ) : null}
      {dialog === 'action' ? (
        <AddActionItemDialog
          {...(clientId ? { advisoryClientId: clientId } : {})}
          onClose={() => setDialog(undefined)}
          onAdded={(title) => {
            setDialog(undefined);
            say(`Action item added: ${title}`);
          }}
        />
      ) : null}
    </BaShell>
  );
}

/** The client and, optionally, one of their plans and goals; shared by the two add dialogs. */
function useClientLinks(preset?: string, presetPlan?: string) {
  const clients = useApiQuery([...BA_KEY, 'pick-clients'], () =>
    api.advisory.clients({ pageSize: 100 }),
  );
  const [clientId, setClientId] = useState(preset ?? '');
  const [planId, setPlanId] = useState(presetPlan ?? '');
  const [goalId, setGoalId] = useState('');
  const plans = useApiQuery([...BA_KEY, 'pick-plans', clientId], () =>
    clientId
      ? api.advisory.plans({ advisoryClientId: clientId, pageSize: 100 })
      : Promise.resolve(null),
  );
  const goals = useApiQuery([...BA_KEY, 'pick-goals', clientId], () =>
    clientId
      ? api.advisory.goals({ advisoryClientId: clientId, pageSize: 100 })
      : Promise.resolve(null),
  );
  const fields = (
    <>
      <Select
        label="Advisory client"
        required
        value={clientId}
        onChange={(e) => {
          setClientId(e.target.value);
          setPlanId('');
          setGoalId('');
        }}
        options={[
          {
            value: '',
            label: clients.isError ? 'Advisory clients could not be loaded' : 'Choose a client…',
          },
          ...(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.client.name })),
        ]}
      />
      {plans.data?.items.length || goals.data?.items.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Business plan"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            options={[
              { value: '', label: 'Not in a plan' },
              ...(plans.data?.items ?? []).map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
          <Select
            label="Goal"
            value={goalId}
            onChange={(e) => setGoalId(e.target.value)}
            options={[
              { value: '', label: 'No goal' },
              ...(goals.data?.items ?? []).map((g) => ({ value: g.id, label: g.title })),
            ]}
          />
        </div>
      ) : null}
    </>
  );
  return {
    clientId,
    links: { ...(planId ? { planId } : {}), ...(goalId ? { goalId } : {}) },
    fields,
  };
}

export function AddRecommendationDialog({
  advisoryClientId,
  planId,
  onClose,
  onAdded,
}: {
  advisoryClientId?: string;
  planId?: string;
  onClose: () => void;
  onAdded: (title: string) => void;
}) {
  const qc = useQueryClient();
  const { clientId, links, fields } = useClientLinks(advisoryClientId, planId);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [rationale, setRationale] = useState('');
  const [impactLabel, setImpactLabel] = useState('');
  const [impact, setImpact] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const cents = centsOf(impact);
    if (cents !== undefined && Number.isNaN(cents)) {
      setError('Enter the impact as a number, for example 25000.');
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.advisory.createRecommendation({
        advisoryClientId: clientId,
        title: title.trim(),
        clientVisible: visible,
        ...links,
        ...(category.trim() ? { category: category.trim() } : {}),
        ...(rationale.trim() ? { rationale: rationale.trim() } : {}),
        ...(impactLabel.trim() ? { impactLabel: impactLabel.trim() } : {}),
        ...(cents !== undefined ? { impactCents: cents } : {}),
      });
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      onAdded(title.trim());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title="Add Recommendation"
      subtitle="An advisory recommendation, not a guarantee. It starts as proposed."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!clientId || !title.trim() || saving} onClick={() => void save()}>
            Add Recommendation
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-recommendation">
        <ErrorLine text={error} />
        {fields}
        <Input
          label="Recommendation"
          required
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Input
            label="Category"
            maxLength={60}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          />
          <Input
            label="Impact (text)"
            maxLength={100}
            value={impactLabel}
            onChange={(e) => setImpactLabel(e.target.value)}
          />
          <Input
            label="Impact ($)"
            inputMode="decimal"
            value={impact}
            onChange={(e) => setImpact(e.target.value)}
          />
        </div>
        <Textarea
          label="Rationale"
          rows={3}
          maxLength={3000}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
        />
        <Checkbox
          label="Show on the client portal"
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />
      </div>
    </Modal>
  );
}

export function AddActionItemDialog({
  advisoryClientId,
  planId,
  onClose,
  onAdded,
}: {
  advisoryClientId?: string;
  planId?: string;
  onClose: () => void;
  onAdded: (title: string) => void;
}) {
  const qc = useQueryClient();
  const members = useMembers();
  const { clientId, links, fields } = useClientLinks(advisoryClientId, planId);
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [kind, setKind] = useState('STAFF');
  const [assignee, setAssignee] = useState('');
  const [due, setDue] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api.advisory.createActionItem({
        advisoryClientId: clientId,
        title: title.trim(),
        assigneeKind: kind as never,
        priority: priority as never,
        clientVisible: visible,
        ...links,
        ...(kind === 'STAFF' && assignee ? { assigneeUserId: assignee } : {}),
        ...(details.trim() ? { details: details.trim() } : {}),
        ...(due ? { dueOn: due } : {}),
      });
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      onAdded(title.trim());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title="Add Action Item"
      subtitle="A task for staff, the client or the advisory team."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!clientId || !title.trim() || saving} onClick={() => void save()}>
            Add Action Item
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-action-item">
        <ErrorLine text={error} />
        {fields}
        <Input
          label="Action item"
          required
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Assigned to"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            options={Object.entries(ASSIGNEE_KIND).map(([value, label]) => ({ value, label }))}
          />
          {kind === 'STAFF' && members.length ? (
            <Select
              label="Staff member"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              options={[{ value: '', label: 'Me' }, ...members]}
            />
          ) : null}
          <Input
            label="Due date"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <Select
            label="Priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            options={Object.entries(PRIORITY).map(([value, label]) => ({ value, label }))}
          />
        </div>
        <Textarea
          label="Details"
          rows={3}
          maxLength={2000}
          value={details}
          onChange={(e) => setDetails(e.target.value)}
        />
        <Checkbox
          label="Show on the client portal"
          checked={visible}
          onChange={(e) => setVisible(e.target.checked)}
        />
      </div>
    </Modal>
  );
}
