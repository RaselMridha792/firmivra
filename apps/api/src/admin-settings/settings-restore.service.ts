import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import {
  AdminBrandingSettings,
  AdminEmailSettings,
  AdminGeneralSettings,
  type AdminRestorePreview,
  type AdminRestoreResult,
  type AdminSettingChange,
  type AdminSettingsHistory,
  type AdminSettingsSectionKey,
  type AdminSettingValue,
} from '@firmivra/types';
import type { z } from 'zod';
import { writeAdminEvent } from '../admin-audit/admin-audit.common.js';
import { httpError } from '../auth/auth-errors.js';
import {
  AuthFlowError,
  IDENTITY_PROVIDER,
  type IdentityProvider,
} from '../auth/identity/identity-provider.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminSettingsService, rethrowCheck, saveConflict } from './admin-settings.service.js';
import { brandingOf, changedFields, emailOf, generalOf } from './settings.mappers.js';

// SA-SYS-A2: a section's history and Restore, read from its own audit rows (the before and after
// of each changed field, kept only when short and plain; never a secret, which no section holds).
// Restore sets that save's kept fields back to their earlier values and leaves every other value,
// in one transaction with the section's version, after the Super Admin's own password again.

type Json = Record<string, unknown>;
type Section = AdminSettingsSectionKey;

type Key = 'general' | 'branding' | 'email_notifications';
const SECTIONS: Record<
  Section,
  { key: Key; read: (v: unknown) => unknown; schema: z.ZodType; label: string }
> = {
  general: { key: 'general', read: generalOf, schema: AdminGeneralSettings, label: 'General' },
  branding: {
    key: 'branding',
    read: brandingOf,
    schema: AdminBrandingSettings,
    label: 'Branding',
  },
  email: {
    key: 'email_notifications',
    read: emailOf,
    schema: AdminEmailSettings,
    label: 'Email & Notifications',
  },
};
const SAVED = 'system_settings.section_saved';
const RESTORED = 'system_settings.section_restored';
const sectionOf = (key: string | null): Section | null =>
  (Object.keys(SECTIONS) as Section[]).find((s) => SECTIONS[s].key === key) ?? null;

const isValue = (x: unknown): x is AdminSettingValue =>
  x === null || ['boolean', 'number', 'string'].includes(typeof x);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** A save's changed fields, from its audit row's `changes`. */
function changesOf(metadata: unknown): AdminSettingChange[] {
  const changes = (metadata as { changes?: unknown } | null)?.changes;
  if (!changes || typeof changes !== 'object') return [];
  return Object.entries(changes as Json)
    .map(([field, c]) => {
      const v = (c ?? {}) as { from?: unknown; to?: unknown };
      const kept = 'from' in v && 'to' in v && isValue(v.from) && isValue(v.to);
      return kept
        ? { field, kept, from: v.from as AdminSettingValue, to: v.to as AdminSettingValue }
        : { field, kept: false, from: null, to: null };
    })
    .sort((a, b) => a.field.localeCompare(b.field));
}

const at = (value: Json, path: string): unknown =>
  path.split('.').reduce<unknown>((node, k) => (node as Json | undefined)?.[k], value);
function put(value: Json, path: string, next: unknown): void {
  const keys = path.split('.');
  let node = value;
  for (const k of keys.slice(0, -1)) {
    const child = node[k];
    node[k] =
      child && typeof child === 'object' && !Array.isArray(child) ? { ...(child as Json) } : {};
    node = node[k] as Json;
  }
  node[keys[keys.length - 1] as string] = next;
}

const notFound = () =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'That save is not in the history',
    details: [{ path: 'eventId', message: 'That save is not in the history' }],
  });
const wrongPassword = () =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'Your password is not right',
    details: [{ path: 'password', message: 'Your password is not right' }],
  });

@Injectable()
export class SettingsRestoreService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly settings: AdminSettingsService,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
  ) {}

  async history(section: Section): Promise<AdminSettingsHistory> {
    return this.admin.transaction(async (tx) => {
      const row = await this.settings.section(tx, SECTIONS[section].key);
      const events = await tx.auditLog.findMany({
        where: {
          businessId: null,
          entityType: 'platform_setting',
          entityId: SECTIONS[section].key,
          action: { in: [SAVED, RESTORED] },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 20,
        select: { id: true, createdAt: true, actorUserId: true, action: true, metadata: true },
      });
      const names = await this.settings.names(events.map((e) => e.actorUserId));
      return {
        section,
        version: row.version,
        items: events.map((e) => ({
          eventId: e.id,
          at: e.createdAt.toISOString(),
          by: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null,
          kind: e.action === RESTORED ? ('RESTORED' as const) : ('SAVED' as const),
          fromVersion: numberOr((e.metadata as Json | null)?.fromVersion),
          changes: changesOf(e.metadata),
        })),
      };
    });
  }

  preview(eventId: string): Promise<AdminRestorePreview> {
    return this.admin.transaction((tx) => this.plan(tx, eventId).then((p) => p.preview));
  }

  async restore(
    cognitoSub: string,
    body: { eventId: string; version: number; password: string },
  ): Promise<AdminRestoreResult> {
    if (!(await this.passwordOk(cognitoSub, body.password))) throw wrongPassword();
    const adminUserId = this.admin.adminUserId;
    try {
      return await this.admin.transaction(async (tx) => {
        const { preview, next, before, key } = await this.plan(tx, body.eventId);
        if (preview.version !== body.version) throw saveConflict();
        if (!preview.fields.length) {
          throw new ConflictException({
            code: 'NOTHING_TO_RESTORE',
            message: 'Every value of that save is already back. Nothing was changed.',
          });
        }
        const { count } = await tx.platformSetting.updateMany({
          where: { key, version: body.version },
          data: { value: next as object },
        });
        if (count !== 1) throw saveConflict();
        await writeAdminEvent(tx, adminUserId, {
          action: RESTORED,
          entityType: 'platform_setting',
          entityId: key,
          category: 'SYSTEM',
          severity: 'MEDIUM',
          parentEventId: body.eventId,
          targetLabel: `System Settings: ${key}`,
          metadata: {
            fromVersion: body.version,
            restoredFrom: body.eventId,
            changes: changedFields(before, next),
          },
        });
        const row = await this.settings.section(tx, key);
        return {
          section: preview.section,
          version: row.version,
          restored: preview.fields.map((f) => f.field),
        };
      });
    } catch (e) {
      rethrowCheck(e);
    }
  }

  /** The restore of one save: the section's value with its kept fields set back. */
  private async plan(tx: TxClient, eventId: string) {
    const event = await tx.auditLog.findFirst({
      where: {
        id: eventId,
        businessId: null,
        entityType: 'platform_setting',
        action: { in: [SAVED, RESTORED] },
      },
      select: { entityId: true, metadata: true },
    });
    const section = sectionOf(event?.entityId ?? null);
    if (!event || !section) throw notFound();
    const { key, read, schema } = SECTIONS[section];
    const row = await this.settings.section(tx, key);
    const before = structuredClone((row.value ?? {}) as Json);
    const next = structuredClone(before);
    const fields: AdminRestorePreview['fields'] = [];
    const unchanged: string[] = [];
    const notKept: string[] = [];
    for (const change of changesOf(event.metadata)) {
      if (!change.kept) {
        notKept.push(change.field);
        continue;
      }
      const current = at(before, change.field);
      if (same(current, change.from)) {
        unchanged.push(change.field);
        continue;
      }
      put(next, change.field, change.from);
      fields.push({
        field: change.field,
        current: isValue(current) ? current : null,
        restoreTo: change.from,
      });
    }
    // What the section's page would read must still be a valid section (it was, when saved).
    if (!schema.safeParse(read(next)).success) {
      throw new ConflictException({
        code: 'RESTORE_INVALID',
        message: 'Those earlier values are no longer allowed together. Nothing was changed.',
      });
    }
    const preview: AdminRestorePreview = {
      section,
      eventId,
      version: row.version,
      fields,
      unchanged,
      notKept,
    };
    return { preview, next, before, key };
  }

  /** The Super Admin's own password, every time (as the kiosk's exit checks a member's). */
  private async passwordOk(cognitoSub: string, password: string): Promise<boolean> {
    try {
      const step = await this.identity.signIn('ADMIN', cognitoSub, password);
      // A sign-in that completed (no second step asked) made tokens nobody uses: revoke them.
      if (step.kind === 'tokens' && step.tokens.refreshToken) {
        await this.identity.revoke('ADMIN', step.tokens.refreshToken);
      }
      return true;
    } catch (error) {
      if (!(error instanceof AuthFlowError)) throw error;
      if (error.code === 'INVALID_CREDENTIALS') return false;
      throw httpError(error.code);
    }
  }
}

const numberOr = (v: unknown) => (typeof v === 'number' ? v : null);
