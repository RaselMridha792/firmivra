import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import {
  ROLES_MANAGED_BY,
  type OkResponse,
  type StaffCompensation,
  type StaffDraft,
  type StaffNote,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from '../workspaces/common.js';
import type { SaveStaffDraftBody, StaffCompensationBody } from './staff-input.js';
import { StaffWriteService } from './staff-write.service.js';
import {
  assertManages,
  forbidden,
  lockTarget,
  mapStaffDbError,
  requireManager,
  type StaffActor,
} from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;

const draftSelect = {
  id: true,
  step: true,
  data: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { user: { select: { name: true } } } },
} satisfies Prisma.StaffDraftSelect;

const toDraft = (d: Prisma.StaffDraftGetPayload<{ select: typeof draftSelect }>): StaffDraft => ({
  id: d.id,
  step: d.step,
  data: (d.data ?? {}) as Record<string, unknown>,
  createdBy: d.createdBy.user.name,
  createdAt: d.createdAt.toISOString(),
  updatedAt: d.updatedAt.toISOString(),
});

/**
 * Staff Management's notes, pay and drafts (R55). Owner and Admin only (the routes' roles).
 * Pay is walled off in the database: its scope names the acting Owner or Admin, and an Admin
 * sees the pay of the roles they manage and their own, never an Owner's or another Admin's.
 * Audit rows say what changed, never a note, an amount or a draft's content.
 */
@Injectable()
export class StaffRecordsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly write: StaffWriteService,
  ) {}

  // ---------- Notes ----------

  note(actor: StaffActor, id: string): Promise<StaffNote | null> {
    const { businessId } = actor;
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await requireManager(tx, actor);
      const m = await tx.membership.findFirst({
        where: { businessId, id },
        select: {
          staffProfile: {
            select: {
              notes: true,
              notesUpdatedAt: true,
              notesUpdatedBy: { select: { user: { select: { name: true } } } },
            },
          },
        },
      });
      if (!m) throw notFound();
      const p = m.staffProfile;
      return p?.notes && p.notesUpdatedAt
        ? {
            text: p.notes,
            updatedAt: p.notesUpdatedAt.toISOString(),
            updatedBy: p.notesUpdatedBy?.user.name ?? null,
          }
        : null;
    });
  }

  /** Account Notes: up to 500 characters, stamped with who and when; empty clears it. */
  async setNote(actor: StaffActor, id: string, text: string): Promise<StaffNote | null> {
    const { businessId } = actor;
    try {
      await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        const by = await requireManager(tx, actor);
        const target = await lockTarget(tx, businessId, id);
        assertManages(actor, target);
        const data = text
          ? { notes: text, notesUpdatedAt: new Date(), notesUpdatedById: by }
          : { notes: null, notesUpdatedAt: null, notesUpdatedById: null };
        await tx.staffProfile.upsert({
          where: { businessId_membershipId: { businessId, membershipId: id } },
          create: { businessId, membershipId: id, ...data },
          update: data,
        });
        await this.audit.logIn(
          tx,
          'staff.note_saved',
          { type: 'membership', id },
          { cleared: !text, length: text.length },
          { businessId },
        );
      });
    } catch (e) {
      throw mapStaffDbError(e);
    }
    return this.note(actor, id);
  }

  // ---------- Pay ----------

  compensation(actor: StaffActor, id: string): Promise<StaffCompensation> {
    const { businessId } = actor;
    return this.database.withScope(
      { kind: 'business', businessId, actorUserId: actor.userId },
      async (tx) => {
        await requireManager(tx, actor);
        const target = await tx.membership.findFirst({
          where: { businessId, id },
          select: { userId: true, role: true },
        });
        if (!target) throw notFound();
        if (target.userId !== actor.userId && !ROLES_MANAGED_BY[actor.role].includes(target.role))
          throw forbidden();
        const pay = await tx.staffCompensation.findUnique({
          where: { businessId_membershipId: { businessId, membershipId: id } },
        });
        return {
          payType: pay?.payType ?? null,
          rateCents:
            pay?.rateCents === null || pay?.rateCents === undefined ? null : Number(pay.rateCents),
          payFrequency: pay?.payFrequency ?? null,
          commission: pay?.commission ?? null,
          payrollId: pay?.payrollId ?? null,
          updatedAt: pay?.updatedAt.toISOString() ?? null,
        };
      },
    );
  }

  async setCompensation(
    actor: StaffActor,
    id: string,
    body: Out<typeof StaffCompensationBody>,
  ): Promise<StaffCompensation> {
    const { businessId } = actor;
    try {
      await this.database.withScope(
        { kind: 'business', businessId, actorUserId: actor.userId },
        async (tx) => {
          await requireManager(tx, actor);
          const target = await lockTarget(tx, businessId, id);
          assertManages(actor, target);
          await this.write.writePay(tx, businessId, id, body);
          await this.audit.logIn(
            tx,
            'staff.compensation_saved',
            { type: 'membership', id },
            {
              fields: Object.keys(body).filter(
                (k) => (body as Record<string, unknown>)[k] !== undefined,
              ),
            },
            { businessId },
          );
        },
      );
    } catch (e) {
      throw mapStaffDbError(e);
    }
    return this.compensation(actor, id);
  }

  // ---------- Drafts (Save as Draft: no account, no invite) ----------

  drafts(actor: StaffActor): Promise<StaffDraft[]> {
    const { businessId } = actor;
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await requireManager(tx, actor);
      const rows = await tx.staffDraft.findMany({
        where: { businessId },
        select: draftSelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 100,
      });
      return rows.map(toDraft);
    });
  }

  draft(actor: StaffActor, draftId: string): Promise<StaffDraft> {
    const { businessId } = actor;
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await requireManager(tx, actor);
      const row = await tx.staffDraft.findFirst({
        where: { businessId, id: draftId },
        select: draftSelect,
      });
      if (!row) throw notFound();
      return toDraft(row);
    });
  }

  /** A new draft (`draftId` undefined) or the draft saved again. */
  async saveDraft(
    actor: StaffActor,
    body: Out<typeof SaveStaffDraftBody>,
    draftId?: string,
  ): Promise<StaffDraft> {
    const { businessId } = actor;
    try {
      return await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        const by = await requireManager(tx, actor);
        const data = body.data as Prisma.InputJsonValue;
        let id = draftId;
        if (id) {
          const { count } = await tx.staffDraft.updateMany({
            where: { businessId, id },
            data: { step: body.step, data },
          });
          if (count !== 1) throw notFound();
        } else {
          id = (
            await tx.staffDraft.create({
              data: { businessId, createdById: by, step: body.step, data },
              select: { id: true },
            })
          ).id;
        }
        await this.audit.logIn(
          tx,
          draftId ? 'staff.draft_saved' : 'staff.draft_created',
          { type: 'staff_draft', id },
          { step: body.step },
          { businessId },
        );
        return toDraft(
          await tx.staffDraft.findFirstOrThrow({ where: { businessId, id }, select: draftSelect }),
        );
      });
    } catch (e) {
      throw mapStaffDbError(e);
    }
  }

  async deleteDraft(actor: StaffActor, draftId: string): Promise<OkResponse> {
    const { businessId } = actor;
    await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await requireManager(tx, actor);
      const { count } = await tx.staffDraft.deleteMany({ where: { businessId, id: draftId } });
      if (count !== 1) throw notFound();
      await this.audit.logIn(
        tx,
        'staff.draft_deleted',
        { type: 'staff_draft', id: draftId },
        undefined,
        { businessId },
      );
    });
    return { ok: true };
  }
}
