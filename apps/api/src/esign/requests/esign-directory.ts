import { Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../../database/database.module.js';

// The firm data a request refers to (clients, services, portal logins, members), read through
// the firm's scoped client (row-level security). A port so the requests service can be tested
// with an in-memory firm (test/unit/esign-fakes.ts).

export interface DirectoryClient {
  id: string;
  displayName: string;
  assignedUserId: string | null;
  archived: boolean;
}
export interface DirectoryEngagement {
  id: string;
  clientId: string;
  title: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}
export interface DirectoryLogin {
  id: string;
  clientId: string | null;
  portalRole: 'PRIMARY' | 'SPOUSE' | 'AUTHORIZED';
  status: 'INVITED' | 'PENDING_APPROVAL' | 'ACTIVE' | 'DECLINED' | 'DISABLED';
  name: string;
  email: string;
}
export interface DirectoryMember {
  userId: string;
  name: string;
  email: string;
  active: boolean;
}

export interface EsignDirectory {
  client(businessId: string, clientId: string): Promise<DirectoryClient | null>;
  engagement(businessId: string, engagementId: string): Promise<DirectoryEngagement | null>;
  clientLogin(businessId: string, clientAccountId: string): Promise<DirectoryLogin | null>;
  member(businessId: string, userId: string): Promise<DirectoryMember | null>;
}
export const ESIGN_DIRECTORY = Symbol('ESIGN_DIRECTORY');

@Injectable()
export class PrismaEsignDirectory implements EsignDirectory {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async client(businessId: string, id: string): Promise<DirectoryClient | null> {
    const row = await this.database.forBusiness(businessId).client.findFirst({
      where: { businessId, id },
      select: { id: true, displayName: true, assignedUserId: true, archivedAt: true },
    });
    if (!row) return null;
    const { archivedAt, ...client } = row;
    return { ...client, archived: archivedAt !== null };
  }

  engagement(businessId: string, id: string): Promise<DirectoryEngagement | null> {
    return this.database.forBusiness(businessId).engagement.findFirst({
      where: { businessId, id },
      select: { id: true, clientId: true, title: true, status: true },
    });
  }

  async clientLogin(businessId: string, id: string): Promise<DirectoryLogin | null> {
    const row = await this.database.forBusiness(businessId).clientAccount.findFirst({
      where: { businessId, id },
      select: {
        id: true,
        clientId: true,
        portalRole: true,
        status: true,
        email: true,
        user: { select: { name: true } },
      },
    });
    return row && { ...row, name: row.user.name };
  }

  async member(businessId: string, userId: string): Promise<DirectoryMember | null> {
    const row = await this.database.forBusiness(businessId).membership.findFirst({
      where: { businessId, userId },
      select: { status: true, user: { select: { name: true, email: true } } },
    });
    return row && { userId, ...row.user, active: row.status === 'ACTIVE' };
  }
}
