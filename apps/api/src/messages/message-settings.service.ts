import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  MESSAGE_SETTINGS_DEFAULTS,
  type MessageAttachmentType,
  type MessageSettings,
  type UpdateMessageSettingsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import type { NotifyConfig } from '../notify/config.js';
import { NOTIFY_CONFIG } from '../notify/notify.module.js';

type Body = z.output<typeof UpdateMessageSettingsRequest>;

const select = {
  portalEnabled: true,
  emailEnabled: true,
  smsEnabled: true,
  senderName: true,
  signature: true,
  notifyUnread: true,
  notifyAssignment: true,
  notifyReply: true,
  notifyFailure: true,
  notifyBulkComplete: true,
  defaultAssigneeUserId: true,
  readReceiptsEnabled: true,
  retentionMonths: true,
  attachmentMaxMb: true,
  allowedAttachmentTypes: true,
  quietHoursStart: true,
  quietHoursEnd: true,
  bulkConfirmThreshold: true,
  bulkRequiresManager: true,
  updatedAt: true,
  defaultAssignee: { select: { userId: true, user: { select: { name: true } } } },
  updatedBy: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.MessageSettingsSelect;
type Row = Prisma.MessageSettingsGetPayload<{ select: typeof select }>;

/** A `time` column comes back as 1970-01-01 at that time, UTC. */
const hhmm = (t: Date | null) => (t ? t.toISOString().slice(11, 16) : null);
const toTime = (v: string | null | undefined) =>
  v === undefined ? undefined : v === null ? null : new Date(`1970-01-01T${v}:00.000Z`);
const member = (m: { userId: string; user: { name: string } } | null) =>
  m ? { userId: m.userId, name: m.user.name } : null;

/** The fields a change touched, for the audit entry: names only, never a signature or a name. */
const FIELDS = [
  'portalEnabled',
  'emailEnabled',
  'smsEnabled',
  'senderName',
  'signature',
  'notifyUnread',
  'notifyAssignment',
  'notifyReply',
  'notifyFailure',
  'notifyBulkComplete',
  'defaultAssigneeUserId',
  'readReceiptsEnabled',
  'retentionMonths',
  'attachmentMaxMb',
  'allowedAttachmentTypes',
  'quietHoursStart',
  'quietHoursEnd',
  'bulkConfirmThreshold',
  'bulkRequiresManager',
] as const;

/**
 * Messages Settings (R60, MSG-F02): the firm's one `message_settings` row (R36), the defaults
 * until the first save. Every query runs in the firm's scope with `businessId` from TenantGuard.
 * Provider credentials stay in Integrations; `smsReady` only says whether texts can leave.
 */
@Injectable()
export class MessageSettingsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_CONFIG) private readonly notify: NotifyConfig,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private shape(row: Row | null, timezone: string): MessageSettings {
    const sms = this.notify.sms;
    const d = MESSAGE_SETTINGS_DEFAULTS;
    return {
      portalEnabled: row?.portalEnabled ?? d.portalEnabled,
      emailEnabled: row?.emailEnabled ?? d.emailEnabled,
      smsEnabled: row?.smsEnabled ?? d.smsEnabled,
      smsReady: !(sms.mode === 'log' && sms.unregistered),
      senderName: row?.senderName ?? null,
      signature: row?.signature ?? null,
      notifyUnread: row?.notifyUnread ?? d.notifyUnread,
      notifyAssignment: row?.notifyAssignment ?? d.notifyAssignment,
      notifyReply: row?.notifyReply ?? d.notifyReply,
      notifyFailure: row?.notifyFailure ?? d.notifyFailure,
      notifyBulkComplete: row?.notifyBulkComplete ?? d.notifyBulkComplete,
      defaultAssignee: member(row?.defaultAssignee ?? null),
      readReceiptsEnabled: row?.readReceiptsEnabled ?? d.readReceiptsEnabled,
      retentionMonths: row?.retentionMonths ?? null,
      attachmentMaxMb: row?.attachmentMaxMb ?? d.attachmentMaxMb,
      allowedAttachmentTypes: (row?.allowedAttachmentTypes ?? [
        ...d.allowedAttachmentTypes,
      ]) as MessageAttachmentType[],
      quietHoursStart: hhmm(row?.quietHoursStart ?? null),
      quietHoursEnd: hhmm(row?.quietHoursEnd ?? null),
      bulkConfirmThreshold: row?.bulkConfirmThreshold ?? d.bulkConfirmThreshold,
      bulkRequiresManager: row?.bulkRequiresManager ?? d.bulkRequiresManager,
      timezone,
      updatedAt: row?.updatedAt.toISOString() ?? null,
      updatedBy: member(row?.updatedBy ?? null),
    };
  }

  get(businessId: string): Promise<MessageSettings> {
    return this.inFirm(businessId, async (tx) =>
      this.shape(
        await tx.messageSettings.findUnique({ where: { businessId }, select }),
        await firmTimeZone(tx, businessId),
      ),
    );
  }

  async update(businessId: string, userId: string, body: Body): Promise<MessageSettings> {
    const { version, ...change } = body;
    const touched = FIELDS.filter((f) => change[f] !== undefined);
    const result = await this.inFirm(businessId, async (tx) => {
      // One save at a time per firm, the first one included (no row to lock yet).
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`message_settings:${businessId}`}))) AS l`;
      if (change.defaultAssigneeUserId) {
        const active = await tx.membership.findFirst({
          where: { businessId, userId: change.defaultAssigneeUserId, status: 'ACTIVE' },
          select: { userId: true },
        });
        if (!active) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
      }
      const current = await tx.messageSettings.findUnique({
        where: { businessId },
        select: { updatedAt: true },
      });
      if (version !== undefined && (current?.updatedAt.toISOString() ?? null) !== version) {
        throw new ConflictException({
          code: 'STALE_VERSION',
          message: 'Someone saved these settings since you opened them. Reload to see them.',
        });
      }
      const data = {
        ...change,
        quietHoursStart: toTime(change.quietHoursStart),
        quietHoursEnd: toTime(change.quietHoursEnd),
        updatedByUserId: userId,
      };
      const row = await tx.messageSettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
        select,
      });
      return this.shape(row, await firmTimeZone(tx, businessId));
    });
    await this.audit.log(
      'message_settings.updated',
      { type: 'message_settings', id: businessId },
      { fields: touched },
    );
    return result;
  }
}
