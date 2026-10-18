import { Module } from '@nestjs/common';
import { poolSecrets } from '../auth/sealed.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { CustomIntegrationService } from './custom-integration.service.js';
import { IntegrationsCallbackController } from './integrations-callback.controller.js';
import {
  IntegrationRequestsController,
  IntegrationsController,
} from './integrations.controller.js';
import { IntegrationsReadService } from './integrations-read.service.js';
import { IntegrationsService, IntegrationStateTokens } from './integrations.service.js';
import { INTEGRATION_ADAPTERS } from './provider-adapter.js';
import { ProviderRegistry } from './provider-registry.js';
import { OUTBOUND_HTTP, SafeOutboundHttp } from './safe-http.js';
import { createSecretStore, SECRET_STORE } from './secret-store.js';

/**
 * The Integrations module (R55; contract in packages/types/src/integrations): the main page, the
 * marketplace, connect and reconnect (a provider's own authorization, or write-only credentials),
 * the Manage page, mappings, the connection test, sync runs, disconnect, requests for an
 * integration not listed, and Custom API & Webhooks. Provider logic lives in adapters registered
 * under INTEGRATION_ADAPTERS (none yet for outside providers: they answer 409 COMING_SOON).
 * Exports ProviderRegistry and IntegrationsReadService for the modules that read provider
 * readiness (Communications senders, Automations checks).
 */
@Module({
  controllers: [
    IntegrationsController,
    IntegrationRequestsController,
    IntegrationsCallbackController,
  ],
  providers: [
    ProviderRegistry,
    IntegrationsReadService,
    IntegrationsService,
    CustomIntegrationService,
    // Provider adapters (none yet for outside providers); tests and later modules supply them.
    { provide: INTEGRATION_ADAPTERS, useValue: [] },
    { provide: SECRET_STORE, useFactory: () => createSecretStore() },
    { provide: OUTBOUND_HTTP, useFactory: () => new SafeOutboundHttp() },
    {
      provide: IntegrationStateTokens,
      inject: [ENV],
      useFactory: (env: Env) => new IntegrationStateTokens(poolSecrets(env)),
    },
  ],
  exports: [ProviderRegistry, IntegrationsReadService],
})
export class IntegrationsModule {}
