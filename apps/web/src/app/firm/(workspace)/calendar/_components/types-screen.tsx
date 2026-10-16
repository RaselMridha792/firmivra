'use client';

import type {
  AppointmentReminder,
  AppointmentTypeConfig,
  MeetingMethod,
  ReminderChannel,
  SchedulingOptions,
} from '@firmivra/types';
import { Button, Checkbox, Textarea, Toggle } from '@firmivra/ui';
import { ArrowLeft, CalendarDots, Plus, Trash } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useOptions } from './ap-data';
import { AP, AP_TYPE, METHOD_LABELS } from './ap-shared';
import { COLORS, REMINDER_UNITS, durationText } from './form-model';
import { CONTROL, Field } from './form-parts';

const METHODS = ['IN_PERSON', 'PHONE', 'VIDEO', 'OTHER'] as const;

/** /calendar/types: Manage Appointment Types, the firm's own list and what each type means. */
export function TypesScreen() {
  const { options, query } = useOptions();
  const [picked, setPicked] = useState('');
  const types = options?.types ?? [];
  const typeId = picked || types[0]?.id || '';
  const type = types.find((t) => t.id === typeId);
  return (
    <div className="flex flex-col gap-5" data-testid="appointment-types">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Link href="/calendar" className="flex items-center gap-2 text-sm font-medium text-link">
            <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Appointments
          </Link>
          <h1 className="font-display text-3xl font-bold text-heading">Appointment Types</h1>
          <p className="text-base text-muted">
            What each kind of appointment means: how long it lasts, who may take it and how it is
            reminded.
          </p>
        </div>
      </header>
      <div className="grid items-start gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <section aria-label="Appointment types" className="rounded-xl bg-surface p-4 shadow-md">
          <h2 className="mb-3 text-lg font-bold text-heading">Types</h2>
          {types.length === 0 ? (
            <p className="rounded-md bg-canvas p-4 text-center text-sm text-muted">
              {query.isPending
                ? 'Loading…'
                : query.isError
                  ? 'Appointment types are not available right now.'
                  : 'No appointment types yet.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-1" data-testid="type-list">
              {types.map((t) => (
                <li key={t.id}>
                  <button
                    type="button"
                    aria-pressed={t.id === typeId}
                    onClick={() => setPicked(t.id)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left ${t.id === typeId ? 'bg-info-soft' : 'hover:bg-canvas'}`}
                  >
                    <span
                      aria-hidden
                      style={{ backgroundColor: t.color ?? undefined }}
                      className={`size-3 shrink-0 rounded-full ${t.color ? '' : 'bg-control-border'}`}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-semibold text-heading">{t.name}</span>
                      <span className="text-xs text-muted">{durationText(t.durationMinutes)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="flex flex-col gap-4">
          {type ? (
            <TypeConfigCard
              key={type.id}
              typeId={type.id}
              name={type.name}
              minutes={type.durationMinutes}
              options={options}
            />
          ) : (
            <section className="rounded-xl bg-surface p-4 shadow-md">
              <h2 className="text-lg font-bold text-heading">Type settings</h2>
              <p className="mt-3 rounded-md bg-canvas p-4 text-center text-sm text-muted">
                Choose an appointment type to see its settings.
              </p>
            </section>
          )}
          <NoticeCard />
        </div>
      </div>
    </div>
  );
}

function TypeConfigCard({
  typeId,
  name,
  minutes,
  options,
}: {
  typeId: string;
  name: string;
  minutes: number;
  options: SchedulingOptions | undefined;
}) {
  const config = useApiQuery([...AP_TYPE, typeId], () => api.scheduling.typeConfig(typeId));
  return (
    <section
      aria-label={`${name} settings`}
      className="rounded-xl bg-surface p-4 shadow-md"
      data-testid="type-config"
    >
      <header className="mb-4 flex items-center gap-3">
        <span
          aria-hidden
          className="flex size-9 items-center justify-center rounded-lg bg-action text-on-action"
        >
          <CalendarDots weight="fill" className="size-5" />
        </span>
        <div>
          <h2 className="text-lg font-bold text-heading">{name}</h2>
          <p className="text-sm text-muted">Default duration: {durationText(minutes)}</p>
        </div>
      </header>
      {config.data ? (
        <ConfigForm key={typeId} typeId={typeId} config={config.data} options={options} />
      ) : (
        <p
          role={config.isError ? 'alert' : undefined}
          className="rounded-md bg-canvas p-4 text-center text-sm text-muted"
        >
          {config.isPending ? 'Loading…' : errorMessage(config.error)}
        </p>
      )}
    </section>
  );
}

function ConfigForm({
  typeId,
  config,
  options,
}: {
  typeId: string;
  config: AppointmentTypeConfig;
  options: SchedulingOptions | undefined;
}) {
  const [c, setC] = useState(config);
  const [done, setDone] = useState<string>();
  const change = (patch: Partial<AppointmentTypeConfig>) => {
    setDone(undefined);
    setC({ ...c, ...patch });
  };
  const save = useApiMutation(
    () =>
      api.scheduling.setTypeConfig(typeId, {
        description: c.description ?? '',
        serviceId: c.serviceId,
        eligibleStaffUserIds: c.eligibleStaffUserIds,
        methods: c.methods,
        officeIds: c.officeIds,
        bufferBeforeMinutes: c.bufferBeforeMinutes,
        bufferAfterMinutes: c.bufferAfterMinutes,
        minNoticeHours: c.minNoticeHours,
        maxWindowDays: c.maxWindowDays,
        requiredIntakeFormId: c.requiredIntakeFormId,
        requiredDocuments: c.requiredDocuments,
        defaultReminders: c.defaultReminders,
        color: c.color,
      }),
    { invalidate: [...AP] },
  );
  const staff = options?.staff ?? [];
  const num = (label: string, value: number, set: (n: number) => void, max: number, min = 0) => (
    <Field label={label}>
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        className={CONTROL}
        value={value}
        onChange={(event) => set(Math.min(max, Math.max(min, Number(event.target.value) || min)))}
      />
    </Field>
  );
  const reminder = (r: AppointmentReminder, i: number) => (
    <li key={i} className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Reminder channel"
        className={`${CONTROL} w-36!`}
        value={r.channel}
        onChange={(event) =>
          change({
            defaultReminders: c.defaultReminders.map((x, j) =>
              j === i ? { ...x, channel: event.target.value as ReminderChannel } : x,
            ),
          })
        }
      >
        <option value="EMAIL">Email</option>
        <option value="SMS">SMS</option>
        <option value="PORTAL">Portal</option>
      </select>
      <input
        aria-label="Reminder amount"
        type="number"
        min={0}
        max={60}
        className={`${CONTROL} w-20!`}
        value={r.amount}
        onChange={(event) =>
          change({
            defaultReminders: c.defaultReminders.map((x, j) =>
              j === i
                ? { ...x, amount: Math.min(60, Math.max(0, Number(event.target.value) || 0)) }
                : x,
            ),
          })
        }
      />
      <select
        aria-label="Reminder unit"
        className={`${CONTROL} w-40!`}
        value={r.unit}
        onChange={(event) =>
          change({
            defaultReminders: c.defaultReminders.map((x, j) =>
              j === i ? { ...x, unit: event.target.value as AppointmentReminder['unit'] } : x,
            ),
          })
        }
      >
        {REMINDER_UNITS.map((u) => (
          <option key={u.value} value={u.value}>
            {u.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        aria-label={`Remove reminder ${i + 1}`}
        onClick={() => change({ defaultReminders: c.defaultReminders.filter((_, j) => j !== i) })}
        className="text-muted hover:text-danger"
      >
        <Trash aria-hidden weight="fill" className="size-4" />
      </button>
    </li>
  );
  return (
    <div className="flex flex-col gap-4">
      <Textarea
        label="Description"
        rows={2}
        maxLength={500}
        value={c.description ?? ''}
        onChange={(event) => change({ description: event.target.value })}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Related service" htmlFor="tc-service">
          <select
            id="tc-service"
            className={CONTROL}
            value={c.serviceId ?? ''}
            onChange={(event) => change({ serviceId: event.target.value || null })}
          >
            <option value="">None</option>
            {(options?.services ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Calendar colour" htmlFor="tc-color">
          <select
            id="tc-color"
            className={CONTROL}
            value={c.color ?? ''}
            onChange={(event) => change({ color: event.target.value || null })}
          >
            {COLORS.map((col) => (
              <option key={col.value} value={col.value}>
                {col.value ? col.label : 'None'}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-text">Location methods</legend>
        <div className="flex flex-wrap gap-x-6">
          {METHODS.map((m: MeetingMethod) => (
            <Checkbox
              key={m}
              label={METHOD_LABELS[m]}
              checked={c.methods.includes(m)}
              onChange={(event) =>
                change({
                  methods: event.target.checked
                    ? [...c.methods, m]
                    : c.methods.filter((x) => x !== m),
                })
              }
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-text">
          Eligible staff <span className="font-normal text-muted">(none checked: anyone)</span>
        </legend>
        {staff.length === 0 ? (
          <p className="text-sm text-muted">No staff to choose from.</p>
        ) : (
          <div className="flex flex-wrap gap-x-6">
            {staff.map((s) => (
              <Checkbox
                key={s.userId}
                label={s.name}
                checked={c.eligibleStaffUserIds.includes(s.userId)}
                onChange={(event) =>
                  change({
                    eligibleStaffUserIds: event.target.checked
                      ? [...c.eligibleStaffUserIds, s.userId]
                      : c.eligibleStaffUserIds.filter((x) => x !== s.userId),
                  })
                }
              />
            ))}
          </div>
        )}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {num(
          'Buffer before (min)',
          c.bufferBeforeMinutes,
          (n) => change({ bufferBeforeMinutes: n }),
          120,
        )}
        {num(
          'Buffer after (min)',
          c.bufferAfterMinutes,
          (n) => change({ bufferAfterMinutes: n }),
          120,
        )}
        {num('Minimum notice (hours)', c.minNoticeHours, (n) => change({ minNoticeHours: n }), 720)}
        {num('Booking window (days)', c.maxWindowDays, (n) => change({ maxWindowDays: n }), 730, 1)}
      </div>
      <div>
        <p className="mb-1 text-sm font-medium text-text">Required documents</p>
        <ul className="flex flex-col gap-2">
          {c.requiredDocuments.map((doc, i) => (
            <li key={`doc-${i}`} className="flex items-center gap-2">
              <input
                aria-label={`Required document ${i + 1}`}
                className={CONTROL}
                maxLength={100}
                value={doc}
                onChange={(event) =>
                  change({
                    requiredDocuments: c.requiredDocuments.map((d, j) =>
                      j === i ? event.target.value : d,
                    ),
                  })
                }
              />
              <button
                type="button"
                aria-label={`Remove document ${i + 1}`}
                onClick={() =>
                  change({ requiredDocuments: c.requiredDocuments.filter((_, j) => j !== i) })
                }
                className="text-muted hover:text-danger"
              >
                <Trash aria-hidden weight="fill" className="size-4" />
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => change({ requiredDocuments: [...c.requiredDocuments, ''] })}
          className="mt-2 flex items-center gap-1 text-sm font-medium text-link"
        >
          <Plus aria-hidden weight="bold" className="size-3" /> Add a document
        </button>
        {c.requiredDocuments.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No documents are required before this type.</p>
        ) : null}
      </div>
      <div>
        <p className="mb-1 text-sm font-medium text-text">Default reminders</p>
        {c.defaultReminders.length === 0 ? (
          <p className="text-sm text-muted">No default reminders.</p>
        ) : (
          <ul className="flex flex-col gap-2">{c.defaultReminders.map(reminder)}</ul>
        )}
        <button
          type="button"
          onClick={() =>
            change({
              defaultReminders: [
                ...c.defaultReminders,
                { channel: 'EMAIL', amount: 1, unit: 'DAYS' },
              ],
            })
          }
          className="mt-2 flex items-center gap-1 text-sm font-medium text-link"
        >
          <Plus aria-hidden weight="bold" className="size-3" /> Add a reminder
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          disabled={save.isPending}
          onClick={() =>
            save.mutate(undefined, { onSuccess: () => setDone('Type settings saved.') })
          }
          data-testid="type-save"
        >
          Save type settings
        </Button>
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error)}
          </p>
        ) : done ? (
          <p role="status" className="text-sm text-success">
            {done}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** The firm master email rule: copied on creation and changes, and optionally on every reminder. */
function NoticeCard() {
  const settings = useApiQuery([...AP, 'notice'], () => api.scheduling.noticeSettings());
  const save = useApiMutation(
    (patch: { copyMasterOnChanges?: boolean; copyMasterOnReminders?: boolean }) =>
      api.scheduling.setNoticeSettings(patch),
    { invalidate: [...AP, 'notice'] },
  );
  const data = settings.data;
  return (
    <section
      aria-label="Appointment notices"
      className="rounded-xl bg-surface p-4 shadow-md"
      data-testid="notice-card"
    >
      <h2 className="mb-1 text-lg font-bold text-heading">Appointment notices</h2>
      <p className="mb-3 text-sm text-muted">
        Appointment notices are also copied to the firm&apos;s main email.
      </p>
      {data ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text">
            Main email:{' '}
            <span className="font-semibold text-heading">
              {data.masterEmail ?? 'Not set. Add it in Settings > Company Profile.'}
            </span>
          </p>
          <label className="flex items-center gap-3 text-sm text-text">
            <Toggle
              label="Copy the main email on changes"
              checked={data.copyMasterOnChanges}
              onChange={(copyMasterOnChanges) => save.mutate({ copyMasterOnChanges })}
            />
            Copy the main email when an appointment is created or changed
          </label>
          <label className="flex items-center gap-3 text-sm text-text">
            <Toggle
              label="Copy the main email on every reminder"
              checked={data.copyMasterOnReminders}
              onChange={(copyMasterOnReminders) => save.mutate({ copyMasterOnReminders })}
            />
            Also copy it on every automatic reminder
          </label>
          {save.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(save.error)}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md bg-canvas p-4 text-center text-sm text-muted">
          {settings.isPending ? 'Loading…' : errorMessage(settings.error)}
        </p>
      )}
    </section>
  );
}
