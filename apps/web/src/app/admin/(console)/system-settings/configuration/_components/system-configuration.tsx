'use client';

import type { AdminJob, AdminMaintenanceWindow, AdminSystemHealth } from '@firmivra/types';
import { Badge, Button, Card, Input, Modal, Textarea, Toggle } from '@firmivra/ui';
import {
  ArrowRight,
  CalendarBlank,
  CheckCircle,
  Clock,
  Database,
  Desktop,
  FileText,
  Gear,
  Heartbeat,
  Key,
  MagnifyingGlass,
  Warning,
  Wrench,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  Body,
  loadError,
  QuietLine,
  SectionCard,
  SettingsHeader,
  SETTINGS_ERRORS,
  SS,
  stamp,
} from '../../_components/settings-kit';

const SERVICES: Record<AdminSystemHealth['services'][number]['key'], string> = {
  api: 'Application Server',
  database: 'Database',
  storage: 'File Storage',
  email: 'Email Service',
  sms: 'SMS Service',
  payments: 'Payment Processing',
};
const SERVICE_STATUS = {
  ONLINE: ['Online', 'success'],
  DOWN: ['Not responding', 'danger'],
  CONFIGURED: ['Configured', 'info'],
  NOT_CONFIGURED: ['Not configured', 'neutral'],
} as const;
const ERRORS = {
  ...SETTINGS_ERRORS,
  STATE: 'This changed meanwhile (it may have started or finished). Reload and try again.',
};
const statusTone = (s: string | null) =>
  s === 'COMPLETED'
    ? 'success'
    : s === 'FAILED'
      ? 'danger'
      : s === 'RUNNING' || s === 'QUEUED'
        ? 'info'
        : 'neutral';
const title = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();

/**
 * Health as the API checks it (database and storage reached now; email, SMS and payments as
 * configured). No answer at all is the API itself down.
 */
async function health(): Promise<{ at: string; services: AdminSystemHealth['services'] }> {
  try {
    const h = await api.adminSettings.health();
    return { at: h.checkedAt, services: h.services };
  } catch {
    return {
      at: new Date().toISOString(),
      services: [{ key: 'api', status: 'DOWN', detail: 'The API did not answer' }],
    };
  }
}

/**
 * System Configuration & Maintenance (system-configuration-dashboard.jpg): the platform's status
 * and health as the API reports them, its environment (read only: set by the deployment), secret
 * references, background jobs (pause with a reason, resume) and maintenance windows (schedule,
 * start, complete, cancel). Services the API does not check show as not monitored; the cache,
 * search index and diagnostics tools have no API and are shown but shut.
 */
export function SystemConfiguration({ appUrl, apiUrl }: { appUrl: string; apiUrl: string }) {
  const h = useApiQuery([...SS, 'health'], health);
  const overview = useApiQuery([...SS, 'overview'], () => api.adminSettings.overview());
  const jobs = useApiQuery([...SS, 'jobs'], () => api.adminSettings.jobs());
  const windows = useApiQuery([...SS, 'maintenance'], () => api.adminSettings.maintenance());
  const [secrets, setSecrets] = useState(false);
  const [pausing, setPausing] = useState<AdminJob | null>(null);
  const [scheduling, setScheduling] = useState<{ mode: 'now' | 'later'; at: number } | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const failed = (e: unknown) => setNotice({ tone: 'error', text: errorMessage(e, ERRORS) });
  const resume = useApiMutation((key: string) => api.adminSettings.resumeJob(key), {
    invalidate: [...SS],
  });
  const act = useApiMutation(
    ({ id, step }: { id: string; step: 'start' | 'complete' | 'cancel' }) =>
      step === 'start'
        ? api.adminSettings.startMaintenance(id)
        : step === 'complete'
          ? api.adminSettings.completeMaintenance(id)
          : api.adminSettings.cancelMaintenance(id),
    { invalidate: [...SS] },
  );
  const active = windows.data?.items.find((w) => w.status === 'ACTIVE');
  const state = (key: string) => h.data?.services.find((x) => x.key === key)?.status;
  const ok =
    state('api') === 'ONLINE' && state('database') === 'ONLINE' && state('storage') !== 'DOWN';

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsHeader
        title="System Configuration & Maintenance"
        subtitle="Manage platform configuration, system tools, environment settings, and maintenance operations."
        icon={Gear}
      />
      <nav aria-label="Sections" className="flex gap-8 overflow-x-auto border-b border-divider">
        {[
          ['#overview', 'Overview'],
          ['#environment', 'Environment'],
          ['#jobs', 'Background Jobs'],
          ['#tools', 'System Tools'],
          ['#maintenance', 'Maintenance'],
          ['/audit-security', 'Logs & Monitoring'],
        ].map(([href, text], i) => (
          <a
            key={href}
            href={href}
            aria-current={i === 0 ? 'location' : undefined}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 text-sm font-medium ${i === 0 ? 'border-action text-action' : 'border-transparent text-text hover:text-heading'}`}
          >
            {text}
          </a>
        ))}
      </nav>

      <Card
        id="overview"
        className={`flex flex-wrap items-center gap-4 p-5! ${ok ? 'bg-success-soft!' : h.data ? 'bg-warning-soft!' : ''}`}
        data-testid="system-status"
      >
        <span
          className={`flex size-12 items-center justify-center rounded-full ${ok ? 'bg-success text-on-action' : 'bg-warning-soft text-gold'}`}
        >
          {ok ? (
            <CheckCircle aria-hidden weight="fill" className="size-7" />
          ) : (
            <Warning aria-hidden weight="fill" className="size-7" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-lg font-bold text-heading">
            {!h.data
              ? 'Checking the platform…'
              : ok
                ? 'All Checked Systems Operational'
                : 'A checked service is not responding'}
          </p>
          <p className="text-sm text-text">Last checked: {h.data ? stamp(h.data.at) : '—'}</p>
        </div>
        <Button variant="secondary" disabled={h.isFetching} onClick={() => void h.refetch()}>
          <span className="inline-flex items-center gap-2 text-action">
            Check Again <ArrowRight aria-hidden weight="bold" className="size-4" />
          </span>
        </Button>
      </Card>

      {notice ? (
        <p
          role={notice.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${notice.tone === 'error' ? 'text-danger' : 'text-success'}`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <SectionCard
          id="environment"
          title="Environment Settings"
          subtitle="The deployment's environment and addresses (set by its configuration)."
          icon={Database}
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-[10rem_1fr]">
            <dt className="text-text">Current Environment</dt>
            <dd className="text-heading">
              {overview.data?.system.environment ??
                (overview.isError ? loadError(overview.error) : '…')}
            </dd>
            <dt className="text-text">Application URL</dt>
            <dd className="break-all text-heading">{appUrl}</dd>
            <dt className="text-text">API URL</dt>
            <dd className="break-all text-heading">{apiUrl}</dd>
            <dt className="text-text">Timezone (Server)</dt>
            <dd className="text-heading">UTC (times are shown in your own time zone)</dd>
            <dt className="text-text">Platform Version</dt>
            <dd className="text-heading">{overview.data?.system.version ?? '—'}</dd>
          </dl>
          <Button variant="secondary" onClick={() => setSecrets(true)}>
            <span className="inline-flex items-center gap-2 text-action">
              <Key aria-hidden weight="fill" className="size-4" /> Manage Secret References
            </span>
          </Button>
        </SectionCard>

        <SectionCard
          id="health"
          title="System Health"
          subtitle="Service status as the platform reports it."
          icon={Heartbeat}
        >
          <ul
            className="divide-y divide-divider rounded-lg border border-divider text-sm"
            data-testid="system-health"
          >
            {h.data ? (
              h.data.services.map((x) => (
                <li key={x.key} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-heading">{SERVICES[x.key]}</span>
                    {x.detail ? <span className="block text-xs text-muted">{x.detail}</span> : null}
                  </span>
                  <Badge tone={SERVICE_STATUS[x.status][1]}>{SERVICE_STATUS[x.status][0]}</Badge>
                </li>
              ))
            ) : (
              <li className="px-3 py-2 text-muted">Checking…</li>
            )}
            <li className="flex items-center justify-between px-3 py-2">
              <span className="text-heading">Third-Party Integrations</span>
              <Link href="/integrations" className="text-sm text-action">
                See Integrations
              </Link>
            </li>
          </ul>
        </SectionCard>

        <SectionCard
          id="jobs"
          title="Background Jobs"
          subtitle="Monitor and manage scheduled and background processes."
          icon={Clock}
        >
          <Body query={jobs} rows={4}>
            {(d) =>
              d.items.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-table-head text-text">
                      <tr>
                        {['Job Name', 'Last Run', 'Status', ''].map((x) => (
                          <th key={x || 'a'} scope="col" className="px-3 py-2 font-medium">
                            {x || <span className="sr-only">Actions</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-divider">
                      {d.items.map((j) => (
                        <tr key={j.key}>
                          <td className="px-3 py-2">
                            <span className="block text-heading">{j.name}</span>
                            {j.pausedReason ? (
                              <span className="block text-xs text-muted">
                                Paused: {j.pausedReason}
                              </span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-text">{stamp(j.lastRunAt)}</td>
                          <td className="px-3 py-2">
                            {j.enabled ? (
                              <Badge tone={statusTone(j.lastStatus)}>
                                {j.lastStatus ? title(j.lastStatus) : 'Not run yet'}
                              </Badge>
                            ) : (
                              <Badge tone="warning">Paused</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {j.enabled ? (
                              <Button variant="ghost" onClick={() => setPausing(j)}>
                                Pause
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                disabled={resume.isPending}
                                onClick={() =>
                                  resume.mutate(j.key, {
                                    onSuccess: () =>
                                      setNotice({ tone: 'ok', text: `${j.name} resumed.` }),
                                    onError: failed,
                                  })
                                }
                              >
                                Resume
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <QuietLine>No background jobs are registered.</QuietLine>
              )
            }
          </Body>
        </SectionCard>

        <SectionCard
          id="tools"
          title="Maintenance"
          subtitle="Tools for system maintenance and troubleshooting."
          icon={Wrench}
        >
          <ul className="flex flex-col gap-2">
            {(
              [
                [Database, 'Clear Application Cache'],
                [MagnifyingGlass, 'Rebuild Search Index'],
                [Desktop, 'Run System Diagnostics'],
              ] as const
            ).map(([I, text]) => (
              <li
                key={text}
                aria-disabled
                title="No platform tool for this yet"
                className="flex cursor-not-allowed items-center gap-3 rounded-lg border border-divider px-3 py-2.5 text-sm text-muted"
              >
                <I aria-hidden weight="fill" className="size-5" /> {text}
              </li>
            ))}
            <li className="flex items-center gap-3 rounded-lg border border-divider px-3 py-2.5 text-sm text-heading">
              <Wrench aria-hidden weight="fill" className="size-5 text-action" />
              <span className="flex-1">
                Maintenance Mode {active ? `(“${active.title}” until ${stamp(active.endsAt)})` : ''}
              </span>
              <Toggle
                label="Maintenance mode"
                checked={Boolean(active)}
                disabled={act.isPending || !windows.data}
                onChange={(on) =>
                  on
                    ? setScheduling({ mode: 'now', at: Date.now() })
                    : active &&
                      act.mutate(
                        { id: active.id, step: 'complete' },
                        {
                          onSuccess: () =>
                            setNotice({ tone: 'ok', text: 'Maintenance mode is off.' }),
                          onError: failed,
                        },
                      )
                }
              />
            </li>
          </ul>
        </SectionCard>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_1.4fr]">
        <Card className="flex flex-wrap items-center gap-4 p-5!">
          <span className="flex size-12 items-center justify-center rounded-full bg-info-soft text-action">
            <FileText aria-hidden weight="fill" className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-heading">System Logs</h2>
            <p className="text-sm text-muted">
              View and search the platform's audit and security log.
            </p>
          </div>
          <Link
            href="/audit-security"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-divider bg-info-soft px-4 text-sm font-medium text-action"
          >
            View System Logs <ArrowRight aria-hidden weight="bold" className="size-4" />
          </Link>
        </Card>
        <SectionCard
          id="maintenance"
          title="Scheduled Maintenance"
          subtitle="Manage planned maintenance windows."
          icon={CalendarBlank}
          action={
            <Button
              variant="secondary"
              onClick={() => setScheduling({ mode: 'later', at: Date.now() })}
            >
              Schedule Maintenance
            </Button>
          }
        >
          <Body query={windows} rows={2}>
            {(d) =>
              d.items.length ? (
                <ul className="divide-y divide-divider text-sm" data-testid="maintenance-windows">
                  {d.items.slice(0, 6).map((w: AdminMaintenanceWindow) => (
                    <li key={w.id} className="flex flex-wrap items-center gap-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-heading">{w.title}</span>
                        <span className="block text-xs text-muted">
                          {stamp(w.startsAt)} – {stamp(w.endsAt)}
                        </span>
                      </span>
                      <Badge
                        tone={
                          w.status === 'ACTIVE'
                            ? 'warning'
                            : w.status === 'SCHEDULED'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {title(w.status)}
                      </Badge>
                      {w.status === 'SCHEDULED' ? (
                        <>
                          <Button
                            variant="ghost"
                            disabled={act.isPending}
                            onClick={() =>
                              act.mutate({ id: w.id, step: 'start' }, { onError: failed })
                            }
                          >
                            Start now
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={act.isPending}
                            onClick={() =>
                              act.mutate({ id: w.id, step: 'cancel' }, { onError: failed })
                            }
                          >
                            Cancel
                          </Button>
                        </>
                      ) : w.status === 'ACTIVE' ? (
                        <Button
                          variant="ghost"
                          disabled={act.isPending}
                          onClick={() =>
                            act.mutate({ id: w.id, step: 'complete' }, { onError: failed })
                          }
                        >
                          Complete
                        </Button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <QuietLine>No maintenance windows.</QuietLine>
              )
            }
          </Body>
        </SectionCard>
      </div>

      <PauseModal
        job={pausing}
        onClose={() => setPausing(null)}
        onDone={(t) => setNotice({ tone: 'ok', text: t })}
      />
      <ScheduleModal
        open={scheduling}
        onClose={() => setScheduling(null)}
        onDone={(t) => setNotice({ tone: 'ok', text: t })}
      />
      <SecretsModal open={secrets} onClose={() => setSecrets(false)} />
    </div>
  );
}

function PauseModal({
  job,
  onClose,
  onDone,
}: {
  job: AdminJob | null;
  onClose: () => void;
  onDone: (t: string) => void;
}) {
  const [reason, setReason] = useState('');
  const pause = useApiMutation(() => api.adminSettings.pauseJob(job!.key, { reason }), {
    invalidate: [...SS],
  });
  const close = () => {
    setReason('');
    pause.reset();
    onClose();
  };
  return (
    <Modal
      open={job !== null}
      title={`Pause ${job?.name ?? ''}?`}
      subtitle="It stops running until resumed. The reason is recorded."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || pause.isPending}
            onClick={() =>
              pause.mutate(undefined, {
                onSuccess: (j) => {
                  onDone(`${j.name} paused.`);
                  close();
                },
              })
            }
          >
            Pause
          </Button>
        </>
      }
    >
      <Textarea
        label="Reason"
        rows={3}
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
      />
      {pause.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(pause.error, ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}

const local = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Schedule a window; "now" starts it at once (Maintenance Mode on). */
function ScheduleModal({
  open,
  onClose,
  onDone,
}: {
  /** How it was opened, and when (the opener's time: the form starts from it). */
  open: { mode: 'now' | 'later'; at: number } | null;
  onClose: () => void;
  onDone: (t: string) => void;
}) {
  const mode = open?.mode ?? null;
  const [form, setForm] = useState({
    title: '',
    message: '',
    startsAt: '',
    endsAt: '',
    adminBypass: true,
  });
  const [opened, setOpened] = useState<number | null>(null);
  if (open && opened !== open.at) {
    setOpened(open.at);
    const start = new Date(open.at + (open.mode === 'now' ? 60_000 : 86_400_000));
    setForm({
      title: mode === 'now' ? 'Maintenance' : '',
      message: '',
      startsAt: local(start),
      endsAt: local(new Date(start.getTime() + 3_600_000)),
      adminBypass: true,
    });
  }
  const save = useApiMutation(
    async () => {
      const w = await api.adminSettings.scheduleMaintenance({
        title: form.title,
        message: form.message,
        startsAt: new Date(form.startsAt).toISOString(),
        endsAt: new Date(form.endsAt).toISOString(),
        adminBypass: form.adminBypass,
      });
      return mode === 'now' ? api.adminSettings.startMaintenance(w.id) : w;
    },
    { invalidate: [...SS] },
  );
  const close = () => {
    setOpened(null);
    save.reset();
    onClose();
  };
  return (
    <Modal
      open={mode !== null}
      title={mode === 'now' ? 'Turn on Maintenance Mode' : 'Schedule Maintenance'}
      subtitle="Users see the message; Super Admins can still sign in when bypass is on."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={
              !form.title.trim() ||
              !form.message.trim() ||
              !form.startsAt ||
              !form.endsAt ||
              save.isPending
            }
            onClick={() =>
              save.mutate(undefined, {
                onSuccess: (w) => {
                  onDone(
                    mode === 'now'
                      ? `Maintenance mode is on until ${stamp(w.endsAt)}.`
                      : `“${w.title}” is scheduled.`,
                  );
                  close();
                },
              })
            }
          >
            {mode === 'now' ? 'Turn On' : 'Schedule'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Title"
          value={form.title}
          maxLength={120}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <Textarea
          label="Message to users"
          rows={3}
          value={form.message}
          maxLength={2000}
          onChange={(e) => setForm({ ...form, message: e.target.value })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Starts"
            type="datetime-local"
            value={form.startsAt}
            onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
          />
          <Input
            label="Ends"
            type="datetime-local"
            value={form.endsAt}
            onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
          />
        </div>
        <div className="flex items-center gap-3 text-sm text-heading">
          <Toggle
            label="Super Admins can still sign in"
            checked={form.adminBypass}
            onChange={(on) => setForm({ ...form, adminBypass: on })}
          />
          <span aria-hidden>Super Admins can still sign in</span>
        </div>
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Secret references: where each secret lives (an AWS ARN), never the secret itself. */
function SecretsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const list = useApiQuery([...SS, 'secrets', open], () =>
    open ? api.adminSettings.secrets() : Promise.resolve({ items: [] }),
  );
  const [key, setKey] = useState('');
  const [reference, setReference] = useState('');
  const set = useApiMutation(
    () => api.adminSettings.setSecret(key.trim(), { reference, hint: null }),
    { invalidate: [...SS] },
  );
  const remove = useApiMutation((k: string) => api.adminSettings.removeSecret(k), {
    invalidate: [...SS],
  });
  return (
    <Modal
      open={open}
      title="Secret References"
      subtitle="Firmivra stores where each secret is (an AWS Secrets Manager ARN), never the secret."
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {list.data?.items.length ? (
          <ul className="divide-y divide-divider text-sm">
            {list.data.items.map((s) => (
              <li key={s.key} className="flex items-center gap-3 py-2">
                <span className="flex-1">
                  <span className="block text-heading">{s.key}</span>
                  <span className="block text-xs text-muted">
                    Updated {stamp(s.updatedAt)}
                    {s.updatedBy ? ` by ${s.updatedBy}` : ''}
                  </span>
                </span>
                <Badge tone="success">Configured</Badge>
                <Button
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(s.key)}
                >
                  <span className="text-danger">Remove</span>
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <QuietLine>{list.isError ? loadError(list.error) : 'No secret references.'}</QuietLine>
        )}
        <div className="grid gap-3 border-t border-divider pt-4 sm:grid-cols-2">
          <Input
            label="Key"
            placeholder="stripe"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <Input
            label="Reference (ARN)"
            placeholder="arn:aws:secretsmanager:…"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
        <Button
          disabled={!key.trim() || !reference.trim() || set.isPending}
          onClick={() =>
            set.mutate(undefined, {
              onSuccess: () => {
                setKey('');
                setReference('');
              },
            })
          }
        >
          Save Reference
        </Button>
        {set.isError || remove.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(set.error ?? remove.error, ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
