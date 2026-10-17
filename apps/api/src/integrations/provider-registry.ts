import { Inject, Injectable, Optional } from '@nestjs/common';
import type { IntegrationProvider } from '@firmivra/types';
import { PROVIDERS } from './catalog.js';
import { INTEGRATION_ADAPTERS, type ProviderAdapter } from './provider-adapter.js';

/**
 * The catalog joined with the adapters that are registered: a provider is connectable when its
 * entry is live (a built-in one that needs no outside account) or an adapter is registered for it.
 * Everything else is "coming soon".
 */
@Injectable()
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(@Optional() @Inject(INTEGRATION_ADAPTERS) adapters: ProviderAdapter[] | null) {
    for (const a of adapters ?? []) this.adapters.set(a.provider, a);
  }

  adapter(provider: string): ProviderAdapter | undefined {
    return this.adapters.get(provider);
  }

  private resolved(p: IntegrationProvider): IntegrationProvider {
    return this.adapters.has(p.provider) ? { ...p, comingSoon: false } : p;
  }

  all(): IntegrationProvider[] {
    return PROVIDERS.map((p) => this.resolved(p));
  }

  get(key: string): IntegrationProvider | undefined {
    const p = PROVIDERS.find((x) => x.provider === key);
    return p ? this.resolved(p) : undefined;
  }
}
