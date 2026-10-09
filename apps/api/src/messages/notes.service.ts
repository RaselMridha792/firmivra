import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { InternalNote, MyNoteResponse } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });

const noteSelect = {
  id: true,
  clientId: true,
  engagementId: true,
  body: true,
  authorUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NoteSelect;
type NoteRow = Prisma.NoteGetPayload<{ select: typeof noteSelect }>;

/**
 * The firm's internal notes on a client and each client login's private note (R20 steps 4 and
 * 5). Internal notes never leave the firm side: no portal route reads them. Private notes are
 * read and written only in the owner's actor scope (`actorUserId`), so the database itself shows
 * them to nobody else. The audit log never gets a note's text; a private note's rows carry no
 * note id or date either, since the firm's Owner and Admin read the log.
 */
@Injectable()
export class NotesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private reach(actor: ClientsActor): Prisma.ClientWhereInput {
    return actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};
  }

  private canEdit(actor: ClientsActor, note: NoteRow): boolean {
    return actor.role !== 'STAFF' || note.authorUserId === actor.userId;
  }

  private async toNotes(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    rows: NoteRow[],
  ): Promise<InternalNote[]> {
    const authors = await tx.membership.findMany({
      where: { businessId, userId: { in: [...new Set(rows.map((n) => n.authorUserId))] } },
      select: { userId: true, user: { select: { name: true } } },
    });
    const names = new Map(authors.map((a) => [a.userId, a.user.name]));
    return rows.map((n) => ({
      id: n.id,
      clientId: n.clientId,
      engagementId: n.engagementId,
      body: n.body,
      author: { userId: n.authorUserId, name: names.get(n.authorUserId) ?? 'Former staff' },
      canEdit: this.canEdit(actor, n),
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));
  }

  private async client(tx: TxClient, businessId: string, actor: ClientsActor, clientId: string) {
    const row = await tx.client.findFirst({
      where: { AND: [{ businessId, id: clientId }, this.reach(actor)] },
      select: { id: true },
    });
    if (!row) throw notFound();
  }

  /** The note, if its client is in reach (404), and the actor may change it (403). */
  private async editable(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM notes WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    if (!locked) throw notFound();
    const note = await tx.note.findFirst({
      where: { businessId, id, client: this.reach(actor) },
      select: noteSelect,
    });
    if (!note) throw notFound();
    if (!this.canEdit(actor, note)) throw forbidden();
    return note;
  }

  async list(
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    engagementId?: string,
  ): Promise<InternalNote[]> {
    const items = await this.inFirm(businessId, async (tx) => {
      await this.client(tx, businessId, actor, clientId);
      const rows = await tx.note.findMany({
        where: { businessId, clientId, ...(engagementId ? { engagementId } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: noteSelect,
      });
      return this.toNotes(tx, businessId, actor, rows);
    });
    await this.audit.log('notes.listed', { type: 'client', id: clientId }, { count: items.length });
    return items;
  }

  async create(
    businessId: string,
    actor: ClientsActor,
    clientId: string,
    body: { body: string; engagementId?: string },
  ): Promise<InternalNote> {
    return this.inFirm(businessId, async (tx) => {
      await this.client(tx, businessId, actor, clientId);
      if (body.engagementId) {
        const engagement = await tx.engagement.findFirst({
          where: { businessId, clientId, id: body.engagementId },
          select: { id: true },
        });
        if (!engagement) throw notFound();
      }
      const row = await tx.note.create({
        data: {
          businessId,
          clientId,
          engagementId: body.engagementId ?? null,
          body: body.body,
          authorUserId: actor.userId,
        },
        select: noteSelect,
      });
      await this.audit.logIn(tx, 'note.created', { type: 'note', id: row.id }, { clientId });
      return (await this.toNotes(tx, businessId, actor, [row]))[0] as InternalNote;
    });
  }

  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    text: string,
  ): Promise<InternalNote> {
    return this.inFirm(businessId, async (tx) => {
      const note = await this.editable(tx, businessId, actor, id);
      const row = await tx.note.update({ where: { id }, data: { body: text }, select: noteSelect });
      await this.audit.logIn(tx, 'note.updated', { type: 'note', id }, { clientId: note.clientId });
      return (await this.toNotes(tx, businessId, actor, [row]))[0] as InternalNote;
    });
  }

  async remove(businessId: string, actor: ClientsActor, id: string): Promise<{ ok: true }> {
    await this.inFirm(businessId, async (tx) => {
      const note = await this.editable(tx, businessId, actor, id);
      await tx.note.delete({ where: { id } });
      await this.audit.logIn(tx, 'note.deleted', { type: 'note', id }, { clientId: note.clientId });
    });
    return { ok: true };
  }

  // ----- The client login's private note -----

  /** Runs `fn` as the login itself: the database shows its notes to no one else. */
  private async asOwner<T>(
    businessId: string,
    clientAccountId: string,
    fn: (tx: TxClient, userId: string) => Promise<T>,
  ): Promise<T> {
    const account = await this.database.forBusiness(businessId).clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { userId: true },
    });
    if (!account) throw notFound();
    return this.database.withScope(
      { kind: 'business', businessId, actorUserId: account.userId },
      (tx) => fn(tx, account.userId),
    );
  }

  private async latest(tx: TxClient, businessId: string, userId: string) {
    return tx.clientPrivateNote.findFirst({
      where: { businessId, userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: {
        id: true,
        body: true,
        createdAt: true,
        reminder: { select: { remindAt: true, remindedAt: true } },
      },
    });
  }

  private async view(tx: TxClient, businessId: string, userId: string): Promise<MyNoteResponse> {
    const note = await this.latest(tx, businessId, userId);
    if (!note) return { note: null };
    return {
      note: {
        body: note.body,
        savedAt: note.createdAt.toISOString(),
        reminder: note.reminder
          ? {
              remindAt: note.reminder.remindAt.toISOString(),
              sentAt: note.reminder.remindedAt?.toISOString() ?? null,
            }
          : null,
      },
    };
  }

  /** Removes the login's reminders that have not gone out, so at most one is ever waiting. */
  private async clearPending(tx: TxClient, businessId: string, userId: string, keep?: string) {
    await tx.clientNoteReminder.deleteMany({
      where: { businessId, userId, remindedAt: null, ...(keep ? { noteId: { not: keep } } : {}) },
    });
  }

  myNote(businessId: string, clientAccountId: string): Promise<MyNoteResponse> {
    return this.asOwner(businessId, clientAccountId, (tx, userId) =>
      this.view(tx, businessId, userId),
    );
  }

  /** A new version. `remindAt`: a time sets it, null removes it, undefined keeps a pending one. */
  async save(
    businessId: string,
    clientAccountId: string,
    body: { body: string; remindAt?: string | null },
  ): Promise<MyNoteResponse> {
    const result = await this.asOwner(businessId, clientAccountId, async (tx, userId) => {
      const before = await this.latest(tx, businessId, userId);
      const pending =
        before?.reminder && !before.reminder.remindedAt ? before.reminder.remindAt : null;
      const remindAt =
        body.remindAt === undefined
          ? pending
          : body.remindAt === null
            ? null
            : new Date(body.remindAt);
      const note = await tx.clientPrivateNote.create({
        data: { businessId, userId, body: body.body },
        select: { id: true },
      });
      await this.clearPending(tx, businessId, userId);
      if (remindAt) {
        await tx.clientNoteReminder.create({
          data: { businessId, noteId: note.id, userId, remindAt },
        });
      }
      return this.view(tx, businessId, userId);
    });
    await this.audit.log('private_note.saved', { type: 'client_private_note' });
    if (body.remindAt !== undefined) {
      await this.audit.log('private_note.reminder_changed', { type: 'client_private_note' });
    }
    return result;
  }

  async setReminder(
    businessId: string,
    clientAccountId: string,
    remindAt: string,
  ): Promise<MyNoteResponse> {
    const result = await this.asOwner(businessId, clientAccountId, async (tx, userId) => {
      const note = await this.latest(tx, businessId, userId);
      if (!note) throw notFound();
      await this.clearPending(tx, businessId, userId, note.id);
      // Moving it clears reminded_at (the database's rule), so it goes out again.
      await tx.clientNoteReminder.upsert({
        where: { businessId_noteId: { businessId, noteId: note.id } },
        create: { businessId, noteId: note.id, userId, remindAt: new Date(remindAt) },
        update: { remindAt: new Date(remindAt) },
      });
      return this.view(tx, businessId, userId);
    });
    await this.audit.log('private_note.reminder_changed', { type: 'client_private_note' });
    return result;
  }

  async removeReminder(businessId: string, clientAccountId: string): Promise<MyNoteResponse> {
    const result = await this.asOwner(businessId, clientAccountId, async (tx, userId) => {
      const note = await this.latest(tx, businessId, userId);
      await this.clearPending(tx, businessId, userId);
      if (note?.reminder)
        await tx.clientNoteReminder.deleteMany({ where: { businessId, noteId: note.id } });
      return this.view(tx, businessId, userId);
    });
    await this.audit.log('private_note.reminder_changed', { type: 'client_private_note' });
    return result;
  }
}
