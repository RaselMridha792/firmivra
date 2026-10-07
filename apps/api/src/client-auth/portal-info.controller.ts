import {
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { LegalKind, type LegalDocument, type LegalVersion, type PortalInfo } from '@firmivra/types';
import { Public } from '../auth/decorators.js';
import { DATABASE } from '../database/database.module.js';

/** Until the firm sets its own: the navy and gold of the portal mockups. */
export const DEFAULT_PRIMARY_COLOR = '#1F3A6B';
/** No accent column yet (R0 asked Rasel); every firm gets this until there is one. */
export const DEFAULT_ACCENT_COLOR = '#C9A227';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const KIND = { terms: 'TERMS', privacy: 'PRIVACY' } as const;
/** Only the version and date go to the browser, never the document's id. */
const shown = (v: LegalVersion | null): LegalVersion | null =>
  v && { version: v.version, publishedAt: v.publishedAt };

/**
 * The portal's public reads (docs/api/client-auth.yaml). Only ACTIVE firms have a portal: any
 * other slug answers 404, so the portal never shows whether a firm exists.
 */
@Injectable()
export class PortalInfoService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** An ACTIVE firm by its portal slug (any letter case), or 404. */
  async activeFirm(firmSlug: string): Promise<{ id: string; slug: string; name: string }> {
    const firm = await this.db.forPlatform().business.findUnique({
      where: { slug: firmSlug.toLowerCase() },
      select: { id: true, slug: true, name: true, status: true },
    });
    if (firm?.status !== 'ACTIVE') throw notFound();
    return firm;
  }

  /** A firm by its portal slug whatever its status, or null: only for signing out. */
  async firmBySlug(firmSlug: string): Promise<{ id: string; slug: string; name: string } | null> {
    return this.db.forPlatform().business.findUnique({
      where: { slug: firmSlug.toLowerCase() },
      select: { id: true, slug: true, name: true },
    });
  }

  /** Whether the firm takes sign-ups now, and the documents a sign-up accepts (with their ids). */
  async signUpPolicy(businessId: string) {
    const [settings, terms, privacy] = await Promise.all([
      this.db.forBusiness(businessId).businessSettings.findUnique({
        where: { businessId },
        select: { clientSignUpEnabled: true },
      }),
      this.currentVersion(businessId, 'TERMS'),
      this.currentVersion(businessId, 'PRIVACY'),
    ]);
    const open = (settings?.clientSignUpEnabled ?? true) && terms !== null && privacy !== null;
    return { open, terms, privacy };
  }

  async info(firmSlug: string): Promise<PortalInfo> {
    const firm = await this.activeFirm(firmSlug);
    const scope = this.db.forBusiness(firm.id);
    const [settings, terms, privacy] = await Promise.all([
      scope.businessSettings.findUnique({
        where: { businessId: firm.id },
        select: {
          brandColor: true,
          clientSignUpEnabled: true,
          portalName: true,
          portalHeader: true,
          welcomeMessage: true,
        },
      }),
      this.currentVersion(firm.id, 'TERMS'),
      this.currentVersion(firm.id, 'PRIVACY'),
    ]);
    return {
      business: { slug: firm.slug, name: firm.name },
      branding: {
        logoUrl: null, // R5 serves logos
        primaryColor: settings?.brandColor ?? DEFAULT_PRIMARY_COLOR,
        accentColor: DEFAULT_ACCENT_COLOR,
        portalName: settings?.portalName ?? `${firm.name} Client Portal`,
        header: settings?.portalHeader ?? null,
        welcomeMessage: settings?.welcomeMessage ?? null,
      },
      // Sign-up needs both documents to accept, and the firm's say-so.
      signUpOpen: (settings?.clientSignUpEnabled ?? true) && terms !== null && privacy !== null,
      legal: { terms: shown(terms), privacy: shown(privacy) },
    };
  }

  async legal(firmSlug: string, kind: string): Promise<LegalDocument> {
    const parsed = LegalKind.safeParse(kind);
    if (!parsed.success) throw notFound();
    const firm = await this.activeFirm(firmSlug);
    const doc = await this.db.forBusiness(firm.id).firmLegalDocument.findFirst({
      where: { kind: KIND[parsed.data] },
      orderBy: { version: 'desc' },
      select: { version: true, publishedAt: true, body: true },
    });
    if (!doc) throw notFound();
    return {
      kind: parsed.data,
      version: doc.version,
      publishedAt: doc.publishedAt.toISOString(),
      body: doc.body,
    };
  }

  /** The highest published version of a document, or null when the firm has none yet. */
  async currentVersion(
    businessId: string,
    kind: 'TERMS' | 'PRIVACY',
  ): Promise<(LegalVersion & { id: string }) | null> {
    const doc = await this.db.forBusiness(businessId).firmLegalDocument.findFirst({
      where: { kind },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, publishedAt: true },
    });
    return doc
      ? { id: doc.id, version: doc.version, publishedAt: doc.publishedAt.toISOString() }
      : null;
  }
}

/** GET /api/v1/portal/{firmSlug}/info and /legal/{kind}: public, for the portal layout and sign-up. */
@Controller('portal/:firmSlug')
export class PortalInfoController {
  constructor(private readonly portal: PortalInfoService) {}

  @Get('info')
  @Public()
  info(@Param('firmSlug') firmSlug: string): Promise<PortalInfo> {
    return this.portal.info(firmSlug);
  }

  @Get('legal/:kind')
  @Public()
  legal(@Param('firmSlug') firmSlug: string, @Param('kind') kind: string): Promise<LegalDocument> {
    return this.portal.legal(firmSlug, kind);
  }
}

@Module({
  controllers: [PortalInfoController],
  providers: [PortalInfoService],
  exports: [PortalInfoService],
})
export class PortalInfoModule {}
