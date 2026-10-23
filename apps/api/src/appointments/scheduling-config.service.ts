import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AppointmentNoticeSettings,
  AppointmentReminder,
  AppointmentTypeConfig,
  ReminderChannel,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { retryWhenBusy } from './calendar-locks.js';
import { errors } from './errors.js';
import {
  colorFromHex,
  colorHex,
  locationKindsOf,
  methodOf,
  reminderFromOffset,
  reminderOffset,
  sameMethods,
  typeMethods,
} from './scheduling-map.js';
import type { NoticeSettingsBody, TypeConfigBody } from './scheduling.input.js';

type ConfigReq = z.output<typeof TypeConfigBody>;
type SettingsReq = z.output<typeof NoticeSettingsBody>;

/** What `appointment_types.reminder_defaults` holds, one per reminder. */
const StoredReminders = z.array(
  z.object({ channel: z.enum(['EMAIL', 'SMS', 'PORTAL']), offsetMinutes: z.number().int() }),
);

/** The longest booking window the form offers; stands for "no limit" (null in the database). */
const NO_LIMIT_DAYS = 730;

function remindersOf(stored: unknown): AppointmentReminder[] {
  const parsed = StoredReminders.safeParse(stored);
  return parsed.success
    ? parsed.data.map((r) => reminderFromOffset(r.channel as ReminderChannel, r.offsetMinutes))
    : [];
}

function storedReminders(reminders: readonly AppointmentReminder[]): Prisma.InputJsonValue {
  const rows = new Map<string, { channel: ReminderChannel; offsetMinutes: number }>();
  for (const r of reminders) {
    const offsetMinutes = reminderOffset(r);
    if (offsetMinutes === null)
      throw errors.unsupported('A reminder is sent at most 30 days before');
    rows.set(`${r.channel}:${offsetMinutes}`, { channel: r.channel, offsetMinutes });
  }
  return [...rows.values()];
}

const configSelect = {
  id: true,
  description: true,
  serviceId: true,
  locationKind: true,
  meetingMethods: true,
  bufferBeforeMinutes: true,
  bufferAfterMinutes: true,
  minNoticeMinutes: true,
  maxAdvanceDays: true,
  reminderDefaults: true,
  color: true,
} satisfies Prisma.AppointmentTypeSelect;
type ConfigRow = Prisma.AppointmentTypeGetPayload<{ select: typeof configSelect }>;

function toConfig(row: ConfigRow): AppointmentTypeConfig {
  return {
    typeId: row.id,
    description: row.description,
    serviceId: row.serviceId,
    // No table of eligible staff, offices, intake forms or required documents yet: empty.
    eligibleStaffUserIds: [],
    methods: typeMethods(row).map(methodOf),
    officeIds: [],
    bufferBeforeMinutes: row.bufferBeforeMinutes,
    bufferAfterMinutes: row.bufferAfterMinutes,
    minNoticeHours: Math.ceil(row.minNoticeMinutes / 60),
    maxWindowDays: row.maxAdvanceDays ?? NO_LIMIT_DAYS,
    requiredIntakeFormId: null,
    requiredDocuments: [],
    defaultReminders: remindersOf(row.reminderDefaults),
    color: colorHex(row.color),
  };
}

/**
 * Manage Appointment Types' configuration and the firm's appointment notice settings (contract in
 * packages/types/src/appointments/scheduling.ts). Everyone at the firm reads a type's
 * configuration; Owner and Admin change it, and only they use the notice settings. What the
 * database cannot keep yet (eligible staff, offices, intake form, required documents, default
 * reminders of the firm) reads as empty and is refused with 400 when a non-empty value is sent,
 * never dropped silently. A type's meeting methods (A1) are 1 to 3 of in person, phone and video
 * (the contract names each problem at `methods.N`); the first is its location kind. Audit rows
 * hold field names only.
 */
@Injectable()
export class SchedulingConfigService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  // ---------- Appointment type configuration ----------

  async typeConfig(businessId: string, id: string): Promise<AppointmentTypeConfig> {
    const row = await this.inFirm(businessId, (tx) =>
      tx.appointmentType.findFirst({ where: { businessId, id }, select: configSelect }),
    );
    if (!row) throw errors.notFound();
    return toConfig(row);
  }

  async setTypeConfig(
    businessId: string,
    id: string,
    body: ConfigReq,
  ): Promise<AppointmentTypeConfig> {
    this.refuseUnstorable(body);
    const { row, changed } = await retryWhenBusy(() =>
      this.inFirm(businessId, async (tx) => {
        // Locked first: two edits at once take turns.
        await tx.$executeRaw`
          SELECT 1 FROM appointment_types
          WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
          FOR NO KEY UPDATE`;
        const current = await tx.appointmentType.findFirst({
          where: { businessId, id },
          select: configSelect,
        });
        if (!current) throw errors.notFound();
        const data: Prisma.AppointmentTypeUncheckedUpdateInput = {};
        const changed = new Set<string>();
        const set = <K extends keyof Prisma.AppointmentTypeUncheckedUpdateInput>(
          field: string,
          key: K,
          value: Prisma.AppointmentTypeUncheckedUpdateInput[K],
          same: boolean,
        ) => {
          if (same) return;
          data[key] = value;
          changed.add(field);
        };
        if (body.description !== undefined) {
          set(
            'description',
            'description',
            body.description,
            body.description === current.description,
          );
        }
        if (body.serviceId !== undefined) {
          if (body.serviceId) {
            const service = await tx.service.findFirst({
              where: { businessId, id: body.serviceId },
              select: { id: true },
            });
            if (!service) throw errors.notFound();
          }
          set('serviceId', 'serviceId', body.serviceId, body.serviceId === current.serviceId);
        }
        if (body.methods !== undefined) {
          // The contract refused OTHER, repeats and more than three, each at its `methods.N`.
          const kinds = locationKindsOf(body.methods);
          const first = kinds?.[0];
          if (!kinds || !first) {
            throw errors.invalidField('methods', 'Choose in person, phone or video');
          }
          const same = sameMethods(kinds, typeMethods(current));
          // Both, in step: the database also makes the first method the location kind.
          set('methods', 'meetingMethods', kinds, same);
          set('methods', 'locationKind', first, same);
        }
        if (body.bufferBeforeMinutes !== undefined) {
          set(
            'bufferBeforeMinutes',
            'bufferBeforeMinutes',
            body.bufferBeforeMinutes,
            body.bufferBeforeMinutes === current.bufferBeforeMinutes,
          );
        }
        if (body.bufferAfterMinutes !== undefined) {
          set(
            'bufferAfterMinutes',
            'bufferAfterMinutes',
            body.bufferAfterMinutes,
            body.bufferAfterMinutes === current.bufferAfterMinutes,
          );
        }
        if (body.minNoticeHours !== undefined) {
          const minutes = body.minNoticeHours * 60;
          set('minNoticeHours', 'minNoticeMinutes', minutes, minutes === current.minNoticeMinutes);
        }
        if (body.maxWindowDays !== undefined) {
          set(
            'maxWindowDays',
            'maxAdvanceDays',
            body.maxWindowDays,
            body.maxWindowDays === current.maxAdvanceDays,
          );
        }
        if (body.defaultReminders !== undefined) {
          const stored = storedReminders(body.defaultReminders);
          set(
            'defaultReminders',
            'reminderDefaults',
            stored,
            JSON.stringify(stored) === JSON.stringify(current.reminderDefaults),
          );
        }
        if (body.color !== undefined) {
          const color = body.color ? colorFromHex(body.color) : null;
          if (body.color && !color) throw errors.unsupported('Choose one of the calendar colours');
          set('color', 'color', color, color === current.color);
        }
        if (changed.size === 0) return { row: current, changed: [] as string[] };
        const updated = await tx.appointmentType.update({
          where: { id },
          data,
          select: configSelect,
        });
        return { row: updated, changed: [...changed].sort() };
      }),
    );
    if (changed.length > 0) {
      await this.audit.log(
        'appointment_type.config_updated',
        { type: 'appointment_type', id },
        { fields: changed },
      );
    }
    return toConfig(row);
  }

  /** Values only a table that does not exist yet could keep (empty ones are what we return). */
  private refuseUnstorable(body: ConfigReq): void {
    const unstorable =
      (body.eligibleStaffUserIds?.length ?? 0) > 0 ||
      (body.officeIds?.length ?? 0) > 0 ||
      (body.requiredIntakeFormId ?? null) !== null ||
      (body.requiredDocuments?.length ?? 0) > 0;
    if (unstorable) {
      throw errors.unsupported(
        'Eligible staff, offices, a required intake form and required documents cannot be saved yet.',
      );
    }
  }

  // ---------- Notice settings ----------

  async noticeSettings(businessId: string): Promise<AppointmentNoticeSettings> {
    return this.inFirm(businessId, (tx) => this.settingsIn(tx, businessId));
  }

  async setNoticeSettings(
    businessId: string,
    body: SettingsReq,
  ): Promise<AppointmentNoticeSettings> {
    if ((body.defaultReminders?.length ?? 0) > 0) {
      throw errors.unsupported('Default reminders for the whole firm cannot be saved yet.');
    }
    const fields = Object.entries({
      copyMasterOnChanges: body.copyMasterOnChanges,
      copyMasterOnReminders: body.copyMasterOnReminders,
    })
      .filter(([, v]) => v !== undefined)
      .map(([k]) => k)
      .sort();
    const result = await this.inFirm(businessId, async (tx) => {
      const data: { copyEnabled?: boolean; copyReminders?: boolean; copyEmail?: string } = {
        ...(body.copyMasterOnChanges !== undefined
          ? { copyEnabled: body.copyMasterOnChanges }
          : {}),
        ...(body.copyMasterOnReminders !== undefined
          ? { copyReminders: body.copyMasterOnReminders }
          : {}),
      };
      if (body.copyMasterOnReminders === true) {
        // The database keeps copies of reminders only with a copy address: use the company's.
        const current = await this.settingsIn(tx, businessId);
        const email = current.masterEmail?.toLowerCase() ?? null;
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
          throw errors.unsupported('Set the company email in Settings before copying reminders.');
        }
        data.copyEmail = email;
      }
      await tx.appointmentSettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
        select: { businessId: true },
      });
      return this.settingsIn(tx, businessId);
    });
    if (fields.length > 0) {
      await this.audit.log(
        'appointment_settings.updated',
        { type: 'appointment_settings' },
        { fields },
      );
    }
    return result;
  }

  /**
   * The master email is the one set in Settings > Company Profile (the firm's contact email), and
   * the copy rules are the firm's own settings row (no row: copies of changes on, of reminders off).
   */
  private async settingsIn(tx: TxClient, businessId: string): Promise<AppointmentNoticeSettings> {
    const settings = await tx.appointmentSettings.findUnique({ where: { businessId } });
    const profile = await tx.businessSettings.findUnique({
      where: { businessId },
      select: { contactEmail: true },
    });
    return {
      masterEmail: settings?.copyEmail ?? profile?.contactEmail ?? null,
      copyMasterOnChanges: settings?.copyEnabled ?? true,
      copyMasterOnReminders: settings?.copyReminders ?? false,
      defaultReminders: [],
    };
  }
}
