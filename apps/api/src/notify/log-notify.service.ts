import { Logger } from '@nestjs/common';
import {
  type NotifyMessage,
  type NotifyService,
  type NotifyTemplate,
  TEMPLATE_CHANNEL,
} from './notify.types.js';

/**
 * The NotifyService until R6 sends real email and SMS (step 2). With AUTH_MODE=local
 * (development and test only; the config refuses it in production) it logs the whole message,
 * so developers can use codes and links of synthetic users. Anywhere else it sends nothing and
 * logs only the template and the firm: never the address, a code, a link or any other data.
 */
export class LogNotifyService implements NotifyService {
  constructor(
    private readonly localMode: boolean,
    private readonly logger: Pick<Logger, 'log' | 'warn'> = new Logger('NotifyService'),
  ) {}

  send<T extends NotifyTemplate>(message: NotifyMessage<T>): Promise<void> {
    const channel = TEMPLATE_CHANNEL[message.template] as string | undefined;
    if (!channel) return Promise.reject(new Error(`Unknown template ${message.template}`));
    if (this.localMode) {
      this.logger.log(
        `Local ${channel} "${message.template}" to ${message.to}: ${JSON.stringify(message.data)}`,
      );
    } else {
      const firm = message.businessId ?? 'Firmivra';
      this.logger.warn(`${channel} "${message.template}" for ${firm} not sent: R6 step 2`);
    }
    return Promise.resolve();
  }
}
