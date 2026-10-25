'use client';

import {
  SaveStaffJobTitleRequest,
  SaveStaffWorkScheduleRequest,
  type StaffJobTitle,
  type StaffWorkSchedule,
} from '@firmivra/types';
import { Badge, Button, Checkbox, Input, Skeleton } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft,
  Briefcase,
  Buildings,
  CalendarCheck,
  type Icon,
  Info,
  MapPin,
  PlusCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, createElement, useState } from 'react';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { NOT_LOADED } from '../../../_components/quiet-card';

/** A change refetches every staff query: the saved lists and the form options. */
const STAFF = ['staff'];

/** One saved name: a job title or a work schedule (the two contracts have the same shape). */
type Saved = StaffJobTitle | StaffWorkSchedule;
type SaveName = SaveStaffJobTitleRequest;

/** What differs between the Job Titles and Work Schedules cards. */
interface SavedKind {
  key: string[];
  testId: string;
  /** Singular, for the row, name and input test ids: `job-title` or `work-schedule`. */
  item: string;
  title: string;
  subtitle: string;
  icon: Icon;
  /** Plural in lower case, for "Show archived …". */
  plural: string;
  addLabel: string;
  addButton: string;
  placeholder: string;
  empty: string;
  note: string;
  errors: Record<string, string>;
  schema: typeof SaveStaffJobTitleRequest | typeof SaveStaffWorkScheduleRequest;
  list: () => Promise<Saved[]>;
  create: (body: SaveName) => Promise<Saved>;
  rename: (id: string, body: SaveName) => Promise<Saved>;
  archive: (id: string) => Promise<Saved>;
  restore: (id: string) => Promise<Saved>;
}

const JOB_TITLES: SavedKind = {
  key: ['staff', 'job-titles', 'all'],
  testId: 'job-titles',
  item: 'job-title',
  title: 'Job Titles',
  subtitle:
    'Saved titles are offered in Create Staff and Edit Staff. A staff member can still be given a title that is not on this list.',
  icon: Briefcase,
  plural: 'titles',
  addLabel: 'New job title',
  addButton: 'Add Job Title',
  placeholder: 'e.g., Senior Tax Preparer',
  empty: 'No saved job titles yet. Add the titles your firm uses.',
  note: 'Renaming or archiving a title changes no staff record: each keeps the title it has.',
  errors: {
    JOB_TITLE_EXISTS: 'Your firm already has a job title with this name.',
    JOB_TITLE_ARCHIVED: 'Restore this job title before renaming it.',
  },
  schema: SaveStaffJobTitleRequest,
  list: () => api.staff.jobTitles(true),
  create: (body) => api.staff.createJobTitle(body),
  rename: (id, body) => api.staff.renameJobTitle(id, body),
  archive: (id) => api.staff.archiveJobTitle(id),
  restore: (id) => api.staff.restoreJobTitle(id),
};

// Octavia's SM8: company-defined schedules, offered after the standard ones.
const WORK_SCHEDULES: SavedKind = {
  key: ['staff', 'work-schedules', 'all'],
  testId: 'work-schedules',
  item: 'work-schedule',
  title: 'Work Schedules',
  subtitle:
    'Saved schedules are offered in Create Staff and Edit Staff after the standard ones. A staff member can still be given a custom schedule.',
  icon: CalendarCheck,
  plural: 'schedules',
  addLabel: 'New work schedule',
  addButton: 'Add Work Schedule',
  placeholder: 'e.g., Mon-Thu, 10-hour days',
  empty: 'No saved work schedules yet. Add the schedules your firm uses.',
  note: 'Renaming or archiving a schedule changes no staff record: each keeps the schedule it has.',
  errors: {
    WORK_SCHEDULE_EXISTS: 'Your firm already has a work schedule with this name.',
    WORK_SCHEDULE_ARCHIVED: 'Restore this work schedule before renaming it.',
  },
  schema: SaveStaffWorkScheduleRequest,
  list: () => api.staff.workSchedules(true),
  create: (body) => api.staff.createWorkSchedule(body),
  rename: (id, body) => api.staff.renameWorkSchedule(id, body),
  archive: (id) => api.staff.archiveWorkSchedule(id),
  restore: (id) => api.staff.restoreWorkSchedule(id),
};

const quiet = 'rounded-lg bg-subtle p-4 text-sm text-muted';

function Panel({
  title,
  subtitle,
  icon,
  testId,
  className = '',
  children,
}: {
  title: string;
  subtitle: string;
  icon: Icon;
  testId: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-testid={testId}
      className={`flex min-w-0 flex-col gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm ${className}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-info-soft text-info"
        >
          {createElement(icon, { weight: 'fill', className: 'size-6' })}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-heading">{title}</h2>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function AddForm({ kind }: { kind: SavedKind }) {
  const form = useForm<SaveName>({
    resolver: zodResolver(kind.schema),
    defaultValues: { name: '' },
  });
  const create = useApiMutation(kind.create, { invalidate: STAFF });
  return (
    <form
      onSubmit={form.handleSubmit((body) => create.mutate(body, { onSuccess: () => form.reset() }))}
      className="flex flex-col gap-2 sm:flex-row sm:items-end"
    >
      <div className="min-w-0 flex-1">
        <Input
          label={kind.addLabel}
          placeholder={kind.placeholder}
          data-testid={`new-${kind.item}`}
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
      </div>
      <Button type="submit" disabled={create.isPending}>
        <PlusCircle aria-hidden weight="fill" className="size-5" />
        {create.isPending ? 'Adding…' : kind.addButton}
      </Button>
      {create.error ? (
        <p role="alert" className="text-sm text-danger sm:w-full">
          {errorMessage(create.error, kind.errors)}
        </p>
      ) : null}
    </form>
  );
}

const staffLine = (n: number) =>
  n === 0 ? 'No staff records' : `${n} staff record${n === 1 ? '' : 's'}`;

function SavedRow({ kind, row }: { kind: SavedKind; row: Saved }) {
  const [editing, setEditing] = useState(false);
  const form = useForm<SaveName>({
    resolver: zodResolver(kind.schema),
    defaultValues: { name: row.name },
  });
  const rename = useApiMutation((body: SaveName) => kind.rename(row.id, body), {
    invalidate: STAFF,
  });
  const archive = useApiMutation(kind.archive, { invalidate: STAFF });
  const restore = useApiMutation(kind.restore, { invalidate: STAFF });
  const error = archive.error ?? restore.error;
  const archived = row.archivedAt !== null;

  if (editing) {
    return (
      <li data-testid={`${kind.item}-row`} className="p-3">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={form.handleSubmit((body) =>
            rename.mutate(body, { onSuccess: () => setEditing(false) }),
          )}
        >
          <div className="min-w-0 flex-1">
            <Input
              label={`New name for ${row.name}`}
              error={form.formState.errors.name?.message}
              {...form.register('name')}
            />
          </div>
          <Button type="submit" disabled={rename.isPending}>
            Save
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              form.reset({ name: row.name });
              setEditing(false);
            }}
          >
            Cancel
          </Button>
          {rename.error ? (
            <p role="alert" className="w-full text-sm text-danger">
              {errorMessage(rename.error, kind.errors)}
            </p>
          ) : null}
        </form>
      </li>
    );
  }
  return (
    <li data-testid={`${kind.item}-row`} className="flex flex-wrap items-center gap-2 p-3">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2">
          <span data-testid={`${kind.item}-name`} className="text-sm font-semibold text-heading">
            {row.name}
          </span>
          {archived ? <Badge>Archived</Badge> : null}
        </span>
        <span className="text-xs text-muted">{staffLine(row.staffCount)}</span>
      </div>
      {archived ? (
        <Button
          variant="secondary"
          aria-label={`Restore ${row.name}`}
          disabled={restore.isPending}
          onClick={() => restore.mutate(row.id)}
        >
          Restore
        </Button>
      ) : (
        <>
          <Button
            variant="ghost"
            aria-label={`Rename ${row.name}`}
            onClick={() => setEditing(true)}
          >
            Rename
          </Button>
          <Button
            variant="secondary"
            aria-label={`Archive ${row.name}`}
            disabled={archive.isPending}
            onClick={() => archive.mutate(row.id)}
          >
            Archive
          </Button>
        </>
      )}
      {error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {errorMessage(error, kind.errors)}
        </p>
      ) : null}
    </li>
  );
}

function SavedList({ kind }: { kind: SavedKind }) {
  const [showArchived, setShowArchived] = useState(false);
  const saved = useApiQuery(kind.key, kind.list);
  const rows = saved.data ?? [];
  const live = rows.filter((t) => t.archivedAt === null);
  const archived = rows.filter((t) => t.archivedAt !== null);
  const shown = showArchived ? [...live, ...archived] : live;

  return (
    <Panel
      title={kind.title}
      subtitle={kind.subtitle}
      icon={kind.icon}
      testId={kind.testId}
      className="min-[1440px]:col-span-2"
    >
      <AddForm kind={kind} />
      {saved.isPending ? (
        <Skeleton className="h-32" />
      ) : saved.data === undefined ? (
        <p className={quiet}>{NOT_LOADED}</p>
      ) : (
        <>
          {archived.length ? (
            <Checkbox
              label={`Show archived ${kind.plural} (${archived.length})`}
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
              className="text-sm"
            />
          ) : null}
          {shown.length ? (
            <ul className="flex flex-col divide-y divide-divider rounded-lg border border-divider">
              {shown.map((row) => (
                <SavedRow key={row.id} kind={kind} row={row} />
              ))}
            </ul>
          ) : (
            <p className={quiet}>{kind.empty}</p>
          )}
        </>
      )}
      <p className="flex items-start gap-2 text-xs text-muted">
        <Info aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
        {kind.note}
      </p>
    </Panel>
  );
}

function Offices() {
  const options = useApiQuery(['staff', 'options'], () => api.staff.options());
  return (
    <Panel
      title="Offices"
      subtitle="Your firm's active locations, offered as Office / Branch when you create or edit staff."
      icon={Buildings}
      testId="offices"
    >
      {options.isPending ? (
        <Skeleton className="h-24" />
      ) : options.data === undefined ? (
        <p className={quiet}>{NOT_LOADED}</p>
      ) : options.data.offices.length ? (
        <ul className="flex flex-col divide-y divide-divider rounded-lg border border-divider">
          {options.data.offices.map((name) => (
            <li
              key={name}
              data-testid="office-row"
              className="flex items-center gap-2 p-3 text-sm font-semibold text-heading"
            >
              <MapPin aria-hidden weight="fill" className="size-4 shrink-0 text-muted" />
              {name}
            </li>
          ))}
        </ul>
      ) : (
        <p className={quiet}>No active locations yet.</p>
      )}
      <p className="flex items-start gap-2 text-xs text-muted">
        <Info aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
        Offices come from your firm&apos;s locations (Location Management), so the two always match.
        A staff record keeps the office it has.
      </p>
    </Panel>
  );
}

/**
 * Staff Settings > Offices & Job Titles (`/team/settings/offices-titles`, Octavia's SM3, SM8 and
 * SM11): the firm's saved job titles and work schedules, added, renamed, archived and restored
 * here, and its offices as Location Management has them. Owner and Admin.
 */
export function OfficesTitlesScreen() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link
          href="/team/settings"
          className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
        >
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back to Staff Settings
        </Link>
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <Briefcase aria-hidden weight="fill" className="size-9" />
          </span>
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              Offices &amp; Job Titles
            </h1>
            <p className="text-base text-link">
              The job titles, work schedules and offices your staff records choose from.
            </p>
          </div>
        </div>
      </header>
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <SavedList kind={JOB_TITLES} />
        <Offices />
        <SavedList kind={WORK_SCHEDULES} />
      </div>
    </div>
  );
}
