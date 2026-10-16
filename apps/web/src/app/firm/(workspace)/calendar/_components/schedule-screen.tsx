'use client';

import type { AppointmentRecord, ConflictResult, SchedulingOptions } from '@firmivra/types';
import { ApiRequestError, SaveAppointmentDraftRequest } from '@firmivra/types';
import { Button, Select, Textarea } from '@firmivra/ui';
import { ArrowLeft, CaretRight } from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { AppointmentForm } from './appointment-form';
import { AppointmentSummary } from './appointment-summary';
import { useOptions } from './ap-data';
import { AP, AP_RECORD, STATUS_LABELS, clock, dateLabel } from './ap-shared';
import { AvailabilityPanel, ConflictCard } from './availability-panel';
import {
  type FormState,
  blankForm,
  formFromRecord,
  fromDraft,
  problems,
  rangeOf,
  requestFrom,
} from './form-model';
import { todayIn } from './time';
import { useAgenda } from './ap-data';
import { dayRange } from './ap-shared';
import { addDays } from './time';

export interface Prefill {
  date?: string | undefined;
  time?: string | undefined;
  /** A saved draft (Duplicate, Save as Draft): its fields fill the form. */
  draft?: string | undefined;
}

/** /calendar/new and /calendar/[id]/edit: one form, one canonical appointment record. */
export function ScheduleScreen({ id, prefill }: { id?: string; prefill?: Prefill }) {
  const { options, timeZone } = useOptions();
  const record = useApiQuery([...AP_RECORD, id ?? 'new'], async () =>
    id ? api.scheduling.record(id) : null,
  );
  // The form mounts once the record is here (edit), or at once (new, or the API unreachable).
  const drafts = useApiQuery([...AP, 'drafts'], async () =>
    prefill?.draft ? api.scheduling.drafts() : [],
  );
  const draft = drafts.data?.find((d) => d.id === prefill?.draft);
  const waiting = (id !== undefined && record.isPending) || (!!prefill?.draft && drafts.isPending);
  return (
    <div className="flex flex-col gap-4" data-testid={id ? 'edit-appointment' : 'new-appointment'}>
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/calendar" className="text-link">
          Appointments
        </Link>
        <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
        <span className="font-semibold text-heading">
          {id ? 'Edit Appointment' : 'Create Appointment'}
        </span>
      </nav>
      {waiting ? (
        <p role="status" className="rounded-xl bg-surface p-6 text-sm text-muted shadow-md">
          Loading the appointment…
        </p>
      ) : (
        <Workspace
          key={record.data?.version ?? draft?.id ?? 'blank'}
          draftData={draft?.data}
          id={id}
          record={record.data ?? undefined}
          loadError={id !== undefined && record.isError ? errorMessage(record.error) : undefined}
          options={options}
          timeZone={timeZone}
          prefill={prefill}
        />
      )}
    </div>
  );
}

function Workspace({
  id,
  record,
  loadError,
  options,
  timeZone,
  prefill,
  draftData,
}: {
  draftData?: Record<string, unknown> | undefined;
  id: string | undefined;
  record: AppointmentRecord | undefined;
  loadError: string | undefined;
  options: SchedulingOptions | undefined;
  timeZone: string;
  prefill: Prefill | undefined;
}) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const draftIdRef = useRef<string | undefined>(undefined);
  const [form, setForm] = useState<FormState>(() => {
    if (record) return formFromRecord(record);
    const base = blankForm(
      timeZone,
      prefill?.date && /^\d{4}-\d{2}-\d{2}$/.test(prefill.date) ? prefill.date : todayIn(timeZone),
      prefill?.time && /^\d{2}:\d{2}$/.test(prefill.time) ? prefill.time : '10:00',
    );
    return draftData ? { ...base, ...fromDraft(draftData) } : base;
  });
  const patch = (change: Partial<FormState>) => setForm((f) => ({ ...f, ...change }));
  const [showErrors, setShowErrors] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'bad' }>();
  const [conflict, setConflict] = useState<ConflictResult>();
  const [mode, setMode] = useState<'new' | 'existing'>(id ? 'existing' : 'new');
  const errors = showErrors ? problems(form, options) : {};
  const ready = loadError === undefined && (id === undefined || record !== undefined);

  const save = useApiMutation(
    async () => {
      const body = requestFrom(form, idempotencyKey);
      if (!body) throw new Error('Choose a date, and an end time after the start.');
      if (record) {
        const { idempotencyKey: _k, contact, ...rest } = body;
        return api.scheduling.updateDetails(record.id, {
          version: record.version,
          ...rest,
          ...(form.picked || form.newContact ? { contact } : {}),
        });
      }
      return api.scheduling.schedule(body);
    },
    { invalidate: AP },
  );
  const draft = useApiMutation(
    async () => {
      const body = requestFrom(form, idempotencyKey);
      const { idempotencyKey: _k, ...fields } = body ?? {};
      const data = SaveAppointmentDraftRequest.parse(
        Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
      );
      return draftIdRef.current
        ? api.scheduling.saveDraft(draftIdRef.current, data)
        : api.scheduling.createDraft(data);
    },
    { invalidate: AP },
  );

  /** A nearby free time from the conflict check becomes the proposed time. */
  function applyAlternative(startsAt: string, endsAt: string) {
    const at = (iso: string) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: form.timezone,
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      })
        .format(new Date(iso))
        .replace(/^24/, '00');
    patch({ start: at(startsAt), end: at(endsAt) });
    setConflict(undefined);
  }

  function submit() {
    setMessage(undefined);
    if (Object.keys(problems(form, options)).length > 0) {
      setShowErrors(true);
      setMessage({ text: 'Fix the highlighted fields to continue.', tone: 'bad' });
      return;
    }
    save.mutate(undefined, {
      onSuccess: (saved) => router.push(`/calendar/${saved.id}`),
      onError: async (error) => {
        if (error instanceof ApiRequestError && error.code === 'SCHEDULING_CONFLICT') {
          const range = rangeOf(form);
          if (range && form.staffIds.length) {
            try {
              setConflict(
                await api.scheduling.checkConflicts({ staffUserIds: form.staffIds, ...range }),
              );
            } catch {
              /* the message below still says what happened */
            }
          }
        }
        setMessage({ text: errorMessage(error), tone: 'bad' });
      },
    });
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <Link
            href="/calendar"
            className="inline-flex min-h-10 items-center gap-2 rounded-control border border-action bg-surface px-3 text-sm font-medium text-action hover:bg-canvas"
          >
            <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Appointments
          </Link>
          <div>
            <h1 className="font-display text-3xl font-bold text-heading">Schedule Appointment</h1>
            <p className="text-base text-muted">
              Create a new appointment or edit an existing one.
            </p>
          </div>
        </div>
        <div className="inline-flex overflow-hidden rounded-lg border border-divider bg-surface">
          <Link
            href="/calendar/new"
            aria-current={!id ? 'page' : undefined}
            className={`min-h-10 px-4 text-sm font-medium leading-10 ${!id ? 'bg-action text-on-action' : 'text-heading hover:bg-canvas'}`}
            onClick={() => setMode('new')}
          >
            Create New
          </Link>
          <button
            type="button"
            aria-pressed={mode === 'existing'}
            onClick={() => setMode('existing')}
            className={`min-h-10 px-4 text-sm font-medium ${id || mode === 'existing' ? 'bg-action text-on-action' : 'text-heading hover:bg-canvas'}`}
          >
            Edit Existing
          </button>
        </div>
      </div>
      {mode === 'existing' && !id ? <ExistingPicker timeZone={timeZone} /> : null}
      {loadError ? (
        <p role="alert" className="rounded-xl bg-danger-soft p-4 text-sm text-danger">
          This appointment could not be loaded: {loadError}
        </p>
      ) : null}
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <AppointmentForm
            form={form}
            patch={patch}
            options={options}
            firmZone={timeZone}
            errors={errors}
            related={record?.related}
          />
          {conflict ? (
            <div className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-md">
              <ConflictCard
                conflict={conflict}
                staffName="The staff member"
                timeZone={form.timezone}
                onPick={applyAlternative}
              />
              {conflict.canOverride ? (
                <Textarea
                  label="Schedule anyway: say why (this is recorded)"
                  rows={2}
                  maxLength={500}
                  value={form.overrideReason}
                  onChange={(event) => patch({ overrideReason: event.target.value })}
                />
              ) : (
                <p className="text-sm text-muted">
                  Choose another time. Overriding a conflict needs an Owner or Admin.
                </p>
              )}
            </div>
          ) : null}
          {message ? (
            <p
              role={message.tone === 'bad' ? 'alert' : 'status'}
              className={`rounded-xl p-3 text-sm ${message.tone === 'bad' ? 'bg-danger-soft text-danger' : 'bg-success-soft text-success'}`}
              data-testid="form-message"
            >
              {message.text}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button
              variant="secondary"
              onClick={() => router.push(record ? `/calendar/${record.id}` : '/calendar')}
            >
              Cancel
            </Button>
            {record ? null : (
              <Button
                variant="secondary"
                disabled={draft.isPending}
                onClick={() => {
                  setMessage(undefined);
                  draft.mutate(undefined, {
                    onSuccess: (saved) => {
                      draftIdRef.current = saved.id;
                      setMessage({ text: 'Draft saved. Nothing was sent.', tone: 'ok' });
                    },
                    onError: (error) => setMessage({ text: errorMessage(error), tone: 'bad' }),
                  });
                }}
              >
                Save as Draft
              </Button>
            )}
            <Button
              disabled={save.isPending || !ready}
              onClick={submit}
              data-testid="schedule-submit"
            >
              {record ? 'Save Changes' : 'Schedule Appointment'}
            </Button>
          </div>
        </div>
        <aside aria-label="Availability and summary" className="flex flex-col gap-4">
          <AvailabilityPanel
            form={form}
            options={options}
            {...(record ? { excludeId: record.id } : {})}
            onPick={applyAlternative}
          />
          <AppointmentSummary form={form} options={options} />
        </aside>
      </div>
    </>
  );
}

/** Edit Existing on /calendar/new: pick one of the coming appointments, then edit it. */
function ExistingPicker({ timeZone }: { timeZone: string }) {
  const router = useRouter();
  const today = todayIn(timeZone);
  const agenda = useAgenda({
    from: dayRange(today, timeZone).from,
    to: dayRange(addDays(today, 60), timeZone).from,
  });
  const open = agenda.items.filter((i) => !['COMPLETED', 'CANCELED', 'NO_SHOW'].includes(i.status));
  return (
    <div className="max-w-xl rounded-xl bg-surface p-4 shadow-md" data-testid="existing-picker">
      <Select
        label="Choose the appointment to edit"
        value=""
        onChange={(event) =>
          event.target.value && router.push(`/calendar/${event.target.value}/edit`)
        }
        options={[
          {
            value: '',
            label: agenda.query.isError
              ? 'Appointments are not available right now'
              : open.length
                ? 'Select an appointment…'
                : 'No upcoming appointments',
          },
          ...open.map((i) => ({
            value: i.id,
            label: `${dateLabel(i.startsAt, timeZone)} ${clock(i.startsAt, timeZone)} · ${i.contact.name || 'Internal'} · ${STATUS_LABELS[i.status]}`,
          })),
        ]}
      />
    </div>
  );
}
