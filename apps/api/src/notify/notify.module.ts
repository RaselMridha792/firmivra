import { Global, Module } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../database/database.module.js';
import { loadNotifyConfig, type NotifyConfig } from './config.js';
import { createNotifyService } from './notify.service.js';
import { NOTIFY_SERVICE } from './notify.types.js';

/** The checked email and SMS settings (`NotifyConfig`), and whether the reminder jobs run. */
export const NOTIFY_CONFIG = Symbol('NOTIFY_CONFIG');

/**
 * Provides NOTIFY_SERVICE everywhere (global, like AuditService). The email and SMS settings are
 * checked when the app starts, so a bad EMAIL_MODE or SMS_MODE never reaches a request.
 */
@Global()
@Module({
  providers: [
    { provide: NOTIFY_CONFIG, useFactory: () => loadNotifyConfig() },
    {
      provide: NOTIFY_SERVICE,
      inject: [NOTIFY_CONFIG, DATABASE],
      useFactory: (config: NotifyConfig, db: Database) => createNotifyService(config, db),
    },
  ],
  exports: [NOTIFY_SERVICE, NOTIFY_CONFIG],
})
export class NotifyModule {}
