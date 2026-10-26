'use client';

import type { BookkeepingSettings } from '@firmivra/types';
import { Button, Checkbox, Input, Select, Toast } from '@firmivra/ui';
import { Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { BK_ERRORS, BK_KEY, card, quiet } from './bookkeeping-shared';

const CADENCE = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'CUSTOM', label: 'Custom' },
];

/** /bookkeeping/settings: the firm's cadence, close day, status rules and checklists (Owner and Admin). */
export function SettingsScreen() {
  const q = useApiQuery([...BK_KEY, 'settings'], () => api.bookkeeping.settings());
  if (q.isError)
    return (
      <div className="flex flex-col gap-3" data-testid="settings-error">
        <Link href="/bookkeeping" className="text-sm font-medium text-link">
          ← Back to Bookkeeping
        </Link>
        <p role="alert" className={quiet}>
          The settings are not available. Only an Owner or Admin can open them, or we could not load
          them.
        </p>
      </div>
    );
  if (!q.data) return <p className={quiet}>Loading…</p>;
  return <SettingsForm initial={q.data} />;
}

const newKey = () => crypto.randomUUID();

function SettingsForm({ initial }: { initial: BookkeepingSettings }) {
  const [s, setS] = useState(initial);
  // BK-D05: each document row keeps one key while it is typed in (a key made from its text
  // remounted the field on every keystroke and the caret was lost).
  const [docKeys, setDocKeys] = useState(() => initial.documentChecklist.map(() => newKey()));
  const [msg, setMsg] = useState<{ text: string; tone: 'success' | 'error' }>();
  const [busy, setBusy] = useState(false);
  const num = (v: string, d: number) => (v === '' ? d : Number(v));
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="bk-settings">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-link">
        <Link href="/bookkeeping">Bookkeeping</Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Settings</span>
      </nav>
      <h1 className="font-display text-3xl font-bold text-heading">Bookkeeping Settings</h1>
      {msg ? (
        <Toast message={msg.text} tone={msg.tone} onDismiss={() => setMsg(undefined)} />
      ) : null}
      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
        <section className={`${card} flex flex-col gap-3`} aria-label="Defaults">
          <h2 className="font-display text-lg font-bold text-heading">Defaults</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="Default cadence"
              value={s.defaultCadence}
              onChange={(e) =>
                setS({ ...s, defaultCadence: e.target.value as typeof s.defaultCadence })
              }
              options={CADENCE}
            />
            <Input
              label="Close by day of month"
              type="number"
              value={String(s.closeTargetDay)}
              onChange={(e) => setS({ ...s, closeTargetDay: num(e.target.value, 10) })}
            />
            <Input
              label="Upcoming report window (days)"
              type="number"
              value={String(s.upcomingReportDays)}
              onChange={(e) => setS({ ...s, upcomingReportDays: num(e.target.value, 14) })}
            />
            <Input
              label="Sync is stale after (hours)"
              type="number"
              value={String(s.staleSyncHours)}
              onChange={(e) => setS({ ...s, staleSyncHours: num(e.target.value, 48) })}
            />
            <Input
              label="Reconciliation tolerance ($)"
              type="number"
              value={String(s.reconToleranceCents / 100)}
              onChange={(e) =>
                setS({ ...s, reconToleranceCents: Math.round(num(e.target.value, 0) * 100) })
              }
            />
          </div>
          <h3 className="text-sm font-semibold text-heading">Status rules</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {/* BK-D04: the age of a request from the day it was sent; no number is assumed. */}
            <div className="flex flex-col gap-1">
              <Input
                label="Missing Documents after (days since the request was sent)"
                type="number"
                min={0}
                max={90}
                value={String(s.statusRules.missingDocumentsAfterDays ?? '')}
                onChange={(e) => {
                  const { missingDocumentsAfterDays: _old, ...rest } = s.statusRules;
                  void _old;
                  setS({
                    ...s,
                    statusRules:
                      e.target.value === ''
                        ? rest
                        : { ...rest, missingDocumentsAfterDays: Number(e.target.value) },
                  });
                }}
              />
              <p className="text-xs text-muted" data-testid="missing-docs-help">
                A document request still open this many days after it was sent makes the client
                Missing Documents. Requests that were received, accepted or cancelled stop counting.
                Left empty, an open request counts from the day it was sent.
              </p>
            </div>
            <Input
              label="Overdue after (days)"
              type="number"
              value={String(s.statusRules.overdueAfterDays ?? '')}
              onChange={(e) =>
                setS({
                  ...s,
                  statusRules: { ...s.statusRules, overdueAfterDays: num(e.target.value, 0) },
                })
              }
            />
          </div>
        </section>
        <section
          className={`${card} flex flex-col gap-3`}
          aria-label="Document checklist"
          data-testid="doc-checklist"
        >
          <h2 className="font-display text-lg font-bold text-heading">Document Checklist</h2>
          {s.documentChecklist.length === 0 ? <p className={quiet}>No documents listed.</p> : null}
          {s.documentChecklist.map((d, i) => (
            <div
              key={docKeys[i] ?? i}
              className="grid items-end gap-2 sm:grid-cols-[1fr_9rem_auto]"
            >
              <Input
                label="Document"
                value={d.label}
                onChange={(e) =>
                  setS({
                    ...s,
                    documentChecklist: s.documentChecklist.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <Select
                label="How often"
                value={d.cadence}
                onChange={(e) =>
                  setS({
                    ...s,
                    documentChecklist: s.documentChecklist.map((x, j) =>
                      j === i ? { ...x, cadence: e.target.value as typeof d.cadence } : x,
                    ),
                  })
                }
                options={CADENCE}
              />
              <button
                type="button"
                aria-label={`Remove ${d.label || 'document'}`}
                onClick={() => {
                  setS({ ...s, documentChecklist: s.documentChecklist.filter((_, j) => j !== i) });
                  setDocKeys((keys) => keys.filter((_, j) => j !== i));
                }}
                className="flex size-10 items-center justify-center rounded-control text-danger hover:bg-danger-soft"
              >
                <Trash aria-hidden weight="bold" className="size-4" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="inline-flex w-fit items-center gap-1 text-sm font-medium text-link"
            onClick={() => {
              setS({
                ...s,
                documentChecklist: [...s.documentChecklist, { label: '', cadence: 'MONTHLY' }],
              });
              setDocKeys((keys) => [...keys, newKey()]);
            }}
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add document
          </button>
        </section>
        <section
          className={`${card} flex flex-col gap-3 xl:col-span-2`}
          aria-label="Close checklist"
          data-testid="close-checklist"
        >
          <h2 className="font-display text-lg font-bold text-heading">Close Checklist</h2>
          {s.closeChecklist.map((c, i) => (
            <div key={c.key} className="grid items-center gap-2 sm:grid-cols-[1fr_auto_auto]">
              <Input
                label={`Step ${i + 1}`}
                value={c.label}
                onChange={(e) =>
                  setS({
                    ...s,
                    closeChecklist: s.closeChecklist.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  })
                }
              />
              <Checkbox
                label="Required"
                checked={c.required}
                onChange={(e) =>
                  setS({
                    ...s,
                    closeChecklist: s.closeChecklist.map((x, j) =>
                      j === i ? { ...x, required: e.target.checked } : x,
                    ),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove ${c.label}`}
                onClick={() =>
                  setS({ ...s, closeChecklist: s.closeChecklist.filter((_, j) => j !== i) })
                }
                className="flex size-10 items-center justify-center rounded-control text-danger hover:bg-danger-soft"
              >
                <Trash aria-hidden weight="bold" className="size-4" />
              </button>
            </div>
          ))}
        </section>
      </div>
      <div className="flex gap-2">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const { updatedAt: _u, ...body } = s;
              void _u;
              setS(await api.bookkeeping.saveSettings(body));
              setMsg({ text: 'Settings saved.', tone: 'success' });
            } catch (e) {
              setMsg({ text: errorMessage(e, BK_ERRORS), tone: 'error' });
            }
            setBusy(false);
          }}
        >
          Save Settings
        </Button>
        <Button variant="secondary" onClick={() => setS(initial)}>
          Reset
        </Button>
      </div>
    </div>
  );
}
