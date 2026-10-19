import {
  AdminGeneralSection,
  AdminSettingsOverview,
  ApiRequestError,
  SaveAdminGeneralRequest,
} from '@firmivra/types';
import { mockedEmpty } from '../lib/mock';

/** Synthetic values from the supplied design. Only imported by the development preview. */
function initialSection(): AdminGeneralSection {
  return AdminGeneralSection.parse({
    version: 1,
    updatedAt: '2026-10-14T21:12:00Z',
    updatedBy: 'Octavia Holder',
    value: {
      platformName: 'Firmivra',
      tagline: 'All-in-One Business Management Platform',
      supportEmail: 'support@firmivra.com',
      supportPhone: '+1 (404) 555-0187',
      defaultTimeZone: 'America/New_York',
      defaultLocale: 'en-US',
      defaultCurrency: 'USD',
      dateFormat: 'MM/DD/YYYY',
      timeFormat: '12H',
      numberFormat: '1,234.56',
      preferences: {
        darkModeOption: true,
        productUpdates: true,
        helpCenter: true,
        userFeedback: true,
        maintenanceBanner: false,
        betaFeatures: false,
      },
    },
  });
}

let section: AdminGeneralSection | undefined;

export function generalSettingsPreview() {
  const empty = mockedEmpty('adminSettings');
  section ??= initialSection();
  return {
    general: empty ? null : structuredClone(section),
    overview: empty
      ? null
      : AdminSettingsOverview.parse({
          categories: [],
          system: {
            version: '1.0.0',
            environment: 'Production',
            lastUpdatedAt: section.updatedAt,
            totalFirms: 24,
            totalUsers: 312,
          },
          maintenance: null,
          recentChanges: [],
        }),
    branding: null,
    preview: true,
    configurationUnavailable: false,
    brandingUnavailable: false,
  };
}

export function saveGeneralSettingsPreview(body: SaveAdminGeneralRequest): AdminGeneralSection {
  const input = SaveAdminGeneralRequest.parse(body);
  section ??= initialSection();
  if (input.version !== section.version) {
    throw new ApiRequestError(409, 'SAVE_CONFLICT', 'Reload the preview before saving.');
  }
  section = AdminGeneralSection.parse({
    ...section,
    version: section.version + 1,
    value: input.value,
    updatedAt: new Date().toISOString(),
    updatedBy: 'Preview user',
  });
  return structuredClone(section);
}
