import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import {
  APPLICABLE_PROFILE_FIELDS,
  type AppliedProfileChange,
  type ApplyProfileChangeRequest,
  type FirmProfileChangeRequest,
  type FirmProfileChanges,
  type FirmProfileErrorCode,
  PROFILE_CHANGE_KIND_LABELS,
  type ProfileChangeField,
  readProfileChangeTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import {
  FieldEncryption,
  FieldEncryptionError,
} from '../field-encryption/field-encryption.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { EIN_HASH_KEY, type EinHashKey, einHash } from '../firm-applications/ein-hash.js';
import { einContext } from '../settings/settings.service.js';

type ApplyBody = z.output<typeof ApplyProfileChangeRequest>;

/** The platform's audit row for an applied request; its time is the request's "applied". */
const APPLIED = 'business.profile_change_applied';
/** A Request Change ticket's subject starts with its card's title (R60). */
const PREFIXES = Object.values(PROFILE_CHANGE_KIND_LABELS).map((t) => `${t} change request: `);
/** Encryption failures that mean "not now": no key for the firm yet, or KMS down or refusing. */
const UNAVAILABLE = new Set(['KEY_NOT_PROVISIONED', 'KMS_UNAVAILABLE', 'KEY_ACCESS_DENIED']);
/** Past setup: the firm edits these itself while Pending Setup; a closed firm stays as it was. */
const LIVE = new Set(['ACTIVE', 'SUSPENDED']);

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const conflict = (code: FirmProfileErrorCode, message: string) =>
  new ConflictException({ code, message });
/** As the Super Admin's ticket screens show a number. */
const ticketNumber = (n: number) => `#${String(n).padStart(4, '0')}`;

/**
 * The Super Admin applies a firm's approved Company Profile Request Change (R56, Rasel Oct 24;
 * R60's Needs). Admin scope only: the firm's settings row and the legal name are written by R1's
 * definer function `app_admin_apply_profile_change`, which also writes the firm's own audit row;
 * this service seals the EIN with the firm's key (never logged or returned), checks it against
 * other firms' applications, and writes the platform's audit row in the same transaction.
 */
@Injectable()
export class AdminFirmProfileService {
  private readonly logger = new Logger(AdminFirmProfileService.name);

  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
    private readonly fieldEncryption: FieldEncryption,
    @Inject(EIN_HASH_KEY) private readonly einKey: EinHashKey,
  ) {}

  async list(firmId: string): Promise<FirmProfileChanges> {
    const db = this.admin.db;
    const firm = await db.business.findUnique({
      where: { id: firmId },
      select: { id: true, name: true, legalName: true, status: true },
    });
    if (!firm) throw notFound();
    const tickets = await db.supportTicket.findMany({
      where: {
        businessId: firmId,
        OR: PREFIXES.map((p) => ({ subject: { startsWith: p } })),
      },
      orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
      take: 50,
      select: {
        id: true,
        number: true,
        subject: true,
        description: true,
        status: true,
        createdAt: true,
      },
    });
    const applied = tickets.length
      ? await db.auditLog.findMany({
          where: {
            businessId: null,
            action: APPLIED,
            entityType: 'support_ticket',
            entityId: { in: tickets.map((t) => t.id) },
          },
          orderBy: { createdAt: 'desc' },
          select: { entityId: true, createdAt: true, actorName: true, metadata: true },
        })
      : [];
    const requests = tickets.flatMap((t): FirmProfileChangeRequest[] => {
      const asked = readProfileChangeTicket(t.subject, t.description);
      if (!asked) return [];
      const last = applied.find((a) => a.entityId === t.id);
      const fields = (last?.metadata as { fields?: ProfileChangeField[] } | null)?.fields ?? [];
      return [
        {
          ticketId: t.id,
          number: ticketNumber(t.number),
          kind: asked.kind,
          fields: asked.fields,
          status: t.status,
          submittedAt: t.createdAt.toISOString(),
          current: asked.current,
          proposed: asked.proposed,
          reason: asked.reason,
          applied: last
            ? { at: last.createdAt.toISOString(), by: last.actorName ?? null, fields }
            : null,
        },
      ];
    });
    return { firm, requests };
  }

  async apply(firmId: string, ticketId: string, body: ApplyBody): Promise<AppliedProfileChange> {
    const fields = APPLICABLE_PROFILE_FIELDS.filter((f) => body[f] !== undefined);
    const result = await this.admin.transaction(async (tx) => {
      const firm = await tx.business.findUnique({
        where: { id: firmId },
        select: { status: true, legalName: true },
      });
      const ticket = firm
        ? await tx.supportTicket.findFirst({
            where: { id: ticketId, businessId: firmId },
            select: { subject: true, description: true, status: true },
          })
        : null;
      const asked = ticket && readProfileChangeTicket(ticket.subject, ticket.description);
      if (!firm || !ticket || !asked) throw notFound();
      if (ticket.status === 'CLOSED')
        throw conflict('TICKET_CLOSED', 'This request is closed. Reopen the ticket to apply it.');
      if (!LIVE.has(firm.status))
        throw conflict('FIRM_NOT_ACTIVE', 'The firm is in setup or closed.');
      const stray = fields.filter((f) => !asked.fields.includes(f));
      if (stray.length)
        throw new BadRequestException({
          code: 'NOT_REQUESTED',
          message: 'Apply only what the request asks for',
          details: stray.map((f) => ({ path: f, message: 'The request does not ask for this' })),
        });

      let einEnc: Uint8Array | null = null;
      if (body.ein !== undefined) {
        await this.checkEin(tx, firmId, body.ein);
        einEnc = await this.seal(tx, firmId, body.ein);
      }
      const einLast4 = body.ein?.slice(-4) ?? null;
      await tx.$executeRaw`SELECT app_admin_apply_profile_change(
        ${firmId}::uuid, ${ticketId}::uuid, ${body.legalName ?? null}::text,
        ${einEnc}::bytea, ${einLast4}::text, ${fields}::text[])`;
      // The platform's row; the firm's own row is written by the function.
      await this.audit.logIn(
        tx,
        APPLIED,
        { type: 'support_ticket', id: ticketId },
        { businessId: firmId, fields },
        { businessId: null },
      );
      return {
        legalName: body.legalName?.trim() ?? firm.legalName,
        einLast4,
      };
    });
    return {
      ticketId,
      fields,
      legalName: result.legalName,
      einLast4: result.einLast4,
      appliedAt: new Date().toISOString(),
    };
  }

  /** Another firm's application with this EIN: the keyed hash, as the application review compares. */
  private async checkEin(tx: TxClient, firmId: string, ein: string): Promise<void> {
    // Fails closed, as an application's submit does: no EIN applies unchecked.
    if (!this.einKey.ok) {
      this.logger.warn(`The EIN check cannot run: ${this.einKey.problem}`);
      throw new ServiceUnavailableException({
        code: 'ENCRYPTION_UNAVAILABLE',
        message: 'The EIN cannot be saved right now. Try again later.',
      });
    }
    const other = await tx.firmApplication.findFirst({
      where: {
        einHash: { equals: new Uint8Array(einHash(this.einKey.key, ein)) },
        OR: [{ businessId: null }, { businessId: { not: firmId } }],
      },
      select: { id: true },
    });
    if (other) throw conflict('DUPLICATE_EIN', "Another firm's application has this EIN");
  }

  /** The EIN sealed with the firm's key, or 503 ENCRYPTION_UNAVAILABLE when that can't be done now. */
  private async seal(tx: TxClient, firmId: string, ein: string): Promise<Uint8Array> {
    try {
      return await this.fieldEncryption.encrypt(einContext(firmId), ein, { tx });
    } catch (e) {
      if (!(e instanceof FieldEncryptionError) || !UNAVAILABLE.has(e.code)) throw e;
      // The reason's code only, never the EIN.
      this.logger.warn(`Firm ${firmId}: the EIN could not be sealed (${e.code})`);
      throw new ServiceUnavailableException({
        code: 'ENCRYPTION_UNAVAILABLE',
        message: 'The EIN cannot be saved right now. Try again later.',
      });
    }
  }
}
