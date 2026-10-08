import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { LogNotifyService } from './log-notify.service.js';
import { NOTIFY_SERVICE } from './notify.types.js';

/**
 * Provides NOTIFY_SERVICE everywhere (global, like AuditService). Until R6 step 2 it is the
 * log-only LogNotifyService; the real sender replaces it here, so callers never change.
 */
@Global()
@Module({
  providers: [
    {
      provide: NOTIFY_SERVICE,
      inject: [ENV],
      useFactory: (env: Env) => new LogNotifyService(env.AUTH_MODE === 'local'),
    },
  ],
  exports: [NOTIFY_SERVICE],
})
export class NotifyModule {}
