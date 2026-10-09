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
  phone: string | null;
  /** Their own job title (Staff Title merge field). */
  jobTitle: string | null;
  active: boolean;
}

/** What the client merge fields read. `address` is one line; null when none is on file. */
export interface DirectoryClientContact {
  displayName: string;
  accountType: 'INDIVIDUAL' | 'BUSINESS';
  firstName: string | null;
  lastName: string | null;
  businessName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  /** The name on the client's ACTIVE SPOUSE login. */
  spouseName: string | null;
}

/** What the firm merge fields read, and the firm's time zone for the date. */
export interface DirectoryFirm {
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  timeZone: string;
}

type AddressParts = {
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};
/** "Line 1, Line 2, City, ST 12345"; null when nothing is on file. */
export function oneLineAddress(a: AddressParts | null | undefined): string | null {
  if (!a) return null;
  const region = [a.state, a.postalCode].filter(Boolean).join(' ');
  return [a.addressLine1, a.addressLine2, a.city, region].filter(Boolean).join(', ') || null;
}
const ADDRESS = {
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
} as const;

/** One of a client's documents (R5's vault), for from-vault. */
export interface DirectoryDocument {
  id: string;
  clientId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  s3Key: string;
  scanStatus: 'PENDING' | 'CLEAN' | 'INFECTED' | 'FAILED';
}

export interface EsignDirectory {
  client(businessId: string, clientId: string): Promise<DirectoryClient | null>;
  engagement(businessId: string, engagementId: string): Promise<DirectoryEngagement | null>;
  clientLogin(businessId: string, clientAccountId: string): Promise<DirectoryLogin | null>;
  member(businessId: string, userId: string): Promise<DirectoryMember | null>;
  clientContact(businessId: string, clientId: string): Promise<DirectoryClientContact | null>;
  firm(businessId: string): Promise<DirectoryFirm>;
  document(businessId: string, documentId: string): Promise<DirectoryDocument | null>;
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
      select: { status: true, user: { select: { name: true, email: true, phone: true } } },
    });
    // TODO(r0_esign): the member's job title column arrives with r0_esign; null until then.
    return row && { userId, ...row.user, jobTitle: null, active: row.status === 'ACTIVE' };
  }

  async clientContact(businessId: string, id: string): Promise<DirectoryClientContact | null> {
    const row = await this.database.forBusiness(businessId).client.findFirst({
      where: { businessId, id },
      select: {
        displayName: true,
        accountType: true,
        email: true,
        phone: true,
        profile: { select: { firstName: true, lastName: true, businessName: true, ...ADDRESS } },
        accounts: {
          where: { portalRole: 'SPOUSE', status: 'ACTIVE' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { user: { select: { name: true } } },
        },
      },
    });
    if (!row) return null;
    const { profile, accounts, ...client } = row;
    return {
      ...client,
      firstName: profile?.firstName ?? null,
      lastName: profile?.lastName ?? null,
      businessName: profile?.businessName ?? null,
      address: oneLineAddress(profile),
      spouseName: accounts[0]?.user.name ?? null,
    };
  }

  async firm(businessId: string): Promise<DirectoryFirm> {
    const row = await this.database.forBusiness(businessId).business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        name: true,
        settings: {
          select: { contactEmail: true, contactPhone: true, timezone: true, ...ADDRESS },
        },
      },
    });
    const settings = row.settings;
    return {
      name: row.name,
      address: oneLineAddress(settings),
      phone: settings?.contactPhone ?? null,
      email: settings?.contactEmail ?? null,
      timeZone: settings?.timezone ?? 'America/New_York',
    };
  }

  document(businessId: string, id: string): Promise<DirectoryDocument | null> {
    return this.database.forBusiness(businessId).document.findFirst({
      where: { businessId, id },
      select: {
        id: true,
        clientId: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        sha256: true,
        s3Key: true,
        scanStatus: true,
      },
    });
  }
}
