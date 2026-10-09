'use client';

import {
  type AppointmentStatus,
  CancelMyAppointmentRequest,
  type MyAppointment,
  type MySlot,
} from '@firmivra/types';
import { Badge, Button, Card, Input } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import type { UseQueryResult } from '@tanstack/react-query';
import { ArrowRight, Clock, EllipsisVertical, MapPin, Phone, Video } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { FreeTimes } from './free-times';
import {
  APPOINTMENT_ERRORS,
  dateTile,
  firstDay,
  myAppointmentsKey,
  STALE,
  TAKEN,
  timeRange,
  today,
  when,
} from './shared';

/** A line above the list: what just changed, or why a change could not be made. */
export type Notice = { text: string; failed: boolean };

/**
 * Reschedule or Cancel asked for from Quick Actions, pinned to one row by `id`; `n` tells
 * repeated asks apart.
 */
export type ActionRequest = { kind: 'reschedule' | 'cancel'; id: string; n: number };

type Action = ActionRequest['kind'];

const STATUS: Record<
  AppointmentStatus,
  { label: string; tone: 'info' | 'success' | 'danger' | 'neutral' }
> = {
  SCHEDULED: { label: 'Upcoming', tone: 'info' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  NO_SHOW: { label: 'Missed', tone: 'neutral' },
};

/** Staff close an appointment after it ends; until they do, an ended one is still SCHEDULED. */
const statusOf = (item: MyAppointment) =>
  item.status === 'SCHEDULED' && Date.parse(item.endsAt) <= Date.now()
    ? { label: 'Past', tone: 'neutral' as const }
    : STATUS[item.status];

/** The appointment Quick Actions' Reschedule or Cancel opens: the soonest one that allows it. */
export const targetOf = (items: MyAppointment[], kind: Action) =>
  items.find((item) => item.changeableUntil && (kind === 'cancel' || item.type));

/**
 * The client's scheduled appointments, soonest first, then the two latest past ones. Each
 * upcoming row's menu has Reschedule and Cancel until the cutoff.
 */
export function UpcomingAppointments({
  slug,
  upcoming,
  past,
  notice,
  onNotice,
  request,
  onRequestDone,
  onViewAll,
}: {
  slug: string;
  upcoming: UseQueryResult<MyAppointment[]>;
  past: UseQueryResult<MyAppointment[]>;
  notice: Notice | null;
  onNotice: (notice: Notice | null) => void;
  request: ActionRequest | null;
  /** The row Quick Actions opened closed its panel, finished or failed. */
  onRequestDone: () => void;
  onViewAll: () => void;
}) {
  return (
    <Card variant="elevated" className="flex h-full flex-col">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-display text-xl font-bold text-heading 2xl:text-2xl">
          Upcoming Appointments
        </h2>
        <button
          type="button"
          onClick={onViewAll}
          className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold whitespace-nowrap text-link hover:underline"
        >
          View All <ArrowRight aria-hidden className="size-4" />
        </button>
      </div>
      {notice ? (
        <p
          role={notice.failed ? 'alert' : 'status'}
          className={`mb-2 text-sm font-medium ${notice.failed ? 'text-danger' : 'text-success'}`}
        >
          {notice.text}
        </p>
      ) : null}
      <PageState query={upcoming}>
        {(items) => {
          const recent = (past.data ?? []).slice(0, 2);
          return (
            <ul className="flex flex-col divide-y divide-border">
              {!items.length ? (
                <li className="py-4 text-sm text-muted">You have no upcoming appointments.</li>
              ) : null}
              {items.map((item) => (
                <Upcoming
                  key={item.id === request?.id ? `${item.id}-${request.n}` : item.id}
                  slug={slug}
                  item={item}
                  initialAction={item.id === request?.id ? request.kind : null}
                  onFinish={item.id === request?.id ? onRequestDone : undefined}
                  onNotice={onNotice}
                  onStale={(error) => {
                    onNotice({ text: errorMessage(error, APPOINTMENT_ERRORS), failed: true });
                    void upcoming.refetch();
                  }}
                />
              ))}
              {recent.map((item) => (
                <li key={item.id} data-testid="past-appointment" className="py-4">
                  <AppointmentRow item={item} />
                </li>
              ))}
            </ul>
          );
        }}
      </PageState>
    </Card>
  );
}

/** Every past appointment, newest first ("View All" and "View Appointment History"). */
export function AppointmentHistory({ past }: { past: UseQueryResult<MyAppointment[]> }) {
  return (
    <PageState query={past} empty="You have no past appointments yet.">
      {(items) => (
        <ul className="flex flex-col divide-y divide-border">
          {items.map((item) => (
            <li key={item.id} className="py-4">
              <AppointmentRow item={item} />
            </li>
          ))}
        </ul>
      )}
    </PageState>
  );
}

/** The mockup's row: date tile, title, time range, place, status, and the row menu. */
function AppointmentRow({
  item,
  menu,
  join = false,
}: {
  item: MyAppointment;
  menu?: ReactNode;
  /** Show the video join link (upcoming rows only). */
  join?: boolean;
}) {
  const tile = dateTile(item.startsAt);
  const status = statusOf(item);
  return (
    <div className="flex gap-4">
      <div className="flex w-16 shrink-0 flex-col items-center justify-center rounded-card bg-info-soft py-2 text-heading">
        <span className="text-xs font-semibold uppercase">{tile.month}</span>
        <span className="font-display text-2xl font-bold">{tile.day}</span>
        <span className="text-xs">{tile.weekday}</span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <div className="flex items-start justify-between gap-2">
          <p className="font-semibold text-heading">{item.type?.name ?? 'Appointment'}</p>
          <div className="flex shrink-0 items-center gap-1">
            <Badge tone={status.tone}>{status.label}</Badge>
            {menu}
          </div>
        </div>
        <p className="flex items-center gap-2 text-text">
          <Clock aria-hidden className="size-4 shrink-0 text-heading" />
          {timeRange(item.startsAt, item.endsAt)}
        </p>
        <Place item={item} join={join} />
      </div>
    </div>
  );
}

function Place({ item, join }: { item: MyAppointment; join: boolean }) {
  const details = item.locationDetails;
  const link = details?.startsWith('https://') ? details : null;
  const Icon =
    item.locationKind === 'VIDEO' ? Video : item.locationKind === 'PHONE' ? Phone : MapPin;
  const label =
    item.locationKind === 'VIDEO'
      ? 'Virtual'
      : item.locationKind === 'PHONE'
        ? 'Phone call'
        : (details ?? 'In person');
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-text">
      <Icon aria-hidden className="size-4 shrink-0 text-heading" />
      <span className="break-words">
        {label}
        {item.locationKind === 'PHONE' && details && !link ? ` · ${details}` : null}
        <span className="text-muted"> · with {item.staffName}</span>
      </span>
      {link && join ? (
        <a href={link} target="_blank" rel="noreferrer" className="break-all text-link">
          Join link
        </a>
      ) : null}
    </p>
  );
}

function Upcoming({
  slug,
  item,
  initialAction,
  onFinish,
  onNotice,
  onStale,
}: {
  slug: string;
  item: MyAppointment;
  /** Quick Actions asked for this row's Reschedule or Cancel: open it and bring it into view. */
  initialAction: Action | null;
  /** Quick Actions' panel on this row closed, finished or failed. */
  onFinish?: () => void;
  onNotice: (notice: Notice | null) => void;
  /** The cutoff passed or the firm changed it meanwhile: say why and refresh the list. */
  onStale: (error: unknown) => void;
}) {
  const [action, setAction] = useState<Action | null>(initialAction);
  const rowRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (initialAction) rowRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [initialAction]);
  const open = (next: Action) => {
    setAction(action === next ? null : next);
    if (action === next) onFinish?.();
    onNotice(null);
  };
  const done = (text: string) => () => {
    setAction(null);
    onFinish?.();
    onNotice({ text, failed: false });
  };
  const stale = (error: unknown) => {
    setAction(null);
    onFinish?.();
    onStale(error);
  };
  return (
    <li data-testid="my-appointment" ref={rowRef} className="flex flex-col gap-3 py-4">
      <AppointmentRow
        item={item}
        join
        menu={item.changeableUntil ? <RowMenu item={item} onChoose={open} /> : null}
      />
      {!item.changeableUntil ? (
        <p className="text-xs text-muted">To change this appointment, please contact us.</p>
      ) : null}
      {action === 'reschedule' && item.type ? (
        <Reschedule
          slug={slug}
          item={item}
          typeId={item.type.id}
          onDone={done('Your appointment was moved.')}
          onStale={stale}
        />
      ) : null}
      {action === 'cancel' ? (
        <Cancel
          slug={slug}
          id={item.id}
          onDone={done('Your appointment was cancelled.')}
          onStale={stale}
        />
      ) : null}
    </li>
  );
}

/**
 * The row's ⋮ menu: Reschedule and Cancel until the cutoff (only rows with a cutoff get one),
 * with the cutoff below the items. Arrow keys, Home and End move between items; Escape and a
 * choice return focus to the button.
 */
function RowMenu({ item, onChoose }: { item: MyAppointment; onChoose: (action: Action) => void }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };
  const choose = (action: Action) => {
    close();
    onChoose(action);
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === 'ArrowDown'
        ? (at + 1) % items.length
        : event.key === 'ArrowUp'
          ? (at - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };
  const itemClass =
    'flex w-full rounded-control px-3 py-2 text-left text-sm text-text hover:bg-canvas focus:bg-canvas';
  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) close();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label="Appointment actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        onClick={() => setOpen(!open)}
        className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-canvas"
      >
        <EllipsisVertical aria-hidden className="size-5" />
      </button>
      {open ? (
        <div className="absolute top-full right-0 z-10 mt-1 w-64 rounded-card border border-border bg-surface p-2 shadow-lg">
          <div
            ref={menuRef}
            id={`${id}-menu`}
            role="menu"
            aria-label="Appointment actions"
            aria-describedby={`${id}-note`}
            onKeyDown={move}
            className="flex flex-col"
          >
            {/* Free times are per kind of appointment: one without a kind can only be cancelled. */}
            {item.type ? (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={itemClass}
                onClick={() => choose('reschedule')}
              >
                Reschedule
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className={itemClass}
              onClick={() => choose('cancel')}
            >
              Cancel
            </button>
          </div>
          <p id={`${id}-note`} className="px-3 py-2 text-xs text-muted">
            {item.changeableUntil && item.type
              ? `You can change this online until ${when(item.changeableUntil)}.`
              : `You can cancel this online until ${when(item.changeableUntil ?? item.startsAt)}. To move it, please contact us.`}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function Reschedule({
  slug,
  item,
  typeId,
  onDone,
  onStale,
}: {
  slug: string;
  item: MyAppointment;
  typeId: string;
  onDone: () => void;
  onStale: (error: unknown) => void;
}) {
  const [first] = useState(today);
  // Start at the appointment's own day (the client's calendar date), never before today.
  const [date, setDate] = useState(() => {
    const day = new Intl.DateTimeFormat('en-CA').format(new Date(item.startsAt));
    return day < first ? first : day;
  });
  const [picked, setPicked] = useState<MySlot | null>(null);
  const [round, setRound] = useState(0);
  const move = useApiMutation(
    (slot: MySlot) => api.myAppointments(slug).reschedule(item.id, { startsAt: slot.startsAt }),
    { invalidate: myAppointmentsKey(slug) },
  );
  return (
    <div className="flex flex-col items-start gap-3 rounded-card border border-border bg-canvas p-4">
      <FreeTimes
        slug={slug}
        typeId={typeId}
        excludeAppointmentId={item.id}
        current={item.startsAt}
        date={date}
        min={firstDay(first)}
        picked={picked}
        round={round}
        onDate={(next) => {
          setDate(next);
          setPicked(null);
          move.reset();
        }}
        onPick={setPicked}
      />
      <Button
        disabled={!picked || move.isPending}
        onClick={() =>
          picked &&
          move.mutate(picked, {
            onSuccess: onDone,
            onError: (error) => {
              const code = errorCode(error) ?? '';
              if (STALE.has(code)) return onStale(error);
              if (!TAKEN.has(code)) return;
              setPicked(null);
              setRound(round + 1);
            },
          })
        }
      >
        {move.isPending
          ? 'Moving…'
          : picked
            ? `Move to ${when(picked.startsAt)}`
            : 'Pick a new time'}
      </Button>
      {move.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(move.error, APPOINTMENT_ERRORS)}
        </p>
      ) : null}
    </div>
  );
}

function Cancel({
  slug,
  id,
  onDone,
  onStale,
}: {
  slug: string;
  id: string;
  onDone: () => void;
  onStale: (error: unknown) => void;
}) {
  const form = useForm({
    resolver: zodResolver(CancelMyAppointmentRequest),
    defaultValues: { reason: '' },
  });
  const cancel = useApiMutation(
    (body: CancelMyAppointmentRequest) => api.myAppointments(slug).cancel(id, body),
    { invalidate: myAppointmentsKey(slug) },
  );
  return (
    <form
      onSubmit={form.handleSubmit((body) =>
        cancel.mutate(body, {
          onSuccess: onDone,
          onError: (error) => (STALE.has(errorCode(error) ?? '') ? onStale(error) : undefined),
        }),
      )}
      noValidate
      className="flex flex-col items-start gap-3 rounded-card border border-border bg-canvas p-4"
    >
      <div className="w-full">
        <Input
          label="Reason (optional)"
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
      </div>
      <Button type="submit" disabled={cancel.isPending}>
        {cancel.isPending ? 'Cancelling…' : 'Cancel this appointment'}
      </Button>
      {cancel.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(cancel.error, APPOINTMENT_ERRORS)}
        </p>
      ) : null}
    </form>
  );
}
