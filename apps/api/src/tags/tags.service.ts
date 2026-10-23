import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type ClientTags,
  type CreateTagRequest,
  type FirmTag,
  type FirmTagList,
  type SetClientTagsRequest,
  TAG_ERRORS,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from '../storage/document-records.js';

// The firm's one tag list for Leads and Clients (L5 and L6 of Octavia's Leads review; contract in
// packages/types/src/tags). A live tag's name is unique in the firm ignoring case and outer
// spaces (the database's tags_live_name index), so a name in another case is that tag. Owner and
// Admin add tags; every member applies existing ones to the clients they reach (Staff: their own;
// any other client is 404). Tags are never deleted here. Audit: ids and counts, never a name.

/** Who acts: the signed-in member, with the legacy role the Clients rules use. */
export interface TagsActor {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

const tagExists = () =>
  new ConflictException({ code: 'TAG_EXISTS', message: TAG_ERRORS.TAG_EXISTS });
const unknownTag = () =>
  new BadRequestException({ code: 'UNKNOWN_TAG', message: TAG_ERRORS.UNKNOWN_TAG });
const clientArchived = () =>
  new ConflictException({ code: 'CLIENT_ARCHIVED', message: 'Restore the client first' });
const managersOnly = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'Only an Owner or Admin can add a tag.' });
const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === 'P2002';
const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });

@Injectable()
export class TagsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  /** Every live tag, by name, with how many open leads and clients carry it. */
  async list(businessId: string): Promise<FirmTagList> {
    const rows = await this.database.forBusiness(businessId).tag.findMany({
      where: { businessId, archivedAt: null },
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            leads: { where: { lead: { archivedAt: null } } },
            clients: { where: { client: { archivedAt: null } } },
          },
        },
      },
    });
    return {
      items: rows
        .map((t) => ({ id: t.id, name: t.name, leads: t._count.leads, clients: t._count.clients }))
        .sort(byName),
    };
  }

  /** Add New Tag: Owner and Admin (the route says so too). 409 TAG_EXISTS in any case. */
  async create(businessId: string, actor: TagsActor, body: CreateTagRequest): Promise<FirmTag> {
    if (actor.role === 'STAFF') throw managersOnly();
    const tag = await this.database
      .withScope({ kind: 'business', businessId }, async (tx) => {
        if (await findTag(tx, businessId, body.name)) throw tagExists();
        return tx.tag.create({
          data: { businessId, name: body.name.trim(), createdByUserId: actor.userId },
          select: { id: true, name: true },
        });
      })
      .catch((e: unknown) => {
        // Two adds of one name at once: the database's index keeps one.
        if (isUniqueViolation(e)) throw tagExists();
        throw e;
      });
    await this.audit.log('tag.created', { type: 'tag', id: tag.id });
    return { ...tag, leads: 0, clients: 0 };
  }

  async clientTags(businessId: string, actor: TagsActor, clientId: string): Promise<ClientTags> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await reachClient(tx, businessId, actor, clientId);
      return { tags: await namesOf(tx, businessId, clientId) };
    });
  }

  /**
   * Replace the client's tags. Repeats count once; a name the firm has (any case) is that tag; a
   * new one is added for Owner and Admin, 400 UNKNOWN_TAG for Staff (nothing changes then).
   */
  async setClientTags(
    businessId: string,
    actor: TagsActor,
    clientId: string,
    body: SetClientTagsRequest,
  ): Promise<ClientTags> {
    const result = await this.database
      .withScope({ kind: 'business', businessId }, async (tx) => {
        // The client's row first, as the Clients changes do: an archive at once waits for this.
        await tx.$queryRaw`
          SELECT 1 FROM clients WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid
          FOR NO KEY UPDATE`;
        const archivedAt = await reachClient(tx, businessId, actor, clientId);
        if (archivedAt) throw clientArchived();
        const tags = await resolveTags(tx, businessId, actor, body.tags);
        const keep = tags.map((t) => t.id);
        const removed = await tx.clientTag.deleteMany({
          where: { businessId, clientId, tagId: { notIn: keep } },
        });
        const added = await tx.clientTag.createMany({
          data: keep.map((tagId) => ({ businessId, clientId, tagId, addedByUserId: actor.userId })),
          skipDuplicates: true,
        });
        return {
          tags: await namesOf(tx, businessId, clientId),
          added: added.count,
          removed: removed.count,
        };
      })
      .catch((e: unknown) => {
        if (isUniqueViolation(e)) throw tagExists();
        throw e;
      });
    await this.audit.log(
      'client.tags_set',
      { type: 'client', id: clientId },
      { added: result.added, removed: result.removed },
    );
    return { tags: result.tags };
  }
}

/** The firm's live tag with this name, in any case and ignoring outer spaces. */
function findTag(tx: TxClient, businessId: string, name: string) {
  return tx.tag.findFirst({
    where: { businessId, archivedAt: null, name: { equals: name.trim(), mode: 'insensitive' } },
    select: { id: true, name: true },
  });
}

/** The tags for these names, once each; a new one is made for Owner and Admin only. */
async function resolveTags(
  tx: TxClient,
  businessId: string,
  actor: TagsActor,
  names: readonly string[],
): Promise<{ id: string; name: string }[]> {
  const tags: { id: string; name: string }[] = [];
  for (const name of new Map(names.map((n) => [n.trim().toLowerCase(), n.trim()])).values()) {
    let tag = await findTag(tx, businessId, name);
    if (!tag) {
      if (actor.role === 'STAFF') throw unknownTag();
      tag = await tx.tag.create({
        data: { businessId, name, createdByUserId: actor.userId },
        select: { id: true, name: true },
      });
    }
    tags.push(tag);
  }
  return tags;
}

/** The client in the actor's reach (404 otherwise); answers when it was archived. */
async function reachClient(
  tx: TxClient,
  businessId: string,
  actor: TagsActor,
  clientId: string,
): Promise<Date | null> {
  const client = await tx.client.findFirst({
    where: {
      businessId,
      id: clientId,
      ...(actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {}),
    },
    select: { archivedAt: true },
  });
  if (!client) throw notFound();
  return client.archivedAt;
}

/** The client's live tags' names, by name. */
async function namesOf(tx: TxClient, businessId: string, clientId: string): Promise<string[]> {
  const rows = await tx.clientTag.findMany({
    where: { businessId, clientId, tag: { archivedAt: null } },
    select: { tag: { select: { name: true } } },
  });
  return rows
    .map((r) => r.tag)
    .sort(byName)
    .map((t) => t.name);
}
