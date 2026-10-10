import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ESIGN_OPEN_STATUSES } from '@firmivra/types';
import type { Database, EsignRecipient as RecipientRow, TxClient } from '@firmivra/db';
import type { EsignCodeKind } from '../engine/engine.types.js';
import {
  addEvents,
  addLinks,
  EsignFieldValues,
  fresh,
  inFirm,
  InjectDatabase,
  lockRequest,
  nextActivity,
  queueEmails,
  toRecipient,
  toRequest,
} from '../requests/esign-prisma.js';
import type { EsignEventRecord } from '../requests/esign.repository.js';
import type {
  EsignSignerRepository,
  SignerAdoption,
  SignerAttachment,
  SignerFinishWrite,
  SignerLink,
  SignerPendingAttachment,
  SignerRecord,
} from './signer.repository.js';

const HOUR_MS = 3_600_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN: readonly string[] = ESIGN_OPEN_STATUSES;
/** The attachment's id: the last part of its key (attachments/<id>), else a new one. */
const attachmentId = (key: string) => key.split('/').pop()?.match(UUID)?.[0] ?? randomUUID();

type SignerWrite = (tx: TxClient, at: Date) => Promise<void>;

/**
 * Firm Sign's signer storage in PostgreSQL (R13, r0_esign). The firm comes from the slug and the
 * request and recipient from the link's hash or the sealed cookie; every query runs in that
 * firm's scope. A signer write locks the request FOR UPDATE, applies only while it is open and
 * the recipient has not signed or declined, writes the recipient's own rows before marking them
 * SIGNED or DECLINED (the database freezes a signer once signed), and moves lastActivityAt and
 * the recipient's kiosk lock (in person: the signer's last activity) forward.
 */
@Injectable()
export class PrismaSignerRepository implements EsignSignerRepository {
  constructor(
    @InjectDatabase() private readonly database: Database,
    @Inject(EsignFieldValues) private readonly values: EsignFieldValues,
  ) {}

  private db(businessId: string) {
    return this.database.forBusiness(businessId);
  }

  async findLink(businessId: string, tokenHash: string): Promise<SignerLink | null> {
    const link = await this.db(businessId).esignSigningLink.findFirst({ where: { tokenHash } });
    if (!link || (link.expiresAt && link.expiresAt <= new Date())) return null;
    const { requestId, recipientId, tokenVersion } = link;
    // An in-person link opens the signing itself, on the staff member's device.
    return {
      requestId,
      recipientId,
      tokenVersion,
      purpose: link.purpose === 'COPY' ? 'COPY' : 'SIGN',
    };
  }

  signer(businessId: string, requestId: string, recipientId: string) {
    return this.record(businessId, requestId, recipientId, ['SIGNER']);
  }

  copyHolder(businessId: string, requestId: string, recipientId: string) {
    return this.record(businessId, requestId, recipientId, ['SIGNER', 'CC']);
  }

  private async record(
    businessId: string,
    requestId: string,
    recipientId: string,
    kinds: ('SIGNER' | 'CC')[],
  ): Promise<SignerRecord | null> {
    const row = await this.db(businessId).esignRecipient.findFirst({
      where: { id: recipientId, requestId, kind: { in: kinds } },
      include: {
        request: true,
        links: {
          where: { purpose: 'COPY' },
          orderBy: { expiresAt: 'desc' },
          select: { expiresAt: true, tokenVersion: true },
        },
      },
    });
    if (!row) return null;
    const { request, links, ...recipient } = row;
    const copy = links.find((l) => l.tokenVersion === recipient.tokenVersion);
    return {
      request: toRequest(request),
      recipient: toRecipient(recipient),
      tokenVersion: recipient.tokenVersion,
      consentVersionId: recipient.consentVersionId,
      adopted: recipient.signatureMethod
        ? { method: recipient.signatureMethod, hasInitials: recipient.initialsMethod !== null }
        : null,
      copyExpiresAt: copy?.expiresAt ?? null,
    };
  }

  async attachments(businessId: string, requestId: string, recipientId: string) {
    const rows = await this.db(businessId).esignAttachment.findMany({
      where: { requestId, recipientId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((a) => ({
      ...{ fieldId: a.fieldId, key: a.s3Key, fileName: a.fileName },
      contentType: a.contentType as SignerAttachment['contentType'],
      ...{ sizeBytes: a.sizeBytes, sha256: a.sha256, scanStatus: a.scanStatus },
      createdAt: a.createdAt,
    }));
  }

  async saveAttachmentUpload(businessId: string, upload: SignerPendingAttachment): Promise<void> {
    const { key, ...rest } = upload;
    await this.db(businessId).esignPendingUpload.create({
      data: { ...rest, businessId, kind: 'ATTACHMENT', fileId: attachmentId(key), s3Key: key },
    });
  }

  async takeAttachmentUpload(
    businessId: string,
    requestId: string,
    recipientId: string,
    tokenHash: string,
  ): Promise<SignerPendingAttachment | null> {
    return inFirm(this.database, businessId, async (tx) => {
      const where = { businessId, tokenHash, requestId, recipientId, kind: 'ATTACHMENT' as const };
      const row = await tx.esignPendingUpload.findFirst({ where });
      if (!row?.fieldId || (await tx.esignPendingUpload.deleteMany({ where })).count !== 1) {
        return null;
      }
      return {
        ...{ tokenHash, requestId, recipientId, fieldId: row.fieldId, key: row.s3Key },
        contentType: row.contentType as SignerPendingAttachment['contentType'],
        ...{ fileName: row.fileName, sizeBytes: row.sizeBytes, sha256: row.sha256 },
        createdAt: row.createdAt,
      };
    });
  }

  async issueCode(
    businessId: string,
    recipientId: string,
    code: { hash: string; sentAt: Date; expiresAt: Date },
  ): Promise<'OK' | 'TOO_SOON'> {
    return inFirm(this.database, businessId, async (tx) => {
      const sent = await this.codeRow(tx, businessId, recipientId, 'EMAIL');
      const at = code.sentAt.getTime();
      const sends = sent.filter((d) => d.getTime() > at - HOUR_MS);
      const last = sends.at(-1);
      if ((last && at - last.getTime() < 60_000) || sends.length >= 5) return 'TOO_SOON';
      await tx.esignVerificationCode.update({
        where: { recipientId_kind: { recipientId, kind: 'EMAIL' } },
        data: {
          codeHash: code.hash,
          expiresAt: code.expiresAt,
          tries: 0,
          sentTimes: [...sends, code.sentAt],
        },
      });
      return 'OK';
    });
  }

  /** The recipient's code row of `kind`, created empty if missing, locked; its send times. */
  private async codeRow(
    tx: TxClient,
    businessId: string,
    recipientId: string,
    kind: EsignCodeKind,
  ): Promise<Date[]> {
    await tx.$executeRaw`
      INSERT INTO esign_verification_codes (business_id, recipient_id, kind, updated_at)
      VALUES (${businessId}::uuid, ${recipientId}::uuid, ${kind}::"EsignCodeKind", now())
      ON CONFLICT DO NOTHING`;
    const [row] = await tx.$queryRaw<{ sent: Date[] | null }[]>`
      SELECT sent_times AS sent FROM esign_verification_codes
      WHERE recipient_id = ${recipientId}::uuid AND kind = ${kind}::"EsignCodeKind" FOR UPDATE`;
    return row?.sent ?? [];
  }

  async takeCodeTry(businessId: string, recipientId: string, kind: EsignCodeKind) {
    return inFirm(this.database, businessId, async (tx) => {
      if (kind === 'ACCESS') await this.codeRow(tx, businessId, recipientId, kind);
      // Counted before the compare, atomically: parallel guesses each use up a try.
      const [row] = await tx.$queryRaw<
        { hash: string | null; expiresAt: Date | null; triesBefore: number }[]
      >`
        UPDATE esign_verification_codes SET tries = tries + 1, updated_at = now()
        WHERE recipient_id = ${recipientId}::uuid AND kind = ${kind}::"EsignCodeKind"
          AND (kind = 'ACCESS' OR code_hash IS NOT NULL)
        RETURNING code_hash AS hash, expires_at AS "expiresAt", tries - 1 AS "triesBefore"`;
      return row ?? null;
    });
  }

  async clearCode(businessId: string, recipientId: string, kind: EsignCodeKind): Promise<void> {
    const where = { recipientId, kind };
    const codes = this.db(businessId).esignVerificationCode;
    if (kind === 'EMAIL') await codes.deleteMany({ where });
    else await codes.updateMany({ where, data: { tries: 0 } });
  }

  async addEvent(businessId: string, requestId: string, event: EsignEventRecord): Promise<void> {
    await inFirm(this.database, businessId, (tx) => addEvents(tx, businessId, requestId, [event]));
  }

  async currentConsent(businessId: string) {
    return this.db(businessId).esignConsentVersion.findFirst({
      where: { businessId },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, bodyMarkdown: true },
    });
  }

  async acceptConsent(
    businessId: string,
    requestId: string,
    recipientId: string,
    versionId: string,
    event: EsignEventRecord,
  ): Promise<boolean> {
    return inFirm(this.database, businessId, async (tx) => {
      // The per-firm lock publishConsent takes: no newer version can land in between.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`esign-consent:${businessId}`}, 0))`;
      const newest = await tx.esignConsentVersion.findFirst({
        where: { businessId },
        orderBy: { version: 'desc' },
        select: { id: true },
      });
      if (newest?.id !== versionId) return false;
      const pinned = await tx.esignRecipient.updateMany({
        where: { id: recipientId, requestId, signedAt: null },
        data: { consentVersionId: versionId, consentedAt: new Date() },
      });
      if (pinned.count !== 1) return false;
      await addEvents(tx, businessId, requestId, [event]);
      return true;
    });
  }

  /**
   * Applies `write` under the request's lock while it is open and the recipient has neither
   * signed nor declined (and, with `readAt`, unchanged since); false otherwise.
   */
  private change(
    businessId: string,
    requestId: string,
    recipientId: string,
    write: SignerWrite,
    readAt?: Date,
    extra?: (me: RecipientRow) => boolean,
  ): Promise<boolean> {
    return inFirm(this.database, businessId, async (tx) => {
      const locked = await lockRequest(tx, requestId);
      if (!locked || !OPEN.includes(locked.status) || (readAt && !fresh(locked, readAt))) {
        return false;
      }
      const me = await tx.esignRecipient.findFirst({ where: { id: recipientId, requestId } });
      if (!me || me.signedAt || me.declinedAt || (extra && !extra(me))) return false;
      const at = new Date();
      await write(tx, at);
      await tx.esignRequest.update({
        where: { id: requestId },
        data: { lastActivityAt: nextActivity(locked.lastActivityAt, at) },
      });
      await tx.esignKioskLock.updateMany({ where: { recipientId }, data: { activeAt: at } });
      return true;
    });
  }

  markViewed(
    businessId: string,
    requestId: string,
    recipientId: string,
    write: { at: Date; status: EsignRequestStatusOf; event: EsignEventRecord },
  ) {
    return this.change(
      businessId,
      requestId,
      recipientId,
      async (tx) => {
        await tx.esignRecipient.update({
          where: { id: recipientId },
          data: { status: 'VIEWED', viewedAt: write.at },
        });
        await tx.esignRequest.update({ where: { id: requestId }, data: { status: write.status } });
        await addEvents(tx, businessId, requestId, [write.event]);
      },
      undefined,
      (me) => me.viewedAt === null,
    );
  }

  adopt(businessId: string, requestId: string, recipientId: string, adoption: SignerAdoption) {
    const { signature: s, initials: i } = adoption;
    return this.change(businessId, requestId, recipientId, async (tx, at) => {
      await tx.esignRecipient.update({
        where: { id: recipientId },
        data: {
          printedName: adoption.printedName,
          ...{ signatureMethod: s.method, signatureText: s.text, signaturePng: png(s.png) },
          initialsMethod: i?.method ?? null,
          initialsText: i?.text ?? null,
          initialsPng: png(i?.png ?? null),
          adoptedAt: at,
        },
      });
    });
  }

  setAttachment(
    businessId: string,
    requestId: string,
    recipientId: string,
    fieldId: string,
    attachment: SignerAttachment | null,
  ) {
    return this.change(businessId, requestId, recipientId, async (tx) => {
      await tx.esignAttachment.deleteMany({ where: { requestId, recipientId, fieldId } });
      if (!attachment) return;
      const { key, scanStatus, ...rest } = attachment;
      await tx.esignAttachment.create({
        data: {
          ...rest,
          ...{ id: attachmentId(key), businessId, requestId, recipientId, fieldId, s3Key: key },
          scanStatus,
          scannedAt: scanStatus === 'PENDING' ? null : attachment.createdAt,
        },
      });
    });
  }

  async finish(
    businessId: string,
    requestId: string,
    recipientId: string,
    write: SignerFinishWrite,
    readAt: Date,
  ): Promise<string[] | null> {
    // Sealed before the transaction: no KMS call while it holds the lock.
    const sealed = await this.values.seal(
      businessId,
      write.values.map((v) => ({ id: v.fieldId, value: v.value })),
    );
    let emailIds: string[] = [];
    const ok = await this.change(
      businessId,
      requestId,
      recipientId,
      async (tx) => {
        // Their values first: the database freezes a field once its signer has signed.
        for (const v of write.values) {
          await tx.esignField.updateMany({
            where: { id: v.fieldId, requestId, recipientId },
            data: { valueEnc: sealed.get(v.fieldId) ?? null, filled: v.value !== '' },
          });
        }
        for (const t of write.turn) {
          await tx.esignRecipient.update({
            where: { id: t.recipientId },
            data: { status: 'SENT', sentAt: write.signedAt },
          });
        }
        const links = write.turn.flatMap((t) =>
          t.tokenHash ? [{ recipientId: t.recipientId, tokenHash: t.tokenHash }] : [],
        );
        await addLinks(tx, businessId, requestId, links, 'SIGN');
        await tx.esignRecipient.update({
          where: { id: recipientId },
          data: { status: 'SIGNED', signedAt: write.signedAt },
        });
        await tx.esignRequest.update({
          where: { id: requestId },
          data: {
            status: write.status,
            ...(write.allSigned && { completionDueAt: write.signedAt }),
          },
        });
        await addEvents(tx, businessId, requestId, [write.event]);
        emailIds = await queueEmails(tx, businessId, requestId, write.emails);
      },
      readAt,
    );
    return ok ? emailIds : null;
  }

  decline(
    businessId: string,
    requestId: string,
    recipientId: string,
    write: { at: Date; reason: string | null; event: EsignEventRecord },
  ) {
    return this.change(businessId, requestId, recipientId, async (tx) => {
      // The recipient first: a DECLINED request's recipients never change again.
      await tx.esignRecipient.update({
        where: { id: recipientId },
        data: {
          status: 'DECLINED',
          declinedAt: write.at,
          declineReason: write.reason?.trim() ? write.reason : null,
        },
      });
      await tx.esignRequest.update({ where: { id: requestId }, data: { status: 'DECLINED' } });
      await addEvents(tx, businessId, requestId, [write.event]);
    });
  }
}

type EsignRequestStatusOf = SignerRecord['request']['status'];
/** A PNG as the bytea column takes it. */
const png = (bytes: Uint8Array | null) => (bytes ? new Uint8Array(bytes) : null);
