import {
  ApiRequestError,
  PORTAL_ANNOUNCEMENT_DEFAULTS,
  type PortalAnnouncementSettings,
  type PortalAnnouncementSettingsClient,
  UpdatePortalAnnouncementSettings,
  parseInput,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * `api.portalAnnouncementSettings` in mock mode (Settings > Client Portal > Announcements). Owner
 * and Admin, as the API: Staff get 403 FORBIDDEN; texts are never required (the contract refuses
 * it, as the API does).
 */
export function createPortalAnnouncementSettingsMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {},
): PortalAnnouncementSettingsClient {
  let saved: PortalAnnouncementSettings = { ...PORTAL_ANNOUNCEMENT_DEFAULTS, updatedAt: null };
  const manage = () => {
    if (options.role === 'STAFF')
      throw new ApiRequestError(403, 'FORBIDDEN', 'This action is not permitted');
  };
  return {
    get: async () => {
      await mockDelay();
      manage();
      return { ...saved };
    },
    update: async (body) => {
      await mockDelay();
      manage();
      const input = parseInput(UpdatePortalAnnouncementSettings, body);
      saved = {
        ...saved,
        ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)),
        updatedAt: new Date().toISOString(),
      };
      return { ...saved };
    },
  };
}
