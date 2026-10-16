import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { clearable, text } from '../clients/text.js';

// Company Profile & Branding (R42 contract), Settings' six tabs. Owner and Admin only.
// What `api.settings` (FirmSettings) already holds stays there and is not repeated here: company
// name, contact email (the Support Email), phone, website, address, time zone, logo, primary and
// accent colour, sidebar motto (the Tagline / Motto), portal name, header and welcome text,
// description (Short Description), EIN (last 4). This file is the rest of the page: one new
// row per firm (`business_branding`, to build). Changes apply only to this firm, never rewrite
// sent emails or generated documents, and keep Firmivra's security and legal notices.
// Preview is in the browser with the unsaved values: no endpoint.

const DateTime = z.iso.datetime({ offset: true });

const HexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1d4ed8')
  .transform((value) => value.toLowerCase());

export const ThemeMode = z.enum(['LIGHT', 'DARK', 'SYSTEM']);
export type ThemeMode = z.infer<typeof ThemeMode>;
/** The design shows "Solid" only; the other choices are a guess until Octavia confirms. */
export const SidebarStyle = z.enum(['SOLID', 'GRADIENT']);
export type SidebarStyle = z.infer<typeof SidebarStyle>;
export const SidebarPosition = z.enum(['LEFT', 'RIGHT']);
export type SidebarPosition = z.infer<typeof SidebarPosition>;

/** Uploaded brand images besides the logo (which is api.settings' logo upload). */
export const BrandAssetKind = z.enum(['FAVICON', 'LOGIN_BACKGROUND', 'EMAIL_LOGO', 'PORTAL_LOGO']);
export type BrandAssetKind = z.infer<typeof BrandAssetKind>;

/** Upload guidance shown beside each field. */
export const BRAND_ASSET_LIMITS: Record<
  BrandAssetKind,
  { maxBytes: number; contentTypes: readonly string[]; recommended: string }
> = {
  FAVICON: {
    maxBytes: 512 * 1024,
    contentTypes: ['image/png', 'image/x-icon', 'image/vnd.microsoft.icon'],
    recommended: '64 x 64 px (PNG, ICO)',
  },
  LOGIN_BACKGROUND: {
    maxBytes: 5 * 1024 * 1024,
    contentTypes: ['image/png', 'image/jpeg', 'image/webp'],
    recommended: '1920 x 1080 px',
  },
  EMAIL_LOGO: {
    maxBytes: 2 * 1024 * 1024,
    contentTypes: ['image/png', 'image/jpeg'],
    recommended: '400 x 200 px (PNG)',
  },
  PORTAL_LOGO: {
    maxBytes: 2 * 1024 * 1024,
    contentTypes: ['image/png', 'image/jpeg', 'image/webp'],
    recommended: '400 x 200 px (PNG)',
  },
};

/** Email & Communications tab. The sending address itself comes from verified sender settings. */
export const EmailBranding = z.object({
  /** Null: the company logo. */
  logoUrl: z.string().nullable(),
  fromName: z.string().nullable(),
  replyToEmail: z.string().nullable(),
  header: z.string().nullable(),
  footer: z.string().nullable(),
  disclaimer: z.string().nullable(),
});
export type EmailBranding = z.infer<typeof EmailBranding>;

/** Client Portal Branding tab: overrides of the company logo and colours, null to inherit. */
export const PortalBranding = z.object({
  logoUrl: z.string().nullable(),
  primaryColor: z.string().nullable(),
  accentColor: z.string().nullable(),
});
export type PortalBranding = z.infer<typeof PortalBranding>;

/** Documents & Legal tab: letterhead of generated documents. */
export const DocumentBranding = z.object({
  showLetterhead: z.boolean(),
  header: z.string().nullable(),
  footer: z.string().nullable(),
  signatureBlock: z.string().nullable(),
  legalText: z.string().nullable(),
});
export type DocumentBranding = z.infer<typeof DocumentBranding>;

/** Preferences tab (System Preferences): formats; the time zone is FirmSettings.timezone. */
export const FirmPreferences = z.object({
  /** BCP 47, for example en-US. */
  locale: z.string(),
  /** ISO 4217, for example USD. Changing it never rewrites past invoices. */
  currency: z.string(),
  dateFormat: z.enum(['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD']),
  numberFormat: z.enum(['1,234.56', '1.234,56', '1 234,56']),
});
export type FirmPreferences = z.infer<typeof FirmPreferences>;

/** GET /business/branding. */
export const BrandingSettings = z.object({
  /** Company Profile: the restricted legal name (Owner, or Admin with Company Profile Edit). */
  legalName: z.string().nullable(),
  /** "Accounting & Tax Services": a business category, not the entity type. */
  businessCategory: z.string().nullable(),
  /** Primary/Admin Email: administrative contact and the firm's master email for notices. */
  adminEmail: z.string().nullable(),
  secondaryColor: z.string().nullable(),
  backgroundColor: z.string().nullable(),
  themeMode: ThemeMode,
  sidebarStyle: SidebarStyle,
  sidebarPosition: SidebarPosition,
  showLogoText: z.boolean(),
  roundedCorners: z.boolean(),
  faviconUrl: z.string().nullable(),
  loginBackgroundUrl: z.string().nullable(),
  loginMessage: z.string().nullable(),
  email: EmailBranding,
  portal: PortalBranding,
  documents: DocumentBranding,
  preferences: FirmPreferences,
  updatedAt: DateTime.nullable(),
  /** Send back on PATCH; a newer one on the server is 409 SAVE_CONFLICT. */
  version: z.string(),
});
export type BrandingSettings = z.infer<typeof BrandingSettings>;

const optionalColor = clearable(HexColor);

/** PATCH /business/branding: Save Changes. Only the fields sent change; '' or null clears. */
export const UpdateBrandingRequest = z.strictObject({
  version: z.string().min(1).max(100),
  legalName: clearable(text(200)),
  businessCategory: clearable(text(80)),
  adminEmail: clearable(Email),
  secondaryColor: optionalColor,
  backgroundColor: optionalColor,
  themeMode: ThemeMode.optional(),
  sidebarStyle: SidebarStyle.optional(),
  sidebarPosition: SidebarPosition.optional(),
  showLogoText: z.boolean().optional(),
  roundedCorners: z.boolean().optional(),
  loginMessage: clearable(text(200, 'many')),
  email: z
    .strictObject({
      fromName: clearable(text(80)),
      replyToEmail: clearable(Email),
      header: clearable(text(500, 'many')),
      footer: clearable(text(1000, 'many')),
      disclaimer: clearable(text(2000, 'many')),
    })
    .optional(),
  portal: z.strictObject({ primaryColor: optionalColor, accentColor: optionalColor }).optional(),
  documents: z
    .strictObject({
      showLetterhead: z.boolean().optional(),
      header: clearable(text(500, 'many')),
      footer: clearable(text(1000, 'many')),
      signatureBlock: clearable(text(500, 'many')),
      legalText: clearable(text(4000, 'many')),
    })
    .optional(),
  preferences: z
    .strictObject({
      locale: z
        .string()
        .regex(/^[a-z]{2}(-[A-Z]{2})?$/)
        .optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
      dateFormat: FirmPreferences.shape.dateFormat.optional(),
      numberFormat: FirmPreferences.shape.numberFormat.optional(),
    })
    .optional(),
});
export type UpdateBrandingRequest = z.input<typeof UpdateBrandingRequest>;

/** Step 1 of a brand image upload: where to PUT the file (UploadTicket). */
export const CreateBrandAssetUploadRequest = z.strictObject({
  kind: BrandAssetKind,
  contentType: z.string().max(100),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(5 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type CreateBrandAssetUploadRequest = z.input<typeof CreateBrandAssetUploadRequest>;

export const ConfirmBrandAssetUploadRequest = z.strictObject({
  uploadToken: z.string().min(1).max(8192),
});
export type ConfirmBrandAssetUploadRequest = z.input<typeof ConfirmBrandAssetUploadRequest>;

/** The groups "Reset to Default Brand Settings" restores (company profile data stays). */
export const BrandingGroup = z.enum(['THEME', 'LOGIN', 'EMAIL', 'PORTAL', 'DOCUMENTS']);
export type BrandingGroup = z.infer<typeof BrandingGroup>;

export const ResetBrandingRequest = z.strictObject({
  groups: z.array(BrandingGroup).min(1),
  confirm: z.literal(true, { error: 'Confirm the reset first' }),
});
export type ResetBrandingRequest = z.input<typeof ResetBrandingRequest>;

export const BrandingErrorCode = z.enum([
  /** 409: someone saved the branding after it was loaded; reload and reapply. */
  'SAVE_CONFLICT',
  /** 400: the colours fail readable contrast (WCAG AA) against each other. */
  'LOW_CONTRAST',
  /** 400: the image's type, size or dimensions are not allowed. */
  'INVALID_ASSET',
]);
export type BrandingErrorCode = z.infer<typeof BrandingErrorCode>;
