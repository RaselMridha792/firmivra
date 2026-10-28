import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CheckOutboundRequest,
  ListOutboundQuery,
  OutboundCheck,
  OutboundExclusion,
  OutboundMessage,
  OutboundMessageList,
  OutboundRecipient,
  OutboundReview,
  SaveOutboundRequest,
  ScheduleOutboundRequest,
  UpdateOutboundRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { legacyFirmRole } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { reach as leadReach, toE164, visibleLead } from '../leads/pipeline.shared.js';
import type { NotifyConfig } from '../notify/config.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';
import { NotifyDeliveryError } from '../notify/notify.service.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { fill } from '../templates/merge-fields.js';
import { TemplateRenderService } from '../templates/template-render.service.js';
import { MessagesService } from './messages.service.js';

type Channel = OutboundMessage['channel'];
type Save = z.output<typeof SaveOutboundRequest>;
type Update = z.output<typeof UpdateOutboundRequest>;
type Check = z.output<typeof CheckOutboundRequest>;
type Schedule = z.output<typeof ScheduleOutboundRequest>;
type ListQuery = z.output<typeof ListOutboundQuery>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const stale = () =>
  conflict('STALE_VERSION', 'This message changed since you opened it. Reload to see it.');
/** A schedule at least this far ahead. */
const LEAD_TIME_MS = 60_000;
const linkOn = (base: string, path: string) => `${base.replace(/\/+$/, '')}${path}`;

const messageSelect = {
  id: true,
  kind: true,
  status: true,
  channel: true,
  subject: true,
  body: true,
  templateId: true,
  scheduledFor: true,
  createdByUserId: true,
  completedAt: true,
  canceledAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { userId: true, role: true, user: { select: { name: true } } } },
  recipients: {
    select: {
      clientId: true,
      leadId: true,
      channel: true,
      status: true,
      exclusion: true,
      message: { select: { threadId: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.OutboundMessageSelect;
type Row = Prisma.OutboundMessageGetPayload<{ select: typeof messageSelect }>;

/** A person and what the channel needs from them, read once. */
interface Person {
  kind: 'CLIENT' | 'LEAD';
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  archived: boolean;
  portal: boolean;
  /** Consent per channel: the newest record's status, when there is one. */
  consent: { EMAIL?: string; SMS?: string };
}

/**
 * New Message (R60, MSG-F09, F10, F14), on R36's outbound_messages (kind DIRECT): drafts,
 * schedules and sends to chosen clients and leads. Every query runs in the firm's scope with
 * `businessId` from TenantGuard; Staff reach only their own clients and leads (404 otherwise) and
 * only their own drafts. A client's message always goes into their portal conversation through
 * MessagesService; Email adds the `message.received` email to the client's address on record,
 * never the text (Rasel, Oct 28). A lead has no portal: Email and SMS carry the text through the
 * Leads templates. Whoever cannot receive is skipped with the reason; a recipient is never sent
 * twice (the database refuses it). The audit log gets ids and counts, never a subject or a text.
 */
@Injectable()
export class OutboundMessagesService {
  private readonly logger = new Logger('OutboundMessages');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(NOTIFY_CONFIG) private readonly notifyConfig: NotifyConfig,
    @Inject(ENV) private readonly env: Env,
    private readonly messages: MessagesService,
    private readonly render: TemplateRenderService,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private clientReach(actor: ClientsActor): Prisma.ClientWhereInput {
    return actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};
  }

  private async settings(tx: TxClient, businessId: string) {
    const s = await tx.messageSettings.findUnique({
      where: { businessId },
      select: { portalEnabled: true, emailEnabled: true, smsEnabled: true },
    });
    return {
      portal: s?.portalEnabled ?? true,
      email: s?.emailEnabled ?? true,
      sms: !!s?.smsEnabled,
    };
  }

  private smsReady(): boolean {
    const sms = this.notifyConfig.sms;
    return !(sms.mode === 'log' && sms.unregistered);
  }

  /** The people, all within the actor's reach (404 when any is not). */
  private async people(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    clientIds: string[],
    leadIds: string[],
  ): Promise<Person[]> {
    const cids = [...new Set(clientIds)];
    const lids = [...new Set(leadIds)];
    const [clients, leads, accounts, consents] = await Promise.all([
      cids.length
        ? tx.client.findMany({
            where: { AND: [{ businessId, id: { in: cids } }, this.clientReach(actor)] },
            select: { id: true, displayName: true, email: true, phone: true, archivedAt: true },
          })
        : [],
      lids.length
        ? tx.lead.findMany({
            where: {
              AND: [visibleLead(businessId), leadReach(actor), { id: { in: lids } }],
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              archivedAt: true,
            },
          })
        : [],
      cids.length
        ? tx.clientAccount.findMany({
            where: { businessId, clientId: { in: cids }, status: 'ACTIVE' },
            select: { clientId: true },
          })
        : [],
      tx.communicationConsent.findMany({
        where: {
          businessId,
          OR: [{ clientId: { in: cids } }, { leadId: { in: lids } }],
          channel: { in: ['EMAIL', 'SMS'] },
        },
        select: { clientId: true, leadId: true, channel: true, status: true },
      }),
    ]);
    if (clients.length !== cids.length || leads.length !== lids.length) throw notFound();
    const portal = new Set(accounts.map((a) => a.clientId));
    const consentOf = (kind: 'clientId' | 'leadId', id: string) =>
      Object.fromEntries(
        consents.filter((c) => c[kind] === id).map((c) => [c.channel, c.status]),
      ) as Person['consent'];
    return [
      ...cids.map((id) => {
        const c = clients.find((x) => x.id === id)!;
        return {
          kind: 'CLIENT' as const,
          id,
          name: c.displayName,
          email: c.email,
          phone: c.phone,
          archived: c.archivedAt !== null,
          portal: portal.has(id),
          consent: consentOf('clientId', id),
        };
      }),
      ...lids.map((id) => {
        const l = leads.find((x) => x.id === id)!;
        return {
          kind: 'LEAD' as const,
          id,
          name: [l.firstName, l.lastName].filter(Boolean).join(' ') || 'Lead',
          email: l.email,
          phone: l.phone,
          archived: l.archivedAt !== null,
          portal: false,
          consent: consentOf('leadId', id),
        };
      }),
    ];
  }

  /**
   * Why `p` cannot receive on `channel`, or null. Email needs an address and no opt-out (and a
   * client's portal, which the email links to); a lead's text needs a mobile and an opt-in.
   */
  private exclusion(
    p: Person,
    channel: Channel,
    firm: { portal: boolean; email: boolean; sms: boolean },
  ): OutboundExclusion | null {
    if (p.archived) return 'NOT_PERMITTED';
    const optedOut = (s?: string) =>
      s === 'OPTED_OUT' ? 'NO_CONSENT' : s && s !== 'OPTED_IN' ? 'SUPPRESSED' : null;
    if (channel === 'PORTAL') {
      if (!firm.portal) return 'PROVIDER_UNAVAILABLE';
      return p.portal ? null : 'NO_PORTAL_ACCESS';
    }
    if (channel === 'EMAIL') {
      if (!firm.email) return 'PROVIDER_UNAVAILABLE';
      if (!p.email) return 'NO_CONTACT';
      const consent = optedOut(p.consent.EMAIL);
      if (consent) return consent;
      return p.kind === 'CLIENT' && !p.portal ? 'NO_PORTAL_ACCESS' : null;
    }
    // Texts reach leads only; a client's text is not set up.
    if (p.kind === 'CLIENT' || !firm.sms || !this.smsReady()) return 'PROVIDER_UNAVAILABLE';
    if (!toE164(p.phone)) return 'NO_CONTACT';
    if (p.consent.SMS !== 'OPTED_IN') return optedOut(p.consent.SMS) ?? 'NO_CONSENT';
    return null;
  }

  private channels(firm: {
    portal: boolean;
    email: boolean;
    sms: boolean;
  }): OutboundCheck['channels'] {
    return [
      { channel: 'PORTAL', unavailable: firm.portal ? null : 'TURNED_OFF' },
      { channel: 'EMAIL', unavailable: firm.email ? null : 'TURNED_OFF' },
      {
        channel: 'SMS',
        unavailable: !firm.sms ? 'TURNED_OFF' : this.smsReady() ? null : 'NOT_SET_UP',
      },
    ];
  }

  async check(businessId: string, actor: ClientsActor, body: Check): Promise<OutboundCheck> {
    return this.inFirm(businessId, async (tx) => {
      const firm = await this.settings(tx, businessId);
      const people = await this.people(tx, businessId, actor, body.clientIds, body.leadIds);
      return {
        recipients: people.map((p) => {
          const reason = this.exclusion(p, body.channel, firm);
          return {
            kind: p.kind,
            id: p.id,
            name: p.name,
            canReceive: !reason,
            reason,
            status: null,
            threadId: null,
          };
        }),
        channels: this.channels(firm),
      };
    });
  }

  /** The answer: an editable message shows who can receive it now; a finished one, what happened. */
  private async shape(tx: TxClient, businessId: string, row: Row): Promise<OutboundMessage> {
    const editable = row.status === 'DRAFT' || row.status === 'SCHEDULED';
    const actor: ClientsActor = { userId: row.createdByUserId, role: 'OWNER' };
    const firm = await this.settings(tx, businessId);
    const people = await this.people(
      tx,
      businessId,
      actor,
      row.recipients.flatMap((r) => (r.clientId ? [r.clientId] : [])),
      row.recipients.flatMap((r) => (r.leadId ? [r.leadId] : [])),
    ).catch(() => [] as Person[]);
    const recipients: OutboundRecipient[] = row.recipients
      .filter((r) => r.channel === row.channel && r.exclusion !== 'MANUALLY_EXCLUDED')
      .map((r) => {
        const id = (r.clientId ?? r.leadId)!;
        const p = people.find((x) => x.id === id);
        const reason = editable
          ? p
            ? this.exclusion(p, row.channel, firm)
            : 'NOT_PERMITTED'
          : r.exclusion;
        return {
          kind: r.clientId ? ('CLIENT' as const) : ('LEAD' as const),
          id,
          name: p?.name ?? (r.clientId ? 'Client' : 'Lead'),
          canReceive: editable ? !reason : r.status !== 'SKIPPED' && r.status !== 'FAILED',
          reason,
          status: r.status,
          threadId: r.message?.threadId ?? null,
        };
      });
    const can = recipients.filter((r) => r.canReceive).length;
    return {
      id: row.id,
      status: row.status,
      channel: row.channel,
      subject: row.subject,
      body: row.body,
      templateId: row.templateId,
      scheduledFor: row.status === 'SCHEDULED' ? (row.scheduledFor?.toISOString() ?? null) : null,
      timezone: await firmTimeZone(tx, businessId),
      recipients,
      counts: { total: recipients.length, canReceive: can, cannotReceive: recipients.length - can },
      createdBy: { userId: row.createdBy.userId, name: row.createdBy.user.name },
      editable,
      completedAt: row.completedAt?.toISOString() ?? null,
      canceledAt: row.canceledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The message, locked when `forChange`; Staff only their own. */
  private async row(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
    forChange = false,
  ): Promise<Row> {
    if (forChange) {
      await tx.$queryRaw`
        SELECT 1 FROM outbound_messages WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
    }
    const row = await tx.outboundMessage.findFirst({
      where: {
        businessId,
        id,
        kind: 'DIRECT',
        ...(actor.role === 'STAFF' ? { createdByUserId: actor.userId } : {}),
      },
      select: messageSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  private async insert(tx: TxClient, businessId: string, actor: ClientsActor, body: Save) {
    await this.people(tx, businessId, actor, body.clientIds, body.leadIds);
    const created = await tx.outboundMessage.create({
      data: {
        businessId,
        kind: 'DIRECT',
        channel: body.channel,
        status: 'DRAFT',
        subject: body.subject ?? null,
        body: body.body,
        templateId: await this.template(tx, businessId, body.templateId),
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });
    const people = [
      ...[...new Set(body.clientIds)].map((clientId) => ({ clientId })),
      ...[...new Set(body.leadIds)].map((leadId) => ({ leadId })),
    ];
    await tx.outboundMessageRecipient.createMany({
      data: people.map((p) => ({
        businessId,
        outboundMessageId: created.id,
        channel: body.channel,
        ...p,
      })),
    });
    return created.id;
  }

  async create(businessId: string, actor: ClientsActor, body: Save): Promise<OutboundMessage> {
    const result = await this.inFirm(businessId, async (tx) => {
      const id = await this.insert(tx, businessId, actor, body);
      return this.shape(tx, businessId, await this.row(tx, businessId, actor, id));
    });
    await this.audit.log(
      'outbound_message.drafted',
      { type: 'outbound_message', id: result.id },
      { channel: result.channel, recipients: result.counts.total },
    );
    return result;
  }

  /**
   * Save Draft on a draft or a scheduled message. The same channel and people change it in place
   * (a scheduled one stays scheduled); new people or another channel make a new draft and cancel
   * this one, since a recipient row is never deleted.
   */
  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: Update,
  ): Promise<OutboundMessage> {
    const { version, ...save } = body;
    const result = await this.inFirm(businessId, async (tx) => {
      const row = await this.row(tx, businessId, actor, id, true);
      // The people and the template first: another firm's or out of reach is 404 whatever the
      // version.
      await this.people(tx, businessId, actor, save.clientIds, save.leadIds);
      await this.template(tx, businessId, save.templateId);
      if (row.status !== 'DRAFT' && row.status !== 'SCHEDULED')
        throw conflict('NOT_EDITABLE', 'This message was already sent or canceled.');
      if (row.updatedAt.toISOString() !== version) throw stale();
      const key = (cs: string[], ls: string[]) =>
        [...new Set(cs.map((c) => `c${c}`)), ...new Set(ls.map((l) => `l${l}`))].sort().join();
      const current = row.recipients.filter((r) => r.channel === row.channel);
      const same =
        save.channel === row.channel &&
        key(
          current.flatMap((r) => (r.clientId ? [r.clientId] : [])),
          current.flatMap((r) => (r.leadId ? [r.leadId] : [])),
        ) === key(save.clientIds, save.leadIds);
      if (same) {
        if (row.status === 'SCHEDULED' && save.channel === 'EMAIL' && !save.subject?.trim())
          throw new BadRequestException({
            code: 'SUBJECT_REQUIRED',
            message: 'An email needs a subject',
          });
        await tx.outboundMessage.update({
          where: { id },
          data: {
            subject: save.subject ?? null,
            body: save.body,
            templateId: await this.template(tx, businessId, save.templateId),
          },
        });
        return this.shape(tx, businessId, await this.row(tx, businessId, actor, id));
      }
      const next = await this.insert(tx, businessId, actor, save);
      await tx.outboundMessage.update({
        where: { id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      });
      return this.shape(tx, businessId, await this.row(tx, businessId, actor, next));
    });
    await this.audit.log(
      'outbound_message.saved',
      { type: 'outbound_message', id: result.id },
      { replaced: result.id === id ? null : id, recipients: result.counts.total },
    );
    return result;
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<OutboundMessage> {
    return this.inFirm(businessId, async (tx) =>
      this.shape(tx, businessId, await this.row(tx, businessId, actor, id)),
    );
  }

  async list(businessId: string, actor: ClientsActor, q: ListQuery): Promise<OutboundMessageList> {
    return this.inFirm(businessId, async (tx) => {
      const rows = await tx.outboundMessage.findMany({
        where: {
          businessId,
          kind: 'DIRECT',
          status: q.status ? q.status : { in: ['DRAFT', 'SCHEDULED'] },
          ...(actor.role === 'STAFF' ? { createdByUserId: actor.userId } : {}),
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: messageSelect,
      });
      const items: OutboundMessage[] = [];
      for (const r of rows) items.push(await this.shape(tx, businessId, r));
      return { items };
    });
  }

  /** An active template of the firm (MSG-F11), or null; another firm's or unknown is 404. */
  private async template(tx: TxClient, businessId: string, id: string | null | undefined) {
    if (!id) return null;
    const t = await tx.messageTemplate.findFirst({
      where: { businessId, id, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!t) throw notFound();
    return t.id;
  }

  /**
   * One person's merge-field values (MSG-F15), from the canonical Templates renderer: the firm,
   * the author, and the client's own record; a lead's name fills the recipient's name fields.
   */
  private async valuesFor(tx: TxClient, businessId: string, author: ClientsActor, p: Person) {
    const values = await this.render.liveValues(
      tx,
      businessId,
      author,
      p.kind === 'CLIENT' ? { clientId: p.id } : {},
    );
    if (p.kind === 'LEAD') {
      const [first = '', ...rest] = p.name.split(' ');
      values.set('client first name', first);
      values.set('client last name', rest.join(' '));
      values.set('client full name', p.name);
      if (p.email) values.set('email address', p.email);
      if (p.phone) values.set('phone number', p.phone);
    }
    return values;
  }

  private filled(values: ReadonlyMap<string, string>, subject: string | null, body: string) {
    const s = subject ? fill(subject, values, 'text') : null;
    const b = fill(body, values, 'text');
    return {
      subject: s?.text ?? null,
      body: b.text,
      unresolved: [...new Set([...(s?.unresolved ?? []), ...b.unresolved])],
    };
  }

  /** The people of a message as the author sees them (the author's reach applies at send). */
  private async peopleOf(tx: TxClient, businessId: string, row: Row, list: OutboundRecipient[]) {
    return this.people(
      tx,
      businessId,
      { userId: row.createdByUserId, role: 'OWNER' },
      list.flatMap((r) => (r.kind === 'CLIENT' ? [r.id] : [])),
      list.flatMap((r) => (r.kind === 'LEAD' ? [r.id] : [])),
    );
  }

  async review(businessId: string, actor: ClientsActor, id: string): Promise<OutboundReview> {
    return this.inFirm(businessId, async (tx) => {
      const row = await this.row(tx, businessId, actor, id);
      const m = await this.shape(tx, businessId, row);
      const author: ClientsActor = {
        userId: row.createdByUserId,
        role: legacyFirmRole(row.createdBy.role),
      };
      const people = await this.peopleOf(tx, businessId, row, m.recipients);
      const recipients: OutboundReview['recipients'] = [];
      for (const r of m.recipients) {
        const p = people.find((x) => x.id === r.id);
        if (!p) continue;
        const f = this.filled(await this.valuesFor(tx, businessId, author, p), m.subject, m.body);
        recipients.push({
          kind: r.kind,
          id: r.id,
          name: r.name,
          canReceive: r.canReceive,
          reason: r.reason,
          ...f,
        });
      }
      const unresolved = [
        ...new Set(recipients.filter((r) => r.canReceive).flatMap((r) => r.unresolved)),
      ];
      const checks: OutboundReview['checks'] = [];
      if (m.counts.canReceive === 0)
        checks.push({
          code: 'NO_RECIPIENTS',
          severity: 'BLOCK',
          message: 'Nobody you chose can receive it on this channel.',
        });
      if (m.channel === 'EMAIL' && !m.subject?.trim())
        checks.push({
          code: 'SUBJECT_REQUIRED',
          severity: 'BLOCK',
          message: 'An email needs a subject.',
        });
      if (unresolved.length > 0)
        checks.push({
          code: 'UNRESOLVED_FIELDS',
          severity: 'WARN',
          message: `Some fields cannot be filled for everyone: ${unresolved.map((u) => `[${u}]`).join(', ')}. They would go as written.`,
        });
      if (m.counts.cannotReceive > 0)
        checks.push({
          code: 'SOME_SKIPPED',
          severity: 'WARN',
          message: `${m.counts.cannotReceive} of ${m.counts.total} cannot receive it on this channel and will be skipped.`,
        });
      if (!checks.some((c) => c.severity === 'BLOCK'))
        checks.push({ code: 'READY', severity: 'OK', message: 'Ready to send.' });
      return {
        channel: m.channel,
        timing: {
          mode: m.status === 'SCHEDULED' ? ('SCHEDULED' as const) : ('NOW' as const),
          scheduledFor: m.scheduledFor,
          timezone: m.timezone,
        },
        recipients,
        unresolved,
        checks,
      };
    });
  }

  /** Fields left unfilled for someone who receives it block a send until confirmed (409). */
  private async confirmFields(
    tx: TxClient,
    businessId: string,
    row: Row,
    m: OutboundMessage,
    confirmed: boolean,
  ) {
    if (confirmed) return;
    const author: ClientsActor = {
      userId: row.createdByUserId,
      role: legacyFirmRole(row.createdBy.role),
    };
    const people = await this.peopleOf(
      tx,
      businessId,
      row,
      m.recipients.filter((r) => r.canReceive),
    );
    for (const p of people) {
      const f = this.filled(await this.valuesFor(tx, businessId, author, p), m.subject, m.body);
      if (f.unresolved.length > 0)
        throw conflict(
          'UNRESOLVED_FIELDS',
          'Some merge fields cannot be filled. Review the message, or send them as written.',
        );
    }
  }

  /** Ready to leave: an email has its subject, and someone can receive it. */
  private ready(m: OutboundMessage): void {
    if (m.channel === 'EMAIL' && !m.subject?.trim())
      throw new BadRequestException({
        code: 'SUBJECT_REQUIRED',
        message: 'An email needs a subject',
      });
    if (m.counts.canReceive === 0)
      throw conflict('NO_RECIPIENTS', 'Nobody you chose can receive it on this channel.');
  }

  async schedule(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: Schedule,
  ): Promise<OutboundMessage> {
    const at = new Date(body.scheduledFor);
    if (at.getTime() < Date.now() + LEAD_TIME_MS)
      throw new BadRequestException({
        code: 'SCHEDULE_IN_PAST',
        message: 'Choose a time at least a minute from now',
      });
    const result = await this.inFirm(businessId, async (tx) => {
      const row = await this.row(tx, businessId, actor, id, true);
      if (row.status !== 'DRAFT' && row.status !== 'SCHEDULED')
        throw conflict('NOT_EDITABLE', 'This message was already sent or canceled.');
      if (row.updatedAt.toISOString() !== body.version) throw stale();
      const m = await this.shape(tx, businessId, row);
      this.ready(m);
      await this.confirmFields(tx, businessId, row, m, body.confirmUnresolved === true);
      await tx.outboundMessage.update({
        where: { id },
        data: { status: 'SCHEDULED', scheduledFor: at },
      });
      return this.shape(tx, businessId, await this.row(tx, businessId, actor, id));
    });
    await this.audit.log(
      'outbound_message.scheduled',
      { type: 'outbound_message', id },
      { scheduledFor: result.scheduledFor, recipients: result.counts.canReceive },
    );
    return result;
  }

  async cancel(
    businessId: string,
    actor: ClientsActor,
    id: string,
    version: string,
  ): Promise<OutboundMessage> {
    const result = await this.inFirm(businessId, async (tx) => {
      const row = await this.row(tx, businessId, actor, id, true);
      if (row.status === 'CANCELED') return this.shape(tx, businessId, row);
      if (row.status !== 'DRAFT' && row.status !== 'SCHEDULED')
        throw conflict('NOT_EDITABLE', 'This message was already sent.');
      if (row.updatedAt.toISOString() !== version) throw stale();
      await tx.outboundMessage.update({
        where: { id },
        data: { status: 'CANCELED', canceledAt: new Date() },
      });
      return this.shape(tx, businessId, await this.row(tx, businessId, actor, id));
    });
    await this.audit.log('outbound_message.canceled', { type: 'outbound_message', id }, {});
    return result;
  }

  /**
   * Send now. Repeating it (a double click, a retry) answers the message as it is: one send.
   * `version` is checked only while it is still a draft or scheduled.
   */
  async send(
    businessId: string,
    actor: ClientsActor,
    id: string,
    version: string | null,
    confirmUnresolved = false,
  ): Promise<OutboundMessage> {
    const started = await this.inFirm(businessId, async (tx) => {
      const row = await this.row(tx, businessId, actor, id, true);
      if (row.status === 'CANCELED') throw conflict('CANCELED', 'This message was canceled.');
      if (row.status !== 'DRAFT' && row.status !== 'SCHEDULED') return false;
      if (version !== null && row.updatedAt.toISOString() !== version) throw stale();
      const m = await this.shape(tx, businessId, row);
      this.ready(m);
      await this.confirmFields(tx, businessId, row, m, confirmUnresolved);
      await tx.outboundMessage.update({ where: { id }, data: { status: 'SENDING' } });
      return true;
    });
    if (started) await this.deliver(businessId, id);
    return this.get(businessId, actor, id);
  }

  /** Each queued recipient, once; then the outcome. Also the job's way to send a scheduled one. */
  async deliver(businessId: string, id: string): Promise<void> {
    const plan = await this.inFirm(businessId, async (tx) => {
      const m = await tx.outboundMessage.findFirst({
        where: { businessId, id, status: 'SENDING' },
        select: messageSelect,
      });
      if (!m) return null;
      const author: ClientsActor = {
        userId: m.createdByUserId,
        role: legacyFirmRole(m.createdBy.role),
      };
      const firm = await this.settings(tx, businessId);
      const queued = m.recipients.filter((r) => r.status === 'QUEUED');
      const people = await this.people(
        tx,
        businessId,
        { userId: m.createdByUserId, role: 'OWNER' },
        queued.flatMap((r) => (r.clientId ? [r.clientId] : [])),
        queued.flatMap((r) => (r.leadId ? [r.leadId] : [])),
      ).catch(() => [] as Person[]);
      const slug = (
        await tx.business.findUnique({ where: { id: businessId }, select: { slug: true } })
      )?.slug;
      return { m, author, firm, queued, people, slug };
    });
    if (!plan) return;
    const { m, author, firm, people, slug } = plan;
    for (const r of plan.queued) {
      const p = people.find((x) => x.id === (r.clientId ?? r.leadId));
      const where = {
        businessId,
        outboundMessageId: id,
        channel: r.channel,
        ...(r.clientId ? { clientId: r.clientId } : { leadId: r.leadId }),
        status: 'QUEUED' as const,
      };
      // Another channel's rows (from before a change) and people out of reach are skipped.
      const reason: OutboundExclusion | null =
        r.channel !== m.channel
          ? 'MANUALLY_EXCLUDED'
          : p
            ? this.exclusion(p, m.channel, firm)
            : 'NOT_PERMITTED';
      if (reason || !p) {
        await this.inFirm(businessId, (tx) =>
          tx.outboundMessageRecipient.updateMany({
            where,
            data: { status: 'SKIPPED', exclusion: reason ?? 'NOT_PERMITTED' },
          }),
        );
        continue;
      }
      // Each person's own text: the merge fields filled from their record (MSG-F15).
      const text = await this.inFirm(businessId, async (tx) =>
        this.filled(await this.valuesFor(tx, businessId, author, p), m.subject, m.body),
      );
      const own = { ...m, subject: text.subject, body: text.body };
      const outcome = await this.one(businessId, author, own, p, slug).catch((error: unknown) => {
        this.logger.warn(
          `message ${id}: a recipient failed (${error instanceof Error ? error.name : 'Error'})`,
        );
        return { ok: false as const, code: 'send_failed' };
      });
      await this.inFirm(businessId, (tx) =>
        tx.outboundMessageRecipient.updateMany({
          where,
          data: outcome.ok
            ? {
                status: 'SENT',
                sentAt: new Date(),
                attempts: { increment: 1 },
                ...(m.channel === 'PORTAL' && outcome.messageId
                  ? { messageId: outcome.messageId }
                  : {}),
              }
            : { status: 'FAILED', attempts: { increment: 1 }, lastError: outcome.code },
        }),
      );
    }
    const summary = await this.inFirm(businessId, async (tx) => {
      const rows = await tx.outboundMessageRecipient.findMany({
        where: { businessId, outboundMessageId: id },
        select: { status: true },
      });
      const sent = rows.filter((x) => x.status === 'SENT').length;
      const failed = rows.filter((x) => x.status === 'FAILED').length;
      const status = sent > 0 && failed > 0 ? 'PARTIAL' : sent > 0 ? 'SENT' : 'FAILED';
      await tx.outboundMessage.update({
        where: { id },
        data: { status, completedAt: new Date() },
      });
      return { status, sent, failed, skipped: rows.length - sent - failed };
    });
    await this.audit.log(
      'outbound_message.sent',
      { type: 'outbound_message', id },
      { channel: m.channel, ...summary },
    );
  }

  /** One person: a client's portal message (and the email notice), or a lead's email or text. */
  private async one(
    businessId: string,
    author: ClientsActor,
    m: Row,
    p: Person,
    slug: string | undefined,
  ): Promise<{ ok: true; messageId?: string } | { ok: false; code: string }> {
    if (p.kind === 'CLIENT') {
      const thread = await this.messages.create(
        businessId,
        author,
        p.id,
        { subject: m.subject?.trim() || 'A message from your firm', body: m.body },
        { emailNotice: m.channel !== 'EMAIL' },
      );
      if (m.channel === 'EMAIL' && p.email && slug) {
        try {
          await this.notify.send({
            template: 'message.received',
            to: p.email,
            businessId,
            data: {
              name: p.name,
              link: linkOn(this.env.PORTAL_BASE_URL, `/${encodeURIComponent(slug)}/messages`),
            },
          });
        } catch (error) {
          if (!(error instanceof NotifyDeliveryError)) throw error;
          return { ok: false, code: 'email_failed' };
        }
      }
      return { ok: true, messageId: thread.messages[0]?.id };
    }
    try {
      if (m.channel === 'SMS') {
        await this.notify.send({
          template: 'lead.message-sms',
          to: toE164(p.phone)!,
          businessId,
          data: { body: m.body },
        });
      } else {
        await this.notify.send({
          template: 'lead.message-email',
          to: p.email!,
          businessId,
          data: { name: p.name.split(' ')[0] ?? p.name, subject: m.subject, body: m.body },
        });
      }
      return { ok: true };
    } catch (error) {
      if (!(error instanceof NotifyDeliveryError)) throw error;
      return { ok: false, code: m.channel === 'SMS' ? 'sms_failed' : 'email_failed' };
    }
  }

  /** The firm's scheduled messages that are due, moved to SENDING; the job delivers them. */
  async due(businessId: string, now: Date): Promise<{ id: string; authorUserId: string }[]> {
    return this.inFirm(businessId, async (tx) => {
      const rows = await tx.outboundMessage.findMany({
        where: { businessId, kind: 'DIRECT', status: 'SCHEDULED', scheduledFor: { lte: now } },
        select: { id: true, createdByUserId: true },
        take: 20,
      });
      const due: { id: string; authorUserId: string }[] = [];
      for (const r of rows) {
        const moved = await tx.outboundMessage.updateMany({
          where: { businessId, id: r.id, status: 'SCHEDULED' },
          data: { status: 'SENDING' },
        });
        if (moved.count === 1) due.push({ id: r.id, authorUserId: r.createdByUserId });
      }
      return due;
    });
  }
}
