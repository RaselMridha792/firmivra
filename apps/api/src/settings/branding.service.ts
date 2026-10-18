import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  BrandingGroup,
  BrandingSettings,
  ResetBrandingRequest,
  UpdateBrandingRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import {
  BRAND_ASSET_COLUMNS,
  BrandAssetsService,
  brandAssetUrl,
  ensureBrandRows,
} from './brand-assets.service.js';

// Company Profile & Branding (R42 contract, packages/types/src/settings/branding.ts): the parts
// of the page `api.settings` does not hold, kept on business_settings (theme, login, formats,
// favicon and login background) and business_brand_profiles (email, portal and document branding).
// Every save is a published version (business_brand_versions keeps its snapshot) and must name
// the version it was loaded at (409 SAVE_CONFLICT). Owner and Admin (the controller's roles).
//
// Mapped: businessCategory is `industry`, adminEmail is `support_email`, themeMode is `theme`.
// Not stored yet: the legal name is locked for the firm (Firmivra sets it at approval: 403); the
// letterhead switch follows its header and footer; the number format is 1,234.56 only.

type Patch = z.output<typeof UpdateBrandingRequest>;
type Reset = z.output<typeof ResetBrandingRequest>;

const DATE_FORMAT = { MDY: 'MM/DD/YYYY', DMY: 'DD/MM/YYYY', YMD: 'YYYY-MM-DD' } as const;
const DATE_COLUMN = { 'MM/DD/YYYY': 'MDY', 'DD/MM/YYYY': 'DMY', 'YYYY-MM-DD': 'YMD' } as const;
const NUMBER_FORMAT = '1,234.56';
/** The text tokens' dark (--color-text), for the background contrast check. */
const TEXT_HEX = '#273444';

const invalid = (message: string, path?: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message, ...(path ? { path } : {}) });

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const settingsSelect = {
  faviconKey: true,
  loginBackgroundKey: true,
  secondaryColor: true,
  backgroundColor: true,
  theme: true,
  sidebarStyle: true,
  sidebarPosition: true,
  showLogoText: true,
  roundedCorners: true,
  loginMessage: true,
  supportEmail: true,
  industry: true,
  locale: true,
  currency: true,
  dateFormat: true,
  brandingVersion: true,
  brandingPublishedAt: true,
} satisfies Prisma.BusinessSettingsSelect;

/** What each Reset group restores (company profile data stays). */
const RESET: Record<
  BrandingGroup,
  {
    settings?: Prisma.BusinessSettingsUncheckedUpdateInput;
    profile?: Prisma.BusinessBrandProfileUncheckedUpdateInput;
  }
> = {
  THEME: {
    settings: {
      secondaryColor: null,
      backgroundColor: null,
      theme: 'LIGHT',
      sidebarStyle: 'SOLID',
      sidebarPosition: 'LEFT',
      showLogoText: true,
      roundedCorners: true,
      faviconKey: null,
    },
  },
  LOGIN: { settings: { loginBackgroundKey: null, loginMessage: null } },
  EMAIL: {
    profile: {
      emailLogoKey: null,
      emailFromName: null,
      replyToEmail: null,
      emailHeader: null,
      emailFooter: null,
      emailDisclaimer: null,
    },
  },
  PORTAL: { profile: { portalLogoKey: null, portalBrandColor: null, portalAccentColor: null } },
  DOCUMENTS: {
    profile: {
      letterheadHeader: null,
      letterheadFooter: null,
      documentFooter: null,
      signatureBlock: null,
      legalText: null,
    },
  },
};

@Injectable()
export class BrandingService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly assets: BrandAssetsService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private async view(tx: TxClient, businessId: string): Promise<BrandingSettings> {
    await ensureBrandRows(tx, businessId);
    const [business, s, p] = await Promise.all([
      tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { slug: true, legalName: true },
      }),
      tx.businessSettings.findUniqueOrThrow({ where: { businessId }, select: settingsSelect }),
      tx.businessBrandProfile.findUniqueOrThrow({ where: { businessId } }),
    ]);
    const url = (kind: keyof typeof BRAND_ASSET_COLUMNS, key: string | null) =>
      brandAssetUrl(this.env.PORTAL_BASE_URL, business.slug, kind, key);
    const updated = [s.brandingPublishedAt, p.updatedAt].filter(Boolean) as Date[];
    return {
      legalName: business.legalName,
      businessCategory: s.industry,
      adminEmail: s.supportEmail,
      secondaryColor: s.secondaryColor,
      backgroundColor: s.backgroundColor,
      themeMode: s.theme,
      sidebarStyle: s.sidebarStyle,
      sidebarPosition: s.sidebarPosition,
      showLogoText: s.showLogoText,
      roundedCorners: s.roundedCorners,
      faviconUrl: url('FAVICON', s.faviconKey),
      loginBackgroundUrl: url('LOGIN_BACKGROUND', s.loginBackgroundKey),
      loginMessage: s.loginMessage,
      email: {
        logoUrl: url('EMAIL_LOGO', p.emailLogoKey),
        fromName: p.emailFromName,
        replyToEmail: p.replyToEmail,
        header: p.emailHeader,
        footer: p.emailFooter,
        disclaimer: p.emailDisclaimer,
      },
      portal: {
        logoUrl: url('PORTAL_LOGO', p.portalLogoKey),
        primaryColor: p.portalBrandColor,
        accentColor: p.portalAccentColor,
      },
      documents: {
        showLetterhead: p.letterheadHeader !== null || p.letterheadFooter !== null,
        header: p.letterheadHeader,
        footer: p.letterheadFooter,
        signatureBlock: p.signatureBlock,
        legalText: p.legalText,
      },
      preferences: {
        locale: s.locale,
        currency: s.currency.toUpperCase(),
        dateFormat: DATE_FORMAT[s.dateFormat],
        numberFormat: NUMBER_FORMAT,
      },
      updatedAt: updated.length
        ? new Date(Math.max(...updated.map((d) => d.getTime()))).toISOString()
        : null,
      version: String(s.brandingVersion),
    };
  }

  get(businessId: string): Promise<BrandingSettings> {
    return this.inFirm(businessId, (tx) => this.view(tx, businessId));
  }

  /** Locks the settings row and checks the version the page was loaded at. */
  private async lock(tx: TxClient, businessId: string, version: string) {
    await ensureBrandRows(tx, businessId);
    await tx.$executeRaw`SELECT 1 FROM business_settings WHERE business_id = ${businessId}::uuid FOR UPDATE`;
    const row = await tx.businessSettings.findUniqueOrThrow({
      where: { businessId },
      select: { brandingVersion: true },
    });
    if (String(row.brandingVersion) !== version) {
      throw new ConflictException({
        code: 'SAVE_CONFLICT',
        message:
          'Someone saved the branding after you opened it. Reload and apply your changes again.',
      });
    }
    return row.brandingVersion;
  }

  /** The next version: counted up, published now, its snapshot kept. */
  private async publish(tx: TxClient, businessId: string, userId: string, from: number) {
    await tx.businessSettings.update({
      where: { businessId },
      data: { brandingVersion: from + 1, brandingPublishedAt: new Date() },
    });
    const snapshot = await this.view(tx, businessId);
    const top = await tx.businessBrandVersion.aggregate({
      where: { businessId },
      _max: { version: true },
    });
    await tx.businessBrandVersion.create({
      data: {
        businessId,
        version: (top._max.version ?? 0) + 1,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        publishedByUserId: userId,
      },
    });
  }

  /** PATCH /business/branding: only the fields sent change; '' or null clears. */
  async update(businessId: string, userId: string, body: Patch): Promise<BrandingSettings> {
    const { version, email, portal, documents, preferences, ...top } = body;
    if (top.legalName !== undefined) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'The legal name is set when Firmivra approves the firm. Ask support to change it.',
      });
    }
    if (preferences?.numberFormat && preferences.numberFormat !== NUMBER_FORMAT) {
      throw invalid(
        'Only the 1,234.56 number format is available for now',
        'preferences.numberFormat',
      );
    }
    if (top.backgroundColor && contrast(top.backgroundColor, TEXT_HEX) < 4.5) {
      throw new BadRequestException({
        code: 'LOW_CONTRAST',
        message: 'Text would be hard to read on this background. Pick a lighter shade.',
      });
    }
    const settings: Prisma.BusinessSettingsUncheckedUpdateInput = {
      ...(top.businessCategory !== undefined ? { industry: top.businessCategory } : {}),
      ...(top.adminEmail !== undefined
        ? { supportEmail: top.adminEmail?.toLowerCase() ?? null }
        : {}),
      ...(top.secondaryColor !== undefined ? { secondaryColor: top.secondaryColor } : {}),
      ...(top.backgroundColor !== undefined ? { backgroundColor: top.backgroundColor } : {}),
      ...(top.themeMode !== undefined ? { theme: top.themeMode } : {}),
      ...(top.sidebarStyle !== undefined ? { sidebarStyle: top.sidebarStyle } : {}),
      ...(top.sidebarPosition !== undefined ? { sidebarPosition: top.sidebarPosition } : {}),
      ...(top.showLogoText !== undefined ? { showLogoText: top.showLogoText } : {}),
      ...(top.roundedCorners !== undefined ? { roundedCorners: top.roundedCorners } : {}),
      ...(top.loginMessage !== undefined ? { loginMessage: top.loginMessage } : {}),
      ...(preferences?.locale !== undefined ? { locale: preferences.locale } : {}),
      ...(preferences?.currency !== undefined
        ? { currency: preferences.currency.toLowerCase() }
        : {}),
      ...(preferences?.dateFormat !== undefined
        ? { dateFormat: DATE_COLUMN[preferences.dateFormat] }
        : {}),
    };
    const profile: Prisma.BusinessBrandProfileUncheckedUpdateInput = {
      ...(email?.fromName !== undefined ? { emailFromName: email.fromName } : {}),
      ...(email?.replyToEmail !== undefined
        ? { replyToEmail: email.replyToEmail?.toLowerCase() ?? null }
        : {}),
      ...(email?.header !== undefined ? { emailHeader: email.header } : {}),
      ...(email?.footer !== undefined ? { emailFooter: email.footer } : {}),
      ...(email?.disclaimer !== undefined ? { emailDisclaimer: email.disclaimer } : {}),
      ...(portal?.primaryColor !== undefined ? { portalBrandColor: portal.primaryColor } : {}),
      ...(portal?.accentColor !== undefined ? { portalAccentColor: portal.accentColor } : {}),
      ...(documents?.header !== undefined ? { letterheadHeader: documents.header } : {}),
      ...(documents?.footer !== undefined ? { letterheadFooter: documents.footer } : {}),
      ...(documents?.signatureBlock !== undefined
        ? { signatureBlock: documents.signatureBlock }
        : {}),
      ...(documents?.legalText !== undefined ? { legalText: documents.legalText } : {}),
    };
    const fields = [
      ...Object.keys(top).filter((k) => (top as Record<string, unknown>)[k] !== undefined),
      ...Object.keys(email ?? {}).map((k) => `email.${k}`),
      ...Object.keys(portal ?? {}).map((k) => `portal.${k}`),
      ...Object.keys(documents ?? {}).map((k) => `documents.${k}`),
      ...Object.keys(preferences ?? {}).map((k) => `preferences.${k}`),
    ].sort();
    return this.inFirm(businessId, async (tx) => {
      const from = await this.lock(tx, businessId, version);
      if (documents?.showLetterhead !== undefined) {
        const p = await tx.businessBrandProfile.findUniqueOrThrow({ where: { businessId } });
        const header = documents.header !== undefined ? documents.header : p.letterheadHeader;
        const footer = documents.footer !== undefined ? documents.footer : p.letterheadFooter;
        if (documents.showLetterhead !== (header !== null || footer !== null)) {
          throw invalid(
            documents.showLetterhead
              ? 'Add a letterhead header or footer to show the letterhead'
              : 'Clear the letterhead header and footer to hide the letterhead',
            'documents.showLetterhead',
          );
        }
      }
      if (Object.keys(settings).length) {
        await tx.businessSettings.update({ where: { businessId }, data: settings });
      }
      if (Object.keys(profile).length) {
        await tx.businessBrandProfile.update({
          where: { businessId },
          data: { ...profile, updatedByUserId: userId },
        });
      }
      await this.publish(tx, businessId, userId, from);
      await this.audit.logIn(
        tx,
        'branding.updated',
        { type: 'business', id: businessId },
        { fields },
        { businessId },
      );
      return this.view(tx, businessId);
    });
  }

  /** POST /business/branding/reset: the groups back to Firmivra's defaults. */
  async reset(businessId: string, userId: string, body: Reset): Promise<BrandingSettings> {
    const groups = [...new Set(body.groups)].sort();
    const { result, files } = await this.inFirm(businessId, async (tx) => {
      await ensureBrandRows(tx, businessId);
      const before = await tx.businessSettings.findUniqueOrThrow({
        where: { businessId },
        select: { brandingVersion: true, faviconKey: true, loginBackgroundKey: true },
      });
      const p = await tx.businessBrandProfile.findUniqueOrThrow({
        where: { businessId },
        select: { emailLogoKey: true, portalLogoKey: true },
      });
      const keys = [
        groups.includes('THEME') ? before.faviconKey : null,
        groups.includes('LOGIN') ? before.loginBackgroundKey : null,
        groups.includes('EMAIL') ? p.emailLogoKey : null,
        groups.includes('PORTAL') ? p.portalLogoKey : null,
      ].filter((k): k is string => k !== null);
      for (const group of groups) {
        const { settings, profile } = RESET[group];
        if (settings) await tx.businessSettings.update({ where: { businessId }, data: settings });
        if (profile) {
          await tx.businessBrandProfile.update({
            where: { businessId },
            data: {
              ...profile,
              updatedByUserId: userId,
            },
          });
        }
      }
      await this.publish(tx, businessId, userId, before.brandingVersion);
      await this.audit.logIn(
        tx,
        'branding.reset',
        { type: 'business', id: businessId },
        { groups },
        { businessId },
      );
      return { result: await this.view(tx, businessId), files: keys };
    });
    for (const key of files) await this.assets.discard(key);
    return result;
  }
}
