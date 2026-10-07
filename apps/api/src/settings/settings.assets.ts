import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/** Implement with Rasel's storage and entitlement services when their interfaces are published. */
export abstract class SettingsAssets {
  abstract authorizeLogo(businessId: string, key: string): Promise<void>;
  abstract logoUrl(businessId: string, key: string | null): Promise<string | null>;
  abstract authorizeModules(
    businessId: string,
    requested: string[],
    configured: string[],
  ): Promise<void>;
}
@Injectable()
export class PendingSettingsAssets extends SettingsAssets {
  authorizeLogo(): Promise<void> {
    throw new ServiceUnavailableException({
      code: 'STORAGE_NOT_READY',
      message: 'Logo storage integration is not available',
    });
  }
  logoUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }
  authorizeModules(_businessId: string, requested: string[], configured: string[]): Promise<void> {
    if (requested.some((key) => !configured.includes(key))) {
      throw new ServiceUnavailableException({
        code: 'ENTITLEMENTS_NOT_READY',
        message: 'Module activation integration is not available',
      });
    }
    return Promise.resolve();
  }
}
