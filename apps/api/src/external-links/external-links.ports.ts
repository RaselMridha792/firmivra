import { Injectable, ServiceUnavailableException } from '@nestjs/common';
export abstract class ExternalLinkIcons {
  abstract verify(businessId: string, key: string, currentKey: string | null): Promise<void>;
  abstract resolve(businessId: string, key: string): Promise<string | null>;
}
@Injectable()
export class PendingExternalLinkIcons extends ExternalLinkIcons {
  async verify(_businessId: string, key: string, currentKey: string | null) {
    if (key !== currentKey)
      throw new ServiceUnavailableException({
        code: 'STORAGE_NOT_READY',
        message: 'Resource icon storage is unavailable',
      });
  }
  async resolve() {
    return null;
  }
}
