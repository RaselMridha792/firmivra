import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type MyProfile,
  type RequestNameChangeRequest,
  SmsPhone,
  type UpdateMyProfileRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { Notifier } from '../notifications/notifier.js';
import { changedFields, NO_DATE_OF_BIRTH, readDateOfBirth } from './client-secrets.js';

type UpdateBody = z.output<typeof UpdateMyProfileRequest>;
/** Whose login number follows which firm's client record. */
type LoginPhoneMove = { businessId: string; clientId: string; userId: string };
type NameChangeBody = z.output<typeof RequestNameChangeRequest>;

/** The login's number for a record's phone: only one texts may go to (SmsPhone: US numbers). */
const loginPhoneOf = (phone: string | null) =>
  phone === null ? null : (SmsPhone.safeParse(phone).data ?? null);
/** Rounds of "write, then check the record still has that number" before giving up (logged). */
const MOVE_ATTEMPTS = 5;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const primaryOnly = () =>
  new ForbiddenException({
    code: 'FORBIDDEN',
    message: 'Only the primary account holder can change this profile',
  });
const archived = () =>
  new ConflictException({
    code: 'CLIENT_ARCHIVED',
    message: 'Your firm has archived this record. Please contact them.',
  });

const accountSelect = {
  userId: true,
  portalRole: true,
  email: true,
  clientId: true,
} satisfies Prisma.ClientAccountSelect;

const clientSelect = {
  id: true,
  displayName: true,
  phone: true,
  archivedAt: true,
  assignedUserId: true,
  profile: true,
} satisfies Prisma.ClientSelect;

/**
 * The signed-in client's own record at one firm (portal "My Profile"; R10 step 4). The client
 * comes from the session's client account (TenantGuard), never from the URL. Name and date of
 * birth are locked: a name change is a request (a NAME_CHANGE task for the firm's staff). Only
 * the primary login sees the date of birth or changes anything; SSN and EIN are never shown here.
 */
/** An address with nothing on file (the country is the form's default). */
const NO_ADDRESS = {
  line1: null,
  line2: null,
  city: null,
  state: null,
  postalCode: null,
  country: 'US',
};

@Injectable()
export class MyProfileService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly fe: FieldEncryption,
    private readonly notifier: Notifier,
  ) {}

  private readonly logger = new Logger(MyProfileService.name);

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The session's account and its client record; `forChange` locks the client's row first. */
  private async mine(tx: TxClient, businessId: string, clientAccountId: string, forChange = false) {
    const account = await tx.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: accountSelect,
    });
    if (!account?.clientId) throw notFound();
    if (forChange) {
      await tx.$queryRaw`
        SELECT 1 FROM clients WHERE business_id = ${businessId}::uuid AND id = ${account.clientId}::uuid
        FOR NO KEY UPDATE`;
    }
    const client = await tx.client.findFirst({
      where: { businessId, id: account.clientId },
      select: clientSelect,
    });
    if (!client) throw notFound();
    return { account, client };
  }

  /** `afterWrite`: the change is saved, so an unreadable date of birth answers null. */
  private async view(
    businessId: string,
    { account, client }: Awaited<ReturnType<MyProfileService['mine']>>,
  ): Promise<MyProfile> {
    const p = client.profile;
    const name = [p?.firstName, p?.middleName, p?.lastName].filter(Boolean).join(' ');
    const named = {
      portalRole: account.portalRole,
      fullName: name || p?.businessName || client.displayName,
      email: account.email,
    };
    // q21 (Rasel, Oct 8): an AUTHORIZED login sees the name only; the rest reads as empty, as for
    // a client with nothing on file. A SPOUSE sees everything but the date of birth.
    if (account.portalRole === 'AUTHORIZED') {
      return {
        ...named,
        ...NO_DATE_OF_BIRTH,
        phone: null,
        address: NO_ADDRESS,
        preferredContactMethod: null,
        referralSource: null,
        additionalInfo: null,
      };
    }
    const primary = account.portalRole === 'PRIMARY';
    return {
      ...named,
      ...(primary
        ? await readDateOfBirth(this.fe, businessId, client.id, p?.dobEnc)
        : NO_DATE_OF_BIRTH),
      phone: client.phone,
      address: {
        line1: p?.addressLine1 ?? null,
        line2: p?.addressLine2 ?? null,
        city: p?.city ?? null,
        state: p?.state ?? null,
        postalCode: p?.postalCode ?? null,
        country: p?.country ?? NO_ADDRESS.country,
      },
      preferredContactMethod: p?.preferredContactMethod ?? null,
      referralSource: p?.referralSource ?? null,
      additionalInfo: p?.additionalInfo ?? null,
    };
  }

  async get(businessId: string, clientAccountId: string): Promise<MyProfile> {
    const mine = await this.inFirm(businessId, (tx) => this.mine(tx, businessId, clientAccountId));
    const profile = await this.view(businessId, mine);
    await this.audit.log('portal.profile_viewed', { type: 'client', id: mine.client.id });
    return profile;
  }

  /** The primary login edits phone, address and the additional information. */
  async update(businessId: string, clientAccountId: string, body: UpdateBody): Promise<MyProfile> {
    let loginMove: LoginPhoneMove | null = null;
    const mine = await this.inFirm(businessId, async (tx) => {
      const current = await this.mine(tx, businessId, clientAccountId, true);
      if (current.account.portalRole !== 'PRIMARY') throw primaryOnly();
      if (current.client.archivedAt) throw archived();
      const clientId = current.client.id;
      if (body.phone !== undefined) {
        await tx.client.update({
          where: { businessId_id: { businessId, id: clientId } },
          data: { phone: body.phone },
        });
        // R6: the PRIMARY login's own number follows (texts and the SMS switch read users.phone),
        // only if texts may go to it (SmsPhone: US numbers only); any other number leaves the
        // login with none. A new or removed number is unverified and clears every SMS choice, in
        // this transaction. The login itself moves after the commit (moveLoginPhone), on every
        // phone save: a concurrent save may have read users.phone before an earlier move ran.
        const { userId } = current.account;
        const loginPhone = loginPhoneOf(body.phone);
        const user = await tx.user.findFirst({ where: { id: userId }, select: { phone: true } });
        if (user && user.phone !== loginPhone) {
          await tx.clientAccount.updateMany({
            where: { businessId, id: clientAccountId, phoneVerifiedAt: { not: null } },
            data: { phoneVerifiedAt: null },
          });
          await this.notifier.phoneChanged(businessId, userId, tx);
        }
        if (user) loginMove = { businessId, clientId, userId };
      }
      const profile: Prisma.ClientProfileUncheckedUpdateInput = {};
      if (body.address) {
        profile.addressLine1 = body.address.line1;
        profile.addressLine2 = body.address.line2;
        profile.city = body.address.city;
        profile.state = body.address.state;
        profile.postalCode = body.address.postalCode;
        profile.country = body.address.country;
      }
      for (const key of ['preferredContactMethod', 'referralSource', 'additionalInfo'] as const) {
        if (body[key] !== undefined) profile[key] = body[key];
      }
      const data = Object.fromEntries(Object.entries(profile).filter(([, v]) => v !== undefined));
      if (Object.keys(data).length > 0) {
        await tx.clientProfile.upsert({
          where: { clientId },
          create: { businessId, clientId, ...data } as Prisma.ClientProfileUncheckedCreateInput,
          update: data,
        });
      }
      return this.mine(tx, businessId, clientAccountId);
    });
    // The firm's change committed: its audit row first, so a failed login step never loses it.
    await this.audit.log(
      'portal.profile_updated',
      { type: 'client', id: mine.client.id },
      { fields: changedFields(body) },
    );
    if (loginMove) {
      const { userId } = loginMove;
      await this.moveLoginPhone(loginMove).catch((e: unknown) => {
        const name = e instanceof Error ? e.name : 'unknown';
        this.logger.error(`My Profile: login phone not moved for user ${userId}: ${name}`);
      });
    }
    return this.view(businessId, mine);
  }

  /**
   * The login's number lives on its user (users.phone): written in the person's own scope, since
   * users cannot change in a firm's scope, after the firm's change committed (its SMS choices are
   * already off). A client login belongs to one firm only (client_accounts.user_id is unique), so
   * no other firm holds SMS choices for it. If this step fails, the firm's record has the new
   * number, the login keeps the old one, and no SMS choice is left on (logged with the user id).
   * The login moves to the number the record ENDS at, not to the one this save wrote: write it,
   * then read the record again, and repeat if a concurrent save changed it meanwhile. Whichever
   * save writes last read the record after that write, so after any number of concurrent saves
   * users.phone matches the final clients.phone (no lock held across the two scopes, so a busy
   * connection pool cannot stall).
   */
  private async moveLoginPhone({ businessId, clientId, userId }: LoginPhoneMove): Promise<void> {
    const recordPhone = async () =>
      (
        await this.database
          .forBusiness(businessId)
          .client.findFirstOrThrow({ where: { businessId, id: clientId }, select: { phone: true } })
      ).phone;
    let phone = await recordPhone();
    for (let attempt = 1; attempt <= MOVE_ATTEMPTS; attempt++) {
      await this.database
        .forUser(userId)
        .user.updateMany({ where: { id: userId }, data: { phone: loginPhoneOf(phone) } });
      const now = await recordPhone();
      if (now === phone) return;
      phone = now;
    }
    this.logger.warn(`My Profile: login phone of user ${userId} kept changing; left as last seen`);
  }

  /**
   * "Request Name Change": a NAME_CHANGE task for the client's assigned staff member, one open at
   * a time (409 NAME_CHANGE_PENDING). The firm makes the change after checking the documents.
   */
  async requestNameChange(
    businessId: string,
    clientAccountId: string,
    body: NameChangeBody,
  ): Promise<{ ok: true }> {
    const pending = () =>
      new ConflictException({
        code: 'NAME_CHANGE_PENDING',
        message: 'Your firm is already looking at a name change request',
      });
    const { clientId, taskId } = await this.inFirm(businessId, async (tx) => {
      const { account, client } = await this.mine(tx, businessId, clientAccountId, true);
      if (account.portalRole !== 'PRIMARY') throw primaryOnly();
      if (client.archivedAt) throw archived();
      const open = await tx.task.findFirst({
        where: { businessId, clientId: client.id, kind: 'NAME_CHANGE', status: 'OPEN' },
        select: { id: true },
      });
      if (open) throw pending();
      // The assigned staff member, while they are an active member; otherwise nobody yet.
      const assignee = client.assignedUserId
        ? await tx.membership.findFirst({
            where: { businessId, userId: client.assignedUserId, status: 'ACTIVE' },
            select: { userId: true },
          })
        : null;
      const task = await tx.task.create({
        data: {
          businessId,
          clientId: client.id,
          kind: 'NAME_CHANGE',
          title: 'Name change request',
          details: body.reason
            ? `New name: ${body.newName}\nReason: ${body.reason}`
            : `New name: ${body.newName}`,
          assignedUserId: assignee?.userId ?? null,
        },
        select: { id: true },
      });
      return { clientId: client.id, taskId: task.id };
    }).catch((error: unknown) => {
      // One open name change per client (the database's partial unique index agrees).
      if ((error as { code?: string }).code === 'P2002') throw pending();
      throw error;
    });
    await this.audit.log(
      'portal.name_change_requested',
      { type: 'client', id: clientId },
      { taskId },
    );
    return { ok: true };
  }
}
