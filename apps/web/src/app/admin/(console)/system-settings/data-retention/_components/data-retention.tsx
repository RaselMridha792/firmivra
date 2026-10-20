'use client';

import type {
  AdminLegalHold,
  AdminRetentionPolicy,
  PlatformRetentionDisposition,
} from '@firmivra/types';
import { Badge, Button, Card, Input, Modal, Select, Textarea, Toggle } from '@firmivra/ui';
import {
  Archive,
  CloudArrowUp,
  Database,
  DownloadSimple,
  FileText,
  Gavel,
  ShieldCheck,
  Trash,
  MagnifyingGlass,
  ChartPie,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  Body,
  ImportantNote,
  loadError,
  QuietLine,
  SaveBar,
  SectionCard,
  SettingsHeader,
  SETTINGS_ERRORS,
  SS,
  stamp,
} from '../../_components/settings-kit';

const LABELS: Record<string, [string, string]> = {
  communications: ['Communications', 'Emails, SMS, notes'],
  support_tickets: ['Support Tickets', 'Tickets and their messages'],
  platform_notifications: ['Platform Notifications', 'Bell items and their copies'],
  export_files: ['Export Files', 'Generated report and data exports'],
  declined_firm_applications: ['Declined Applications', 'Firm applications that were declined'],
  lost_sales_records: ['Lost Sales Records', 'Leads and deals that were lost'],
  platform_billing: ['Billing Records', 'Invoices, payments, subscriptions'],
};
const label = (c: string) => LABELS[c] ?? [c.replaceAll('_', ' '), ''];
const PERIODS = [7, 30, 90, 180, 365, 730, 1095, 1825, 2555, 3650];
const periodText = (d: number) =>
  d % 365 === 0 ? `${d / 365} ${d === 365 ? 'year' : 'years'}` : `${d} ${d === 1 ? 'day' : 'days'}`;
const ACTIONS: { value: PlatformRetentionDisposition; label: string }[] = [
  { value: 'ARCHIVE', label: 'Archive' },
  { value: 'ANONYMIZE', label: 'Anonymize' },
  { value: 'DELETE', label: 'Auto-delete' },
];
const RETENTION_ERRORS = {
  ...SETTINGS_ERRORS,
  STATE: 'This changed meanwhile. Reload and try again.',
};

type Edit = Pick<AdminRetentionPolicy, 'retentionDays' | 'disposition' | 'archiveAfterDays'>;
type Status = Parameters<typeof SaveBar>[0]['status'];

/**
 * Data & Retention (firmivra-data-and-retention-settings.jpg): how long each kind of platform
 * data is kept and what happens after (each policy saved with its own version, never below its
 * floor, applying from today), when it is archived, retention runs (a dry run counts first) and
 * legal holds, which stop retention for a category, a firm or one record. Backups and data export
 * have no platform settings: their cards say where those live.
 */
export function DataRetention() {
  const q = useApiQuery([...SS, 'retention'], () => api.adminSettings.retention());
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [status, setStatus] = useState<Status>(null);
  const rows = q.data?.items ?? [];
  const now = (p: AdminRetentionPolicy): Edit => edits[p.category] ?? p;
  const changed = rows.filter((p) => {
    const e = edits[p.category];
    return (
      e &&
      (e.retentionDays !== p.retentionDays ||
        e.disposition !== p.disposition ||
        e.archiveAfterDays !== p.archiveAfterDays)
    );
  });
  const edit = (p: AdminRetentionPolicy, next: Partial<Edit>) => {
    setEdits({ ...edits, [p.category]: { ...now(p), ...next } });
    setStatus(null);
  };
  const save = useApiMutation(
    async () => {
      for (const p of changed) {
        // Only the request's own fields (the row also carries the policy's read-only facts).
        const e = edits[p.category]!;
        await api.adminSettings.updateRetention(p.category, {
          version: p.version,
          retentionDays: e.retentionDays,
          disposition: e.disposition,
          archiveAfterDays: e.archiveAfterDays,
        });
      }
      return changed.length;
    },
    { invalidate: [...SS] },
  );

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsHeader
        title="Data & Retention"
        subtitle="Manage data retention policies, archiving, backups, and deletion rules for the platform."
        icon={Database}
      />
      <nav aria-label="Sections" className="flex gap-8 overflow-x-auto border-b border-divider">
        {[
          ['#policies', 'Retention Policies'],
          ['#archiving', 'Archiving'],
          ['#backups', 'Backups'],
          ['#runs', 'Data Deletion'],
          ['#export', 'Data Export'],
          ['#holds', 'Legal Holds'],
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
        <span
          aria-disabled
          title="Storage usage is not reported yet"
          className="-mb-px inline-flex min-h-11 shrink-0 cursor-not-allowed items-center border-b-2 border-transparent text-sm font-medium text-muted"
        >
          Storage &amp; Usage
        </span>
      </nav>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[1.6fr_1fr]">
        <SectionCard
          id="policies"
          title="Retention Settings"
          subtitle="Set how long different types of data are retained in the system."
          icon={FileText}
        >
          <Body query={q} rows={6}>
            {() => (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-table-head text-text">
                    <tr>
                      {['Data Type', 'Retention Period', 'Action After Retention', 'Status'].map(
                        (h) => (
                          <th key={h} scope="col" className="px-3 py-2 font-medium">
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-divider">
                    {rows.map((p) => {
                      const v = now(p);
                      const [name, hint] = label(p.category);
                      const periods = [
                        ...new Set([...PERIODS.filter((d) => d >= p.minimumDays), v.retentionDays]),
                      ].sort((a, b) => a - b);
                      return (
                        <tr key={p.category}>
                          <td className="px-3 py-2.5">
                            <span className="block font-semibold text-heading">{name}</span>
                            <span className="block text-xs text-muted">{hint}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <Select
                              label={`${name} retention period`}
                              hideLabel
                              value={String(v.retentionDays)}
                              onChange={(e) => edit(p, { retentionDays: Number(e.target.value) })}
                              options={periods.map((d) => ({
                                value: String(d),
                                label: periodText(d),
                              }))}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            <Select
                              label={`${name} action after retention`}
                              hideLabel
                              value={v.disposition}
                              onChange={(e) =>
                                edit(p, {
                                  disposition: e.target.value as PlatformRetentionDisposition,
                                })
                              }
                              options={ACTIONS}
                            />
                          </td>
                          <td className="px-3 py-2.5">
                            {p.activeHolds ? (
                              <Badge tone="warning">On hold ({p.activeHolds})</Badge>
                            ) : (
                              <Badge tone="success">Active</Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!rows.length ? <QuietLine>No retention policies yet.</QuietLine> : null}
                <p className="mt-2 text-xs text-muted">
                  A change applies from today and never goes below the minimum each kind of data
                  must be kept.
                </p>
              </div>
            )}
          </Body>
        </SectionCard>

        <div className="flex min-w-0 flex-col gap-5">
          <SectionCard
            id="archiving"
            title="Automatic Archiving"
            subtitle="When data moves to archive storage, per kind of data."
            icon={Archive}
          >
            <Body query={q} rows={3}>
              {() => (
                <div className="flex flex-col gap-3">
                  {rows.map((p) => {
                    const v = now(p);
                    const [name] = label(p.category);
                    return (
                      <div key={p.category} className="flex items-center gap-3 text-sm">
                        <Toggle
                          label={`Archive ${name}`}
                          checked={v.archiveAfterDays !== null}
                          onChange={(on) =>
                            edit(p, {
                              archiveAfterDays: on ? Math.min(365, v.retentionDays) : null,
                            })
                          }
                        />
                        <span className="flex-1 text-heading">{name}</span>
                        {v.archiveAfterDays !== null ? (
                          <span className="flex items-center gap-2">
                            <span className="w-20">
                              <Input
                                label={`${name}: archive after days`}
                                hideLabel
                                type="number"
                                min={1}
                                value={String(v.archiveAfterDays)}
                                onChange={(e) =>
                                  edit(p, { archiveAfterDays: Math.max(1, Number(e.target.value)) })
                                }
                              />
                            </span>
                            <span className="text-muted">days</span>
                          </span>
                        ) : (
                          <span className="text-muted">Not archived</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Body>
          </SectionCard>
          <RetentionRuns policies={rows} />
        </div>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_1fr_1fr]">
        <SectionCard
          id="backups"
          title="Backup Settings"
          subtitle="Configure system backups and recovery options."
          icon={CloudArrowUp}
        >
          <QuietLine>
            Backups are taken by the platform's AWS database service (automated, encrypted,
            point-in-time). They are not set here.
          </QuietLine>
        </SectionCard>
        <SectionCard
          id="export"
          title="Data Export"
          subtitle="Configure data export options for compliance and support."
          icon={DownloadSimple}
        >
          <p className="text-sm text-text">
            Exports are built in Reports &amp; Analytics as CSV, with the fields and filters you
            choose; each export is in the audit log.
          </p>
          <Link
            href="/reports/builder"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-divider bg-info-soft text-sm font-medium text-action"
          >
            <DownloadSimple aria-hidden weight="bold" className="size-4" /> Export Data Now
          </Link>
        </SectionCard>
        <div className="flex flex-col gap-5">
          <ImportantNote href="/audit-security/settings">
            Ensure your data retention settings comply with applicable laws and regulations (e.g.,
            IRS, GDPR, CCPA).
          </ImportantNote>
          <Card className="flex flex-col gap-2 p-5!" data-testid="quick-links">
            <h2 className="text-base font-bold text-heading">Quick Links</h2>
            {(
              [
                [
                  MagnifyingGlass,
                  'Data Deletion Logs',
                  'View recent deletion activity',
                  '/audit-security?search=retention',
                ],
                [
                  ShieldCheck,
                  'Compliance Settings',
                  'Manage regulatory requirements',
                  '/audit-security/settings',
                ],
                [ChartPie, 'Reports & Analytics', 'Platform usage and exports', '/reports'],
              ] as const
            ).map(([I, title, text, href]) => (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 py-1.5 hover:text-action"
              >
                <span className="flex size-9 items-center justify-center rounded-full bg-info-soft text-action">
                  <I aria-hidden weight="fill" className="size-4.5" />
                </span>
                <span>
                  <span className="block text-sm font-medium text-heading">{title}</span>
                  <span className="block text-xs text-muted">{text}</span>
                </span>
              </Link>
            ))}
          </Card>
        </div>
      </div>

      <LegalHolds policies={rows} />

      <SaveBar
        status={status}
        saving={save.isPending}
        disabled={!changed.length}
        resetLabel="Discard Changes"
        onReset={() => {
          setEdits({});
          setStatus({ tone: 'info', text: 'Changes discarded.' });
        }}
        onSave={() =>
          save.mutate(undefined, {
            onSuccess: (n) => {
              setEdits({});
              setStatus({
                tone: 'ok',
                text: `Saved ${n} ${n === 1 ? 'policy' : 'policies'}. They apply from today; the change was added to the audit log.`,
              });
            },
            onError: (e) => setStatus({ tone: 'error', text: errorMessage(e, RETENTION_ERRORS) }),
          })
        }
      />
    </div>
  );
}

/** Data Deletion: a retention run per kind of data (a dry run counts first), and recent runs. */
function RetentionRuns({ policies }: { policies: AdminRetentionPolicy[] }) {
  const runs = useApiQuery([...SS, 'retention-runs'], () => api.adminSettings.retentionRuns());
  const [category, setCategory] = useState('');
  const [dryRun, setDryRun] = useState(true);
  const start = useApiMutation(() => api.adminSettings.createRetentionRun(category, { dryRun }), {
    invalidate: [...SS],
  });
  const cancel = useApiMutation((id: string) => api.adminSettings.cancelRetentionRun(id), {
    invalidate: [...SS],
  });
  return (
    <SectionCard
      id="runs"
      title="Data Deletion Requests"
      subtitle="Run retention for a kind of data; a dry run only counts what would go."
      icon={Trash}
    >
      <div className="flex flex-col gap-3">
        <Select
          label="Data type"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={[
            { value: '', label: 'Choose a data type' },
            ...policies.map((p) => ({ value: p.category, label: label(p.category)[0] })),
          ]}
        />
        <div className="flex items-center gap-3 text-sm text-heading">
          <Toggle label="Dry run (count only)" checked={dryRun} onChange={setDryRun} />
          <span aria-hidden>Dry run (count only)</span>
        </div>
        <Button
          variant="secondary"
          disabled={!category || start.isPending}
          onClick={() => start.mutate(undefined)}
        >
          {dryRun ? 'Queue Dry Run' : 'Queue Retention Run'}
        </Button>
        {start.isError || cancel.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(start.error ?? cancel.error, RETENTION_ERRORS)}
          </p>
        ) : null}
        {runs.data?.items.length ? (
          <ul className="divide-y divide-divider text-sm" data-testid="retention-runs">
            {runs.data.items.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-center gap-2 py-2">
                <span className="flex-1">
                  <span className="block text-heading">
                    {label(r.category)[0]}
                    {r.dryRun ? ' (dry run)' : ''}
                  </span>
                  <span className="block text-xs text-muted">
                    {stamp(r.createdAt)}
                    {r.eligibleCount !== null ? ` · ${r.eligibleCount} eligible` : ''}
                    {r.heldCount ? ` · ${r.heldCount} held` : ''}
                  </span>
                </span>
                <Badge
                  tone={
                    r.status === 'COMPLETED'
                      ? 'success'
                      : r.status === 'FAILED'
                        ? 'danger'
                        : r.status === 'CANCELLED'
                          ? 'neutral'
                          : 'info'
                  }
                >
                  {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
                </Badge>
                {r.status === 'QUEUED' ? (
                  <Button
                    variant="ghost"
                    disabled={cancel.isPending}
                    onClick={() => cancel.mutate(r.id)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <QuietLine>{runs.isError ? loadError(runs.error) : 'No retention runs yet.'}</QuietLine>
        )}
      </div>
    </SectionCard>
  );
}

/** Legal holds: stop retention for a kind of data, a firm or one record, until released. */
function LegalHolds({ policies }: { policies: AdminRetentionPolicy[] }) {
  const holds = useApiQuery([...SS, 'holds'], () => api.adminSettings.holds());
  const [creating, setCreating] = useState(false);
  const [releasing, setReleasing] = useState<AdminLegalHold | null>(null);
  const active = holds.data?.items.filter((h) => !h.releasedAt) ?? [];
  return (
    <SectionCard
      id="holds"
      title="Legal Holds"
      subtitle="Keep data past its retention while a legal matter is open."
      icon={Gavel}
      action={
        <Button variant="secondary" onClick={() => setCreating(true)}>
          New Hold
        </Button>
      }
    >
      {holds.data && holds.data.items.length ? (
        <ul className="divide-y divide-divider text-sm" data-testid="legal-holds">
          {holds.data.items.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-heading">{h.name}</span>
                <span className="block text-xs text-muted">
                  {h.category
                    ? label(h.category)[0]
                    : h.firm
                      ? h.firm.name
                      : h.record
                        ? `${h.record.type} ${h.record.id}`
                        : ''}{' '}
                  · {h.reason}
                </span>
              </span>
              {h.releasedAt ? (
                <Badge tone="neutral">Released {stamp(h.releasedAt)}</Badge>
              ) : (
                <Badge tone="warning">Active</Badge>
              )}
              {!h.releasedAt ? (
                <Button variant="ghost" onClick={() => setReleasing(h)}>
                  Release
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <QuietLine>
          {holds.isError
            ? loadError(holds.error)
            : holds.isPending
              ? 'Loading…'
              : 'No legal holds.'}
        </QuietLine>
      )}
      <p className="text-xs text-muted">{active.length} active.</p>
      <HoldModal open={creating} policies={policies} onClose={() => setCreating(false)} />
      <ReleaseModal hold={releasing} onClose={() => setReleasing(null)} />
    </SectionCard>
  );
}

function HoldModal({
  open,
  policies,
  onClose,
}: {
  open: boolean;
  policies: AdminRetentionPolicy[];
  onClose: () => void;
}) {
  const [form, setForm] = useState({ name: '', reason: '', category: '' });
  const create = useApiMutation(
    () =>
      api.adminSettings.createHold({
        name: form.name,
        reason: form.reason,
        category: form.category,
      }),
    { invalidate: [...SS] },
  );
  const close = () => {
    setForm({ name: '', reason: '', category: '' });
    create.reset();
    onClose();
  };
  return (
    <Modal
      open={open}
      title="New Legal Hold"
      subtitle="Data under hold is kept past its retention until the hold is released."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={
              !form.name.trim() || !form.reason.trim() || !form.category || create.isPending
            }
            onClick={() => create.mutate(undefined, { onSuccess: close })}
          >
            Place Hold
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input
          label="Name"
          value={form.name}
          maxLength={120}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Select
          label="Data type"
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          options={[
            { value: '', label: 'Choose a data type' },
            ...policies.map((p) => ({ value: p.category, label: label(p.category)[0] })),
          ]}
        />
        <Textarea
          label="Reason"
          rows={3}
          value={form.reason}
          maxLength={2000}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        {create.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(create.error, RETENTION_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

function ReleaseModal({ hold, onClose }: { hold: AdminLegalHold | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const release = useApiMutation(() => api.adminSettings.releaseHold(hold!.id, { reason }), {
    invalidate: [...SS],
  });
  const close = () => {
    setReason('');
    release.reset();
    onClose();
  };
  return (
    <Modal
      open={hold !== null}
      title={`Release ${hold?.name ?? 'hold'}?`}
      subtitle="Retention applies again to what it held. A release cannot be undone."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim() || release.isPending}
            onClick={() => release.mutate(undefined, { onSuccess: close })}
          >
            Release
          </Button>
        </>
      }
    >
      <Textarea
        label="Reason"
        rows={3}
        value={reason}
        maxLength={2000}
        onChange={(e) => setReason(e.target.value)}
      />
      {release.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(release.error, RETENTION_ERRORS)}
        </p>
      ) : null}
    </Modal>
  );
}
