'use client';

import {
  Button,
  Callout,
  PermissionMatrix,
  Table,
  Toggle,
  type PermissionValue,
} from '@firmivra/ui';
import {
  Alarm,
  ArrowSquareUpRight,
  Bell,
  ChartBar,
  ChatCenteredText,
  ClockCountdown,
  Info,
  LockSimple,
  PencilSimple,
  Plus,
  Tag,
  TrendUp,
  Users,
  type Icon,
} from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import {
  adminSupport,
  AGENT_ROLES,
  CLIENT_EVENTS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  NOTIFICATION_RECIPIENTS,
  PRIORITY_COLORS,
  SUPPORT_PERMISSIONS,
  targetLabel,
  TIME_ZONES,
  WEEKDAYS,
  type AgentRole,
  type BusinessHours,
  type CannedResponse,
  type NotificationChannel,
  type NotificationEvent,
  type NotificationRecipient,
  type NotificationSettings,
  type PermissionGrid,
  type SupportCategory,
  type SupportPermission,
  type SupportPriority,
  type SupportSettings,
} from '../../../../../../mocks/admin-support';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  formatDate,
  loadError,
  PRIORITY_DOTS,
  SUPPORT,
  SUPPORT_ERRORS,
  supportKeys,
} from '../../_components/support-data';
import { Breadcrumbs, QuietLine, ResultLine, RowMenu } from '../../_components/support-parts';
import { SettingsModal, type Editing } from './settings-modals';

const SECTIONS: { id: string; label: string; icon: Icon }[] = [
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'priorities', label: 'Priorities', icon: ChartBar },
  { id: 'sla', label: 'SLA & Business Hours', icon: Alarm },
  { id: 'assignment', label: 'Assignment Rules', icon: Users },
  { id: 'escalation', label: 'Escalation Rules', icon: ArrowSquareUpRight },
  { id: 'canned', label: 'Canned Responses', icon: ChatCenteredText },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'permissions', label: 'Permissions', icon: LockSimple },
];

function Card({
  id,
  title,
  subtitle,
  action,
  wide,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={`support-${id}`}
      aria-labelledby={`support-${id}-title`}
      data-testid={`settings-${id}`}
      className={`min-w-0 scroll-mt-4 rounded-xl border border-divider bg-surface p-4 shadow-sm contain-paint ${wide ? 'xl:col-span-2' : ''}`}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`support-${id}-title`} className="text-xl font-bold text-heading">
            {title}
          </h2>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** The loading skeleton, the quiet error line, or the card's content. */
function Body({
  loading,
  error,
  children,
}: {
  loading: boolean;
  error: unknown;
  children: () => ReactNode;
}) {
  if (loading) {
    return (
      <div role="status" aria-label="Loading" className="flex flex-col gap-3 py-2">
        <span className="h-4 w-3/4 animate-pulse rounded-control bg-disabled" />
        <span className="h-4 w-1/2 animate-pulse rounded-control bg-disabled" />
        <span className="h-4 w-2/3 animate-pulse rounded-control bg-disabled" />
      </div>
    );
  }
  if (error) return <QuietLine>{loadError(error)}</QuietLine>;
  return <>{children()}</>;
}

/** The blue tinted box with a round icon tile, as in the SLA, Assignment and Escalation cards. */
function RuleBox({ icon: Glyph, children }: { icon: Icon; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-4 rounded-lg bg-subtle p-4">
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-info-soft text-info">
        <Glyph aria-hidden weight="fill" className="size-6" />
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function RuleRows({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
      {rows.map(([label, text]) => (
        <div key={label} className="contents">
          <dt className="font-semibold text-heading">{label}</dt>
          <dd className="text-text sm:col-span-2">{text}</dd>
        </div>
      ))}
    </dl>
  );
}

const time = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
};

/** "Monday - Friday 8:00 AM – 6:00 PM": days in a row with the same hours share a line. */
function hourLines(hours: BusinessHours): [string, string][] {
  const zone = TIME_ZONES.find((z) => z.value === hours.timeZone)?.short ?? '';
  const order = [1, 2, 3, 4, 5, 6, 0];
  const lines: { from: number; to: number; text: string }[] = [];
  for (const number of order) {
    const day = hours.days.find((d) => d.day === number);
    const text = day?.open ? `${time(day.start)} – ${time(day.end)} (${zone})` : 'Closed';
    const last = lines[lines.length - 1];
    if (last && last.text === text) last.to = number;
    else lines.push({ from: number, to: number, text });
  }
  return lines.map(({ from, to, text }): [string, string] => [
    from === to ? (WEEKDAYS[from] ?? '') : `${WEEKDAYS[from] ?? ''} - ${WEEKDAYS[to] ?? ''}`,
    text,
  ]);
}

const ROLES = Object.keys(AGENT_ROLES) as AgentRole[];
const PERMISSIONS = Object.keys(SUPPORT_PERMISSIONS) as SupportPermission[];

function permissionValue(grid: PermissionGrid): PermissionValue {
  return Object.fromEntries(
    PERMISSIONS.map((permission) => [
      permission,
      ROLES.filter((r) => grid[r].includes(permission)),
    ]),
  );
}
function permissionGrid(value: PermissionValue): PermissionGrid {
  const grid = { OWNER: [], LEAD: [], AGENT: [] } as Record<AgentRole, SupportPermission[]>;
  for (const permission of PERMISSIONS) {
    for (const role of value[permission] ?? []) {
      if (role in grid) grid[role as AgentRole].push(permission);
    }
  }
  return grid;
}
function notificationValue(settings: NotificationSettings): PermissionValue {
  return Object.fromEntries(settings.rules.map((rule) => [rule.event, rule.recipients]));
}

/**
 * Support Settings (support-settings-admin-dashboard.jpg, docx §4): categories, priorities, SLA
 * and business hours with the holiday calendar, assignment and escalation rules, canned responses,
 * notifications and permissions. The section bar jumps to each card. Only people with the "Edit
 * settings" permission (canned responses: "Manage canned responses") can change them.
 */
export function SupportSettingsScreen() {
  const settings = useApiQuery(supportKeys.settings, () => adminSupport.settings());
  const me = useApiQuery(supportKeys.me, () => adminSupport.me());
  const [section, setSection] = useState('categories');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [message, setMessage] = useState('');
  const [notifyDraft, setNotifyDraft] = useState<NotificationSettings | null>(null);
  const [permissionDraft, setPermissionDraft] = useState<PermissionValue | null>(null);

  const permissions = me.data?.permissions ?? [];
  const canEdit = permissions.includes('EDIT_SETTINGS');
  const canCanned = permissions.includes('MANAGE_CANNED');
  const loading = settings.isPending;
  const failed = settings.error;
  const data = settings.data;

  const toggle = useApiMutation(
    ({
      kind,
      id,
      active,
    }: {
      kind: 'category' | 'priority' | 'canned';
      id: string;
      active: boolean;
    }): Promise<SupportCategory | SupportPriority | CannedResponse> =>
      kind === 'category'
        ? adminSupport.setCategoryActive(id, active)
        : kind === 'priority'
          ? adminSupport.setPriorityActive(id, active)
          : adminSupport.setCannedActive(id, active),
    { invalidate: SUPPORT },
  );
  const saveNotifications = useApiMutation(
    (body: NotificationSettings) => adminSupport.saveNotifications(body),
    { invalidate: SUPPORT },
  );
  const savePermissions = useApiMutation(
    (body: PermissionGrid) => adminSupport.savePermissions(body),
    { invalidate: SUPPORT },
  );

  function edit(next: Editing) {
    setMessage('');
    setEditing(next);
  }
  function flip(
    kind: 'category' | 'priority' | 'canned',
    id: string,
    active: boolean,
    name: string,
  ) {
    setMessage('');
    toggle.mutate(
      { kind, id, active },
      { onSuccess: () => setMessage(`${name} ${active ? 'reactivated' : 'deactivated'}.`) },
    );
  }

  const error = toggle.error ?? saveNotifications.error ?? savePermissions.error;
  const editButton = (label: string, onClick: () => void, allowed = canEdit) =>
    allowed && data ? (
      <Button variant="secondary" onClick={onClick}>
        <PencilSimple aria-hidden weight="fill" className="size-4 text-action" />
        <span className="text-action">{label}</span>
      </Button>
    ) : null;
  const addButton = (label: string, onClick: () => void, allowed = canEdit) =>
    allowed && data ? (
      <Button onClick={onClick}>
        <Plus aria-hidden weight="bold" className="size-4" />
        {label}
      </Button>
    ) : null;

  const categoryNames = new Map((data?.categories ?? []).map((c) => [c.id, c.name]));
  const priorities = [...(data?.priorities ?? [])].sort((a, b) => a.rank - b.rank);
  const recipientColumns = (Object.keys(NOTIFICATION_RECIPIENTS) as NotificationRecipient[]).map(
    (r) => ({ id: r, label: NOTIFICATION_RECIPIENTS[r] }),
  );
  const notify = notifyDraft ?? data?.notifications;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header className="flex flex-col gap-2">
        <Breadcrumbs
          items={[
            { label: 'Home', href: '/' },
            { label: 'Support', href: '/support' },
            { label: 'Support Settings' },
          ]}
        />
        <h1 data-testid="page-title" className="text-4xl font-bold text-heading">
          Support Settings
        </h1>
        <p className="text-base text-muted">
          Configure how support tickets are managed, assigned, and communicated.
        </p>
      </header>

      <nav
        aria-label="Support settings sections"
        className="min-w-0 overflow-x-auto rounded-xl border border-divider bg-surface px-4 shadow-sm contain-paint"
      >
        {/* At 1440 px all eight sections fit, spread across the bar as in the design; narrower
            screens scroll inside the bar. */}
        <ul className="flex gap-6 min-[1440px]:justify-between min-[1440px]:gap-2">
          {SECTIONS.map(({ id, label, icon: Glyph }) => (
            <li key={id} className="shrink-0">
              <a
                href={`#support-${id}`}
                aria-current={section === id ? 'location' : undefined}
                onClick={() => setSection(id)}
                className={`-mb-px inline-flex min-h-12 items-center gap-2 border-b-2 text-sm font-medium ${section === id ? 'border-action text-action' : 'border-transparent text-text hover:text-action'}`}
              >
                <Glyph aria-hidden weight="fill" className="size-5" />
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {me.data && !canEdit ? (
        <Callout icon={Info} surface="info" size="compact">
          You can view these settings. Only people with the Edit settings permission can change
          them.
        </Callout>
      ) : null}
      <ResultLine
        message={message}
        error={error ? errorMessage(error, SUPPORT_ERRORS) : undefined}
      />

      <div className="grid min-w-0 grid-cols-1 items-start gap-5 xl:grid-cols-2">
        <Card
          id="categories"
          title="Ticket Categories"
          subtitle="Manage the categories available when creating support tickets."
          action={addButton('Add Category', () => edit({ kind: 'category', item: null }))}
        >
          <Body loading={loading} error={failed}>
            {() => (
              <Table
                rows={data?.categories ?? []}
                rowKey={(c) => c.id}
                caption="Ticket categories"
                noun="categories"
                dense
                showPagination={false}
                emptyTitle="No categories yet"
                emptyText="Add the first category for new tickets."
                rowActions={(c) => (
                  <RowMenu
                    label={`Actions for ${c.name}`}
                    items={
                      canEdit
                        ? [
                            { label: 'Edit', onSelect: () => edit({ kind: 'category', item: c }) },
                            {
                              label: c.active ? 'Deactivate' : 'Reactivate',
                              onSelect: () => flip('category', c.id, !c.active, c.name),
                            },
                          ]
                        : []
                    }
                  />
                )}
                columns={[
                  {
                    id: 'n',
                    label: '#',
                    cell: (c) => (data?.categories ?? []).indexOf(c) + 1,
                  },
                  {
                    id: 'name',
                    label: 'Category Name',
                    cell: (c) => <span className="font-semibold text-heading">{c.name}</span>,
                  },
                  { id: 'description', label: 'Description', cell: (c) => c.description },
                  {
                    id: 'active',
                    label: 'Active',
                    cell: (c) => (
                      <Toggle
                        label={`${c.name} active`}
                        checked={c.active}
                        disabled={!canEdit || toggle.isPending}
                        onChange={(on) => flip('category', c.id, on, c.name)}
                      />
                    ),
                  },
                ]}
              />
            )}
          </Body>
        </Card>

        <Card
          id="priorities"
          title="Ticket Priorities"
          subtitle="Manage priority levels and their response targets."
          action={addButton('Add Priority', () => edit({ kind: 'priority', item: null }))}
        >
          <Body loading={loading} error={failed}>
            {() => (
              <Table
                rows={priorities}
                rowKey={(p) => p.id}
                caption="Ticket priorities"
                noun="priorities"
                dense
                showPagination={false}
                emptyTitle="No priorities yet"
                emptyText="Add a priority with its response target."
                rowActions={(p) => (
                  <RowMenu
                    label={`Actions for ${p.name}`}
                    items={
                      canEdit
                        ? [
                            { label: 'Edit', onSelect: () => edit({ kind: 'priority', item: p }) },
                            {
                              label: p.active ? 'Deactivate' : 'Reactivate',
                              onSelect: () => flip('priority', p.id, !p.active, p.name),
                            },
                          ]
                        : []
                    }
                  />
                )}
                columns={[
                  { id: 'n', label: '#', cell: (p) => p.rank },
                  {
                    id: 'name',
                    label: 'Priority',
                    cell: (p) => <span className="font-semibold text-heading">{p.name}</span>,
                  },
                  { id: 'description', label: 'Description', cell: (p) => p.description },
                  {
                    id: 'color',
                    label: 'Color',
                    cell: (p) => (
                      <span className="inline-flex items-center">
                        <span
                          aria-hidden
                          className={`inline-block size-4 rounded-full ${PRIORITY_DOTS[p.color]}`}
                        />
                        <span className="sr-only">{PRIORITY_COLORS[p.color]}</span>
                      </span>
                    ),
                  },
                  {
                    id: 'target',
                    label: 'Response Target',
                    cell: (p) => <span className="whitespace-nowrap">{targetLabel(p.target)}</span>,
                  },
                  {
                    id: 'active',
                    label: 'Active',
                    cell: (p) => (
                      <Toggle
                        label={`${p.name} active`}
                        checked={p.active}
                        disabled={!canEdit || toggle.isPending}
                        onChange={(on) => flip('priority', p.id, on, p.name)}
                      />
                    ),
                  },
                ]}
              />
            )}
          </Body>
        </Card>

        <Card
          id="sla"
          title="SLA & Business Hours"
          subtitle="Set response and resolution targets and define support hours."
          action={editButton('Edit Settings', () => edit({ kind: 'hours' }))}
        >
          <Body loading={loading} error={failed}>
            {() =>
              data ? (
                <RuleBox icon={ClockCountdown}>
                  <div className="grid gap-4 sm:grid-cols-2 sm:divide-x sm:divide-divider">
                    <div className="min-w-0 sm:pr-4">
                      <h3 className="mb-1 text-sm font-semibold text-heading">Business Hours</h3>
                      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-text">
                        {hourLines(data.businessHours).map(([days, text]) => (
                          <div key={days} className="contents">
                            <dt>{days}</dt>
                            <dd>{text}</dd>
                          </div>
                        ))}
                        <div className="contents">
                          <dt>Holidays</dt>
                          <dd>
                            <button
                              type="button"
                              onClick={() => edit({ kind: 'holidays' })}
                              disabled={!canEdit}
                              className="text-left text-link hover:underline disabled:text-muted disabled:no-underline"
                            >
                              Use holiday calendar
                              <span className="sr-only">
                                {' '}
                                ({data.businessHours.holidays.length} holidays)
                              </span>
                            </button>
                          </dd>
                        </div>
                      </dl>
                    </div>
                    <div className="min-w-0 sm:pl-4">
                      <h3 className="mb-1 text-sm font-semibold text-heading">SLA Targets</h3>
                      {priorities.length === 0 ? (
                        <p className="text-sm text-muted">No priorities yet.</p>
                      ) : (
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-text">
                          {priorities
                            .filter((p) => p.active)
                            .map((p) => (
                              <div key={p.id} className="contents">
                                <dt>{p.name}</dt>
                                <dd>{targetLabel(p.target)}</dd>
                              </div>
                            ))}
                        </dl>
                      )}
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    {data.businessHours.clock === 'BUSINESS'
                      ? 'SLA clocks count business hours only; holidays pause them.'
                      : 'SLA clocks count calendar time.'}
                  </p>
                </RuleBox>
              ) : null
            }
          </Body>
        </Card>

        <Card
          id="assignment"
          title="Assignment Rules"
          subtitle="Define how tickets are automatically assigned."
          action={editButton('Edit Rules', () => edit({ kind: 'assignment' }))}
        >
          <Body loading={loading} error={failed}>
            {() =>
              data ? (
                <RuleBox icon={Users}>
                  <RuleRows
                    rows={[
                      [
                        'Default Assignment',
                        data.assignment.defaultQueue
                          ? 'New tickets are assigned to the Support Team queue.'
                          : 'New tickets must be assigned when they are created.',
                      ],
                      [
                        'Assignment Logic',
                        data.assignment.roundRobin
                          ? 'Round robin among available team members.'
                          : 'Assigned by hand.',
                      ],
                      [
                        'Reassignment',
                        data.assignment.reassign
                          ? `If a ticket is not accepted within ${data.assignment.reassignAfterHours} hours, reassign to next available member.`
                          : 'Off: tickets stay with their assignee.',
                      ],
                    ]}
                  />
                </RuleBox>
              ) : null
            }
          </Body>
        </Card>

        <Card
          id="escalation"
          title="Escalation Rules"
          subtitle="Set rules for when tickets should be escalated."
          action={editButton('Edit Rules', () => edit({ kind: 'escalation' }))}
        >
          <Body loading={loading} error={failed}>
            {() =>
              data ? (
                <RuleBox icon={TrendUp}>
                  <RuleRows rows={escalationRows(data)} />
                </RuleBox>
              ) : null
            }
          </Body>
        </Card>

        <Card
          id="canned"
          title="Canned Responses"
          subtitle="Manage saved reply templates for common issues."
          action={addButton('Add Response', () => edit({ kind: 'canned', item: null }), canCanned)}
        >
          <Body loading={loading} error={failed}>
            {() => (
              <Table
                rows={data?.cannedResponses ?? []}
                rowKey={(c) => c.id}
                caption="Canned responses"
                noun="responses"
                dense
                showPagination={false}
                emptyTitle="No canned responses yet"
                emptyText="Save a reply your team sends often."
                rowActions={(c) => (
                  <RowMenu
                    label={`Actions for ${c.title}`}
                    items={
                      canCanned
                        ? [
                            { label: 'Edit', onSelect: () => edit({ kind: 'canned', item: c }) },
                            {
                              label: c.active ? 'Deactivate' : 'Reactivate',
                              onSelect: () => flip('canned', c.id, !c.active, c.title),
                            },
                          ]
                        : []
                    }
                  />
                )}
                columns={[
                  {
                    id: 'n',
                    label: '#',
                    cell: (c) => (data?.cannedResponses ?? []).indexOf(c) + 1,
                  },
                  {
                    id: 'title',
                    label: 'Title',
                    cell: (c) => (
                      <span className="font-semibold text-heading" title={`By ${c.createdBy}`}>
                        {c.title}
                      </span>
                    ),
                  },
                  {
                    id: 'category',
                    label: 'Category',
                    cell: (c) => (c.categoryId ? (categoryNames.get(c.categoryId) ?? '—') : 'Any'),
                  },
                  {
                    id: 'updated',
                    label: 'Last Updated',
                    cell: (c) => (
                      <span className="whitespace-nowrap">{formatDate(c.updatedAt)}</span>
                    ),
                  },
                  {
                    id: 'active',
                    label: 'Active',
                    cell: (c) => (
                      <Toggle
                        label={`${c.title} active`}
                        checked={c.active}
                        disabled={!canCanned || toggle.isPending}
                        onChange={(on) => flip('canned', c.id, on, c.title)}
                      />
                    ),
                  },
                ]}
              />
            )}
          </Body>
        </Card>

        <Card
          id="notifications"
          wide
          title="Notifications"
          subtitle="Choose who is told about each ticket event, and by which channels."
          action={
            notifyDraft ? (
              <span className="flex gap-3">
                <Button variant="secondary" onClick={() => setNotifyDraft(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={saveNotifications.isPending}
                  onClick={() =>
                    saveNotifications.mutate(notifyDraft, {
                      onSuccess: () => {
                        setNotifyDraft(null);
                        setMessage('Notification settings saved.');
                      },
                    })
                  }
                >
                  Save
                </Button>
              </span>
            ) : (
              editButton('Edit Notifications', () => {
                setMessage('');
                setNotifyDraft(data ? structuredClone(data.notifications) : null);
              })
            )
          }
        >
          <Body loading={loading} error={failed}>
            {() =>
              notify ? (
                <div className="flex flex-col gap-4">
                  <fieldset className="flex flex-wrap items-center gap-6">
                    <legend className="mb-2 text-sm font-semibold text-heading">Channels</legend>
                    {(Object.keys(NOTIFICATION_CHANNELS) as NotificationChannel[]).map(
                      (channel) => (
                        <span key={channel} className="flex items-center gap-2 text-sm text-text">
                          <Toggle
                            label={`${NOTIFICATION_CHANNELS[channel]} notifications`}
                            checked={notify.channels.includes(channel)}
                            disabled={!notifyDraft}
                            onChange={(on) =>
                              notifyDraft &&
                              setNotifyDraft({
                                ...notifyDraft,
                                channels: on
                                  ? [...notifyDraft.channels, channel]
                                  : notifyDraft.channels.filter((c) => c !== channel),
                              })
                            }
                          />
                          {NOTIFICATION_CHANNELS[channel]}
                        </span>
                      ),
                    )}
                  </fieldset>
                  <PermissionMatrix
                    caption="Who is notified for each event"
                    rowHeader="Event"
                    rows={(Object.keys(NOTIFICATION_EVENTS) as NotificationEvent[]).map((e) => ({
                      id: e,
                      label: NOTIFICATION_EVENTS[e],
                    }))}
                    columns={recipientColumns}
                    value={notificationValue(notify)}
                    readOnly={!notifyDraft}
                    isAvailable={(row, column) =>
                      column !== 'CLIENT' || CLIENT_EVENTS.includes(row as NotificationEvent)
                    }
                    onChange={(next) =>
                      notifyDraft &&
                      setNotifyDraft({
                        ...notifyDraft,
                        rules: notifyDraft.rules.map((rule) => ({
                          ...rule,
                          recipients: [...(next[rule.event] ?? [])] as NotificationRecipient[],
                        })),
                      })
                    }
                  />
                  <p className="text-xs text-muted">
                    Internal notes, SLA and escalation events never reach the client. SMS goes out
                    only for escalations and SLA breaches.
                  </p>
                </div>
              ) : null
            }
          </Body>
        </Card>

        <Card
          id="permissions"
          wide
          title="Permissions"
          subtitle="Choose what each support role can do. The API enforces the same rules."
          action={
            permissionDraft ? (
              <span className="flex gap-3">
                <Button variant="secondary" onClick={() => setPermissionDraft(null)}>
                  Cancel
                </Button>
                <Button
                  disabled={savePermissions.isPending}
                  onClick={() =>
                    savePermissions.mutate(permissionGrid(permissionDraft), {
                      onSuccess: () => {
                        setPermissionDraft(null);
                        setMessage('Permissions saved.');
                      },
                    })
                  }
                >
                  Save
                </Button>
              </span>
            ) : (
              editButton('Edit Permissions', () => {
                setMessage('');
                setPermissionDraft(data ? permissionValue(data.permissions) : null);
              })
            )
          }
        >
          <Body loading={loading} error={failed}>
            {() =>
              data ? (
                <PermissionMatrix
                  caption="Support permissions by role"
                  rowHeader="Permission"
                  rows={PERMISSIONS.map((p) => ({ id: p, label: SUPPORT_PERMISSIONS[p] }))}
                  columns={ROLES.map((r) => ({ id: r, label: AGENT_ROLES[r] }))}
                  value={permissionDraft ?? permissionValue(data.permissions)}
                  readOnly={!permissionDraft}
                  onChange={(next) => permissionDraft && setPermissionDraft(next)}
                />
              ) : null
            }
          </Body>
        </Card>
      </div>

      {editing && data ? (
        <SettingsModal
          editing={editing}
          settings={data}
          onClose={() => setEditing(null)}
          onDone={(text) => {
            setEditing(null);
            setMessage(text);
          }}
        />
      ) : null}
    </div>
  );
}

function escalationRows(data: SupportSettings): [string, string][] {
  const { slaBreach, highPriority, critical } = data.escalation;
  const name = (id: string) => data.priorities.find((p) => p.id === id)?.name ?? 'the chosen';
  const channels = critical.channels.map((c) => NOTIFICATION_CHANNELS[c]);
  return [
    [
      'SLA Breach',
      slaBreach.enabled
        ? `Escalate to ${slaBreach.notify === 'LEAD' ? 'team lead' : 'admins'} when response time is exceeded.`
        : 'Off.',
    ],
    [
      'High Priority',
      highPriority.enabled
        ? `Escalate to admin if not resolved within ${targetLabel(highPriority.target)} (${name(highPriority.priorityId)} tickets).`
        : 'Off.',
    ],
    [
      'Critical',
      critical.enabled
        ? `Immediately notify admin${channels.length ? ` by ${channels.join(', ')}` : ''} for ${name(critical.priorityId)} tickets.`
        : 'Off.',
    ],
  ];
}
