import {
  ApiRequestError,
  type AdminBrandingSection,
  type AdminGeneralSection,
  type AdminSettingsOverview,
  type SaveAdminGeneralRequest,
} from '@firmivra/types';
import { api } from '../../../../../../lib/api';

export const GENERAL_SETTINGS = ['admin-settings', 'general', 'screen'] as const;

export interface GeneralSettingsData {
  general: AdminGeneralSection | null;
  overview: AdminSettingsOverview | null;
  branding: AdminBrandingSection | null;
  preview: boolean;
  configurationUnavailable: boolean;
  brandingUnavailable: boolean;
}

export async function loadGeneralSettings(): Promise<GeneralSettingsData> {
  let general: AdminGeneralSection;
  try {
    general = await api.adminSettings.general();
  } catch (error) {
    // The published contract precedes its backend. Never replace permission/network errors
    // or production responses with sample values, and clearly label the local preview.
    if (
      process.env.NODE_ENV !== 'production' &&
      error instanceof ApiRequestError &&
      error.status === 404
    ) {
      const { generalSettingsPreview } =
        await import('../../../../../../mocks/admin-system-settings-general');
      return generalSettingsPreview();
    }
    throw error;
  }
  const [overview, branding] = await Promise.allSettled([
    api.adminSettings.overview(),
    api.adminSettings.branding(),
  ]);
  return {
    general,
    overview: overview.status === 'fulfilled' ? overview.value : null,
    branding: branding.status === 'fulfilled' ? branding.value : null,
    preview: false,
    configurationUnavailable: overview.status === 'rejected',
    brandingUnavailable: branding.status === 'rejected',
  };
}

export async function saveGeneralSettings(body: SaveAdminGeneralRequest, preview: boolean) {
  if (process.env.NODE_ENV !== 'production' && preview) {
    const { saveGeneralSettingsPreview } =
      await import('../../../../../../mocks/admin-system-settings-general');
    return saveGeneralSettingsPreview(body);
  }
  return api.adminSettings.saveGeneral(body);
}
