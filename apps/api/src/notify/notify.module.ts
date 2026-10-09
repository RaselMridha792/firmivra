import { Global, Module } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../database/database.module.js';
import { loadNotifyConfig } from './config.js';
import { createNotifyService } from './notify.service.js';
import { NOTIFY_SERVICE } from './notify.types.js';

/**
 * Provides NOTIFY_SERVICE everywhere (global, like AuditService). The email and SMS settings are
 * checked when the app starts, so a bad EMAIL_MODE or SMS_MODE never reaches a request.
 */
@Global()
@Module({
  providers: [
    {
      provide: NOTIFY_SERVICE,
      inject: [DATABASE],
      useFactory: (db: Database) => createNotifyService(loadNotifyConfig(), db),
    },
  ],
  exports: [NOTIFY_SERVICE],
})
export class NotifyModule {}
