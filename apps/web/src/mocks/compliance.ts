import {
  type AddDeadlineDocumentRequest,
  type AddDeadlineLinkRequest,
  BulkDeadlinesRequest,
  ClientComplianceQuery,
  CompleteComplianceDeadlineRequest,
  type ComplianceCalendarMonth,
  ComplianceByClientQuery,
  ComplianceCalendarMonthQuery,
  type ComplianceClient,
  type ComplianceDeadline,
  ComplianceDeadlinesQuery,
  CreateComplianceDeadlineRequest,
  CreateDeadlineTaskRequest,
  ExtensionRequest,
  LinkDeadlineTaskRequest,
  NotApplicableRequest,
  parseInput,
  ReassignRequest,
  SaveDeadlineAsTemplateRequest,
  SaveRemindersRequest,
  UpdateComplianceDeadlineRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockMe } from './appointments';
import {
  CLIENTS,
  type Options,
  type Store,
  blankDeadline,
  copy,
  DEFAULT_SETTINGS,
  effectiveDue,
  fail,
  fresh,
  iso,
  memberOf,
  nowIso,
  plus,
  seedDeadlines,
  today,
  toRow,
  uuid,
} from './compliance-base';
import { createLibraryMock, seedLibrary } from './compliance-library';

/**
 * Mock data for `api.compliance` (R57 contract, Compliance & Deadlines). It checks input with the
 * contract's schemas and answers its codes: DEADLINE_STATE, OVERRIDE_REASON_REQUIRED, DUPLICATE,
 * NOT_THIS_CLIENTS, CALENDAR_STATE, ENTRIES_NEED_VERIFICATION, NO_ENTRIES, RECURRENCE_STATE,
 * SUGGESTION_STATE, RULE_INACTIVE. STAFF can read and work deadlines but not publish calendars or
 * change settings (403). `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=compliance) starts with no
 * deadlines, calendars, recurrences or rules.
 */
const OPEN = ['UPCOMING', 'IN_PROGRESS', 'WAITING_ON_CLIENT'];
const page = <T>(rows: T[], q: { page?: number; pageSize?: number }) => {
  const size = q.pageSize ?? 25;
  const at = q.page ?? 1;
  return {
    items: rows.slice((at - 1) * size, at * size),
    total: rows.length,
    page: at,
    pageSize: size,
  };
};

export function createComplianceMock({
  role = 'OWNER',
  empty = false,
}: Options = {}): ComplianceClient {
  const store: Store = {
    deadlines: empty ? [] : seedDeadlines(),
    ...seedLibrary(empty),
    settings: copy(DEFAULT_SETTINGS),
    next: 200,
  };
  const id = (block: string) => uuid(block, store.next++);
  const log = (
    kind: Store['logs'][number]['kind'],
    outcome: Store['logs'][number]['outcome'],
    message: string,
    extra: Partial<Store['logs'][number]> = {},
  ) =>
    store.logs.unshift({
      id: id('4f00'),
      kind,
      outcome,
      message,
      calendarId: null,
      deadlineId: null,
      recurrenceId: null,
      details: {},
      actor: mockMe,
      createdAt: nowIso(),
      ...extra,
    });

  const find = (deadlineId: string) => {
    const d = store.deadlines.find((x) => x.id === deadlineId);
    if (!d) throw fail(404, 'NOT_FOUND', 'That deadline was not found.');
    return d;
  };
  const view = (d: ComplianceDeadline) => fresh(d, store.settings);
  const live = () => store.deadlines.map(view);
  const open = (d: ComplianceDeadline) => OPEN.includes(d.status);
  const touch = (d: ComplianceDeadline) => {
    d.updatedAt = nowIso();
    return view(d);
  };
  const needOpen = (d: ComplianceDeadline) => {
    if (d.archived || !open(d)) {
      throw fail(409, 'DEADLINE_STATE', 'This deadline is closed. Reopen it first.');
    }
  };

  const inRange = (due: string, range: string, from?: string, to?: string) => {
    const t = today();
    const d = new Date(`${t}T12:00:00Z`);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const first = (yy: number, mm: number) => iso(Date.UTC(yy, mm, 1));
    const last = (yy: number, mm: number) => iso(Date.UTC(yy, mm + 1, 0));
    const q = Math.floor(m / 3) * 3;
    const bounds: Record<string, [string, string] | undefined> = {
      NEXT_7_DAYS: [t, plus(t, 7)],
      NEXT_30_DAYS: [t, plus(t, 30)],
      NEXT_90_DAYS: [t, plus(t, 90)],
      PAST_30_DAYS: [plus(t, -30), t],
      THIS_MONTH: [first(y, m), last(y, m)],
      THIS_QUARTER: [first(y, q), last(y, q + 2)],
      THIS_YEAR: [first(y, 0), last(y, 11)],
    };
    const b = bounds[range];
    if (b && (due < b[0] || due > b[1])) return false;
    if (from && due < from) return false;
    if (to && due > to) return false;
    return true;
  };

  const atRiskOf = (clientId: string) => {
    const rows = live().filter((d) => d.client.id === clientId && !d.archived && open(d));
    const overdue = rows.filter((d) => d.displayStatus === 'OVERDUE').length;
    const high = rows.filter(
      (d) =>
        d.priority === 'HIGH' && d.daysUntilDue >= 0 && d.daysUntilDue <= store.settings.atRiskDays,
    ).length;
    const waiting = rows.filter((d) => d.status === 'WAITING_ON_CLIENT').length;
    if (overdue + high + waiting === 0) return null;
    const next = rows.map(effectiveDue).sort()[0] ?? null;
    return {
      client: CLIENTS.find((c) => c.id === clientId)!,
      overdueCount: overdue,
      highPriorityUpcomingCount: high,
      waitingOnClientCount: waiting,
      nextDueOn: next,
    };
  };
  const atRiskList = () =>
    CLIENTS.map((c) => atRiskOf(c.id))
      .filter((r): r is NonNullable<ReturnType<typeof atRiskOf>> => r !== null)
      .sort((a, b) => b.overdueCount - a.overdueCount);

  const run = async <T>(work: () => T): Promise<T> => {
    await mockDelay();
    return copy(work());
  };
  const staffBlocked = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'Your role cannot do this.');
  };
  const create = (input: ReturnType<typeof parseInput<typeof CreateComplianceDeadlineRequest>>) => {
    const client = CLIENTS.find((c) => c.id === input.clientId);
    if (!client) throw fail(404, 'NOT_FOUND', 'That client was not found.');
    if (input.assignedUserId && !memberOf(input.assignedUserId)) {
      throw fail(409, 'NOT_A_MEMBER', 'That person is not on your team.');
    }
    const overridden =
      input.statutoryDueOn !== undefined &&
      input.statutoryDueOn !== null &&
      input.statutoryDueOn !== input.dueOn;
    if (overridden && !input.dueOverrideReason) {
      throw fail(400, 'OVERRIDE_REASON_REQUIRED', 'Give a reason for changing the statutory date.');
    }
    if (
      store.deadlines.some(
        (d) =>
          d.client.id === client.id &&
          d.name === input.name &&
          d.dueOn === input.dueOn &&
          !d.archived,
      )
    ) {
      throw fail(409, 'DUPLICATE', 'This client already has that deadline on that date.');
    }
    const d = blankDeadline(id('2d00'), client, {
      name: input.name,
      type: input.type,
      dueOn: input.dueOn,
      source: input.source,
      description: input.description ?? null,
      internalNotes: input.internalNotes ?? null,
      clientNotes: input.clientNotes ?? null,
      entityType: input.entityType ?? null,
      taxYear: input.taxYear ?? null,
      filingPeriod: input.filingPeriod ?? null,
      relatedForm: input.relatedForm ?? null,
      agency: input.agency ?? null,
      jurisdiction: input.jurisdiction ?? null,
      state: input.state ?? null,
      statutoryDueOn: input.statutoryDueOn ?? input.dueOn,
      dueOverridden: overridden,
      dueOverrideReason: overridden ? (input.dueOverrideReason ?? null) : null,
      dueTime: input.dueTime ?? null,
      paymentDueOn: input.paymentDueOn ?? null,
      priority: input.priority,
      status: input.status,
      assignedTo: memberOf(input.assignedUserId ?? null),
      clientVisible: input.clientVisible,
      engagementId: input.engagementId ?? null,
      createTask: input.createTask,
      taskTemplateId: input.taskTemplateId ?? null,
      reminders: (input.reminders ?? store.settings.defaultReminders).map((r) => ({
        daysBefore: r.daysBefore,
        inApp: r.inApp ?? true,
        channels: r.channels ?? [],
      })),
    });
    if (input.createTask) {
      d.tasks.push({
        id: id('5a00'),
        title: `Prepare ${input.name}`,
        status: 'OPEN',
        dueOn: plus(input.dueOn, -3),
        assignedTo: d.assignedTo,
      });
    }
    store.deadlines.unshift(d);
    log('OVERRIDE', 'SUCCESS', overridden ? `Date changed on ${d.name}.` : `Added ${d.name}.`, {
      deadlineId: d.id,
    });
    return view(d);
  };

  const library = createLibraryMock({ store, role, id, log, run, staffBlocked, live });

  return {
    summary: () =>
      run(() => {
        const rows = live().filter((d) => !d.archived);
        const t = today();
        const month = t.slice(0, 7);
        const prev = iso(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 1)).slice(
          0,
          7,
        );
        const doneIn = (m: string) =>
          rows.filter((d) => d.status === 'COMPLETED' && d.completedAt?.slice(0, 7) === m).length;
        const kpi = (value: number, previous: number) => ({
          value,
          previous,
          changePercent: previous > 0 ? Math.round(((value - previous) / previous) * 100) : null,
        });
        const counts = new Map<string, number>();
        for (const d of rows) counts.set(d.type, (counts.get(d.type) ?? 0) + 1);
        const types = [...counts].map(([type, count]) => ({
          type: type as ComplianceDeadline['type'],
          count,
          percent: Math.round((count / rows.length) * 1000) / 10,
        }));
        const risk = atRiskList();
        return {
          today: t,
          kpis: {
            total: kpi(rows.length, Math.max(0, rows.length - 5)),
            next30Days: rows.filter((d) => open(d) && d.daysUntilDue >= 0 && d.daysUntilDue <= 30)
              .length,
            overdue: rows.filter((d) => d.displayStatus === 'OVERDUE').length,
            completedThisMonth: kpi(doneIn(month), doneIn(prev)),
            recurring: rows.filter((d) => d.recurring).length,
            clientsAtRisk: risk.length,
          },
          types,
          atRiskClients: risk.slice(0, 5),
          staleCalendars: store.calendars.filter((c) => c.stale && c.status === 'PUBLISHED').length,
        };
      }),
    atRisk: () => run(() => ({ items: atRiskList() })),
    month: (query = {}) =>
      run((): ComplianceCalendarMonth => {
        const q = parseInput(ComplianceCalendarMonthQuery, query);
        const month = q.month ?? today().slice(0, 7);
        const rows = live().filter(
          (d) =>
            !d.archived &&
            effectiveDue(d).startsWith(month) &&
            (!q.type || d.type === q.type) &&
            (!q.clientId || d.client.id === q.clientId) &&
            (!q.assignedUserId || d.assignedTo?.userId === q.assignedUserId) &&
            (!q.mine || d.assignedTo?.userId === mockMe.userId),
        );
        const days = new Map<string, ComplianceDeadline[]>();
        for (const d of rows) days.set(effectiveDue(d), [...(days.get(effectiveDue(d)) ?? []), d]);
        return {
          month,
          truncated: false,
          days: [...days]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, list]) => ({
              date,
              counts: {
                upcoming: list.filter(
                  (d) =>
                    d.displayStatus === 'UPCOMING' ||
                    d.displayStatus === 'IN_PROGRESS' ||
                    d.displayStatus === 'WAITING_ON_CLIENT',
                ).length,
                overdue: list.filter((d) => d.displayStatus === 'OVERDUE').length,
                dueSoon: list.filter((d) => d.displayStatus === 'DUE_SOON').length,
                completed: list.filter((d) => d.displayStatus === 'COMPLETED').length,
              },
              deadlines: list.map((d) => ({
                id: d.id,
                name: d.name,
                type: d.type,
                displayStatus: d.displayStatus,
                clientName: d.client.displayName,
              })),
            })),
        };
      }),
    byClient: (query = {}) =>
      run(() => {
        const q = parseInput(ComplianceByClientQuery, query);
        const rows = CLIENTS.filter(
          (c) => !q.search || c.displayName.toLowerCase().includes(q.search.toLowerCase()),
        )
          .map((c) => {
            const mine = live().filter((d) => d.client.id === c.id && !d.archived);
            const openRows = mine.filter(open);
            return {
              client: c,
              total: mine.length,
              open: openRows.length,
              overdue: mine.filter((d) => d.displayStatus === 'OVERDUE').length,
              dueSoon: mine.filter((d) => d.displayStatus === 'DUE_SOON').length,
              completed: mine.filter((d) => d.status === 'COMPLETED').length,
              nextDueOn: openRows.map(effectiveDue).sort()[0] ?? null,
              atRisk: atRiskOf(c.id) !== null,
            };
          })
          .filter((r) => r.total > 0 && (!q.atRisk || r.atRisk));
        return page(rows, q);
      }),
    clientCompliance: (clientId, query = {}) =>
      run(() => {
        const q = parseInput(ClientComplianceQuery, query);
        const client = CLIENTS.find((c) => c.id === clientId);
        if (!client) throw fail(404, 'NOT_FOUND', 'That client was not found.');
        const mine = live().filter((d) => d.client.id === clientId && !d.archived);
        return {
          client,
          totals: {
            open: mine.filter(open).length,
            overdue: mine.filter((d) => d.displayStatus === 'OVERDUE').length,
            dueSoon: mine.filter((d) => d.displayStatus === 'DUE_SOON').length,
            completed: mine.filter((d) => d.status === 'COMPLETED').length,
          },
          atRisk: atRiskOf(clientId),
          deadlines: mine.filter((d) => q.includeClosed || open(d)).map(toRow),
          suggestions: store.suggestions.filter(
            (s) =>
              s.client.id === clientId &&
              (s.decision === 'SUGGESTED' || s.decision === 'NEEDS_REVIEW'),
          ).length,
        };
      }),
    deadlines: (query = {}) =>
      run(() => {
        const q = parseInput(ComplianceDeadlinesQuery, query);
        const term = q.search?.toLowerCase();
        const rows = live()
          .filter((d) =>
            q.tab === 'ARCHIVED'
              ? d.archived
              : !d.archived &&
                (q.tab !== 'COMPLETED' || d.status === 'COMPLETED') &&
                (q.tab !== 'RECURRING' || d.recurring),
          )
          .filter(
            (d) =>
              inRange(effectiveDue(d), q.range, q.from, q.to) &&
              (!q.type || d.type === q.type) &&
              (!q.status || d.displayStatus === q.status) &&
              (!q.clientId || d.client.id === q.clientId) &&
              (!q.assignedUserId || d.assignedTo?.userId === q.assignedUserId) &&
              (!q.agency || d.agency === q.agency) &&
              (!q.mine || d.assignedTo?.userId === mockMe.userId) &&
              (!term ||
                d.name.toLowerCase().includes(term) ||
                d.client.displayName.toLowerCase().includes(term)),
          );
        const key = {
          dueOn: (d: ComplianceDeadline) => effectiveDue(d),
          name: (d: ComplianceDeadline) => d.name,
          client: (d: ComplianceDeadline) => d.client.displayName,
          type: (d: ComplianceDeadline) => d.type,
          agency: (d: ComplianceDeadline) => d.agency ?? '',
          status: (d: ComplianceDeadline) => d.displayStatus,
          priority: (d: ComplianceDeadline) => ({ HIGH: 0, MEDIUM: 1, LOW: 2 })[d.priority],
        }[q.sort];
        rows.sort((a, b) => {
          const x = key(a);
          const y = key(b);
          const c = x < y ? -1 : x > y ? 1 : a.name.localeCompare(b.name);
          return q.direction === 'desc' ? -c : c;
        });
        return page(rows.map(toRow), q);
      }),
    createDeadline: (body) =>
      run(() => {
        return create(parseInput(CreateComplianceDeadlineRequest, body));
      }),
    getDeadline: (deadlineId) => run(() => view(find(deadlineId))),
    updateDeadline: (deadlineId, body) =>
      run(() => {
        const input = parseInput(UpdateComplianceDeadlineRequest, body);
        const d = find(deadlineId);
        if (d.archived) throw fail(409, 'DEADLINE_STATE', 'This deadline is archived.');
        if (input.assignedUserId && !memberOf(input.assignedUserId)) {
          throw fail(409, 'NOT_A_MEMBER', 'That person is not on your team.');
        }
        const dueOn = input.dueOn ?? d.dueOn;
        const overridden = d.statutoryDueOn !== null && dueOn !== d.statutoryDueOn;
        const reason =
          input.dueOverrideReason === undefined ? d.dueOverrideReason : input.dueOverrideReason;
        if (overridden && !reason) {
          throw fail(
            400,
            'OVERRIDE_REASON_REQUIRED',
            'Give a reason for changing the statutory date.',
          );
        }
        const { assignedUserId, ...rest } = input;
        Object.assign(d, rest, {
          dueOverridden: overridden,
          dueOverrideReason: overridden ? (reason ?? null) : null,
        });
        if (assignedUserId !== undefined) d.assignedTo = memberOf(assignedUserId);
        if (overridden)
          log('OVERRIDE', 'SUCCESS', `Date changed on ${d.name}.`, { deadlineId: d.id });
        return touch(d);
      }),
    startDeadline: (deadlineId) =>
      run(() => {
        const d = find(deadlineId);
        needOpen(d);
        d.status = 'IN_PROGRESS';
        return touch(d);
      }),
    waitOnClient: (deadlineId) =>
      run(() => {
        const d = find(deadlineId);
        needOpen(d);
        d.status = 'WAITING_ON_CLIENT';
        return touch(d);
      }),
    completeDeadline: (deadlineId, body = {}) =>
      run(() => {
        const input = parseInput(CompleteComplianceDeadlineRequest, body);
        const d = find(deadlineId);
        needOpen(d);
        d.status = 'COMPLETED';
        d.completedAt = nowIso();
        d.completedBy = mockMe;
        d.filedOn = input.filedOn ?? today();
        d.confirmationNumber = input.confirmationNumber ?? null;
        return touch(d);
      }),
    reopenDeadline: (deadlineId) =>
      run(() => {
        const d = find(deadlineId);
        if (d.archived || open(d)) {
          throw fail(409, 'DEADLINE_STATE', 'Only a completed or closed deadline can be reopened.');
        }
        d.status = 'UPCOMING';
        d.completedAt = null;
        d.completedBy = null;
        d.filedOn = null;
        d.confirmationNumber = null;
        d.notApplicableReason = null;
        return touch(d);
      }),
    notApplicable: (deadlineId, body) =>
      run(() => {
        const input = parseInput(NotApplicableRequest, body);
        const d = find(deadlineId);
        needOpen(d);
        d.status = 'NOT_APPLICABLE';
        d.notApplicableReason = input.reason;
        return touch(d);
      }),
    reassign: (deadlineId, body) =>
      run(() => {
        const input = parseInput(ReassignRequest, body);
        const d = find(deadlineId);
        if (d.archived) throw fail(409, 'DEADLINE_STATE', 'This deadline is archived.');
        if (input.assignedUserId && !memberOf(input.assignedUserId)) {
          throw fail(409, 'NOT_A_MEMBER', 'That person is not on your team.');
        }
        d.assignedTo = memberOf(input.assignedUserId);
        return touch(d);
      }),
    archiveDeadline: (deadlineId) =>
      run(() => {
        const d = find(deadlineId);
        d.archived = true;
        d.archivedAt = nowIso();
        return touch(d);
      }),
    fileExtension: (deadlineId, body) =>
      run(() => {
        const input = parseInput(ExtensionRequest, body);
        const d = find(deadlineId);
        needOpen(d);
        if (input.extendedDueOn < d.dueOn) {
          throw fail(400, 'VALIDATION_FAILED', 'The extended date is before the due date.');
        }
        d.extensionFiledOn = input.filedOn;
        d.extendedDueOn = input.extendedDueOn;
        return touch(d);
      }),
    saveReminders: (deadlineId, body) =>
      run(() => {
        const input = parseInput(SaveRemindersRequest, body);
        const d = find(deadlineId);
        d.reminders = input.reminders.map((r) => ({
          daysBefore: r.daysBefore,
          inApp: r.inApp ?? true,
          channels: r.channels ?? [],
        }));
        return touch(d);
      }),
    addTask: (deadlineId, body = {}) =>
      run(() => {
        const input = parseInput(CreateDeadlineTaskRequest, body);
        const d = find(deadlineId);
        needOpen(d);
        const title = input.title ?? `Prepare ${d.name}`;
        if (d.tasks.some((t) => t.title === title)) {
          throw fail(409, 'DUPLICATE', 'A task like this already exists for this deadline.');
        }
        d.tasks.push({
          id: id('5a00'),
          title,
          status: 'OPEN',
          dueOn: plus(effectiveDue(d), -3),
          assignedTo: d.assignedTo,
        });
        return touch(d);
      }),
    linkTask: (deadlineId, body) =>
      run(() => {
        const input = parseInput(LinkDeadlineTaskRequest, body);
        const d = find(deadlineId);
        if (d.tasks.some((t) => t.id === input.taskId)) {
          throw fail(409, 'DUPLICATE', 'That task is already linked.');
        }
        d.tasks.push({
          id: input.taskId,
          title: 'Linked task',
          status: 'OPEN',
          dueOn: null,
          assignedTo: d.assignedTo,
        });
        return touch(d);
      }),
    removeTask: (deadlineId, taskId) =>
      run(() => {
        const d = find(deadlineId);
        d.tasks = d.tasks.filter((t) => t.id !== taskId);
        return touch(d);
      }),
    addDocument: (deadlineId, body: AddDeadlineDocumentRequest) =>
      run(() => {
        const d = find(deadlineId);
        if (d.documents.some((x) => x.documentId === body.documentId)) {
          throw fail(409, 'DUPLICATE', 'That document is already added.');
        }
        d.documents.push({
          documentId: body.documentId,
          fileName: `Supporting document ${d.documents.length + 1}.pdf`,
          addedAt: nowIso(),
        });
        return touch(d);
      }),
    removeDocument: (deadlineId, documentId) =>
      run(() => {
        const d = find(deadlineId);
        d.documents = d.documents.filter((x) => x.documentId !== documentId);
        return touch(d);
      }),
    addLink: (deadlineId, body: AddDeadlineLinkRequest) =>
      run(() => {
        const d = find(deadlineId);
        const other = find(body.relatedDeadlineId);
        if (other.client.id !== d.client.id) {
          throw fail(409, 'NOT_THIS_CLIENTS', 'Only this client’s deadlines can be linked.');
        }
        if (other.id === d.id || d.relatedDeadlines.some((r) => r.id === other.id)) {
          throw fail(409, 'DUPLICATE', 'That deadline is already linked.');
        }
        d.relatedDeadlines.push({
          id: other.id,
          name: other.name,
          dueOn: other.dueOn,
          displayStatus: view(other).displayStatus,
        });
        return touch(d);
      }),
    removeLink: (deadlineId, relatedId) =>
      run(() => {
        const d = find(deadlineId);
        d.relatedDeadlines = d.relatedDeadlines.filter((r) => r.id !== relatedId);
        return touch(d);
      }),
    saveAsTemplate: (deadlineId, body) =>
      run(() => {
        const input = parseInput(SaveDeadlineAsTemplateRequest, body);
        const d = find(deadlineId);
        return library.templateFrom(d, input.name);
      }),
    bulk: (body) =>
      run(() => {
        const input = parseInput(BulkDeadlinesRequest, body);
        const updated: string[] = [];
        const skipped: { id: string; reason: string }[] = [];
        for (const deadlineId of input.ids) {
          const d = store.deadlines.find((x) => x.id === deadlineId);
          if (!d) {
            skipped.push({ id: deadlineId, reason: 'Not found.' });
            continue;
          }
          if (d.archived) {
            skipped.push({ id: d.id, reason: 'Archived.' });
            continue;
          }
          if (input.action === 'REASSIGN') {
            d.assignedTo = memberOf(input.assignedUserId ?? null);
          } else if (input.action === 'ARCHIVE') {
            d.archived = true;
            d.archivedAt = nowIso();
          } else {
            if (!open(d)) {
              skipped.push({ id: d.id, reason: 'Already closed.' });
              continue;
            }
            d.status = input.status!;
            if (input.status === 'COMPLETED') {
              d.completedAt = nowIso();
              d.completedBy = mockMe;
              d.filedOn = today();
            }
            if (input.status === 'NOT_APPLICABLE') d.notApplicableReason = input.reason ?? null;
          }
          d.updatedAt = nowIso();
          updated.push(d.id);
        }
        return { updated, skipped };
      }),
    ...library.methods,
  };
}
