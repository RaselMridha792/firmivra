import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  INTAKE_FILE_SIZE_CHOICES,
  type IntakeSettings,
  type IntakeSettingsChange,
  type OkResponse,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { INTAKE_DEFAULT_FILE_SIZE_MB } from '../intake/intake-file-size.js';
import { memberNames, memberRef } from '../workspaces/common.js';
import type { ResetSettingsBody, UpdateSettingsBody } from './workspace-input.js';
import { codeOfMime, FILE_TYPE_CODES, forbidden, iso } from './workspace.common.js';

type Out<S extends z.ZodType> = z.output<S>;

const invalid = (path: string, message: string) =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'The request is not valid',
    details: [{ path, message }],
  });

const MEMBER = { select: { userId: true, user: { select: { name: true } } } } as const;

const isFileSizeChoice = (mb: number) =>
  (INTAKE_FILE_SIZE_CHOICES as readonly number[]).includes(mb);
/** "2, 5, 10, 50 or 100": the choices in words. */
const FILE_SIZE_WORDS = `${INTAKE_FILE_SIZE_CHOICES.slice(0, -1).join(', ')} or ${INTAKE_FILE_SIZE_CHOICES.at(-1)}`;

/**
 * The firm's Intake Forms settings: one row per firm, created on first read with the defaults.
 * Owner and Admin change them. A change names the sections it touched in the audit log, which is
 * also the "recent changes" list; no value or message is logged.
 */
@Injectable()
export class IntakeSettingsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private requireAdmin(tenant: TenantContext) {
    if (tenant.role !== 'OWNER' && tenant.role !== 'ADMIN') throw forbidden();
  }

  private async row(tx: TxClient, businessId: string) {
    return tx.intakeSettings.upsert({
      where: { businessId },
      create: { businessId },
      update: {},
      include: { defaultOwner: MEMBER, followUpOwner: MEMBER },
    });
  }

  private view(
    r: Prisma.IntakeSettingsGetPayload<{
      include: { defaultOwner: typeof MEMBER; followUpOwner: typeof MEMBER };
    }>,
  ): IntakeSettings {
    const ref = (m: { userId: string; user: { name: string } } | null) =>
      m ? { userId: m.userId, name: m.user.name } : null;
    return {
      general: {
        defaultExpirationDays: r.defaultExpiryDays,
        allowSaveAndResume: r.allowSaveResume,
        requireSignature: r.requireSignature,
        autoSubmissionId: r.autoSubmissionId,
        defaultOwner: ref(r.defaultOwner),
      },
      clientExperience: {
        showProgressBar: r.showProgressBar,
        // The client pages always fit a phone: there is nothing to switch.
        mobileFriendly: true,
        thankYouMessage: r.thankYouMessage,
        redirectAfterCompletion: r.redirectAfterCompletion,
        redirectUrl: r.redirectUrl,
      },
      notifications: {
        sendClientConfirmation: r.sendClientConfirmation,
        notifyAssignedStaff: r.notifyAssignedStaff,
        firstReminderAfterDays: r.firstReminderDays,
        finalReminderAfterDays: r.finalReminderDays,
        expirationAlertHours: r.expiryAlertHours,
      },
      automation: {
        autoCreateClient: r.autoCreateClient,
        autoCreateFollowUpTask: r.autoCreateFollowUpTask,
        routeByServiceType: r.routeByService,
        defaultFollowUpOwner: ref(r.followUpOwner),
      },
      branding: { useFirmBranding: r.useFirmBranding },
      security: {
        encryptedUploads: true,
        acceptedFileTypes: r.acceptedFileTypes.flatMap((m) => {
          const c = codeOfMime(m);
          return c ? [c] : [];
        }),
        maxFileSizeMb: r.maxFileSizeMb,
        consentRequired: r.consentRequired,
      },
      updatedAt: iso(r.updatedAt),
      version: r.updatedAt.toISOString(),
    };
  }

  get(tenant: TenantContext): Promise<IntakeSettings> {
    return this.inFirm(tenant, async (tx) => this.view(await this.row(tx, tenant.businessId)));
  }

  /** Staff Management members who may own a form: active members only. */
  private async activeMember(tx: TxClient, businessId: string, userId: string, path: string) {
    const m = await tx.membership.findFirst({
      where: { businessId, userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!m) throw invalid(path, 'Choose an active member of the firm');
  }

  update(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof UpdateSettingsBody>,
  ): Promise<IntakeSettings> {
    this.requireAdmin(tenant);
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      await tx.$queryRaw`SELECT 1 FROM intake_settings WHERE business_id = ${businessId}::uuid FOR UPDATE`;
      const current = await this.row(tx, businessId);
      if (current.updatedAt.toISOString() !== body.version)
        throw new ConflictException({
          code: 'SAVE_CONFLICT',
          message: 'Someone saved these settings after you opened them. Reload and try again.',
        });
      const g = body.general;
      const c = body.clientExperience;
      const n = body.notifications;
      const a = body.automation;
      const s = body.security;
      const data: Prisma.IntakeSettingsUncheckedUpdateInput = {};
      if (g) {
        if (g.defaultExpirationDays !== undefined)
          data.defaultExpiryDays = g.defaultExpirationDays ?? 14;
        if (g.allowSaveAndResume !== undefined) data.allowSaveResume = g.allowSaveAndResume;
        if (g.requireSignature !== undefined) data.requireSignature = g.requireSignature;
        if (g.autoSubmissionId !== undefined) data.autoSubmissionId = g.autoSubmissionId;
        if (g.defaultOwnerUserId !== undefined) {
          if (g.defaultOwnerUserId)
            await this.activeMember(
              tx,
              businessId,
              g.defaultOwnerUserId,
              'general.defaultOwnerUserId',
            );
          data.defaultOwnerUserId = g.defaultOwnerUserId;
        }
      }
      if (c) {
        if (c.showProgressBar !== undefined) data.showProgressBar = c.showProgressBar;
        if (c.mobileFriendly === false)
          throw invalid('clientExperience.mobileFriendly', 'The client pages always fit a phone');
        if (c.thankYouMessage !== undefined) data.thankYouMessage = c.thankYouMessage;
        if (c.redirectAfterCompletion !== undefined)
          data.redirectAfterCompletion = c.redirectAfterCompletion;
        if (c.redirectUrl !== undefined) data.redirectUrl = c.redirectUrl;
      }
      const redirectOn = c?.redirectAfterCompletion ?? current.redirectAfterCompletion;
      const redirectUrl = c?.redirectUrl !== undefined ? c.redirectUrl : current.redirectUrl;
      if (redirectOn && !redirectUrl)
        throw invalid('clientExperience.redirectUrl', 'Add the address to send clients to');
      if (n) {
        if (n.sendClientConfirmation !== undefined)
          data.sendClientConfirmation = n.sendClientConfirmation;
        if (n.notifyAssignedStaff !== undefined) data.notifyAssignedStaff = n.notifyAssignedStaff;
        if (n.firstReminderAfterDays !== undefined)
          data.firstReminderDays = n.firstReminderAfterDays ?? 3;
        if (n.finalReminderAfterDays !== undefined)
          data.finalReminderDays = n.finalReminderAfterDays ?? 7;
        if (n.expirationAlertHours !== undefined)
          data.expiryAlertHours = n.expirationAlertHours ?? 24;
      }
      const first = (data.firstReminderDays as number | undefined) ?? current.firstReminderDays;
      const final = (data.finalReminderDays as number | undefined) ?? current.finalReminderDays;
      if (final < first)
        throw invalid(
          'notifications.finalReminderAfterDays',
          'The final reminder comes after the first',
        );
      if (a) {
        if (a.autoCreateClient !== undefined) data.autoCreateClient = a.autoCreateClient;
        if (a.autoCreateFollowUpTask !== undefined)
          data.autoCreateFollowUpTask = a.autoCreateFollowUpTask;
        if (a.routeByServiceType !== undefined) data.routeByService = a.routeByServiceType;
        if (a.defaultFollowUpOwnerUserId !== undefined) {
          if (a.defaultFollowUpOwnerUserId)
            await this.activeMember(
              tx,
              businessId,
              a.defaultFollowUpOwnerUserId,
              'automation.defaultFollowUpOwnerUserId',
            );
          data.followUpOwnerUserId = a.defaultFollowUpOwnerUserId;
        }
      }
      if (body.branding) data.useFirmBranding = body.branding.useFirmBranding;
      if (s) {
        if (s.acceptedFileTypes !== undefined) {
          const unknown = s.acceptedFileTypes.find((t) => !FILE_TYPE_CODES[t]);
          if (unknown)
            throw invalid(
              'security.acceptedFileTypes',
              `${unknown} files are not accepted by Firmivra`,
            );
          data.acceptedFileTypes = [
            ...new Set(s.acceptedFileTypes.map((t) => FILE_TYPE_CODES[t]!)),
          ];
        }
        if (s.maxFileSizeMb !== undefined) {
          // Octavia's I10: a change is to one of the choices. The size the firm already has stays
          // valid as it is (a 25 MB saved when the API took 1 to 100 MB), read under the lock.
          if (s.maxFileSizeMb !== current.maxFileSizeMb && !isFileSizeChoice(s.maxFileSizeMb))
            throw invalid('security.maxFileSizeMb', `Choose ${FILE_SIZE_WORDS} MB`);
          data.maxFileSizeMb = s.maxFileSizeMb;
        }
        if (s.consentRequired !== undefined) data.consentRequired = s.consentRequired;
      }
      const sections = (
        [
          'general',
          'clientExperience',
          'notifications',
          'automation',
          'branding',
          'security',
        ] as const
      ).filter((k) => body[k] !== undefined);
      const saved = await tx.intakeSettings.update({
        where: { businessId },
        data,
        include: { defaultOwner: MEMBER, followUpOwner: MEMBER },
      });
      await this.audit.logIn(
        tx,
        'intake_settings.updated',
        { type: 'intake_settings', id: businessId },
        { sections, actorUserId: userId },
      );
      return this.view(saved);
    });
  }

  reset(
    tenant: TenantContext,
    userId: string,
    _body: Out<typeof ResetSettingsBody>,
  ): Promise<IntakeSettings> {
    this.requireAdmin(tenant);
    return this.inFirm(tenant, async (tx) => {
      const businessId = tenant.businessId;
      await this.row(tx, businessId);
      // The defaults of the table, written back (the row is never deleted).
      const fresh = await tx.intakeSettings.update({
        where: { businessId },
        data: {
          defaultExpiryDays: 14,
          allowSaveResume: true,
          requireSignature: true,
          autoSubmissionId: false,
          defaultOwnerUserId: null,
          showProgressBar: true,
          thankYouMessage: null,
          redirectAfterCompletion: false,
          redirectUrl: null,
          sendClientConfirmation: true,
          notifyAssignedStaff: true,
          remindersEnabled: true,
          firstReminderDays: 3,
          finalReminderDays: 7,
          expiryAlertHours: 24,
          autoCreateClient: false,
          autoCreateFollowUpTask: false,
          routeByService: false,
          followUpOwnerUserId: null,
          useFirmBranding: true,
          acceptedFileTypes: ['application/pdf', 'image/jpeg', 'image/png'],
          maxFileSizeMb: INTAKE_DEFAULT_FILE_SIZE_MB,
          consentRequired: true,
        },
        include: { defaultOwner: MEMBER, followUpOwner: MEMBER },
      });
      await this.audit.logIn(
        tx,
        'intake_settings.reset',
        { type: 'intake_settings', id: businessId },
        { actorUserId: userId },
      );
      return this.view(fresh);
    });
  }

  /** The recent changes, from the audit log. */
  changes(tenant: TenantContext): Promise<{ items: IntakeSettingsChange[] }> {
    return this.inFirm(tenant, async (tx) => {
      const rows = await tx.auditLog.findMany({
        where: { businessId: tenant.businessId, action: { startsWith: 'intake_settings.' } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: { id: true, action: true, createdAt: true, actorUserId: true, metadata: true },
      });
      const names = await memberNames(
        tx,
        tenant.businessId,
        rows.map((r) => r.actorUserId),
      );
      const words: Record<string, string> = {
        general: 'General',
        clientExperience: 'Client experience',
        notifications: 'Notifications',
        automation: 'Automation',
        branding: 'Branding',
        security: 'Security',
      };
      return {
        items: rows.map((r) => {
          const sections = ((r.metadata as { sections?: string[] } | null)?.sections ?? []).map(
            (s) => words[s] ?? s,
          );
          return {
            id: r.id,
            at: r.createdAt.toISOString(),
            label:
              r.action === 'intake_settings.reset'
                ? 'Settings reset to the defaults'
                : `Changed ${sections.join(', ').toLowerCase() || 'settings'}`,
            by: memberRef(names, r.actorUserId)?.name ?? null,
          };
        }),
      };
    });
  }

  /** A test reminder needs the email sender for ad hoc messages, which does not exist yet. */
  testReminder(tenant: TenantContext): OkResponse {
    this.requireAdmin(tenant);
    throw new ServiceUnavailableException({
      code: 'TEST_REMINDER_UNAVAILABLE',
      message: 'Test reminders are not available yet',
    });
  }
}
