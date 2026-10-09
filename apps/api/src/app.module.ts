import { randomUUID } from 'node:crypto';
import { type DynamicModule, Module } from '@nestjs/common';

import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuditModule } from './audit/audit.service.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthModule } from './auth/auth.module.js';
import { RolesGuard } from './auth/roles.guard.js';
import { SignInModule } from './auth/sign-in.controller.js';
import { PortalInfoModule } from './client-auth/portal-info.controller.js';
import { ClientSignUpsModule } from './client-auth/client-sign-ups.controller.js';
import { PortalSignInModule } from './client-auth/portal-sign-in.controller.js';
import { SignUpModule } from './client-auth/sign-up.controller.js';
import { TenantGuard } from './auth/tenant.guard.js';
import { BusinessModule } from './business/business.controller.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { DevModule } from './dev/dev.controller.js';
import { HealthModule } from './health/health.controller.js';
import { FirmApplicationsModule } from './firm-applications/firm-applications.controller.js';
import { MeModule } from './me/me.controller.js';
import { NotificationsModule } from './notifications/notifications.controller.js';
import { NotifyModule } from './notify/notify.module.js';
import { TaxStatusesModule } from './tax-statuses/tax-statuses.controller.js';
import { ClientsModule } from './clients/clients.controller.js';
import { TaxReturnsModule } from './tax-returns/tax-returns.controller.js';
import { EngagementsModule } from './engagements/engagements.controller.js';
import { MessagesModule } from './messages/messages.module.js';
import { SettingsModule } from './settings/settings.controller.js';
import { AppointmentsModule } from './appointments/appointments.module.js';
import { AuditViewerModule } from './audit-viewer/audit-log.controller.js';
import { CalculatorsModule } from './calculators/calculators.controller.js';
import { ContentModule } from './content/content.controller.js';
import { TeamModule } from './team/team.controller.js';
import { WorkspacesModule } from './workspaces/workspaces.module.js';
import { DocumentsModule } from './storage/documents.controller.js';
import { PaymentsSetupModule } from './payments/setup/payments-setup.controller.js';
import { StripeClientModule } from './payments/stripe/stripe-client.module.js';
import { InvoicesModule } from './payments/invoices/invoices.module.js';

/** Pretty one-line logs in local development, when pino-pretty is installed (not in the image). */
function prettyTransport(env: Env) {
  if (env.NODE_ENV !== 'development') return undefined;
  try {
    import.meta.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { singleLine: true } };
  } catch {
    return undefined;
  }
}

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            genReqId: (req) => (req as { id?: string }).id ?? randomUUID(),
            // Never log credentials, codes or cookies.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'res.headers["set-cookie"]',
              ],
              remove: true,
            },
            transport: prettyTransport(env),
          },
        }),
        ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
        DatabaseModule,
        AuthModule,
        AuditModule,
        NotifyModule,
        NotificationsModule,
        HealthModule,
        MeModule,
        FirmApplicationsModule,
        TaxStatusesModule,
        ClientsModule,
        TaxReturnsModule,
        EngagementsModule,
        MessagesModule,
        SettingsModule,
        TeamModule,
        CalculatorsModule,
        ContentModule,
        AppointmentsModule,
        AuditViewerModule,
        WorkspacesModule,
        DocumentsModule,
        StripeClientModule,
        PaymentsSetupModule,
        InvoicesModule,
        SignInModule,
        PortalInfoModule,
        SignUpModule,
        PortalSignInModule,
        ClientSignUpsModule,
        BusinessModule,
        ...(env.AUTH_MODE === 'local' ? [DevModule] : []),
      ],
      // Run in this order on every request. Each skips @Public() routes.
      providers: [
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: TenantGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    };
  }
}
