import { ConflictException, Inject, Injectable } from '@nestjs/common';
import type { Database, Note, TxClient } from '@firmivra/db';
import type { InternalNote, InternalNoteList, MyNotepad } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { decodeCursor, encodeCursor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { notFound, type Viewer } from './messages.service.js';

type Staff = Viewer & { kind: 'staff' };

/**
 * The firm's internal notes per client (never shown to the client; Staff: their own clients) and
 * a portal login's private notepad. The notepad runs in the login's own actor scope
 * (forBusiness with actorUserId): the database shows it to nobody else, the firm included. Each
 * save adds a version; the reminder moves to the newest one. Audited with ids only, never text.
 */
@Injectable()
export class NotesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  /** In the firm's scope, for a client (and engagement) this member reaches; else 404. */
  private inClient<T>(
    v: Staff,
    clientId: string,
    engagementId: string | undefined,
    fn: (tx: TxClient) => Promise<T>,
  ): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: v.businessId }, async (tx) => {
      const client = await tx.client.findFirst({
        where: {
          businessId: v.businessId,
          id: clientId,
          ...(v.role === 'STAFF' ? { assignedUserId: v.userId } : {}),
          ...(engagementId ? { engagements: { some: { id: engagementId } } } : {}),
        },
        select: { id: true },
      });
      if (!client) throw notFound();
      return fn(tx);
    });
  }

  private async present(tx: TxClient, rows: Note[]): Promise<InternalNote[]> {
    const users = await tx.user.findMany({
      where: { id: { in: rows.map((r) => r.authorUserId) } },
      select: { id: true, name: true },
    });
    const names = new Map(users.map((u) => [u.id, u.name]));
    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      engagementId: r.engagementId,
      body: r.body,
      author: { userId: r.authorUserId, name: names.get(r.authorUserId) ?? '' },
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Newest first. */
  async list(
    v: Staff,
    clientId: string,
    q: { cursor?: string | undefined; limit: number },
  ): Promise<InternalNoteList> {
    const after = q.cursor ? decodeCursor(q.cursor) : undefined;
    const { rows, items } = await this.inClient(v, clientId, undefined, async (tx) => {
      const rows = await tx.note.findMany({
        where: {
          businessId: v.businessId,
          clientId,
          ...(after && {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
      });
      return { rows, items: await this.present(tx, rows.slice(0, q.limit)) };
    });
    const last = rows[q.limit - 1];
    await this.audit.log('notes.listed', { type: 'client', id: clientId }, { count: items.length });
    return { items, nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null };
  }

  async create(
    v: Staff,
    clientId: string,
    body: { body: string; engagementId?: string | undefined },
  ): Promise<InternalNote> {
    const [note] = await this.inClient(v, clientId, body.engagementId, async (tx) => {
      const row = await tx.note.create({
        data: {
          businessId: v.businessId,
          clientId,
          engagementId: body.engagementId ?? null,
          body: body.body,
          authorUserId: v.userId,
        },
      });
      return this.present(tx, [row]);
    });
    await this.audit.log('note.created', { type: 'note', id: note!.id }, { clientId });
    return note!;
  }

  // ---------- The portal login's private notepad ----------

  private mine<T>(v: Viewer, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    const scope = { kind: 'business' as const, businessId: v.businessId, actorUserId: v.userId };
    return this.database.withScope(scope, fn);
  }

  private async read(tx: TxClient, v: Viewer): Promise<MyNotepad> {
    const where = { businessId: v.businessId, userId: v.userId };
    const note = await tx.clientPrivateNote.findFirst({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const reminder = await tx.clientNoteReminder.findFirst({ where });
    return {
      note: note && { id: note.id, body: note.body, savedAt: note.createdAt.toISOString() },
      reminder: reminder && {
        remindAt: reminder.remindAt.toISOString(),
        remindedAt: reminder.remindedAt?.toISOString() ?? null,
      },
    };
  }

  /** Replaces the login's reminder with one on `noteId` (or none), then reads the notepad. */
  private async remind(tx: TxClient, v: Viewer, noteId: string, at: string | null) {
    const where = { businessId: v.businessId, userId: v.userId };
    await tx.clientNoteReminder.deleteMany({ where });
    if (at) await tx.clientNoteReminder.create({ data: { ...where, noteId, remindAt: at } });
    return this.read(tx, v);
  }

  async notepad(v: Viewer): Promise<MyNotepad> {
    const pad = await this.mine(v, (tx) => this.read(tx, v));
    await this.audit.log('client_note.viewed', { type: 'client_private_note', id: pad.note?.id });
    return pad;
  }

  /** A new version; `remindAt` left out keeps an unsent reminder, null removes it. */
  async save(v: Viewer, body: { body: string; remindAt?: string | null | undefined }) {
    const pad = await this.mine(v, async (tx) => {
      const { reminder } = await this.read(tx, v);
      const note = await tx.clientPrivateNote.create({
        data: { businessId: v.businessId, userId: v.userId, body: body.body },
      });
      const kept = reminder && !reminder.remindedAt ? reminder.remindAt : null;
      return this.remind(tx, v, note.id, body.remindAt === undefined ? kept : body.remindAt);
    });
    const entity = { type: 'client_private_note', id: pad.note?.id };
    await this.audit.log('client_note.saved', entity, { reminder: pad.reminder !== null });
    return pad;
  }

  /** Sets or (null) removes the reminder on the latest version. 409 NOTE_REQUIRED before any. */
  async setReminder(v: Viewer, remindAt: string | null): Promise<MyNotepad> {
    const pad = await this.mine(v, async (tx) => {
      const { note } = await this.read(tx, v);
      if (!note) {
        throw new ConflictException({ code: 'NOTE_REQUIRED', message: 'Save a note first' });
      }
      return this.remind(tx, v, note.id, remindAt);
    });
    const action = remindAt ? 'client_note.reminder_set' : 'client_note.reminder_removed';
    await this.audit.log(action, { type: 'client_private_note', id: pad.note?.id });
    return pad;
  }
}
