'use client';

import {
  type CreateDashboardCardRequest,
  DASHBOARD_CARD_METRIC_LABELS,
  DASHBOARD_CARD_PROBLEMS,
  DASHBOARD_CARD_SLOTS,
  DASHBOARD_CARD_STATUS_KEYS,
  DASHBOARD_CARD_STATUS_LABELS,
  DASHBOARD_TAX_SERVICE_KINDS,
  type DashboardCardMetric,
  type DashboardCardService,
  type DashboardCardStatusKey,
  type DashboardCardTemplate,
  DEFAULT_DASHBOARD_CARDS,
  dashboardCardProblem,
} from '@firmivra/types';
import { Button, Input, Modal, Select, Skeleton, Toast, Toggle } from '@firmivra/ui';
import { ArrowDown, ArrowUp, PencilSimple, Plus, SquaresFour } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { NOT_LOADED, SettingsCard, SettingsHeader } from '../../_components/settings-parts';

// D4 and D5 (Octavia's Oct 25 dashboard review): Settings > Dashboard Cards. Owner and Admin choose
// the service cards the dashboard shows after its fixed cards: a service, what it counts, a status
// and a label, together, so the label, the number and the list it opens always agree. A card is
// switched off, never removed; up to six.

const KEY = ['dashboard', 'cards'] as const;
/** A change refetches the cards and the dashboard's summary (both under 'dashboard'). */
const AFTER = { invalidate: ['dashboard'] };

const CARD_ERRORS: Record<string, string> = {
  ...DASHBOARD_CARD_PROBLEMS,
  CARDS_FULL: 'A dashboard shows six service cards at most. Change or switch off one of them.',
  STALE_VERSION: 'This card was changed somewhere else. Reload and try again.',
  NOT_FOUND: "We couldn't find that service or card. Reload and try again.",
};

const EVERY_RETURN = '';

type Draft = {
  serviceId: string;
  metric: DashboardCardMetric;
  statusKey: DashboardCardStatusKey | '';
  label: string;
  enabled: boolean;
};

const draftOf = (c?: DashboardCardTemplate): Draft => ({
  serviceId: c?.service?.id ?? EVERY_RETURN,
  metric: c?.metric ?? 'ENGAGEMENTS_IN_STATUS',
  statusKey: c?.statusKey ?? 'tax:IN_PROGRESS',
  label: c?.label ?? '',
  enabled: c?.enabled ?? true,
});

/** The statuses a metric and a service may take (the rule's choices). */
function statusesFor(metric: DashboardCardMetric, kind: DashboardCardService['kind'] | null) {
  if (metric === 'ACTIVE_ENGAGEMENTS') return [];
  const tax = kind === null || (DASHBOARD_TAX_SERVICE_KINDS as readonly string[]).includes(kind);
  const keys = DASHBOARD_CARD_STATUS_KEYS.filter((k) =>
    k.startsWith('tax:') ? tax : kind !== null,
  );
  return metric === 'COMPLETED_IN_PERIOD'
    ? keys.filter((k) => k === 'engagement:COMPLETED' || k === 'tax:ACCEPTED')
    : keys;
}

/** "Bookkeeping · In a status now · Active", or "Every tax return · …". */
function summaryOf(c: Pick<DashboardCardTemplate, 'service' | 'metric' | 'statusKey'>) {
  return [
    c.service?.name ?? 'Every tax return',
    DASHBOARD_CARD_METRIC_LABELS[c.metric],
    c.statusKey ? DASHBOARD_CARD_STATUS_LABELS[c.statusKey] : 'Active',
  ].join(' · ');
}

export function DashboardCardsScreen() {
  const settings = useApiQuery(KEY, () => api.dashboard.cards.list());
  const [editing, setEditing] = useState<DashboardCardTemplate | 'new' | null>(null);
  const [notice, setNotice] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const toggle = useApiMutation(
    (c: DashboardCardTemplate) =>
      api.dashboard.cards.update(c.id, {
        serviceId: c.service?.id ?? null,
        metric: c.metric,
        statusKey: c.statusKey,
        label: c.label,
        enabled: !c.enabled,
        version: c.version,
      }),
    AFTER,
  );
  const order = useApiMutation((ids: string[]) => api.dashboard.cards.order({ ids }), AFTER);
  const defaults = useApiMutation(async () => {
    for (const d of DEFAULT_DASHBOARD_CARDS)
      await api.dashboard.cards.create({
        serviceId: null,
        metric: d.metric,
        statusKey: d.statusKey,
        label: d.label,
      });
  }, AFTER);

  const items = settings.data?.items ?? [];
  const full = items.length >= DASHBOARD_CARD_SLOTS;
  const fail = (e: unknown) => setNotice({ text: errorMessage(e, CARD_ERRORS), tone: 'error' });
  const move = (from: number, to: number) => {
    const ids = items.map((c) => c.id);
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved!);
    order.mutate(ids, { onError: fail });
  };

  return (
    <div className="flex min-w-0 flex-col gap-6" data-testid="dashboard-cards">
      <SettingsHeader
        icon={SquaresFour}
        title="Dashboard cards"
        subtitle="Choose the service cards your dashboard shows after Total Clients, New Leads, Outstanding Invoices and Appointments Today."
        action={
          <Button
            onClick={() => setEditing('new')}
            disabled={!settings.data || full}
            title={full ? 'Six cards at most: change or switch off one of them.' : undefined}
          >
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Card
          </Button>
        }
      />
      {notice ? (
        <Toast message={notice.text} tone={notice.tone} onDismiss={() => setNotice(null)} />
      ) : null}
      <SettingsCard
        icon={SquaresFour}
        title="Service cards"
        subtitle="Each card counts one thing and opens the list of exactly that, with your firm's period. Up to six; switch a card off to hide it."
        testId="card-list"
      >
        {settings.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : settings.isError ? (
          <p className="text-sm text-muted">{NOT_LOADED}</p>
        ) : settings.data.usingDefaults ? (
          <div className="flex flex-col gap-3" data-testid="using-defaults">
            <p className="text-sm text-text">
              Your dashboard shows the default cards: <strong>Returns In Progress</strong> and{' '}
              <strong>Accepted Returns</strong>. Saving a card replaces them.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={defaults.isPending}
                onClick={() =>
                  defaults.mutate(undefined, {
                    onSuccess: () =>
                      setNotice({
                        text: 'The default cards are saved. Change them below.',
                        tone: 'success',
                      }),
                    onError: fail,
                  })
                }
              >
                Start from the defaults
              </Button>
            </div>
          </div>
        ) : (
          <ol className="flex flex-col gap-2" aria-label="Service cards in order">
            {items.map((c, i) => (
              <li
                key={c.id}
                data-testid="card-row"
                className="flex flex-wrap items-center gap-3 rounded-lg border border-divider p-3"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-heading">
                  {c.slot}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={`font-semibold ${c.enabled ? 'text-heading' : 'text-muted'}`}>
                    {c.label}
                    {c.enabled ? null : <span className="ml-2 text-xs font-normal">(off)</span>}
                  </span>
                  <span className="text-sm text-muted">{summaryOf(c)}</span>
                </span>
                <Toggle
                  checked={c.enabled}
                  label={`Show ${c.label} on the dashboard`}
                  disabled={toggle.isPending}
                  onChange={() => toggle.mutate(c, { onError: fail })}
                />
                <Button
                  variant="secondary"
                  aria-label={`Move ${c.label} up`}
                  disabled={i === 0 || order.isPending}
                  onClick={() => move(i, i - 1)}
                >
                  <ArrowUp aria-hidden weight="bold" className="size-4" />
                </Button>
                <Button
                  variant="secondary"
                  aria-label={`Move ${c.label} down`}
                  disabled={i === items.length - 1 || order.isPending}
                  onClick={() => move(i, i + 1)}
                >
                  <ArrowDown aria-hidden weight="bold" className="size-4" />
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setEditing(c)}
                  aria-label={`Edit ${c.label}`}
                >
                  <PencilSimple aria-hidden weight="bold" className="size-4" />
                  Edit
                </Button>
              </li>
            ))}
          </ol>
        )}
      </SettingsCard>
      {editing && settings.data ? (
        <CardDialog
          card={editing === 'new' ? undefined : editing}
          services={settings.data.services}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            setNotice({ text, tone: 'success' });
          }}
        />
      ) : null}
    </div>
  );
}

function CardDialog({
  card,
  services,
  onClose,
  onSaved,
}: {
  card?: DashboardCardTemplate;
  services: DashboardCardService[];
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [d, setD] = useState<Draft>(() => draftOf(card));
  const [error, setError] = useState('');
  const service = services.find((s) => s.id === d.serviceId) ?? null;
  const statuses = statusesFor(d.metric, service?.kind ?? null);
  // A status the choices no longer take shows as the first one they do.
  const chosen = statuses.includes(d.statusKey as DashboardCardStatusKey)
    ? (d.statusKey as DashboardCardStatusKey)
    : (statuses[0] ?? '');
  const statusKey = d.metric === 'ACTIVE_ENGAGEMENTS' ? null : chosen || null;
  const problem = dashboardCardProblem({
    serviceKind: service?.kind ?? null,
    metric: d.metric,
    statusKey,
    label: d.label.trim() || (statusKey?.startsWith('tax:') ? 'Returns' : 'Clients'),
  });

  const body: CreateDashboardCardRequest = {
    serviceId: d.serviceId || null,
    metric: d.metric,
    statusKey,
    label: d.label.trim(),
    enabled: d.enabled,
  };
  const countable = problem === null || problem === 'LABEL_MISMATCH';
  const preview = useApiQuery(
    [...KEY, 'preview', body.serviceId, body.metric, body.statusKey, countable],
    async () =>
      countable
        ? api.dashboard.cards.preview({
            serviceId: body.serviceId,
            metric: body.metric,
            statusKey: body.statusKey,
          })
        : null,
  );
  const save = useApiMutation(
    () =>
      card
        ? api.dashboard.cards.update(card.id, {
            ...body,
            enabled: d.enabled,
            version: card.version,
          })
        : api.dashboard.cards.create(body),
    AFTER,
  );
  const label = d.label.trim() ? problem === 'LABEL_MISMATCH' : false;
  return (
    <Modal
      open
      title={card ? `Edit ${card.label}` : 'Add a dashboard card'}
      subtitle="Choose what the card counts, then name it. The number and the list it opens follow your choices."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={problem !== null || !d.label.trim() || save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: () => onSaved(card ? 'The card is saved.' : 'The card is added.'),
                onError: (e) => setError(errorMessage(e, CARD_ERRORS)),
              })
            }
          >
            {card ? 'Save Card' : 'Add Card'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="card-dialog">
        <Select
          label="Service"
          value={d.serviceId}
          onChange={(e) => setD((x) => ({ ...x, serviceId: e.target.value }))}
          options={[
            { value: EVERY_RETURN, label: 'Every tax return (any service)' },
            ...services.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Select
          label="What it counts"
          value={d.metric}
          onChange={(e) => setD((x) => ({ ...x, metric: e.target.value as DashboardCardMetric }))}
          options={(
            ['ENGAGEMENTS_IN_STATUS', 'COMPLETED_IN_PERIOD', 'ACTIVE_ENGAGEMENTS'] as const
          ).map((m) => ({ value: m, label: DASHBOARD_CARD_METRIC_LABELS[m] }))}
        />
        {d.metric === 'ACTIVE_ENGAGEMENTS' ? null : (
          <Select
            label="Status"
            value={chosen}
            onChange={(e) =>
              setD((x) => ({ ...x, statusKey: e.target.value as DashboardCardStatusKey }))
            }
            options={statuses.map((k) => ({ value: k, label: DASHBOARD_CARD_STATUS_LABELS[k] }))}
          />
        )}
        <Input
          label="Label"
          value={d.label}
          maxLength={40}
          onChange={(e) => setD((x) => ({ ...x, label: e.target.value }))}
          error={label ? DASHBOARD_CARD_PROBLEMS.LABEL_MISMATCH : undefined}
        />
        <label className="flex items-center gap-2 text-sm text-text">
          <Toggle
            checked={d.enabled}
            label="Show on the dashboard"
            onChange={(on) => setD((x) => ({ ...x, enabled: on }))}
          />
          Show on the dashboard
        </label>
        {problem && problem !== 'LABEL_MISMATCH' ? (
          <p role="alert" className="text-sm text-danger">
            {DASHBOARD_CARD_PROBLEMS[problem]}
          </p>
        ) : null}
        <p className="text-sm text-muted" data-testid="card-preview" aria-live="polite">
          {problem !== null && problem !== 'LABEL_MISMATCH'
            ? 'Choose the card to see its number.'
            : preview.isPending
              ? 'Counting…'
              : preview.isError
                ? 'The number is not available right now.'
                : preview.data
                  ? `This month it would show ${preview.data.value}.`
                  : 'Choose the card to see its number.'}
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
