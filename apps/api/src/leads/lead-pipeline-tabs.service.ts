import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AddLeadNoteRequest,
  CompleteFollowUpRequest,
  LeadActivity,
  LeadActivityPage,
  LeadActivityQuery,
  LeadAppointment,
  LeadDocumentsAndForms,
  LeadNote,
  LeadProfile,
  LeadTask,
  LogLeadActivityRequest,
  SetFollowUpRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { decodeCursor, encodeCursor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { conflict, notFound } from './leads.service.js';
import {
  activitySelect,
  CLOSED_STATUSES,
  invalid,
  loadProfile,
  lockLead,
  type PipelineActor,
  reach,
  toActivity,
  visibleLead,
} from './pipeline.shared.js';

type FollowUp = z.output<typeof SetFollowUpRequest>;
type Complete = z.output<typeof CompleteFollowUpRequest>;
type ActivityQ = z.output<typeof LeadActivityQuery>;
type LogBody = z.output<typeof LogLeadActivityRequest>;
type NoteBody = z.output<typeof AddLeadNoteRequest>;

const COMMUNICATIONS = ['CALL', 'EMAIL_SENT', 'SMS_SENT'] as const;
const ACTION_LABEL: Record<FollowUp['type'], string> = {
  CALL: 'Call',
  EMAIL: 'Email',
  SMS: 'Text message',
  APPOINTMENT: 'Appointment',
  SEND_DOCUMENTS: 'Send documents',
  FOLLOW_UP: 'Follow up',
  CLOSE_LEAD: 'Close lead',
};

/** A minute of clock drift is allowed, as the database allows it (lead_activities_rules). */
const SKEW_MS = 60_000;

/**
 * The Lead Profile's tabs and the Next Action card (R57 part 2): follow-ups, activity, notes,
 * tasks, appointments, documents and forms. A note is a NOTE row in the lead's timeline
 * (lead_activities.body), so Notes and Activity share one history. Every read and change needs a
 * lead the member reaches (404 otherwise) and writes an audit row without any text.
 */
@Injectable()
export class LeadPipelineTabsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The lead's source, if the member reaches it and it is not archived: 404 otherwise. */
  private async reachable(tx: TxClient, businessId: string, actor: PipelineActor, id: string) {
    const lead = await tx.lead.findFirst({
      where: { AND: [visibleLead(businessId), reach(actor), { id, archivedAt: null }] },
      select: { id: true, source: true },
    });
    if (!lead) throw notFound();
    return lead;
  }

  // ---------- Next Action / Follow-Up ----------

  async setFollowUp(
    businessId: string,
    actor: PipelineActor,
    id: string,
    body: FollowUp,
  ): Promise<LeadProfile> {
    const profile = await this.inFirm(businessId, async (tx) => {
      await this.openLead(tx, businessId, actor, id);
      await this.writeNext(tx, businessId, actor, id, body);
      return loadProfile(tx, businessId, actor, id, { unrestricted: true });
    });
    await this.audit.log('lead.follow_up_set', { type: 'lead', id }, { type: body.type });
    return profile;
  }

  async completeFollowUp(
    businessId: string,
    actor: PipelineActor,
    id: string,
    body: Complete,
  ): Promise<LeadProfile> {
    const profile = await this.inFirm(businessId, async (tx) => {
      const lead = await this.openLead(tx, businessId, actor, id);
      if (!lead.nextActionType) {
        throw conflict('NO_FOLLOW_UP', 'This lead has no follow-up to complete');
      }
      await tx.leadActivity.create({
        data: {
          businessId,
          leadId: id,
          kind: 'FOLLOW_UP_COMPLETED',
          actorUserId: actor.userId,
          summary: ACTION_LABEL[lead.nextActionType],
          body: body.outcome ?? null,
          metadata: { type: lead.nextActionType },
        },
      });
      if (body.next) {
        await this.writeNext(tx, businessId, actor, id, body.next);
      } else {
        await tx.lead.update({
          where: { id },
          data: {
            nextActionType: null,
            nextActionAt: null,
            nextActionNote: null,
            updatedByUserId: actor.userId,
          },
        });
      }
      return loadProfile(tx, businessId, actor, id, { unrestricted: true });
    });
    await this.audit.log(
      'lead.follow_up_completed',
      { type: 'lead', id },
      { next: body.next?.type ?? null },
    );
    return profile;
  }

  /** The lead held for a change; a closed lead has no follow-up (409 LEAD_CLOSED). */
  private async openLead(tx: TxClient, businessId: string, actor: PipelineActor, id: string) {
    const lead = await lockLead(tx, businessId, actor, id);
    if (lead.archivedAt) throw notFound();
    if (lead.status === 'CONVERTED') {
      throw conflict('ALREADY_CONVERTED', 'This lead is already a client');
    }
    if (CLOSED_STATUSES.includes(lead.status as (typeof CLOSED_STATUSES)[number])) {
      throw conflict('LEAD_CLOSED', 'A closed lead has no follow-up');
    }
    return lead;
  }

  private async writeNext(
    tx: TxClient,
    businessId: string,
    actor: PipelineActor,
    id: string,
    next: FollowUp,
  ): Promise<void> {
    await tx.lead.update({
      where: { id },
      data: {
        nextActionType: next.type,
        nextActionAt: new Date(next.dueAt),
        nextActionNote: next.notes ?? null,
        updatedByUserId: actor.userId,
      },
    });
    await tx.leadActivity.create({
      data: {
        businessId,
        leadId: id,
        kind: 'FOLLOW_UP',
        actorUserId: actor.userId,
        summary: ACTION_LABEL[next.type],
        metadata: { type: next.type, dueAt: next.dueAt },
      },
    });
  }

  // ---------- Activity ----------

  async activity(
    businessId: string,
    actor: PipelineActor,
    id: string,
    q: ActivityQ,
  ): Promise<LeadActivityPage> {
    const after = q.cursor ? decodeCursor(q.cursor) : undefined;
    const page = await this.inFirm(businessId, async (tx) => {
      const lead = await this.reachable(tx, businessId, actor, id);
      const where: Prisma.LeadActivityWhereInput = {
        AND: [
          { businessId, leadId: id },
          q.kind === 'communications' ? { kind: { in: [...COMMUNICATIONS] } } : {},
          after
            ? {
                OR: [
                  { occurredAt: { lt: after.createdAt } },
                  { occurredAt: after.createdAt, id: { lt: after.id } },
                ],
              }
            : {},
        ],
      };
      const rows = await tx.leadActivity.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: activitySelect,
      });
      const items = rows.slice(0, q.limit);
      const last = items.at(-1);
      return {
        items: items.map((a) => toActivity(a, lead.source)),
        nextCursor:
          rows.length > q.limit && last
            ? encodeCursor({ createdAt: last.occurredAt, id: last.id })
            : null,
      };
    });
    await this.audit.log('lead.viewed', { type: 'lead', id }, { view: 'activity' });
    return page;
  }

  async logActivity(
    businessId: string,
    actor: PipelineActor,
    id: string,
    body: LogBody,
  ): Promise<LeadActivity> {
    const at = body.at ? new Date(body.at) : new Date();
    if (at.getTime() > Date.now() + SKEW_MS) throw invalid('The time cannot be in the future');
    const activity = await this.inFirm(businessId, async (tx) => {
      const lead = await this.reachable(tx, businessId, actor, id);
      const row = await tx.leadActivity.create({
        data: {
          businessId,
          leadId: id,
          kind: body.kind,
          actorUserId: actor.userId,
          occurredAt: at,
          summary: body.summary,
          metadata: { manual: true },
        },
        select: activitySelect,
      });
      return toActivity(row, lead.source);
    });
    await this.audit.log('lead.activity_logged', { type: 'lead', id }, { kind: body.kind });
    return activity;
  }

  // ---------- Notes ----------

  async notes(businessId: string, actor: PipelineActor, id: string): Promise<LeadNote[]> {
    const notes = await this.inFirm(businessId, async (tx) => {
      await this.reachable(tx, businessId, actor, id);
      const rows = await tx.leadActivity.findMany({
        where: { businessId, leadId: id, kind: 'NOTE' },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: { ...activitySelect, body: true },
      });
      return rows.map((r) => this.toNote(r));
    });
    await this.audit.log('lead.viewed', { type: 'lead', id }, { view: 'notes' });
    return notes;
  }

  async addNote(
    businessId: string,
    actor: PipelineActor,
    id: string,
    body: NoteBody,
  ): Promise<LeadNote> {
    const note = await this.inFirm(businessId, async (tx) => {
      await this.reachable(tx, businessId, actor, id);
      const row = await tx.leadActivity.create({
        data: { businessId, leadId: id, kind: 'NOTE', actorUserId: actor.userId, body: body.text },
        select: { ...activitySelect, body: true },
      });
      return this.toNote(row);
    });
    // The note's text stays out of the audit row: it is free text about a person.
    await this.audit.log('lead.note_added', { type: 'lead', id }, { noteId: note.id });
    return note;
  }

  private toNote(r: {
    id: string;
    occurredAt: Date;
    body: string | null;
    actor: { userId: string; user: { name: string } } | null;
  }): LeadNote {
    return {
      id: r.id,
      text: r.body ?? '',
      by: r.actor ? { userId: r.actor.userId, name: r.actor.user.name } : null,
      at: r.occurredAt.toISOString(),
    };
  }

  // ---------- Tasks, appointments, documents and forms ----------

  /** Tasks have no lead link yet (see the PR's gaps): an empty list for a lead the member reaches. */
  async tasks(businessId: string, actor: PipelineActor, id: string): Promise<LeadTask[]> {
    await this.inFirm(businessId, (tx) => this.reachable(tx, businessId, actor, id));
    return [];
  }

  /** Appointments have no lead link yet (see the PR's gaps): an empty list. */
  async appointments(
    businessId: string,
    actor: PipelineActor,
    id: string,
  ): Promise<LeadAppointment[]> {
    await this.inFirm(businessId, (tx) => this.reachable(tx, businessId, actor, id));
    return [];
  }

  async documentsAndForms(
    businessId: string,
    actor: PipelineActor,
    id: string,
  ): Promise<LeadDocumentsAndForms> {
    const result = await this.inFirm(businessId, async (tx) => {
      await this.reachable(tx, businessId, actor, id);
      const [uploads, intakes] = await Promise.all([
        tx.leadUpload.findMany({
          where: { businessId, leadId: id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, fileName: true, createdAt: true, scanStatus: true },
        }),
        tx.intake.findMany({
          where: { businessId, leadId: id },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, status: true, sentAt: true, form: { select: { title: true } } },
        }),
      ]);
      return {
        documents: uploads.map((u) => ({
          id: u.id,
          fileName: u.fileName,
          uploadedAt: u.createdAt.toISOString(),
          scanStatus: u.scanStatus,
        })),
        forms: intakes.map((i) => ({
          id: i.id,
          name: i.form.title,
          status: i.status,
          sentAt: i.sentAt?.toISOString() ?? null,
        })),
      };
    });
    await this.audit.log('lead.viewed', { type: 'lead', id }, { view: 'documents' });
    return result;
  }
}
