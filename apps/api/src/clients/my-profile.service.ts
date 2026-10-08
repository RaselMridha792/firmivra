import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { MyProfile, RequestNameChangeRequest, UpdateMyProfileRequest } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { changedFields, readDateOfBirth, readDateOfBirthAfterWrite } from './client-secrets.js';

type UpdateBody = z.output<typeof UpdateMyProfileRequest>;
type NameChangeBody = z.output<typeof RequestNameChangeRequest>;

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
@Injectable()
export class MyProfileService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly fe: FieldEncryption,
  ) {}

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
    afterWrite = false,
  ): Promise<MyProfile> {
    const p = client.profile;
    const name = [p?.firstName, p?.middleName, p?.lastName].filter(Boolean).join(' ');
    const primary = account.portalRole === 'PRIMARY';
    return {
      portalRole: account.portalRole,
      fullName: name || p?.businessName || client.displayName,
      dateOfBirth: !primary
        ? null
        : afterWrite
          ? await readDateOfBirthAfterWrite(this.fe, businessId, client.id, p?.dobEnc)
          : await readDateOfBirth(this.fe, businessId, client.id, p?.dobEnc),
      email: account.email,
      phone: client.phone,
      address: {
        line1: p?.addressLine1 ?? null,
        line2: p?.addressLine2 ?? null,
        city: p?.city ?? null,
        state: p?.state ?? null,
        postalCode: p?.postalCode ?? null,
        country: p?.country ?? 'US',
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
    await this.audit.log(
      'portal.profile_updated',
      { type: 'client', id: mine.client.id },
      { fields: changedFields(body) },
    );
    return this.view(businessId, mine, true);
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
