import { Body, Controller, Get, Inject, Injectable, Module, Put } from '@nestjs/common';
import type { z } from 'zod';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type MyPortalContact,
  type PortalContactSettings,
  type PortalContactSwitches,
  type PortalOfficeContact,
  UpdatePortalContactRequest,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import { contactOf } from '../client-auth/portal-info.controller.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { PortalTabsModule, PortalTabsService } from './portal-tabs.js';

// Client Portal guide 4, 7.2 and 9.4 (PRT-3 on R1's `client_portal_settings`). The firm's switches
// for the portal's contact card; the details come from Company Profile and Locations each time,
// so a change there shows in the portal at once. No row means the defaults.

/** The table's defaults: offices shown, phone, email and messages on, texts and booking off. */
export const PORTAL_CONTACT_DEFAULTS: PortalContactSwitches = {
  showCorporateOffice: true,
  showLocalOffice: true,
  allowPhone: true,
  allowSms: false,
  allowEmail: true,
  allowSecureMessage: true,
  allowAppointmentLink: false,
};
const KEYS = Object.keys(PORTAL_CONTACT_DEFAULTS) as (keyof PortalContactSwitches)[];

const OFFICE = {
  id: true,
  name: true,
  phone: true,
  email: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
  hours: {
    orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }],
    select: { weekday: true, opensAt: true, closesAt: true },
  },
} satisfies Prisma.FirmOfficeSelect;
const LIVE = { status: 'ACTIVE', archivedAt: null } as const;

/** A location read with OFFICE. */
interface Office {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  hours: { weekday: number; opensAt: Date; closesAt: Date }[];
}

/** A location as the portal shows it: its own profile's details only. */
const officeContact = (o: Office): PortalOfficeContact => ({
  id: o.id,
  name: o.name,
  ...contactOf(null, o),
});

@Injectable()
export class PortalContactService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly tabs: PortalTabsService,
  ) {}

  private async switches(tx: TxClient, businessId: string) {
    const row = await tx.clientPortalSettings.findUnique({ where: { businessId } });
    const switches = row
      ? (Object.fromEntries(KEYS.map((k) => [k, row[k]])) as PortalContactSwitches)
      : { ...PORTAL_CONTACT_DEFAULTS };
    return { switches, updatedAt: row?.updatedAt.toISOString() ?? null };
  }

  /** Company Profile under the firm's name, filled from the main location (as the portal's info). */
  private async corporate(tx: TxClient, businessId: string): Promise<PortalOfficeContact | null> {
    const [firm, settings, main] = await Promise.all([
      tx.business.findUnique({ where: { id: businessId }, select: { name: true } }),
      tx.businessSettings.findUnique({
        where: { businessId },
        select: {
          contactPhone: true,
          contactEmail: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
        },
      }),
      tx.firmOffice.findFirst({ where: { businessId, isMain: true, ...LIVE }, select: OFFICE }),
    ]);
    const contact = contactOf(settings, main);
    if (!contact.phone && !contact.email && contact.addressLines.length === 0) return null;
    return { id: null, name: firm?.name ?? 'Corporate Office', ...contact };
  }

  async settings(businessId: string): Promise<PortalContactSettings> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const [{ switches, updatedAt }, corporate, offices] = await Promise.all([
        this.switches(tx, businessId),
        this.corporate(tx, businessId),
        tx.firmOffice.findMany({
          where: { businessId, ...LIVE },
          orderBy: [{ isMain: 'desc' }, { name: 'asc' }, { id: 'asc' }],
          take: 200,
          select: OFFICE,
        }),
      ]);
      return {
        switches,
        updatedAt,
        corporate,
        offices: offices.map(officeContact),
      };
    });
  }

  /** Only the switches sent change; a save that changes nothing writes nothing. Audited. */
  async update(
    businessId: string,
    userId: string,
    body: z.output<typeof UpdatePortalContactRequest>,
  ): Promise<PortalContactSettings> {
    await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const { switches } = await this.switches(tx, businessId);
      const changed = KEYS.filter((k) => body[k] !== undefined && body[k] !== switches[k]);
      if (changed.length === 0) return;
      const next = { ...switches, ...body };
      await tx.clientPortalSettings.upsert({
        where: { businessId },
        create: { businessId, ...next, updatedByUserId: userId },
        update: { ...next, updatedByUserId: userId },
      });
      await this.audit.logIn(
        tx,
        'client_portal.contact_updated',
        { type: 'business', id: businessId },
        { changed: Object.fromEntries(changed.map((k) => [k, next[k]])) },
        { businessId },
      );
    });
    return this.settings(businessId);
  }

  /**
   * The signed-in client's card. Their local office is the one on their client record (or, before
   * a record is linked, the one they chose at registration), shown only while it is active.
   */
  async mine(businessId: string, clientAccountId: string): Promise<MyPortalContact> {
    const messagesOn = await this.tabs.isOn(businessId, 'MESSAGES');
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const { switches } = await this.switches(tx, businessId);
      const account = await tx.clientAccount.findFirst({
        where: { businessId, id: clientAccountId },
        select: { clientId: true, selectedOfficeId: true },
      });
      const clientId = account?.clientId ?? null;
      const client = clientId
        ? await tx.client.findFirst({
            where: { businessId, id: clientId },
            select: { officeId: true },
          })
        : null;
      const officeId = client?.officeId ?? account?.selectedOfficeId ?? null;
      const [corporate, local, consent] = await Promise.all([
        switches.showCorporateOffice ? this.corporate(tx, businessId) : null,
        switches.showLocalOffice && officeId
          ? tx.firmOffice.findFirst({
              where: { businessId, id: officeId, ...LIVE },
              select: OFFICE,
            })
          : null,
        switches.allowSms && clientId
          ? tx.communicationConsent.findFirst({
              where: { businessId, clientId, channel: 'SMS' },
              select: { status: true },
            })
          : null,
      ]);
      return {
        corporate,
        local: local ? officeContact(local) : null,
        methods: {
          phone: switches.allowPhone,
          sms: switches.allowSms && consent?.status === 'OPTED_IN',
          email: switches.allowEmail,
          secureMessage: switches.allowSecureMessage && messagesOn,
          appointment: switches.allowAppointmentLink,
        },
      };
    });
  }
}

/** Settings > Client portal > Contact Information: Owner and Admin. */
@Controller('business/settings/portal-contact')
@Roles(...FIRM_MANAGERS)
export class PortalContactController {
  constructor(private readonly contact: PortalContactService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<PortalContactSettings> {
    return this.contact.settings(tenant.businessId);
  }

  @Put()
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdatePortalContactRequest))
    body: z.output<typeof UpdatePortalContactRequest>,
  ): Promise<PortalContactSettings> {
    return this.contact.update(tenant.businessId, auth.userId, body);
  }
}

/** The portal's contact card for the signed-in client (the client from their login, never the URL). */
@Controller('portal/:firmSlug/me/contact')
@Roles('CLIENT')
export class MyPortalContactController {
  constructor(private readonly contact: PortalContactService) {}

  @Get()
  mine(@CurrentTenant() tenant: TenantContext): Promise<MyPortalContact> {
    if (tenant.kind !== 'client') throw new Error('portal contact needs a client login');
    return this.contact.mine(tenant.businessId, tenant.clientAccountId);
  }
}

@Module({
  imports: [PortalTabsModule],
  controllers: [PortalContactController, MyPortalContactController],
  providers: [PortalContactService],
})
export class PortalContactModule {}
