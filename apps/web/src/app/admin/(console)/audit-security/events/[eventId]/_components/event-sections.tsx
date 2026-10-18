'use client';

import { Avatar, Badge, Button, Card, IconButton, Table, Textarea } from '@firmivra/ui';
import {
  Check,
  ClipboardText,
  Clock,
  Copy,
  Database,
  Desktop,
  DeviceMobile,
  GitDiff,
  LinkSimple,
  ListChecks,
  MapPin,
  NotePencil,
  User,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import {
  adminAuditSecurity,
  type AuditActor,
  type AuditEventDetail,
  type AuditTone,
} from '../../../../../../../mocks/admin-audit-security';
import {
  AccountBadge,
  CATEGORY_LABELS,
  FactTable,
  formatClock,
  formatDate,
  formatShortStamp,
  formatStamp,
  LinkButton,
  Loaded,
  OutcomeBadge,
  Panel,
  QuietLine,
  SeverityBadge,
} from '../../../_components/audit-parts';

/** The tab panels of the event details page (both designs; docx §3, Page B). */

type DetailQuery = UseQueryResult<AuditEventDetail>;

const eventHref = (id: string) => `/audit-security/events/${id}`;
const approximate = (location: string | null) =>
  location ? `${location} (Approximate)` : 'Not available';

/** A small copy button after an id (Event ID, Session ID, Request ID). */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconButton
      icon={copied ? Check : Copy}
      label={copied ? 'Copied' : label}
      tone="action"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        });
      }}
    />
  );
}

/** Label and value rows without bands (the overview's two columns). */
function InfoList({ rows }: { rows: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="flex min-w-0 flex-col gap-3 text-sm">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-5 items-start gap-3">
          <dt className="col-span-2 text-text">{row.label}</dt>
          <dd className="col-span-3 min-w-0 wrap-anywhere text-heading">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Person({ actor }: { actor: AuditActor }) {
  return (
    <span className="flex items-center gap-3">
      <Avatar name={actor.name} size="lg" />
      <span className="min-w-0">
        <span className="block font-semibold text-heading">{actor.name}</span>
        <span className="block text-muted">{actor.role}</span>
      </span>
    </span>
  );
}

function Frame({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Card data-testid={testId} className="flex min-w-0 flex-col gap-3 p-5!">
      <h2 className="text-lg font-bold text-heading">{title}</h2>
      {children}
    </Card>
  );
}

export function OverviewTab({ query }: { query: DetailQuery }) {
  return (
    <div className="flex flex-col gap-5">
      <Frame title="Event Information" testId="event-information">
        <Loaded query={query} rows={6}>
          {({ event, account }) => {
            const { device } = event;
            const own = account?.userId === event.actor.id ? account : null;
            return (
              <div className="grid gap-x-8 gap-y-3 md:grid-cols-2">
                <InfoList
                  rows={[
                    { label: 'User', value: <Person actor={event.actor} /> },
                    { label: 'Firm', value: event.firm.name },
                    {
                      label: 'Date & Time',
                      value: <time dateTime={event.at}>{formatStamp(event.at)}</time>,
                    },
                    {
                      label: 'IP Address',
                      value: (
                        <span className="flex items-start gap-2">
                          <MapPin
                            aria-hidden
                            weight="fill"
                            className="mt-0.5 size-4 shrink-0 text-muted"
                          />
                          <span>
                            {device.ip ?? 'Not recorded'}
                            {device.location ? (
                              <span className="block">{device.location}</span>
                            ) : null}
                          </span>
                        </span>
                      ),
                    },
                    {
                      label: 'Device',
                      value: (
                        <span className="flex items-center gap-2">
                          {device.mobile ? (
                            <DeviceMobile
                              aria-hidden
                              weight="fill"
                              className="size-4 shrink-0 text-muted"
                            />
                          ) : (
                            <Desktop
                              aria-hidden
                              weight="fill"
                              className="size-4 shrink-0 text-muted"
                            />
                          )}
                          {device.label}
                        </span>
                      ),
                    },
                    { label: 'Browser / OS', value: `${device.browser} / ${device.os}` },
                    { label: 'Auth Method', value: event.authMethod ?? 'Not applicable' },
                    { label: 'Source', value: event.source },
                  ]}
                />
                <InfoList
                  rows={[
                    { label: 'Action Type', value: event.action },
                    { label: 'Category', value: CATEGORY_LABELS[event.category] },
                    { label: 'Severity', value: <SeverityBadge severity={event.severity} /> },
                    ...event.facts.map((fact) => ({ label: fact.label, value: fact.value })),
                    ...(own
                      ? [
                          { label: 'Account Status', value: <AccountBadge status={own.status} /> },
                          {
                            label: 'MFA Enabled',
                            value: (
                              <Badge tone={own.mfaEnabled ? 'success' : 'danger'}>
                                {own.mfaEnabled ? 'Yes' : 'No'}
                              </Badge>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </div>
            );
          }}
        </Loaded>
      </Frame>

      <Frame title="Event Description" testId="event-description">
        <Loaded query={query} rows={2}>
          {({ event }) => <p className="text-sm text-text">{event.description}</p>}
        </Loaded>
      </Frame>

      <Frame title="Additional Details" testId="event-additional">
        <Loaded query={query} rows={5}>
          {({ event }) => (
            <InfoList
              rows={[
                {
                  label: 'Referrer URL',
                  value: <span className="text-link">{event.referrerUrl ?? 'Not recorded'}</span>,
                },
                {
                  label: 'Session ID',
                  value: event.sessionId ? (
                    <span className="flex items-center gap-1 text-link">
                      <span className="min-w-0 wrap-anywhere">{event.sessionId}</span>
                      <CopyButton value={event.sessionId} label="Copy session ID" />
                    </span>
                  ) : (
                    'Not recorded'
                  ),
                },
                { label: 'User Agent', value: event.device.userAgent ?? 'Not applicable' },
                { label: 'Geolocation', value: approximate(event.device.location) },
                {
                  label: 'Request ID',
                  value: (
                    <span className="flex items-center gap-1">
                      <span className="min-w-0 wrap-anywhere">{event.requestId}</span>
                      <CopyButton value={event.requestId} label="Copy request ID" />
                    </span>
                  ),
                },
              ]}
            />
          )}
        </Loaded>
      </Frame>
    </div>
  );
}

export function AffectedDataTab({ query }: { query: DetailQuery }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel title="Affected Resource" icon={Database} testId="affected-resource">
        <Loaded query={query} rows={4}>
          {({ event }) => (
            <>
              <FactTable
                rows={[
                  { label: 'Resource Type', value: event.target.type },
                  { label: 'Resource ID', value: event.target.id },
                  { label: 'Resource Name', value: event.target.name },
                  { label: 'Related Record', value: event.target.relatedRecord ?? 'N/A' },
                ]}
              />
              {event.target.href ? (
                <Link
                  href={event.target.href}
                  className="text-sm font-semibold text-link hover:underline"
                >
                  Open the related record
                </Link>
              ) : null}
            </>
          )}
        </Loaded>
      </Panel>

      <Panel title="Changes" icon={GitDiff} testId="event-changes">
        <Loaded query={query} rows={3}>
          {({ event }) =>
            event.changes.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Field changes</caption>
                  <thead className="bg-table-head text-text">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Field
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        Before
                      </th>
                      <th scope="col" className="px-3 py-2 font-semibold">
                        After
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {event.changes.map((change) => (
                      <tr key={change.field} className="border-b border-divider">
                        <th scope="row" className="px-3 py-2 font-medium text-heading">
                          {change.field}
                          {change.masked ? (
                            <span className="ml-2">
                              <Badge>Masked</Badge>
                            </span>
                          ) : null}
                        </th>
                        <td className="px-3 py-2 text-text">{change.before ?? '—'}</td>
                        <td className="px-3 py-2 text-text">{change.after ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <QuietLine>No field changes were recorded for this event.</QuietLine>
            )
          }
        </Loaded>
      </Panel>

      <Panel title="User Information" icon={User} testId="user-information">
        <Loaded query={query} rows={5}>
          {({ event, account }) => {
            const own = account?.userId === event.actor.id ? account : null;
            return (
              <FactTable
                rows={[
                  { label: 'Name', value: event.actor.name },
                  {
                    label: event.actor.type === 'USER' ? 'Email' : 'Type',
                    value:
                      event.actor.email ??
                      (event.actor.type === 'SERVICE' ? 'Service account' : 'Firmivra system'),
                  },
                  { label: 'Role', value: event.actor.role },
                  { label: 'Firm', value: event.firm.name },
                  ...(own
                    ? [
                        { label: 'Account Status', value: <AccountBadge status={own.status} /> },
                        {
                          label: 'Last Successful Login',
                          value: own.lastSuccessfulLoginAt
                            ? formatShortStamp(own.lastSuccessfulLoginAt, true)
                            : 'Never',
                        },
                      ]
                    : []),
                ]}
              />
            );
          }}
        </Loaded>
      </Panel>

      <Panel title="Device & Location" icon={Desktop} testId="device-location">
        <Loaded query={query} rows={5}>
          {({ event }) => (
            <FactTable
              rows={[
                { label: 'IP Address', value: event.device.ip ?? 'Not recorded' },
                { label: 'Location', value: approximate(event.device.location) },
                { label: 'Device', value: event.device.label },
                { label: 'Operating System', value: event.device.os },
                { label: 'Browser', value: event.device.browser },
                { label: 'User Agent', value: event.device.userAgent ?? 'Not applicable' },
              ]}
            />
          )}
        </Loaded>
      </Panel>
    </div>
  );
}

const DOTS: Record<AuditTone, string> = {
  danger: 'bg-danger',
  warning: 'bg-gold',
  info: 'bg-action',
  success: 'bg-success',
};

export function TimelineTab({ query }: { query: DetailQuery }) {
  return (
    <Panel title="Event Timeline" icon={Clock} testId="event-timeline">
      <Loaded query={query} rows={5}>
        {({ event }) => {
          const day = formatDate(event.at);
          return (
            <ol aria-label="Event timeline" className="ml-2 border-l-2 border-folder-border">
              {[...event.timeline]
                .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
                .map((entry) => (
                  <li
                    key={entry.id}
                    className="relative grid grid-cols-5 gap-3 border-b border-divider py-2.5 pl-6 text-sm last:border-b-0"
                  >
                    <span
                      aria-hidden
                      className={`absolute top-1/2 -left-1.5 size-2.5 -translate-y-1/2 rounded-full ${DOTS[entry.tone]}`}
                    />
                    <time dateTime={entry.at} className="col-span-2 text-text">
                      {formatDate(entry.at) === day ? formatClock(entry.at) : formatStamp(entry.at)}
                    </time>
                    <span className="col-span-3 border-l border-divider pl-4 text-heading">
                      {entry.label}
                    </span>
                  </li>
                ))}
            </ol>
          );
        }}
      </Loaded>
    </Panel>
  );
}

export function RelatedTab({ query }: { query: DetailQuery }) {
  const actorId = query.data?.event.actor.id;
  return (
    <Panel
      title="Related Events"
      icon={LinkSimple}
      testId="related-events"
      action={
        actorId ? (
          <LinkButton href={`/audit-security?user=${actorId}`} size="sm">
            View All for This User
          </LinkButton>
        ) : null
      }
    >
      <Loaded query={query} rows={3}>
        {({ related, relatedTotal }) =>
          related.length ? (
            <>
              <Table
                caption="Related events"
                rows={related}
                rowKey={(event) => event.id}
                showPagination={false}
                columns={[
                  {
                    id: 'at',
                    label: 'Date & Time',
                    className: 'whitespace-nowrap',
                    cell: (event) => <time dateTime={event.at}>{formatShortStamp(event.at)}</time>,
                  },
                  {
                    id: 'event',
                    label: 'Event',
                    className: 'min-w-44',
                    cell: (event) => (
                      <Link
                        href={eventHref(event.id)}
                        className="hover:text-action hover:underline"
                      >
                        {event.title}
                      </Link>
                    ),
                  },
                  {
                    id: 'severity',
                    label: 'Severity',
                    cell: (event) => <SeverityBadge severity={event.severity} />,
                  },
                  {
                    id: 'status',
                    label: 'Status',
                    cell: (event) => <OutcomeBadge outcome={event.outcome} />,
                  },
                ]}
              />
              {relatedTotal > related.length ? (
                <p className="text-sm text-muted">
                  Showing the {related.length} nearest of {relatedTotal} related events.
                </p>
              ) : null}
            </>
          ) : (
            <QuietLine>
              No related events: nothing with the same user, session, IP address or record within 24
              hours.
            </QuietLine>
          )
        }
      </Loaded>
    </Panel>
  );
}

export function ActionsTakenTab({ query, eventId }: { query: DetailQuery; eventId: string }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const add = useApiMutation(
    (note: string) => adminAuditSecurity.addNote({ eventId, text: note }),
    { invalidate: ['admin-audit-security'] },
  );

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const note = text.trim();
    if (!note) {
      setError('Write the note first.');
      return;
    }
    setError(undefined);
    add.mutate(note, {
      onSuccess: () => setText(''),
      onError: (failure) => setError(errorMessage(failure)),
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Actions Taken" icon={ListChecks} testId="actions-taken">
        <Loaded query={query} rows={3}>
          {({ event }) =>
            event.actionsTaken.length ? (
              <ul className="divide-y divide-divider">
                {event.actionsTaken.map((item) => (
                  <li key={item.id} className="flex flex-col gap-1 py-3 text-sm">
                    <span className="font-semibold text-heading">{item.label}</span>
                    <span className="text-muted">
                      {item.by} · <time dateTime={item.at}>{formatShortStamp(item.at, true)}</time>
                    </span>
                    {item.reason ? <span className="text-text">Reason: {item.reason}</span> : null}
                    <Link
                      href={eventHref(item.eventId)}
                      className="w-fit text-link hover:underline"
                    >
                      Open the audit event it wrote
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <QuietLine>
                No response actions yet. An action taken here is also written to the audit log as a
                new event linked to this one.
              </QuietLine>
            )
          }
        </Loaded>
      </Panel>

      <Panel title="Investigation Notes" icon={NotePencil} testId="investigation-notes">
        <Loaded query={query} rows={2}>
          {({ event }) =>
            event.notes.length ? (
              <ul className="divide-y divide-divider">
                {event.notes.map((note) => (
                  <li key={note.id} className="flex flex-col gap-1 py-3 text-sm">
                    <span className="whitespace-pre-line text-heading">{note.text}</span>
                    <span className="text-muted">
                      {note.author} ·{' '}
                      <time dateTime={note.at}>{formatShortStamp(note.at, true)}</time>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <QuietLine>No notes yet.</QuietLine>
            )
          }
        </Loaded>
        {query.isSuccess ? (
          <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
            <Textarea
              label="Add an investigation note"
              rows={3}
              maxLength={2000}
              value={text}
              error={error}
              onChange={(change) => setText(change.target.value)}
            />
            <p className="flex items-center gap-2 text-xs text-muted">
              <ClipboardText aria-hidden weight="fill" className="size-4 shrink-0" />
              Notes are added to the record and never edited. Adding one is logged; the note's text
              is not copied into the log.
            </p>
            <div>
              <Button type="submit" disabled={add.isPending}>
                {add.isPending ? 'Adding…' : 'Add Note'}
              </Button>
            </div>
          </form>
        ) : null}
      </Panel>
    </div>
  );
}
