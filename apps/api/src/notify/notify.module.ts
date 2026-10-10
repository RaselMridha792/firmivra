import { Global, Module } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../database/database.module.js';
import { loadNotifyConfig, type NotifyConfig } from './config.js';
import { EmailSendLog } from './email-sends.js';
import { createNotifyService } from './notify.service.js';
import { NOTIFY_SERVICE } from './notify.types.js';

/** The checked email and SMS settings (`NotifyConfig`), and whether the reminder jobs run. */
export const NOTIFY_CONFIG = Symbol('NOTIFY_CONFIG');

/** This API's recent email outcomes (`EmailSendLog`), for the Super Admin's System Status. */
export const EMAIL_SENDS = Symbol('EMAIL_SENDS');

/**
 * Provides NOTIFY_SERVICE everywhere (global, like AuditService). The email and SMS settings are
 * checked when the app starts, so a bad EMAIL_MODE or SMS_MODE never reaches a request.
 */
@Global()
@Module({
  providers: [
    { provide: NOTIFY_CONFIG, useFactory: () => loadNotifyConfig() },
    { provide: EMAIL_SENDS, useFactory: () => new EmailSendLog() },
    {
      provide: NOTIFY_SERVICE,
      inject: [NOTIFY_CONFIG, DATABASE, EMAIL_SENDS],
      useFactory: (config: NotifyConfig, db: Database, sends: EmailSendLog) =>
        createNotifyService(config, db, undefined, sends),
    },
  ],
  exports: [NOTIFY_SERVICE, NOTIFY_CONFIG, EMAIL_SENDS],
})
export class NotifyModule {}
