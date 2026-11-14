import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { AppointmentContact, AppointmentDraft, AppointmentDraftList } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames } from '../workspaces/common.js';
import { activeMember, type FirmActor } from './calendar-data.js';
import { errors } from './errors.js';
import type { DraftBody } from './scheduling.input.js';

type Draft = z.output<typeof DraftBody>;

/** appointment_drafts.data holds at most 64 KB (the database checks it too). */
const MAX_DRAFT_BYTES = 65_536;

/**
 * Save as Draft (Appointments Review 2; Rasel's approval through the lead, Nov 14): the Schedule
 * Appointment form kept before it is booked. Each member reads, saves and deletes only their own
 * drafts (anyone else's is 404, as another firm's). A draft keeps the form as it is, but every
 * record it names (client, lead, type, service, staff, office, room) must be this firm's and in the
 * member's reach (404 otherwise), and what a booking cannot keep (related items) is refused as at
 * scheduling. Scheduling a draft deletes it in the booking's transaction
 * (SchedulingWriteService). Audit rows hold ids only.
 */
@Injectable()
export class AppointmentDraftsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async list(businessId: string, actor: FirmActor): Promise<AppointmentDraftList> {
    const rows = await this.inFirm(businessId, (tx) =>
      tx.appointmentDraft.findMany({
        where: { businessId, createdByUserId: actor.userId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 50,
      }),
    );
    const name = await this.nameOf(businessId, actor);
    return { items: rows.map((r) => toDraft(r, name, null)) };
  }

  /** One of the member's drafts, with its client as the form shows it (to reopen it). */
  async get(businessId: string, actor: FirmActor, id: string): Promise<AppointmentDraft> {
    const { row, contact } = await this.inFirm(businessId, async (tx) => {
      const row = await this.own(tx, businessId, actor, id);
      return { row, contact: await this.contactOf(tx, businessId, actor, row.data) };
    });
    return toDraft(row, await this.nameOf(businessId, actor), contact);
  }

  /** The draft's client as the form shows it; null when it names none in the member's reach. */
  private async contactOf(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    data: Prisma.JsonValue,
  ): Promise<AppointmentContact | null> {
    const named = (data as { contact?: { kind?: string; id?: string } } | null)?.contact;
    if (named?.kind !== 'CLIENT' || !named.id) return null;
    const c = await tx.client.findFirst({
      where: {
        businessId,
        id: named.id,
        archivedAt: null,
        ...(actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {}),
      },
      select: {
        id: true,
        displayName: true,
        email: true,
        phone: true,
        accountType: true,
        profile: { select: { businessName: true } },
      },
    });
    if (!c) return null;
    return {
      kind: 'CLIENT',
      id: c.id,
      name: c.displayName,
      businessName:
        c.profile?.businessName ?? (c.accountType === 'BUSINESS' ? c.displayName : null),
      email: c.email,
      phone: c.phone,
      clientType: c.accountType,
    };
  }

  async create(businessId: string, actor: FirmActor, body: Draft): Promise<AppointmentDraft> {
    const data = sized(body);
    const row = await this.inFirm(businessId, async (tx) => {
      await this.checkRecords(tx, businessId, actor, body);
      const made = await tx.appointmentDraft.create({
        data: { businessId, createdByUserId: actor.userId, data },
      });
      await this.audit.logIn(tx, 'appointment_draft.created', {
        type: 'appointment_draft',
        id: made.id,
      });
      return made;
    });
    return toDraft(row, await this.nameOf(businessId, actor), null);
  }

  async save(
    businessId: string,
    actor: FirmActor,
    id: string,
    body: Draft,
  ): Promise<AppointmentDraft> {
    const data = sized(body);
    const row = await this.inFirm(businessId, async (tx) => {
      await this.own(tx, businessId, actor, id);
      await this.checkRecords(tx, businessId, actor, body);
      const saved = await tx.appointmentDraft.update({
        where: { businessId_id: { businessId, id } },
        data: { data },
      });
      await this.audit.logIn(tx, 'appointment_draft.saved', { type: 'appointment_draft', id });
      return saved;
    });
    return toDraft(row, await this.nameOf(businessId, actor), null);
  }

  async remove(businessId: string, actor: FirmActor, id: string): Promise<{ ok: true }> {
    await this.inFirm(businessId, async (tx) => {
      await this.own(tx, businessId, actor, id);
      await tx.appointmentDraft.delete({ where: { businessId_id: { businessId, id } } });
      await this.audit.logIn(tx, 'appointment_draft.deleted', { type: 'appointment_draft', id });
    });
    return { ok: true };
  }

  /** The member's own draft, else 404 (another member's, another firm's or none). */
  private async own(tx: TxClient, businessId: string, actor: FirmActor, id: string) {
    const row = await tx.appointmentDraft.findFirst({
      where: { businessId, id, createdByUserId: actor.userId },
    });
    if (!row) throw errors.notFound();
    return row;
  }

  /** Every record the draft names is this firm's and in the member's reach (404 otherwise). */
  private async checkRecords(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    body: Draft,
  ): Promise<void> {
    const related = body.related;
    if (related && Object.values(related).some((v) => v !== null && v !== undefined)) {
      throw errors.unsupported(
        'Related items (tax return, invoice, task, intake form, documents) cannot be saved yet.',
      );
    }
    const contact = body.contact;
    if (contact?.kind === 'CLIENT' && contact.id) {
      const client = await tx.client.findFirst({
        where: { businessId, id: contact.id },
        select: { assignedUserId: true },
      });
      if (!client) throw errors.notFound();
      if (actor.role === 'STAFF' && client.assignedUserId !== actor.userId) throw errors.notFound();
    }
    if (contact?.kind === 'LEAD' && contact.id) {
      const lead = await tx.lead.findFirst({
        where: { businessId, id: contact.id },
        select: { id: true },
      });
      if (!lead) throw errors.notFound();
    }
    const exists = async (found: Promise<unknown>) => {
      if (!(await found)) throw errors.notFound();
    };
    const pick = { select: { id: true } } as const;
    if (body.typeId)
      await exists(
        tx.appointmentType.findFirst({ where: { businessId, id: body.typeId }, ...pick }),
      );
    if (body.serviceId)
      await exists(tx.service.findFirst({ where: { businessId, id: body.serviceId }, ...pick }));
    if (body.officeId)
      await exists(tx.firmOffice.findFirst({ where: { businessId, id: body.officeId }, ...pick }));
    if (body.roomId)
      await exists(tx.firmRoom.findFirst({ where: { businessId, id: body.roomId }, ...pick }));
    for (const userId of body.staffUserIds ?? []) await activeMember(tx, businessId, userId);
  }

  private async nameOf(businessId: string, actor: FirmActor): Promise<string | null> {
    const names = await this.inFirm(businessId, (tx) =>
      memberNames(tx, businessId, [actor.userId]),
    );
    return names.get(actor.userId) ?? null;
  }
}

/** The draft as stored: a JSON object of at most 64 KB (400 when larger). */
function sized(body: Draft): Prisma.InputJsonObject {
  const data = JSON.parse(JSON.stringify(body)) as Prisma.InputJsonObject;
  if (Buffer.byteLength(JSON.stringify(data)) > MAX_DRAFT_BYTES) {
    throw errors.unsupported('This draft is too large to save. Shorten the notes and try again.');
  }
  return data;
}

function toDraft(
  row: { id: string; data: Prisma.JsonValue; updatedAt: Date },
  createdBy: string | null,
  contact: AppointmentContact | null,
): AppointmentDraft {
  return {
    id: row.id,
    data: (row.data ?? {}) as Record<string, unknown>,
    contact,
    createdBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}
