import type {
  AdminAuditEvent,
  AdminAuditEventDetail,
  AdminAuditEventQuery,
  AdminAuditNote,
  AdminAuditSummary,
} from '@firmivra/types';
import { api } from '../../../../../lib/api';
import { mocked } from '../../../../../lib/mock';
import {
  adminAuditSecurity as mockAudit,
  CATEGORY_GUIDANCE,
  SEVERITY_MEANINGS,
  type AuditActionTaken,
  type AuditEvent,
  type AuditEventDetail,
  type AuditEventPage,
  type AuditEventQuery,
  type AuditExport,
  type AuditFacets,
  type AuditSummary,
  type AuditTone,
  type ExportFormat,
  type InvestigationNote,
  type ResponseAction,
  type SecuritySettings,
  type SecuritySettingsRecord,
} from '../../../../../mocks/admin-audit-security';

// The Audit & Security screens' data (R55): `api.adminAudit` (contract
// packages/types/src/admin-audit), under the method names the screens were built with. Mock mode
// (NEXT_PUBLIC_API_MOCK=adminAuditSecurity) keeps mocks/admin-audit-security.ts. What differs from
// the contract is handled here:
// - The cards' trend is the last 7 days against the 7 before (a second summary call); the API has
//   no session count (sessions are firm data), so Active Sessions shows as not available.
// - A list row carries no timeline, notes or actions; Event Details fills them from the detail:
//   the rows that name the event (reviews, alerts raised) are its timeline and actions taken.
// - What the API does not record (the source, the actor's email, risk indicators) shows as not
//   recorded or empty;
//   recommendations are the category's guidance.

const DAY_MS = 86_400_000;
const TONES: Record<AdminAuditEvent['severity'], AuditTone> = {
  INFO: 'info',
  LOW: 'success',
  MEDIUM: 'warning',
  HIGH: 'danger',
  CRITICAL: 'danger',
};
/** The rows a response action writes, by the action they record. */
const RESPONSES: Record<string, ResponseAction> = {
  'audit.event_reviewed': 'MARK_REVIEWED',
  'security_alert.created': 'SEND_ALERT',
};
const OUTCOME_TEXT = { SUCCESS: 'Success', FAILURE: 'Failed', DENIED: 'Denied' } as const;

/** A list row in the screens' shape. */
function shown(e: AdminAuditEvent): AuditEvent {
  return {
    id: e.id,
    reference: e.reference,
    type: e.type,
    action: e.action,
    category: e.category,
    severity: e.severity,
    outcome: e.outcome,
    alertState: e.alertState,
    at: e.at,
    title: e.action,
    summary: e.summary,
    details: e.summary,
    description: e.summary,
    actor: { ...e.actor, email: null },
    firm: e.firm,
    source: 'Not recorded',
    authMethod: e.authMethod,
    sessionId: e.sessionId,
    requestId: e.requestId ?? '',
    referrerUrl: null,
    device: {
      ...e.device,
      browserName: e.device.browser ?? 'Unknown',
      osName: e.device.os ?? 'Unknown',
      browser: e.device.browser ?? 'Unknown',
      os: e.device.os ?? 'Unknown',
    },
    target: {
      type: e.target.type,
      id: e.target.id ?? '',
      name: e.target.name ?? e.target.type,
      relatedRecord: null,
      href: null,
    },
    subjectUserId: e.subjectUserId,
    facts: e.itemCount === null ? [] : [{ label: 'Records', value: String(e.itemCount) }],
    changes: [],
    risk: {
      score: e.risk.score,
      rule: e.risk.rule,
      reason: e.risk.reason ?? SEVERITY_MEANINGS[e.severity],
      indicators: [],
    },
    recommendations: CATEGORY_GUIDANCE[e.category],
    quickInfo: [
      { label: 'Recorded', at: e.at, show: 'datetime' },
      { label: 'Outcome', value: OUTCOME_TEXT[e.outcome] },
    ],
    timeline: [
      { id: `${e.id}-recorded`, at: e.at, label: 'Event recorded', tone: TONES[e.severity] },
    ],
    actionsTaken: [],
    notes: [],
    relatedEventId: e.relatedEventId,
    reviewedAt: e.reviewedAt,
  };
}

/** The notes still standing: not retracted and not corrected by a later one. */
function notesOf(notes: AdminAuditNote[]): InvestigationNote[] {
  const replaced = new Set(notes.map((n) => n.supersedesId).filter(Boolean));
  return notes
    .filter((n) => !n.retractedAt && !replaced.has(n.id))
    .map((n) => ({ id: n.id, author: n.author.name, at: n.at, text: n.text }));
}

function detailOf(d: AdminAuditEventDetail): AuditEventDetail {
  const event = shown(d.event);
  const actionsTaken: AuditActionTaken[] = d.timeline.flatMap((t) => {
    const action = RESPONSES[t.type];
    return action
      ? [
          {
            id: t.id,
            action,
            label: t.action,
            by: t.actor.name,
            at: t.at,
            reason: null,
            eventId: t.id,
          },
        ]
      : [];
  });
  return {
    event: {
      ...event,
      changes: d.changes,
      timeline: [
        ...event.timeline,
        ...d.timeline.map((t) => ({
          id: t.id,
          at: t.at,
          label: `${t.action} by ${t.actor.name}`,
          tone: TONES[t.severity],
        })),
      ],
      actionsTaken,
      notes: notesOf(d.notes),
    },
    // The admin scope reads no firm accounts or sessions: the account panel shows what the event has.
    account: null,
    related: d.related.map(shown),
    relatedTotal: d.relatedTotal,
    previousId: d.previousId,
    nextId: d.nextId,
    actions: d.actions,
  };
}

/** The screens' query in the contract's terms. */
function apiQuery(query: AuditEventQuery): AdminAuditEventQuery {
  return Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== ''),
  ) as AdminAuditEventQuery;
}

const metric = (range: AdminAuditSummary['openAlerts'], week: AdminAuditSummary['openAlerts']) => ({
  value: range.value,
  current: week.value,
  previous: week.previous,
});

const real = {
  facets: (): Promise<AuditFacets> => api.adminAudit.facets(),
  summary: async (range: { from?: string; to?: string }): Promise<AuditSummary> => {
    const end = range.to ?? new Date().toISOString();
    const [selected, week] = await Promise.all([
      api.adminAudit.summary(range),
      api.adminAudit.summary({
        from: new Date(new Date(end).getTime() - 7 * DAY_MS).toISOString(),
        to: end,
      }),
    ]);
    return {
      securityAlerts: metric(selected.openAlerts, week.openAlerts),
      failedLogins: metric(selected.failedLogins, week.failedLogins),
      highRiskEvents: metric(selected.highRiskEvents, week.highRiskEvents),
      activeSessions:
        selected.activeSessions && week.activeSessions
          ? metric(selected.activeSessions, week.activeSessions)
          : null,
    };
  },
  events: async (query: AuditEventQuery = {}): Promise<AuditEventPage> => {
    const page = await api.adminAudit.events(apiQuery(query));
    return { ...page, items: page.items.map(shown) };
  },
  event: async (id: string): Promise<AuditEventDetail> => detailOf(await api.adminAudit.event(id)),
  /** The action, then the event again (its timeline and actions taken have changed). */
  respond: async (body: {
    eventId: string;
    action: ResponseAction;
    reason?: string;
  }): Promise<AuditEventDetail> => {
    const reason = body.reason?.trim();
    await api.adminAudit.respond(body.eventId, {
      action: body.action,
      ...(reason ? { reason } : {}),
    });
    return detailOf(await api.adminAudit.event(body.eventId));
  },
  addNote: async (body: { eventId: string; text: string }): Promise<InvestigationNote> => {
    const note = await api.adminAudit.addNote(body.eventId, { text: body.text });
    return { id: note.id, author: note.author.name, at: note.at, text: note.text };
  },
  /** The file comes in the answer, so there is no link to expire. */
  exportEvents: async (body: {
    query: AuditEventQuery;
    format: ExportFormat;
  }): Promise<AuditExport> => {
    const { page: _page, pageSize: _size, ...query } = apiQuery(body.query);
    const file = await api.adminAudit.exportEvents({ query, format: body.format });
    return { ...file, expiresAt: '' };
  },
  settings: (): Promise<SecuritySettingsRecord> => api.adminAudit.settings(),
  saveSettings: (body: {
    version: number;
    settings: SecuritySettings;
  }): Promise<SecuritySettingsRecord> => api.adminAudit.saveSettings(body),
};

/** The screens' client: the mock in mock mode, the API otherwise. */
export const adminAuditSecurity: typeof real = mocked('adminAuditSecurity') ? mockAudit : real;
