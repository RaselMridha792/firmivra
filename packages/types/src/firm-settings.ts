import { z } from 'zod';

// Shared contract for docs/api/firm/settings.yaml; policy validation also runs in the service.
export const FirmSettings = z.strictObject({
  profile: z.strictObject({
    id: z.uuid(),
    name: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(1)
      .max(120),
    legalName: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(1)
      .max(200)
      .nullable(),
    slug: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(1)
      .max(120),
    status: z.enum(['PENDING_SETUP', 'ACTIVE', 'SUSPENDED', 'CLOSED']),
  }),
  contactEmail: z.email().max(254).nullable(),
  contactPhone: z.string().max(40).nullable(),
  website: z.url().max(2048).regex(new RegExp('^https://')).nullable(),
  addressLine1: z.string().max(200).nullable(),
  addressLine2: z.string().max(200).nullable(),
  city: z.string().max(120).nullable(),
  state: z.string().max(120).nullable(),
  postalCode: z.string().max(32).nullable(),
  country: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(2)
    .max(2)
    .regex(new RegExp('^[A-Z]{2}$')),
  timezone: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA timezone'),
  logoKey: z.string().max(1024).nullable(),
  brandColor: z.string().regex(new RegExp('^#[0-9a-fA-F]{6}$')).nullable(),
  enabledModules: z
    .array(
      z
        .string()
        .refine((value) => value.trim().length > 0, 'Cannot be blank')
        .min(1)
        .max(60),
    )
    .max(30)
    .refine((value) => new Set(value).size === value.length, 'Duplicate values'),
  clientSignUpEnabled: z.boolean(),
  portalName: z.string().max(120).nullable(),
  portalHeader: z.string().max(200).nullable(),
  welcomeMessage: z.string().max(2000).nullable(),
  setup: z.lazy(() => FirmSetup),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type FirmSettings = z.infer<typeof FirmSettings>;

export const FirmSettingsPatch = z
  .strictObject({
    name: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(1)
      .max(120)
      .optional(),
    contactEmail: z.email().max(254).nullable().optional(),
    contactPhone: z.string().max(40).nullable().optional(),
    website: z.url().max(2048).regex(new RegExp('^https://')).nullable().optional(),
    addressLine1: z.string().max(200).nullable().optional(),
    addressLine2: z.string().max(200).nullable().optional(),
    city: z.string().max(120).nullable().optional(),
    state: z.string().max(120).nullable().optional(),
    postalCode: z.string().max(32).nullable().optional(),
    country: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(2)
      .max(2)
      .regex(new RegExp('^[A-Z]{2}$'))
      .optional(),
    timezone: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA timezone')
      .optional(),
    logoKey: z.string().max(1024).nullable().optional(),
    brandColor: z.string().regex(new RegExp('^#[0-9a-fA-F]{6}$')).nullable().optional(),
    enabledModules: z
      .array(
        z
          .string()
          .refine((value) => value.trim().length > 0, 'Cannot be blank')
          .min(1)
          .max(60),
      )
      .max(30)
      .refine((value) => new Set(value).size === value.length, 'Duplicate values')
      .optional(),
    clientSignUpEnabled: z.boolean().optional(),
    portalName: z.string().max(120).nullable().optional(),
    portalHeader: z.string().max(200).nullable().optional(),
    welcomeMessage: z.string().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length >= 1, 'Supply at least 1 fields');
export type FirmSettingsPatch = z.infer<typeof FirmSettingsPatch>;

export const FirmSetup = z.strictObject({
  completedSteps: z
    .array(z.enum(['branding', 'businessDetails', 'team', 'clientPortal', 'finish']))
    .max(5)
    .refine((value) => new Set(value).size === value.length, 'Duplicate values'),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type FirmSetup = z.infer<typeof FirmSetup>;

export const FirmLegalDocument = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['TERMS', 'PRIVACY']),
  version: z.number().int().min(1),
  bodyMarkdown: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(100000),
  publishedAt: z.iso.datetime({ offset: true }),
});
export type FirmLegalDocument = z.infer<typeof FirmLegalDocument>;

export const FirmPortalSettings = z.strictObject({
  name: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(120),
  portalName: z.string().max(120).nullable(),
  portalHeader: z.string().max(200).nullable(),
  welcomeMessage: z.string().max(2000).nullable(),
  brandColor: z.string().regex(new RegExp('^#[0-9a-fA-F]{6}$')).nullable(),
  logoUrl: z.url().nullable(),
  enabledModules: z
    .array(
      z
        .string()
        .refine((value) => value.trim().length > 0, 'Cannot be blank')
        .min(1)
        .max(60),
    )
    .max(30)
    .refine((value) => new Set(value).size === value.length, 'Duplicate values'),
  clientSignUpEnabled: z.boolean(),
});
export type FirmPortalSettings = z.infer<typeof FirmPortalSettings>;

export const GetBusinessSettingsResponse = z.lazy(() => FirmSettings);
export type GetBusinessSettingsResponse = z.infer<typeof GetBusinessSettingsResponse>;

export const UpdateBusinessSettingsRequest = z.lazy(() => FirmSettingsPatch);
export type UpdateBusinessSettingsRequest = z.infer<typeof UpdateBusinessSettingsRequest>;

export const UpdateBusinessSettingsResponse = z.lazy(() => FirmSettings);
export type UpdateBusinessSettingsResponse = z.infer<typeof UpdateBusinessSettingsResponse>;

export const GetBusinessSetupResponse = z.lazy(() => FirmSetup);
export type GetBusinessSetupResponse = z.infer<typeof GetBusinessSetupResponse>;

export const SaveBusinessSetupRequest = z.strictObject({
  completedSteps: z
    .array(z.enum(['branding', 'businessDetails', 'team', 'clientPortal', 'finish']))
    .max(5)
    .refine((value) => new Set(value).size === value.length, 'Duplicate values'),
});
export type SaveBusinessSetupRequest = z.infer<typeof SaveBusinessSetupRequest>;

export const SaveBusinessSetupResponse = z.lazy(() => FirmSetup);
export type SaveBusinessSetupResponse = z.infer<typeof SaveBusinessSetupResponse>;

export const CompleteBusinessSetupResponse = z.lazy(() => FirmSetup);
export type CompleteBusinessSetupResponse = z.infer<typeof CompleteBusinessSetupResponse>;

export const GetFirmLegalVersionQuery = z.strictObject({
  version: z.coerce.number().int().min(1).optional(),
});
export type GetFirmLegalVersionQuery = z.infer<typeof GetFirmLegalVersionQuery>;

export const GetFirmLegalVersionResponse = z.lazy(() => FirmLegalDocument);
export type GetFirmLegalVersionResponse = z.infer<typeof GetFirmLegalVersionResponse>;

export const PublishFirmLegalVersionRequest = z.strictObject({
  bodyMarkdown: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(100000),
});
export type PublishFirmLegalVersionRequest = z.infer<typeof PublishFirmLegalVersionRequest>;

export const PublishFirmLegalVersionResponse = z.lazy(() => FirmLegalDocument);
export type PublishFirmLegalVersionResponse = z.infer<typeof PublishFirmLegalVersionResponse>;

export const GetPortalSettingsResponse = z.lazy(() => FirmPortalSettings);
export type GetPortalSettingsResponse = z.infer<typeof GetPortalSettingsResponse>;

export const GetPortalLegalVersionQuery = z.strictObject({
  version: z.coerce.number().int().min(1).optional(),
});
export type GetPortalLegalVersionQuery = z.infer<typeof GetPortalLegalVersionQuery>;

export const GetPortalLegalVersionResponse = z.lazy(() => FirmLegalDocument);
export type GetPortalLegalVersionResponse = z.infer<typeof GetPortalLegalVersionResponse>;
