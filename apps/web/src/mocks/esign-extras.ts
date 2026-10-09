import {
  DuplicateEsignTemplateBody,
  EsignApprovalBody,
  type EsignAccessRole,
  type EsignBulkBatch,
  ESIGN_BULK_MAX,
  ESIGN_KIOSK_PASSWORD_TRIES,
  EsignErrorCode,
  EsignBulkSendBody,
  type EsignClient,
  type EsignInPersonSession,
  type EsignMemberRole,
  EsignRecipientId,
  type EsignReadinessCode,
  type EsignReportTotals,
  EsignReportQuery,
  type EsignRequestDetail,
  type EsignTemplateDetail,
  EsignTemplateId,
  type EsignTemplateVersion,
  ExitEsignInPersonBody,
  type MemberRef,
  parseInput,
  RestoreEsignTemplateVersionBody,
  SaveEsignTemplateVersionBody,
  SetEsignMemberRoleBody,
  StartEsignInPersonBody,
  SubmitEsignApprovalBody,
} from '@firmivra/types';
import { clientFixtures } from './clients';
import { copy, fail, HOUR, iso, MINUTE } from './esign-common';
import { engagementFixtures } from './engagements';
import {
  checkTemplateSource,
  type EsignAdminContext,
  type EsignBaseClient,
  type ExtrasKeys,
  esignTemplateStore,
  type TemplateExtrasKeys,
  MOCK_SIGNING_TOKENS,
} from './esign-signing';

/**
 * Contract 3's extras for the firm-side mock (mocks/esign.ts): approvals, Firm Sign roles,
 * template versions and duplicate, in-person signing, bulk send and reports. Synthetic data only.
 * - The in-person password is `mock-password`; 5 wrong ones answer 401 (signed out). The kiosk
 *   link opens the signer pages with MOCK_SIGNING_TOKENS.inPerson (on NEXT_PUBLIC_PORTAL_BASE_URL,
 *   else http://portal.localhost:3000).
 * - Bulk send creates and sends every client's request at once; a client with no open service or
 *   a readiness problem stays a DRAFT, NOT_SENT.
 */
export const MOCK_KIOSK_PASSWORD = 'mock-password';
const PORTAL = process.env.NEXT_PUBLIC_PORTAL_BASE_URL ?? 'http://portal.localhost:3000';
/** A bulk row's problem: the error's own code when it is a Firm Sign one, else `fallback`. */
const problemOf = (
  e: unknown,
  fallback: EsignErrorCode | EsignReadinessCode,
): EsignErrorCode | EsignReadinessCode => {
  const code = EsignErrorCode.safeParse((e as { code?: unknown }).code);
  return code.success ? code.data : fallback;
};

/** `on` here only checks Firm Sign is on: `unlocked()` adds the kiosk lock where it applies. */
export interface EsignExtrasContext extends EsignAdminContext {
  client: EsignBaseClient & { templates: Pick<EsignClient['templates'], 'use'> };
  role: EsignAccessRole;
  /** Every request the caller may see (the store's own copies). */
  visible: () => EsignRequestDetail[];
  /** The firm's members: Owner (`mockMe`) and Sam Staff. */
  members: (MemberRef & { email: string; firmRole: 'OWNER' | 'ADMIN' | 'STAFF' })[];
}

interface ExtrasState {
  versions: Map<string, EsignTemplateVersion[]>;
  esignRoles: Map<string, 'MANAGER' | 'STAFF' | 'VIEWER'>;
  kiosk: EsignInPersonSession | null;
  wrongPasswords: number;
  batches: Map<string, EsignBulkBatch>;
}
let state: ExtrasState | undefined;
const extras = (): ExtrasState =>
  (state ??= {
    versions: new Map(),
    esignRoles: new Map(),
    kiosk: null,
    wrongPasswords: 0,
    batches: new Map(),
  });

export function esignExtrasMock(
  ctx: EsignExtrasContext,
): Pick<EsignClient, ExtrasKeys> & Pick<EsignClient['templates'], TemplateExtrasKeys> {
  const manager = ctx.templateManager;
  const forbidden = () => fail(403, 'FORBIDDEN', 'You can’t do this');
  const ownerOrAdmin = () => {
    if (ctx.role !== 'OWNER' && ctx.role !== 'ADMIN') throw forbidden();
  };
  const mayApprove = (userId: string) =>
    esignMockMayApprove(ctx.members, userId, { userId: ctx.me.userId, role: ctx.role });
  const unlocked = async () => {
    await ctx.on();
    if (extras().kiosk) throw fail(403, 'KIOSK_LOCKED', 'An in-person signing is open');
  };
  const template = (templateId: string): EsignTemplateDetail => {
    const tid = parseInput(EsignTemplateId, templateId);
    const t = esignTemplateStore(ctx.me).find(
      (x) =>
        x.id === tid &&
        (x.visibility === 'FIRM' || x.owner.userId === ctx.me.userId || ctx.manager),
    );
    if (!t) throw fail(404, 'NOT_FOUND', 'Not found');
    return t;
  };
  const editable = (t: EsignTemplateDetail) => {
    if (!manager && t.owner.userId !== ctx.me.userId) throw forbidden();
    if (t.archivedAt) throw fail(409, 'TEMPLATE_ARCHIVED', 'This template is archived');
  };
  const versionsOf = (t: EsignTemplateDetail) => {
    let list = extras().versions.get(t.id);
    if (!list) {
      list = [
        {
          version: t.version,
          savedAt: t.updatedAt,
          savedBy: t.owner,
          note: null,
          pageCount: t.pageCount,
          roleCount: t.roleCount,
          fieldCount: t.fields.length,
          current: true,
        },
      ];
      extras().versions.set(t.id, list);
    }
    return list;
  };
  const addVersion = (t: EsignTemplateDetail, note: string | null) => {
    const list = versionsOf(t);
    for (const v of list) v.current = false;
    t.version += 1;
    t.updatedAt = iso(Date.now());
    list.unshift({
      version: t.version,
      savedAt: t.updatedAt,
      savedBy: ctx.me,
      note,
      pageCount: t.pageCount,
      roleCount: t.roleCount,
      fieldCount: t.fields.length,
      current: true,
    });
  };
  const roleOf = (m: EsignExtrasContext['members'][number]): EsignMemberRole => ({
    user: { userId: m.userId, name: m.name },
    email: m.email,
    esignRole: m.firmRole === 'STAFF' ? (extras().esignRoles.get(m.userId) ?? 'STAFF') : m.firmRole,
    canChange: m.firmRole === 'STAFF',
  });

  return {
    saveAsVersion: async (requestId, body) => {
      const input = parseInput(SaveEsignTemplateVersionBody, body);
      await unlocked();
      const r = ctx.find(requestId);
      const t = template(input.templateId);
      editable(t);
      checkTemplateSource(r);
      t.pageCount = r.pagePlan.length;
      t.roleCount = r.recipients.length;
      t.routing = r.routing;
      t.expiryDays = r.expiryDays;
      t.reminders = { ...r.reminders };
      addVersion(t, input.note ?? null);
      return copy(t);
    },

    submitForApproval: async (requestId, body) => {
      parseInput(SubmitEsignApprovalBody, body);
      await unlocked();
      const r = ctx.stored(requestId);
      if (r.status !== 'DRAFT') throw fail(409, 'INVALID_STATE', 'Not a draft');
      const { problems } = await ctx.client.readiness(requestId);
      const approvers = r.recipients.filter((x) => x.kind === 'APPROVER');
      if (
        !problems.some((p) => p.code === 'APPROVAL_PENDING') ||
        problems.some((p) => p.code !== 'APPROVAL_PENDING')
      ) {
        // Approvals that still stand (a failed send) need no new round: send it instead.
        throw fail(409, 'NOT_READY', 'The request is not ready');
      }
      for (const x of approvers) {
        const userId = x.link.type === 'STAFF' ? x.link.userId : '';
        if (userId === r.sender.userId || !mayApprove(userId)) {
          throw fail(409, 'APPROVER_NOT_ALLOWED', 'This person cannot approve this request');
        }
      }
      r.status = 'NEEDS_APPROVAL';
      for (const x of approvers) {
        x.status = 'SENT';
        x.sentAt = iso(Date.now());
      }
      r.lastActivityAt = iso(Date.now());
      ctx.record(r, 'APPROVAL_REQUESTED');
      return ctx.find(requestId);
    },

    decideApproval: async (requestId, body) => {
      const input = parseInput(EsignApprovalBody, body);
      await unlocked();
      const r = ctx.stored(requestId);
      const me = r.recipients.find(
        (x) => x.kind === 'APPROVER' && x.link.type === 'STAFF' && x.link.userId === ctx.me.userId,
      );
      if (!me || !mayApprove(ctx.me.userId) || r.sender.userId === ctx.me.userId) {
        throw fail(403, 'NOT_AN_APPROVER', 'You are not an approver');
      }
      if (r.status !== 'NEEDS_APPROVAL') throw fail(409, 'INVALID_STATE', 'Not waiting');
      if (me.status === 'APPROVED') throw fail(409, 'RECIPIENT_DONE', 'Already decided');
      r.approvalNotes.push({
        recipientId: me.id,
        decision: input.decision,
        note: input.note ?? '',
      });
      const who = { recipient: { id: me.id, name: me.name } };
      if (input.decision === 'REJECT') {
        r.status = 'DRAFT';
        for (const x of r.recipients) if (x.kind === 'APPROVER') x.status = 'WAITING';
        ctx.record(r, 'APPROVAL_REJECTED', who);
        return ctx.find(requestId);
      }
      me.status = 'APPROVED';
      ctx.record(r, 'APPROVED', who);
      if (r.recipients.every((x) => x.kind !== 'APPROVER' || x.status === 'APPROVED')) {
        // If the send fails, the approvals stand and the request stays a DRAFT.
        r.status = 'DRAFT';
        return ctx.client.send(requestId, { confirm: true }).catch(() => ctx.find(requestId));
      }
      return ctx.find(requestId);
    },

    inPerson: {
      start: async (requestId, body) => {
        const { recipientId } = parseInput(StartEsignInPersonBody, body);
        await unlocked();
        const r = ctx.stored(requestId);
        if (['COMPLETED', 'DECLINED', 'EXPIRED', 'VOIDED'].includes(r.status)) {
          throw fail(409, 'REQUEST_CLOSED', 'The request is closed');
        }
        const x = r.recipients.find((k) => k.id === parseInput(EsignRecipientId, recipientId));
        if (!x) throw fail(404, 'NOT_FOUND', 'Not found');
        if (x.delivery !== 'IN_PERSON') throw fail(409, 'NOT_IN_PERSON', 'Not in person');
        if (x.status === 'SIGNED' || x.status === 'DECLINED') {
          throw fail(409, 'RECIPIENT_DONE', 'Already finished');
        }
        if (!['SENT', 'DELIVERED', 'VIEWED'].includes(x.status)) {
          throw fail(409, 'NOT_YOUR_TURN', 'Not their turn');
        }
        const now = Date.now();
        extras().kiosk = {
          requestId: r.id,
          recipientId: x.id,
          signerName: x.name,
          signingUrl: `${PORTAL}/lvp/sign#t=${MOCK_SIGNING_TOKENS.inPerson}`,
          startedAt: iso(now),
          expiresAt: iso(now + 15 * MINUTE),
        };
        ctx.record(r, 'IN_PERSON_STARTED', { recipient: { id: x.id, name: x.name } });
        return copy(extras().kiosk!);
      },
      state: async () => {
        await ctx.on();
        return { session: copy(extras().kiosk) };
      },
      exit: async (body) => {
        const { password } = parseInput(ExitEsignInPersonBody, body);
        await ctx.on();
        const k = extras().kiosk;
        if (!k) return { ok: true as const };
        if (password !== MOCK_KIOSK_PASSWORD) {
          extras().wrongPasswords += 1;
          if (extras().wrongPasswords >= ESIGN_KIOSK_PASSWORD_TRIES) {
            extras().kiosk = null;
            extras().wrongPasswords = 0;
            throw fail(401, 'UNAUTHENTICATED', 'Signed out');
          }
          throw fail(400, 'PASSWORD_WRONG', 'Wrong password');
        }
        extras().kiosk = null;
        extras().wrongPasswords = 0;
        const r = ctx.stored(k.requestId);
        ctx.record(r, 'IN_PERSON_ENDED', { recipient: { id: k.recipientId, name: k.signerName } });
        return { ok: true as const };
      },
    },

    approvers: async () => {
      await unlocked();
      return {
        items: ctx.members
          .filter((m) => m.userId !== ctx.me.userId && mayApprove(m.userId))
          .map((m) => ({
            user: { userId: m.userId, name: m.name },
            esignRole: m.firmRole === 'STAFF' ? ('MANAGER' as const) : m.firmRole,
          })),
      };
    },

    roles: {
      list: async () => {
        await unlocked();
        ownerOrAdmin();
        return { items: ctx.members.map(roleOf) };
      },
      set: async (userId, body) => {
        const { esignRole } = parseInput(SetEsignMemberRoleBody, body);
        await unlocked();
        ownerOrAdmin();
        const m = ctx.members.find((x) => x.userId === userId);
        if (!m) throw fail(409, 'NOT_A_MEMBER', 'Not a member');
        if (m.firmRole !== 'STAFF') throw fail(409, 'ROLE_FIXED', 'Owner and Admin are fixed');
        extras().esignRoles.set(m.userId, esignRole);
        return roleOf(m);
      },
    },

    bulk: async (batchId) => {
      await unlocked();
      const b = extras().batches.get(batchId);
      if (!b || (!ctx.manager && b.createdBy.userId !== ctx.me.userId)) {
        throw fail(404, 'NOT_FOUND', 'Not found');
      }
      return copy(b);
    },

    report: async (query) => {
      const q = parseInput(EsignReportQuery, query);
      await unlocked();
      const sent = ctx
        .visible()
        .filter(
          (r) =>
            r.sentAt !== null &&
            r.sentAt.slice(0, 10) >= q.from &&
            r.sentAt.slice(0, 10) <= q.to &&
            (!q.status || r.status === q.status) &&
            (!q.senderId || r.sender.userId === q.senderId),
        );
      const totals = (list: EsignRequestDetail[]): EsignReportTotals => {
        const done = list.filter((r) => r.status === 'COMPLETED' && r.completedAt && r.sentAt);
        const hours = done.map((r) => (Date.parse(r.completedAt!) - Date.parse(r.sentAt!)) / HOUR);
        const count = (...s: string[]) => list.filter((r) => s.includes(r.status)).length;
        return {
          sent: list.length,
          completed: done.length,
          outstanding: count('SENT', 'DELIVERED', 'VIEWED', 'PARTIALLY_SIGNED'),
          declined: count('DECLINED'),
          expired: count('EXPIRED'),
          voided: count('VOIDED'),
          completionRate: list.length ? done.length / list.length : null,
          averageCompletionHours: hours.length
            ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10
            : null,
        };
      };
      const senders = new Map<string, MemberRef>();
      for (const r of sent) senders.set(r.sender.userId, r.sender);
      return {
        from: q.from,
        to: q.to,
        totals: totals(sent),
        bySender: [...senders.values()]
          .map((s) => ({ sender: s, ...totals(sent.filter((r) => r.sender.userId === s.userId)) }))
          .sort((a, b) => b.sent - a.sent),
      };
    },

    versions: async (templateId) => {
      await unlocked();
      return { items: copy(versionsOf(template(templateId))) };
    },
    restoreVersion: async (templateId, version, body = {}) => {
      const { note } = parseInput(RestoreEsignTemplateVersionBody, body);
      await unlocked();
      const t = template(templateId);
      editable(t);
      if (!versionsOf(t).some((v) => v.version === version)) {
        throw fail(404, 'NOT_FOUND', 'Not found');
      }
      addVersion(t, note ?? `Restored version ${version}`);
      return copy(t);
    },
    duplicate: async (templateId, body) => {
      const input = parseInput(DuplicateEsignTemplateBody, body);
      await unlocked();
      const t = template(templateId);
      const taken = esignTemplateStore(ctx.me).some(
        (x) => !x.archivedAt && x.name.toLowerCase() === input.name.toLowerCase(),
      );
      if (taken) throw fail(409, 'TEMPLATE_NAME_TAKEN', 'Name taken');
      const dup: EsignTemplateDetail = {
        ...copy(t),
        id: ctx.newId('e'),
        name: input.name,
        visibility: input.visibility ?? t.visibility,
        owner: ctx.me,
        version: 1,
        updatedAt: iso(Date.now()),
        archivedAt: null,
        canEdit: true,
      };
      esignTemplateStore(ctx.me).unshift(dup);
      return copy(dup);
    },
    bulkSend: async (templateId, body) => {
      if (Array.isArray(body.clients) && body.clients.length > ESIGN_BULK_MAX) {
        await ctx.on();
        throw fail(400, 'BULK_LIMIT', 'At most 200 clients');
      }
      const input = parseInput(EsignBulkSendBody, body);
      await unlocked();
      const t = template(templateId);
      if (t.archivedAt) throw fail(409, 'TEMPLATE_ARCHIVED', 'This template is archived');
      const batch: EsignBulkBatch = {
        id: ctx.newId('f'),
        templateId: t.id,
        templateName: t.name,
        createdBy: ctx.me,
        createdAt: iso(Date.now()),
        done: true,
        items: [],
      };
      for (const c of input.clients) {
        const name = clientFixtures().find((x) => x.id === c.clientId)?.displayName ?? 'Client';
        try {
          const open = engagementFixtures().filter(
            (e) => e.clientId === c.clientId && ['PENDING', 'ACTIVE'].includes(e.status),
          );
          const r = await ctx.client.templates.use(templateId, {
            clientId: c.clientId,
            engagementId: c.engagementId ?? (open.length === 1 ? open[0]!.id : undefined),
            title: input.title,
            roles: input.roles,
          });
          ctx.stored(r.id).source = 'BULK';
          try {
            await ctx.client.send(r.id, { confirm: true });
            batch.items.push({
              clientId: c.clientId,
              clientName: name,
              state: 'SENT',
              requestId: r.id,
              problem: null,
            });
          } catch (e) {
            const code = problemOf(e, 'NOT_READY');
            batch.items.push({
              clientId: c.clientId,
              clientName: name,
              state: 'NOT_SENT',
              requestId: r.id,
              problem: code,
            });
          }
        } catch (e) {
          const code = problemOf(e, 'NO_CLIENT');
          batch.items.push({
            clientId: c.clientId,
            clientName: name,
            state: 'NOT_SENT',
            requestId: null,
            problem: code,
          });
        }
      }
      extras().batches.set(batch.id, batch);
      return copy(batch);
    },
  };
}

/**
 * Who may approve, the one rule for both firm-side mocks: an Owner or Admin, or a Staff member
 * who is a Firm Sign Manager (set with `roles.set`, or the caller signed in as one).
 */
export const esignMockMayApprove = (
  members: readonly { userId: string; firmRole: 'OWNER' | 'ADMIN' | 'STAFF' }[],
  userId: string,
  caller: { userId: string; role: EsignAccessRole },
): boolean => {
  const m = members.find((x) => x.userId === userId);
  if (!m) return false;
  if (m.firmRole !== 'STAFF') return true;
  return (
    state?.esignRoles.get(userId) === 'MANAGER' ||
    (userId === caller.userId && caller.role === 'MANAGER')
  );
};

/** True while an in-person signing is open: every other firm call answers 403 KIOSK_LOCKED. */
export const esignKioskOpen = () => state?.kiosk != null;
