'use client';

import type { ComplianceCalendarDiff, ComplianceCalendarRow } from '@firmivra/types';
import { ActionMenu, Badge, Button, type Column, Input, Modal, Table, Toast } from '@firmivra/ui';
import {
  Archive,
  ArrowCounterClockwise,
  CheckCircle,
  DotsThreeVertical,
  Eye,
  GitDiff,
  Trash,
  UploadSimple,
  Warning,
} from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { DiffView } from './calendar-import';
import {
  COMPLIANCE_ERRORS,
  COMPLIANCE_KEY,
  FAMILY_LABEL,
  Selectbox,
  TYPE_LABEL,
  TYPE_OPTIONS,
  dayText,
  quiet,
  subtle,
} from './compliance-shared';

const TONE = {
  DRAFT: 'neutral',
  VERIFIED: 'info',
  PUBLISHED: 'success',
  SUPERSEDED: 'neutral',
  ARCHIVED: 'neutral',
} as const;
const frame = 'min-w-0 rounded-xl bg-surface p-4 shadow-md';

/** The "Calendar Library" tab: every version of every calendar, with verify, publish, rollback and compare. */
export function CalendarLibrary() {
  const [status, setStatus] = useState('');
  const [family, setFamily] = useState('');
  const [openId, setOpenId] = useState<string>();
  const [compare, setCompare] = useState<{ id: string; other: string } | null>(null);
  const [diff, setDiff] = useState<ComplianceCalendarDiff>();
  const [message, setMessage] = useState<{ text: string; tone: 'success' | 'error' }>();
  const list = useApiQuery([...COMPLIANCE_KEY, 'calendars', 'library', status, family], () =>
    api.compliance.calendars({
      ...(status ? { status: status as ComplianceCalendarRow['status'] } : {}),
      ...(family ? { family: family as ComplianceCalendarRow['family'] } : {}),
      pageSize: 50,
    }),
  );
  const rows = list.data?.items ?? [];
  const options = { invalidate: [...COMPLIANCE_KEY] };
  const done = (text: string) => () => setMessage({ text, tone: 'success' });
  const fail = (e: unknown) =>
    setMessage({ text: errorMessage(e, COMPLIANCE_ERRORS), tone: 'error' });
  const verify = useApiMutation((id: string) => api.compliance.verifyCalendar(id), options);
  const publish = useApiMutation((id: string) => api.compliance.publishCalendar(id), options);
  const rollback = useApiMutation((id: string) => api.compliance.rollbackCalendar(id), options);
  const archive = useApiMutation((id: string) => api.compliance.archiveCalendar(id), options);
  const compareNow = useApiMutation(
    (v: { id: string; other: string }) => api.compliance.compareCalendars(v.id, v.other),
    {},
  );

  const columns: Column<ComplianceCalendarRow>[] = [
    {
      id: 'name',
      label: 'Calendar',
      cell: (c) => <span className="font-medium text-heading">{c.name}</span>,
    },
    { id: 'family', label: 'Family', cell: (c) => FAMILY_LABEL[c.family] },
    { id: 'authority', label: 'Authority', cell: (c) => c.authority },
    { id: 'year', label: 'Year', cell: (c) => `${c.effectiveYear} · v${c.version}` },
    {
      id: 'status',
      label: 'Status',
      cell: (c) => (
        <Badge tone={TONE[c.status]}>{c.status.charAt(0) + c.status.slice(1).toLowerCase()}</Badge>
      ),
    },
    {
      id: 'verified',
      label: 'Last Verified',
      cell: (c) =>
        c.verifiedAt ? (
          <span className={c.stale ? 'font-semibold text-warning' : ''}>
            {dayText(c.verifiedAt.slice(0, 10))}
            {c.stale ? ' (stale)' : ''}
          </span>
        ) : (
          'Not verified'
        ),
    },
    {
      id: 'entries',
      label: 'Records',
      cell: (c) => (
        <span>
          {c.entryCount}
          {c.needsVerificationCount ? (
            <span className="ml-1 text-xs text-warning">
              {c.needsVerificationCount} need verification
            </span>
          ) : null}
        </span>
      ),
    },
  ];
  const menu = (c: ComplianceCalendarRow) => {
    const item = (label: string, icon: typeof Eye, onSelect: () => void, danger?: boolean) => ({
      label,
      icon,
      onSelect,
      ...(danger ? { danger } : {}),
    });
    return [
      {
        items: [
          item('Open', Eye, () => setOpenId(c.id)),
          ...(c.status === 'DRAFT'
            ? [
                item('Verify', CheckCircle, () =>
                  verify.mutate(c.id, { onSuccess: done(`${c.name} verified.`), onError: fail }),
                ),
              ]
            : []),
          ...(c.status === 'VERIFIED'
            ? [
                item('Publish', UploadSimple, () =>
                  publish.mutate(c.id, { onSuccess: done(`${c.name} published.`), onError: fail }),
                ),
              ]
            : []),
          ...(c.status === 'PUBLISHED'
            ? [
                item('Roll Back', ArrowCounterClockwise, () =>
                  rollback.mutate(c.id, {
                    onSuccess: done('Rolled back to the earlier version.'),
                    onError: fail,
                  }),
                ),
              ]
            : []),
          item('Compare Versions', GitDiff, () => {
            setCompare({ id: c.id, other: '' });
            setDiff(undefined);
          }),
          ...(c.status !== 'PUBLISHED' && c.status !== 'ARCHIVED'
            ? [
                item(
                  'Archive',
                  Archive,
                  () =>
                    archive.mutate(c.id, { onSuccess: done(`${c.name} archived.`), onError: fail }),
                  true,
                ),
              ]
            : []),
        ],
      },
    ];
  };
  const stale = rows.filter((c) => c.stale && c.status === 'PUBLISHED');
  const compareChoices = rows.filter((c) => c.id !== compare?.id);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="calendar-library">
      {message ? (
        <Toast message={message.text} tone={message.tone} onDismiss={() => setMessage(undefined)} />
      ) : null}
      <section className={frame} aria-label="Calendar Library">
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <div className="w-44">
            <Selectbox
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: 'All Statuses' },
                ...(['DRAFT', 'VERIFIED', 'PUBLISHED', 'SUPERSEDED', 'ARCHIVED'] as const).map(
                  (v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase() }),
                ),
              ]}
            />
          </div>
          <div className="w-56">
            <Selectbox
              label="Family"
              value={family}
              onChange={setFamily}
              options={[
                { value: '', label: 'All Families' },
                ...(Object.keys(FAMILY_LABEL) as (keyof typeof FAMILY_LABEL)[]).map((v) => ({
                  value: v,
                  label: FAMILY_LABEL[v],
                })),
              ]}
            />
          </div>
        </div>
        {stale.length > 0 ? (
          <p
            role="status"
            className="mb-3 flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning"
          >
            <Warning aria-hidden weight="fill" className="mt-0.5 size-4 shrink-0" />
            {stale.length} published calendar(s) were verified a long time ago. Check the official
            source and verify them again.
          </p>
        ) : null}
        <div className="relative">
          <Table
            rows={rows}
            columns={columns}
            rowKey={(c) => c.id}
            caption="Calendar library"
            dense
            noun="calendars"
            pageSize={50}
            loading={list.isPending}
            emptyTitle={list.isError ? 'The library is not available' : 'No calendars yet'}
            emptyText={
              list.isError
                ? 'We could not load the library. Try again in a moment.'
                : 'Import a government calendar to start the library.'
            }
            rowActions={(c) => (
              <ActionMenu
                label={`Actions for ${c.name}`}
                sections={menu(c)}
                trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
              />
            )}
          />
        </div>
      </section>
      {openId ? <CalendarDetail id={openId} onClose={() => setOpenId(undefined)} /> : null}
      {compare ? (
        <Modal
          open
          title="Compare Versions"
          subtitle="Choose the calendar to compare with."
          onClose={() => setCompare(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCompare(null)}>
                Close
              </Button>
              <Button
                disabled={!compare.other || compareNow.isPending}
                onClick={() => compareNow.mutate(compare, { onSuccess: setDiff, onError: fail })}
              >
                Compare
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Selectbox
              label="Compare with"
              value={compare.other}
              onChange={(other) => setCompare({ ...compare, other })}
              options={[
                { value: '', label: 'Choose a calendar' },
                ...compareChoices.map((c) => ({ value: c.id, label: `${c.name} (v${c.version})` })),
              ]}
            />
            {diff ? <DiffView diff={diff} /> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function CalendarDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const cal = useApiQuery([...COMPLIANCE_KEY, 'calendar', id], () =>
    api.compliance.getCalendar(id),
  );
  const c = cal.data;
  const [name, setName] = useState('');
  const [type, setType] = useState<keyof typeof TYPE_LABEL>('TAX_FILING');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string>();
  const options = { invalidate: [...COMPLIANCE_KEY] };
  const add = useApiMutation(
    () =>
      api.compliance.addEntry(id, { ruleKind: 'FIXED_DATE', name: name.trim(), type, dueOn: due }),
    options,
  );
  const drop = useApiMutation(
    (entryId: string) => api.compliance.deleteEntry(id, entryId),
    options,
  );
  const draft = c?.status === 'DRAFT';
  return (
    <section className={frame} aria-label="Calendar records" data-testid="calendar-detail">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-heading">{c?.name ?? 'Calendar'}</h2>
          {c ? (
            <p className="text-sm text-muted">
              {c.authority} · {c.effectiveYear} · v{c.version} ·{' '}
              <a
                href={c.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-link underline"
              >
                Official source<span className="sr-only"> (opens the official page)</span>
              </a>
              {c.retrievedAt ? ` · Retrieved ${dayText(c.retrievedAt.slice(0, 10))}` : ''}
            </p>
          ) : (
            <p className="text-sm text-muted">
              {cal.isError ? 'This calendar is not available right now.' : 'Loading…'}
            </p>
          )}
        </div>
        <button type="button" className={subtle} onClick={onClose}>
          Close
        </button>
      </header>
      {c && c.entries.length === 0 ? <p className={quiet}>This calendar has no records.</p> : null}
      {c && c.entries.length > 0 ? (
        <div className="relative overflow-x-auto rounded-lg border border-divider">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Calendar records</caption>
            <thead className="bg-table-head text-heading">
              <tr>
                <th className="px-3 py-2 font-semibold">Deadline</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Form</th>
                <th className="px-3 py-2 font-semibold">Date rule</th>
                {draft ? <th className="px-3 py-2 text-right font-semibold">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {c.entries.map((e) => (
                <tr key={e.id} className="border-t border-divider">
                  <td className="px-3 py-2 font-medium text-heading">{e.name}</td>
                  <td className="px-3 py-2">{TYPE_LABEL[e.type]}</td>
                  <td className="px-3 py-2">{e.form ?? '—'}</td>
                  <td className="px-3 py-2">
                    {e.ruleKind === 'FIXED_DATE' && e.dueOn ? (
                      dayText(e.dueOn)
                    ) : e.ruleKind === 'FORMULA' && e.rule ? (
                      `${e.rule.monthsAfterYearEnd} month(s) after year end, day ${e.rule.day}`
                    ) : (
                      <Badge tone="warning">Needs verification</Badge>
                    )}
                  </td>
                  {draft ? (
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        aria-label={`Delete ${e.name}`}
                        onClick={() => drop.mutate(e.id)}
                        className="text-muted hover:text-danger"
                      >
                        <Trash aria-hidden weight="fill" className="size-4" />
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {draft ? (
        <form
          className="mt-3 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !due) return setError('Give the record a name and a date');
            setError(undefined);
            add.mutate(undefined, {
              onSuccess: () => {
                setName('');
                setDue('');
              },
              onError: (err) => setError(errorMessage(err, COMPLIANCE_ERRORS)),
            });
          }}
        >
          <div className="min-w-48 flex-1">
            <Input
              label="New record name"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="w-44">
            <Selectbox
              label="New record type"
              value={type}
              onChange={(v) => setType(v as typeof type)}
              options={TYPE_OPTIONS}
            />
          </div>
          <Input
            label="Due date"
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
          />
          <Button type="submit" disabled={add.isPending}>
            Add Record
          </Button>
          {error ? (
            <p role="alert" className="w-full text-sm text-danger">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
