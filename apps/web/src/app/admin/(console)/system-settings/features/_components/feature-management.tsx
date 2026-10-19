'use client';

import type { AdminFeature } from '@firmivra/types';
import {
  ActionMenu,
  Badge,
  Button,
  Callout,
  Card,
  Drawer,
  Input,
  KpiCard,
  Modal,
  Pagination,
  SearchField,
  Select,
  Textarea,
  Toggle,
} from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  CheckCircle,
  DotsThree,
  FileText,
  Gear,
  Info,
  Pause,
  PencilSimple,
  Plus,
  SlidersHorizontal,
  SquaresFour,
  Warning,
  Buildings,
} from '@phosphor-icons/react';
import { useMemo, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  loadError,
  QuietLine,
  SETTINGS_ERRORS,
  SettingsHeader,
  SS,
  stamp,
} from '../../_components/settings-kit';

const PAGE = 8;
const FEATURE_ERRORS = {
  ...SETTINGS_ERRORS,
  FEATURE_DEPENDENCY:
    'That would make features depend on each other in a circle, or names a feature that does not exist.',
  DUPLICATE_KEY: 'A feature with this key exists already.',
};
const moduleOf = (key: string) => {
  const head = key.split('.')[0] ?? key;
  return head.charAt(0).toUpperCase() + head.slice(1).replaceAll('_', ' ');
};
type Filter = { search: string; status: '' | 'ON' | 'OFF' | 'EMERGENCY_OFF'; module: string };

/**
 * Feature Management (firmivra-feature-management-dashboard.jpg and -1.jpg): the platform's
 * features with their default state, emergency switch and per-firm overrides. A feature has no
 * module, plan or beta field: the module is its key's first part, access is "All firms" plus the
 * firms with their own setting, and the fourth card counts emergency switches (there is no beta).
 */
export function FeatureManagement() {
  const q = useApiQuery([...SS, 'features'], () => api.adminSettings.features());
  const [filter, setFilter] = useState<Filter>({ search: '', status: '', module: '' });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminFeature | 'new' | null>(null);
  const [emergency, setEmergency] = useState<AdminFeature | null>(null);
  const [overrides, setOverrides] = useState<AdminFeature | null>(null);
  const [bulk, setBulk] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const failed = (e: unknown) =>
    setNotice({ tone: 'error', text: errorMessage(e, FEATURE_ERRORS) });

  const toggle = useApiMutation(
    (f: { key: string; on: boolean }) =>
      api.adminSettings.updateFeature(f.key, { defaultState: f.on ? 'ON' : 'OFF' }),
    { invalidate: [...SS] },
  );
  const bulkApply = useApiMutation(
    async (on: boolean) => {
      for (const key of selected)
        await api.adminSettings.updateFeature(key, { defaultState: on ? 'ON' : 'OFF' });
      return selected.length;
    },
    { invalidate: [...SS] },
  );

  const items = q.data?.items ?? [];
  const modules = useMemo(() => [...new Set(items.map((f) => moduleOf(f.key)))].sort(), [items]);
  const shown = items.filter((f) => {
    const s = filter.search.trim().toLowerCase();
    if (s && !`${f.name} ${f.key} ${f.description ?? ''}`.toLowerCase().includes(s)) return false;
    if (filter.module && moduleOf(f.key) !== filter.module) return false;
    if (filter.status === 'EMERGENCY_OFF') return f.emergencyDisabled;
    if (filter.status) return !f.emergencyDisabled && f.defaultState === filter.status;
    return true;
  });
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = shown.slice((page - 1) * PAGE, page * PAGE);
  const c = q.data?.counts;
  const pct = (n: number | undefined) =>
    c && c.total && n !== undefined ? `${Math.round((n / c.total) * 1000) / 10}%` : undefined;
  const focused = items.find((f) => f.key === focus);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsHeader
        title="Feature Management"
        subtitle="Enable, disable, and control platform features across all firms."
        icon={SlidersHorizontal}
      />
      <nav aria-label="Sections" className="flex gap-8 overflow-x-auto border-b border-divider">
        <span
          aria-current="location"
          className="-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 border-action text-sm font-medium text-action"
        >
          Feature Controls
        </span>
        {['Feature Groups', 'Beta Features', 'Plan & Access', 'Release Management'].map((t) => (
          <span
            key={t}
            aria-disabled
            title="Features have no groups, beta, plan or release settings yet"
            className="-mb-px inline-flex min-h-11 shrink-0 cursor-not-allowed items-center border-b-2 border-transparent text-sm font-medium text-muted"
          >
            {t}
          </span>
        ))}
        <a
          href="/audit-security?search=feature"
          className="-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 border-transparent text-sm font-medium text-text hover:text-heading"
        >
          Feature Log
        </a>
      </nav>
      <Callout size="compact" surface="info" icon={Info}>
        Manage which features are available on the platform, set access by firm, and switch a
        feature off at once in an emergency.
      </Callout>

      <section aria-label="Feature summary" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={SquaresFour}
          tone="green"
          label="Total Features"
          value={c ? c.total : '—'}
          note="Across all modules"
          loading={q.isPending}
        />
        <KpiCard
          icon={CheckCircle}
          tone="green"
          label="Enabled"
          value={c ? c.on : '—'}
          note={pct(c?.on)}
          loading={q.isPending}
        />
        <KpiCard
          icon={Pause}
          tone="grey"
          label="Disabled"
          value={c ? c.off : '—'}
          note={pct(c?.off)}
          loading={q.isPending}
        />
        <KpiCard
          icon={Warning}
          tone="red"
          label="Emergency Off"
          value={c ? c.emergencyOff : '—'}
          note={pct(c?.emergencyOff)}
          loading={q.isPending}
        />
      </section>

      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${notice.tone === 'error' ? 'text-danger' : 'text-success'}`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_20rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-56 flex-1">
              <SearchField
                label="Search features"
                placeholder="Search features…"
                value={filter.search}
                onChange={(e) => {
                  setFilter({ ...filter, search: e.target.value });
                  setPage(1);
                }}
              />
            </div>
            <div className="w-36">
              <Select
                label="Status"
                value={filter.status}
                onChange={(e) => {
                  setFilter({ ...filter, status: e.target.value as Filter['status'] });
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All' },
                  { value: 'ON', label: 'Enabled' },
                  { value: 'OFF', label: 'Disabled' },
                  { value: 'EMERGENCY_OFF', label: 'Emergency off' },
                ]}
              />
            </div>
            <div className="w-44">
              <Select
                label="Module"
                value={filter.module}
                onChange={(e) => {
                  setFilter({ ...filter, module: e.target.value });
                  setPage(1);
                }}
                options={[
                  { value: '', label: 'All Modules' },
                  ...modules.map((m) => ({ value: m, label: m })),
                ]}
              />
            </div>
            <div className="w-36">
              <Select
                label="Access"
                value=""
                disabled
                title="Features have no plan access yet"
                onChange={() => undefined}
                options={[{ value: '', label: 'All' }]}
              />
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                setFilter({ search: '', status: '', module: '' });
                setPage(1);
              }}
            >
              <span className="inline-flex items-center gap-2 text-action">
                <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" /> Reset Filters
              </span>
            </Button>
            <Button onClick={() => setEditing('new')}>
              <span className="inline-flex items-center gap-2">
                <Plus aria-hidden weight="bold" className="size-4" /> Add Feature
              </span>
            </Button>
          </div>

          <Card className="min-w-0 p-0!" data-testid="features-table">
            <div className="overflow-x-auto">
              <table className="w-full min-w-4xl text-left text-sm">
                <thead className="bg-table-head text-text">
                  <tr>
                    <th scope="col" className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        aria-label="Select all on this page"
                        className="size-4 accent-action"
                        checked={
                          pageRows.length > 0 && pageRows.every((f) => selected.includes(f.key))
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...new Set([...selected, ...pageRows.map((f) => f.key)])]
                              : selected.filter((k) => !pageRows.some((f) => f.key === k)),
                          )
                        }
                      />
                    </th>
                    {[
                      'Feature Name',
                      'Module',
                      'Description',
                      'Status',
                      'Access',
                      'Last Updated',
                      '',
                    ].map((h) => (
                      <th key={h || 'actions'} scope="col" className="px-3 py-3 font-medium">
                        {h || <span className="sr-only">Actions</span>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-divider">
                  {pageRows.map((f) => {
                    const on = f.defaultState === 'ON' && !f.emergencyDisabled;
                    return (
                      <tr
                        key={f.key}
                        className={focus === f.key ? 'bg-info-soft' : 'hover:bg-canvas'}
                      >
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${f.name}`}
                            className="size-4 accent-action"
                            checked={selected.includes(f.key)}
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? [...selected, f.key]
                                  : selected.filter((k) => k !== f.key),
                              )
                            }
                          />
                        </td>
                        <td className="px-3 py-3">
                          <button
                            type="button"
                            onClick={() => setFocus(f.key)}
                            className="text-left font-semibold text-heading hover:text-action"
                          >
                            {f.name}
                          </button>
                          <span className="block text-xs text-muted">{f.key}</span>
                        </td>
                        <td className="px-3 py-3">
                          <Badge tone="info">{moduleOf(f.key)}</Badge>
                        </td>
                        <td className="max-w-72 px-3 py-3 text-text">{f.description ?? '—'}</td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-3">
                            <Badge
                              tone={f.emergencyDisabled ? 'danger' : on ? 'success' : 'neutral'}
                            >
                              {f.emergencyDisabled ? 'Emergency off' : on ? 'Enabled' : 'Disabled'}
                            </Badge>
                            <Toggle
                              label={`${f.name} on by default`}
                              checked={f.defaultState === 'ON'}
                              disabled={toggle.isPending}
                              onChange={(next) =>
                                toggle.mutate({ key: f.key, on: next }, { onError: failed })
                              }
                            />
                          </div>
                        </td>
                        <td className="px-3 py-3 text-text">
                          All firms
                          {f.overrides ? (
                            <span className="block text-xs text-muted">
                              {f.overrides} with their own setting
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 py-3 text-text">
                          {stamp(f.updatedAt)}
                          <span className="block text-xs text-muted">
                            by {f.updatedBy ?? 'Firmivra'}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          <ActionMenu
                            label={`Actions for ${f.name}`}
                            align="right"
                            trigger={<DotsThree aria-hidden weight="bold" className="size-5" />}
                            sections={[
                              {
                                items: [
                                  {
                                    label: 'View details',
                                    icon: FileText,
                                    onSelect: () => setFocus(f.key),
                                  },
                                  {
                                    label: 'Edit',
                                    icon: PencilSimple,
                                    onSelect: () => setEditing(f),
                                  },
                                  {
                                    label: 'Firm overrides',
                                    icon: Buildings,
                                    onSelect: () => setOverrides(f),
                                  },
                                  {
                                    label: f.emergencyDisabled
                                      ? 'Lift emergency switch'
                                      : 'Emergency switch off',
                                    icon: Warning,
                                    danger: !f.emergencyDisabled,
                                    onSelect: () => setEmergency(f),
                                  },
                                ],
                              },
                            ]}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-4">
              {q.isError ? (
                <QuietLine>{loadError(q.error)}</QuietLine>
              ) : q.isPending ? (
                <QuietLine>Loading features…</QuietLine>
              ) : !shown.length ? (
                <QuietLine>
                  {items.length
                    ? 'No feature matches these filters.'
                    : 'No features yet. Add the first one.'}
                </QuietLine>
              ) : (
                <Pagination
                  page={page}
                  pageCount={pages}
                  onPage={setPage}
                  summary={`Showing ${(page - 1) * PAGE + 1}–${Math.min(shown.length, page * PAGE)} of ${shown.length} features`}
                />
              )}
            </div>
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-5">
          <Card className="flex flex-col gap-3 p-5!" data-testid="bulk-actions">
            <h2 className="flex items-center gap-2 text-base font-bold text-heading">
              <Gear aria-hidden weight="fill" className="size-5 text-action" /> Bulk Actions
            </h2>
            <p className="text-sm text-muted">
              Make changes to multiple features at once. {selected.length} selected.
            </p>
            <Select
              label="Bulk action"
              hideLabel
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              options={[
                { value: '', label: 'Select an action' },
                { value: 'on', label: 'Turn on by default' },
                { value: 'off', label: 'Turn off by default' },
              ]}
            />
            <Button
              disabled={!bulk || !selected.length || bulkApply.isPending}
              onClick={() =>
                bulkApply.mutate(bulk === 'on', {
                  onSuccess: (n) => {
                    setNotice({
                      tone: 'ok',
                      text: `${n} ${n === 1 ? 'feature' : 'features'} changed.`,
                    });
                    setSelected([]);
                    setBulk('');
                  },
                  onError: failed,
                })
              }
            >
              {bulkApply.isPending ? 'Applying…' : 'Apply'}
            </Button>
          </Card>

          <Card className="flex flex-col gap-3 p-5!" data-testid="feature-details">
            <h2 className="flex items-center gap-2 text-base font-bold text-heading">
              <FileText aria-hidden weight="fill" className="size-5 text-action" /> Feature Details
            </h2>
            {focused ? (
              <dl className="flex flex-col gap-2 text-sm">
                <dt className="font-semibold text-heading">{focused.name}</dt>
                <dd className="text-text">{focused.description ?? 'No description.'}</dd>
                <dt className="text-muted">Needs</dt>
                <dd className="text-text">
                  {focused.dependsOn.length ? focused.dependsOn.join(', ') : 'Nothing'}
                </dd>
                <dt className="text-muted">Needed by</dt>
                <dd className="text-text">
                  {focused.requiredBy.length ? focused.requiredBy.join(', ') : 'Nothing'}
                </dd>
                <dt className="text-muted">Firms with their own setting</dt>
                <dd className="text-text">
                  {focused.overrides}{' '}
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => setOverrides(focused)}
                  >
                    Manage
                  </button>
                </dd>
              </dl>
            ) : (
              <>
                <p className="text-sm text-muted">
                  Select a feature from the list to view and edit detailed settings, including:
                </p>
                <ul className="list-disc pl-5 text-sm text-text">
                  <li>Feature description</li>
                  <li>Dependencies</li>
                  <li>Firm overrides</li>
                  <li>The emergency switch</li>
                </ul>
              </>
            )}
          </Card>

          <Card className="flex flex-col gap-3 p-5!" data-testid="status-legend">
            <h2 className="flex items-center gap-2 text-base font-bold text-heading">
              <Info aria-hidden weight="fill" className="size-5 text-action" /> Status Legend
            </h2>
            {(
              [
                ['success', 'Enabled', 'Feature is on for every firm without its own setting'],
                ['neutral', 'Disabled', 'Feature is off unless a firm has it turned on'],
                [
                  'danger',
                  'Emergency off',
                  'Switched off for every firm at once, whatever their setting',
                ],
              ] as const
            ).map(([tone, label, text]) => (
              <div key={label} className="text-sm">
                <Badge tone={tone}>{label}</Badge>
                <p className="mt-1 text-muted">{text}</p>
              </div>
            ))}
          </Card>
        </aside>
      </div>

      <FeatureModal
        feature={editing}
        onClose={() => setEditing(null)}
        onDone={(text) => setNotice({ tone: 'ok', text })}
      />
      <EmergencyModal
        feature={emergency}
        onClose={() => setEmergency(null)}
        onDone={(text) => setNotice({ tone: 'ok', text })}
      />
      <OverridesDrawer feature={overrides} onClose={() => setOverrides(null)} />
    </div>
  );
}

function FeatureModal({
  feature,
  onClose,
  onDone,
}: {
  feature: AdminFeature | 'new' | null;
  onClose: () => void;
  onDone: (t: string) => void;
}) {
  const isNew = feature === 'new';
  const current = feature && feature !== 'new' ? feature : null;
  const [form, setForm] = useState({
    key: '',
    name: '',
    description: '',
    on: false,
    dependsOn: '',
  });
  const [loaded, setLoaded] = useState<string | null>(null);
  if (feature && (current?.key ?? 'new') !== loaded) {
    setLoaded(current?.key ?? 'new');
    setForm({
      key: current?.key ?? '',
      name: current?.name ?? '',
      description: current?.description ?? '',
      on: current ? current.defaultState === 'ON' : false,
      dependsOn: current?.dependsOn.join(', ') ?? '',
    });
  }
  const deps = form.dependsOn
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const save = useApiMutation(
    () =>
      isNew
        ? api.adminSettings.createFeature({
            key: form.key.trim(),
            name: form.name,
            description: form.description || null,
            defaultState: form.on ? 'ON' : 'OFF',
            dependsOn: deps,
          })
        : api.adminSettings.updateFeature(current!.key, {
            name: form.name,
            description: form.description || null,
            defaultState: form.on ? 'ON' : 'OFF',
            dependsOn: deps,
          }),
    { invalidate: [...SS] },
  );
  const close = () => {
    setLoaded(null);
    save.reset();
    onClose();
  };
  return (
    <Modal
      open={feature !== null}
      title={isNew ? 'Add Feature' : `Edit ${current?.name ?? ''}`}
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!form.name.trim() || (isNew && !form.key.trim()) || save.isPending}
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: (f) => {
                  onDone(isNew ? `Added ${f.name}.` : `Saved ${f.name}.`);
                  close();
                },
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Key"
          placeholder="reports.advanced"
          value={form.key}
          disabled={!isNew}
          onChange={(e) => setForm({ ...form, key: e.target.value })}
        />
        <Input
          label="Name"
          value={form.name}
          maxLength={100}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Textarea
          label="Description"
          rows={3}
          value={form.description}
          maxLength={1000}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <Input
          label="Needs these features (keys, comma separated)"
          value={form.dependsOn}
          onChange={(e) => setForm({ ...form, dependsOn: e.target.value })}
        />
        <div className="flex items-center gap-3 text-sm text-heading">
          <Toggle
            label="On by default"
            checked={form.on}
            onChange={(on) => setForm({ ...form, on })}
          />
          <span aria-hidden>On by default</span>
        </div>
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, FEATURE_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function EmergencyModal({
  feature,
  onClose,
  onDone,
}: {
  feature: AdminFeature | null;
  onClose: () => void;
  onDone: (t: string) => void;
}) {
  const [reason, setReason] = useState('');
  const off = !feature?.emergencyDisabled;
  const send = useApiMutation(
    () => api.adminSettings.emergency(feature!.key, { disabled: off, reason }),
    { invalidate: [...SS] },
  );
  const close = () => {
    setReason('');
    send.reset();
    onClose();
  };
  return (
    <Modal
      open={feature !== null}
      title={
        off
          ? `Switch off ${feature?.name ?? ''} for every firm?`
          : `Lift the emergency switch on ${feature?.name ?? ''}?`
      }
      subtitle={
        off
          ? 'It goes off at once for every firm, whatever their own setting. Recorded in the audit log.'
          : 'Firms get their own setting or the default again.'
      }
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || send.isPending}
            onClick={() =>
              send.mutate(undefined, {
                onSuccess: (f) => {
                  onDone(
                    off
                      ? `${f.name} is switched off for every firm.`
                      : `${f.name}: the emergency switch is lifted.`,
                  );
                  close();
                },
              })
            }
          >
            {off ? 'Switch Off' : 'Lift Switch'}
          </Button>
        </>
      }
    >
      <Textarea
        label="Reason"
        rows={3}
        value={reason}
        maxLength={1000}
        onChange={(e) => setReason(e.target.value)}
      />
      {send.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(send.error, FEATURE_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}

function OverridesDrawer({
  feature,
  onClose,
}: {
  feature: AdminFeature | null;
  onClose: () => void;
}) {
  const key = feature?.key ?? '';
  const list = useApiQuery([...SS, 'features', key, 'overrides'], () =>
    key ? api.adminSettings.featureOverrides(key) : Promise.resolve({ items: [] }),
  );
  const firms = useApiQuery(['admin-reports', 'firms', 'all'], () =>
    api.adminReports.firms({ pageSize: 100 }),
  );
  const [firm, setFirm] = useState('');
  const [on, setOn] = useState(true);
  const set = useApiMutation(
    () => api.adminSettings.setFeatureOverride(key, firm, { state: on ? 'ON' : 'OFF' }),
    { invalidate: [...SS] },
  );
  const remove = useApiMutation(
    (businessId: string) => api.adminSettings.removeFeatureOverride(key, businessId),
    { invalidate: [...SS] },
  );
  return (
    <Drawer
      open={feature !== null}
      title={`Firm overrides: ${feature?.name ?? ''}`}
      subtitle="A firm's own setting wins over the default, but not over the emergency switch."
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {list.data?.items.length ? (
          <ul className="divide-y divide-divider text-sm">
            {list.data.items.map((o) => (
              <li key={o.businessId} className="flex items-center gap-3 py-2">
                <span className="flex-1 text-heading">{o.firmName}</span>
                <Badge tone={o.state === 'ON' ? 'success' : 'neutral'}>
                  {o.state === 'ON' ? 'On' : 'Off'}
                </Badge>
                {o.effective !== o.state ? (
                  <span className="text-xs text-muted">
                    gets {o.effective === 'ON' ? 'on' : 'off'}
                  </span>
                ) : null}
                <Button
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(o.businessId)}
                >
                  <span className="text-danger">Remove</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <QuietLine>
            {list.isError ? loadError(list.error) : 'No firm has its own setting.'}
          </QuietLine>
        )}
        <div className="flex flex-col gap-3 border-t border-divider pt-4">
          <Select
            label="Firm"
            value={firm}
            onChange={(e) => setFirm(e.target.value)}
            options={[
              { value: '', label: 'Choose a firm' },
              ...(firms.data?.items ?? []).map((f) => ({ value: f.id, label: f.name })),
            ]}
          />
          <div className="flex items-center gap-3 text-sm text-heading">
            <Toggle label="On for this firm" checked={on} onChange={setOn} />
            <span aria-hidden>On for this firm</span>
          </div>
          <Button
            disabled={!firm || set.isPending}
            onClick={() => set.mutate(undefined, { onSuccess: () => setFirm('') })}
          >
            Set for this firm
          </Button>
          {set.isError || remove.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(set.error ?? remove.error, FEATURE_ERRORS)}
            </p>
          ) : null}
        </div>
      </div>
    </Drawer>
  );
}
