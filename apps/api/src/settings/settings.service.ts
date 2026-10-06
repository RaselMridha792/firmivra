import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type Database, type TxClient } from '@firmivra/db';
import {
  FirmLegalDocument,
  FirmPortalSettings,
  FirmSettings,
  type UpdateBusinessSettingsRequest,
  type SaveBusinessSetupRequest,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { SettingsAssets } from './settings.assets.js';

const portalColumns = {
  portalName: 'portal_name',
  portalHeader: 'portal_header',
  welcomeMessage: 'welcome_message',
} as const;
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
export function requireSetupSteps(steps: string[], available: Record<string, boolean>): void {
  if (steps.includes('finish') || steps.some((step) => !available[step]))
    throw new ConflictException({
      code: 'SETUP_INCOMPLETE',
      message: 'Complete the required setup information first',
    });
}
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly assets: SettingsAssets,
  ) {}
  private context() {
    const context = requestContext.getStore();
    if (!context?.tenant || !context.auth) throw notFound();
    return { businessId: context.tenant.businessId, userId: context.auth.userId };
  }
  private async row(tx: TxClient, businessId: string) {
    return tx.businessSettings.upsert({
      where: { businessId },
      create: { businessId },
      update: {},
    });
  }
  private async serialize(tx: TxClient, businessId: string) {
    const profile = await tx.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, legalName: true, slug: true, status: true },
    });
    if (!profile) throw notFound();
    const row = await this.row(tx, businessId);
    const extra = await tx.$queryRaw<
      { portalName: string | null; portalHeader: string | null; welcomeMessage: string | null }[]
    >`SELECT to_jsonb(s)->>'portal_name' AS "portalName", to_jsonb(s)->>'portal_header' AS "portalHeader", to_jsonb(s)->>'welcome_message' AS "welcomeMessage" FROM business_settings s WHERE business_id=${businessId}::uuid`;
    const progress = row.setupProgress as { completedSteps?: string[] };
    const fields = Object.fromEntries(
      Object.entries(row).filter(([key]) => key in FirmSettings.shape),
    );
    return FirmSettings.parse({
      profile,
      ...fields,
      ...extra[0],
      setup: {
        completedSteps: progress.completedSteps ?? [],
        completedAt: row.setupCompletedAt?.toISOString() ?? null,
      },
      updatedAt: row.updatedAt.toISOString(),
    });
  }
  async get() {
    const { businessId } = this.context();
    const result = await this.db.withScope({ kind: 'business', businessId }, (tx) =>
      this.serialize(tx, businessId),
    );
    await this.audit.log('business.settings.viewed', { type: 'business', id: businessId });
    return result;
  }
  async update(input: UpdateBusinessSettingsRequest) {
    const { businessId } = this.context();
    const result = await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id=${businessId}::uuid FOR UPDATE`;
      const current = await this.row(tx, businessId);
      if (
        input.logoKey !== undefined &&
        input.logoKey !== null &&
        input.logoKey !== current.logoKey
      )
        await this.assets.authorizeLogo(businessId, input.logoKey);
      if (input.enabledModules)
        await this.assets.authorizeModules(
          businessId,
          input.enabledModules,
          current.enabledModules,
        );
      const { name, portalName, portalHeader, welcomeMessage, ...settings } = input;
      const extras = { portalName, portalHeader, welcomeMessage };
      const assignments = Object.entries(portalColumns)
        .filter(([key]) => extras[key as keyof typeof extras] !== undefined)
        .map(
          ([key, column]) =>
            Prisma.sql`${Prisma.raw(column)}=${extras[key as keyof typeof extras]}`,
        );
      if (assignments.length) {
        const columns = await tx.$queryRaw<
          { column_name: string }[]
        >`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='business_settings'`;
        if (
          Object.entries(portalColumns).some(
            ([key, column]) =>
              extras[key as keyof typeof extras] !== undefined &&
              !columns.some((c) => c.column_name === column),
          )
        )
          throw new ServiceUnavailableException({
            code: 'SCHEMA_NOT_READY',
            message: 'Portal content fields are awaiting the database update',
          });
        await tx.$executeRaw(
          Prisma.sql`UPDATE business_settings SET ${Prisma.join(assignments)},updated_at=now() WHERE business_id=${businessId}::uuid`,
        );
      }
      if (name !== undefined)
        await tx.business.update({ where: { id: businessId }, data: { name: name.trim() } });
      await tx.businessSettings.update({ where: { businessId }, data: settings });
      return this.serialize(tx, businessId);
    });
    await this.audit.log(
      'business.settings.updated',
      { type: 'business', id: businessId },
      { fields: Object.keys(input) },
    );
    return result;
  }
  async setup() {
    return (await this.get()).setup;
  }
  async saveSetup(input: SaveBusinessSetupRequest) {
    const { businessId } = this.context();
    const result = await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id=${businessId}::uuid FOR UPDATE`;
      const settings = await this.row(tx, businessId);
      if (settings.setupCompletedAt)
        throw new ConflictException({
          code: 'SETUP_COMPLETE',
          message: 'Setup is already complete',
        });
      requireSetupSteps(input.completedSteps, await this.available(tx, businessId));
      await tx.businessSettings.update({
        where: { businessId },
        data: { setupProgress: { completedSteps: input.completedSteps } },
      });
      return (await this.serialize(tx, businessId)).setup;
    });
    await this.audit.log(
      'business.setup.saved',
      { type: 'business', id: businessId },
      { steps: input.completedSteps },
    );
    return result;
  }
  private async available(tx: TxClient, businessId: string) {
    const settings = await this.row(tx, businessId);
    const kinds = await tx.firmLegalDocument.findMany({
      where: { businessId },
      select: { kind: true },
      distinct: ['kind'],
    });
    return {
      branding: !!settings.brandColor,
      businessDetails: !!settings.contactEmail && !!settings.country,
      team:
        (await tx.membership.count({ where: { businessId, role: 'OWNER', status: 'ACTIVE' } })) > 0,
      clientPortal: kinds.length === 2,
    };
  }
  async complete() {
    const { businessId } = this.context();
    const result = await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id=${businessId}::uuid FOR UPDATE`;
      const row = await this.row(tx, businessId);
      if (!row.setupCompletedAt) {
        const steps = ['branding', 'businessDetails', 'team', 'clientPortal'];
        requireSetupSteps(steps, await this.available(tx, businessId));
        await tx.businessSettings.update({
          where: { businessId },
          data: {
            setupProgress: { completedSteps: [...steps, 'finish'] },
            setupCompletedAt: new Date(),
          },
        });
      }
      return (await this.serialize(tx, businessId)).setup;
    });
    await this.audit.log('business.setup.completed', { type: 'business', id: businessId });
    return result;
  }
  async legal(kind: 'TERMS' | 'PRIVACY', version?: number) {
    const { businessId } = this.context();
    const row = await this.db.forBusiness(businessId).firmLegalDocument.findFirst({
      where: { businessId, kind, ...(version === undefined ? {} : { version }) },
      orderBy: { version: 'desc' },
    });
    if (!row) throw notFound();
    await this.audit.log(
      'business.legal.viewed',
      { type: 'firmLegalDocument', id: row.id },
      { kind, version: row.version },
    );
    return FirmLegalDocument.parse({
      id: row.id,
      kind: row.kind,
      version: row.version,
      bodyMarkdown: row.body,
      publishedAt: row.publishedAt.toISOString(),
    });
  }
  async publish(kind: 'TERMS' | 'PRIVACY', bodyMarkdown: string) {
    const { businessId, userId } = this.context();
    const row = await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      await tx.$queryRaw`SELECT id FROM businesses WHERE id=${businessId}::uuid FOR UPDATE`;
      const last = await tx.firmLegalDocument.findFirst({
        where: { businessId, kind },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.firmLegalDocument.create({
        data: {
          businessId,
          kind,
          version: (last?.version ?? 0) + 1,
          body: bodyMarkdown,
          publishedByUserId: userId,
        },
      });
    });
    await this.audit.log(
      'business.legal.published',
      { type: 'firmLegalDocument', id: row.id },
      { kind, version: row.version },
    );
    return FirmLegalDocument.parse({
      id: row.id,
      kind: row.kind,
      version: row.version,
      bodyMarkdown: row.body,
      publishedAt: row.publishedAt.toISOString(),
    });
  }
  async portal() {
    const { businessId, userId } = this.context();
    const settings = await this.get();
    const account = await this.db.forBusiness(businessId).clientAccount.findFirst({
      where: { businessId, userId, status: 'ACTIVE' },
      select: { accountType: true },
    });
    if (!account) throw notFound();
    return FirmPortalSettings.parse({
      name: settings.profile.name,
      portalName: settings.portalName,
      portalHeader: settings.portalHeader,
      welcomeMessage: settings.welcomeMessage,
      brandColor: settings.brandColor,
      logoUrl: await this.assets.logoUrl(businessId, settings.logoKey),
      enabledModules: settings.enabledModules.filter(
        (key) =>
          account.accountType === 'BUSINESS' ||
          !['business', 'business-resources', 'payroll'].includes(key),
      ),
      clientSignUpEnabled: settings.clientSignUpEnabled,
    });
  }
}
