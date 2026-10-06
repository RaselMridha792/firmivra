import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { FirmNotification, FirmPreferenceResponse } from '@firmivra/types';
import type { FirmActor } from '../firm-common/actor.js';
export abstract class NotificationTargets {
  abstract visible(
    ctx: FirmActor,
    target: NonNullable<FirmNotification['target']>,
  ): Promise<boolean>;
}
@Injectable()
export class PendingNotificationTargets extends NotificationTargets {
  async visible() {
    return false;
  }
}
export interface NotifyRequest {
  businessId: string;
  recipientUserId: string;
  category: FirmNotification['category'];
  eventKey: string;
  channels: ('EMAIL' | 'SMS')[];
  /** Generic template key: no document contents or private text. R6 resolves recipient/consent. */
  template: 'notification-available';
}
export abstract class NotificationDelivery {
  abstract policy(
    businessId: string,
  ): Promise<Pick<FirmPreferenceResponse, 'supportedChannels' | 'mandatoryCategories'>>;
  /** R6 must durably enqueue and deduplicate eventKey, recheck consent/mandatory policy. */
  abstract enqueue(request: NotifyRequest): Promise<void>;
}
@Injectable()
export class PendingNotificationDelivery extends NotificationDelivery {
  async policy(): Promise<
    Pick<FirmPreferenceResponse, 'supportedChannels' | 'mandatoryCategories'>
  > {
    throw new ServiceUnavailableException({
      code: 'NOTIFY_NOT_READY',
      message: 'Notification policy service is unavailable',
    });
  }
  async enqueue(): Promise<void> {
    throw new ServiceUnavailableException({
      code: 'NOTIFY_NOT_READY',
      message: 'Notification sending service is unavailable',
    });
  }
}
