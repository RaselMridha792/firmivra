import { ConflictException } from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import {
  ADMIN_COMM_ATTACHMENTS_MAX_BYTES,
  ADMIN_COMM_ERRORS,
  type AdminCommAttachment,
} from '@firmivra/types';
import type { NotifyAttachment } from '../notify/notify.types.js';
import type { DocumentStorage } from '../storage/document-storage.js';

// SA-COM-R1 and R3: library files (comm_media, kind ATTACHMENT) on an email message or template,
// linked through comm_media_links (usage ATTACHMENT, exactly one owner). A draft or a template may
// hold a file that is still being checked; a send needs every file CLEAN. The files go out as
// real attachments (NotifyService), never inline, read from storage at send time.

const failure = (code: 'ATTACHMENT_NOT_USABLE' | 'ATTACHMENTS_TOO_LARGE') =>
  new ConflictException({ code, message: ADMIN_COMM_ERRORS[code] });

/** For an include: a message's or template's attachments, oldest link first. */
export const attachmentLinks = {
  where: { usage: 'ATTACHMENT' },
  orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  select: {
    media: {
      select: { id: true, fileName: true, contentType: true, sizeBytes: true, scanStatus: true },
    },
  },
} satisfies Prisma.CommMediaLinkFindManyArgs;

type LinkRow = Prisma.CommMediaLinkGetPayload<{ select: (typeof attachmentLinks)['select'] }>;

export const attachmentsOf = (links: readonly LinkRow[]): AdminCommAttachment[] =>
  links.map(({ media }) => ({ ...media }));

/**
 * Replaces the owner's attachments with `ids` (in that order). Each must be an ATTACHMENT file
 * not INFECTED or FAILED, and together within ADMIN_COMM_ATTACHMENTS_MAX_BYTES (409 otherwise).
 */
export async function setAttachments(
  tx: TxClient,
  owner: { messageId: string } | { templateId: string },
  ids: readonly string[],
): Promise<void> {
  const media = ids.length
    ? await tx.commMedia.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, kind: true, scanStatus: true, sizeBytes: true },
      })
    : [];
  if (
    media.length !== ids.length ||
    media.some(
      (m) => m.kind !== 'ATTACHMENT' || m.scanStatus === 'INFECTED' || m.scanStatus === 'FAILED',
    )
  )
    throw failure('ATTACHMENT_NOT_USABLE');
  if (media.reduce((sum, m) => sum + m.sizeBytes, 0) > ADMIN_COMM_ATTACHMENTS_MAX_BYTES)
    throw failure('ATTACHMENTS_TOO_LARGE');
  await tx.commMediaLink.deleteMany({ where: { ...owner, usage: 'ATTACHMENT' } });
  for (const mediaId of ids)
    await tx.commMediaLink.create({ data: { mediaId, usage: 'ATTACHMENT', ...owner } });
}

/** A send needs every attached file CLEAN (409 ATTACHMENT_NOT_USABLE). */
export async function requireCleanAttachments(tx: TxClient, messageId: string): Promise<void> {
  const notReady = await tx.commMediaLink.count({
    where: { messageId, usage: 'ATTACHMENT', media: { scanStatus: { not: 'CLEAN' } } },
  });
  if (notReady > 0) throw failure('ATTACHMENT_NOT_USABLE');
}

/** A message's attached files as stored (read inside a transaction, the bytes after it). */
export function attachmentRows(tx: TxClient, messageId: string) {
  return tx.commMediaLink.findMany({
    where: { messageId, usage: 'ATTACHMENT' },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      media: { select: { fileName: true, contentType: true, s3Key: true, scanStatus: true } },
    },
  });
}

/** The files with their bytes, for NotifyService; null when one is not CLEAN or can't be read. */
export async function readAttachments(
  storage: Pick<DocumentStorage, 'read'>,
  rows: Awaited<ReturnType<typeof attachmentRows>>,
): Promise<NotifyAttachment[] | null> {
  const files: NotifyAttachment[] = [];
  for (const { media } of rows) {
    if (media.scanStatus !== 'CLEAN') return null;
    const content = await storage.read(media.s3Key).catch(() => null);
    if (!content) return null;
    files.push({ fileName: media.fileName, contentType: media.contentType, content });
  }
  return files;
}
