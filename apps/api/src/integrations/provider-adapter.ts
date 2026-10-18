import type { IntegrationEnvironment } from '@firmivra/types';

// The provider-adapter seam: provider logic (the sign-in, the sync, the test, the revoke) lives in
// one adapter per provider, never scattered through the module. An adapter is registered under the
// INTEGRATION_ADAPTERS token; a provider with no adapter is "coming soon". The Integrations API
// never sees a secret except to hand it to the adapter that needs it.

export interface AdapterConnection {
  id: string;
  businessId: string;
  provider: string;
  environment: IntegrationEnvironment;
  /** Non-secret options the firm chose. */
  settings: Record<string, unknown>;
  entities: string[];
}

/** What an adapter returns after a successful authorization or credential check. */
export interface AdapterGrant {
  /** The tokens or key, as one string (JSON when the adapter has several). Saved in the secret store. */
  secret: string;
  accountLabel?: string;
  /** The provider's account id; only its last 4 characters are kept. */
  accountId?: string;
  /** Permission keys the provider granted (of the catalog's list). */
  grantedPermissions?: string[];
}

export interface AdapterCheck {
  key: 'AUTHENTICATION' | 'API' | 'DATA_SYNC' | 'RECENT_ERRORS' | 'PERMISSIONS';
  ok: boolean;
  message?: string;
}

/** A failure an adapter reports; `code` is a short lower-case code that never carries data. */
export class AdapterError extends Error {
  constructor(
    readonly code:
      | 'authorization_expired'
      | 'authorization_revoked'
      | 'permission_missing'
      | 'provider_outage'
      | 'rate_limited'
      | 'credentials_rejected'
      | 'sync_failed',
    message = code,
  ) {
    super(message);
  }
}

export interface ProviderAdapter {
  readonly provider: string;
  /** OAUTH2 and PROVIDER_LINK: the provider's authorization address for the browser. */
  authorizeUrl?(input: {
    redirectUri: string;
    state: string;
    environment: IntegrationEnvironment;
    scopes: string[];
  }): string;
  /** OAUTH2 and PROVIDER_LINK: the code from the callback, exchanged for a grant. */
  exchange?(input: {
    code: string;
    redirectUri: string;
    environment: IntegrationEnvironment;
  }): Promise<AdapterGrant>;
  /** API_KEY: the credentials the firm typed, checked with the provider. Throws AdapterError('credentials_rejected'). */
  verifyCredentials?(
    credentials: Record<string, string>,
    environment: IntegrationEnvironment,
  ): Promise<AdapterGrant>;
  /** The connection test: the health checks. */
  test(secret: string | null, connection: AdapterConnection): Promise<AdapterCheck[]>;
  /** One object's sync; the counts are written to the run. Idempotent: duplicates are the adapter's to avoid. */
  sync?(input: {
    secret: string | null;
    connection: AdapterConnection;
    entity: string;
  }): Promise<{ records: number; failed: number }>;
  /** Revokes the provider's access on disconnect (best effort). */
  revoke?(secret: string | null, connection: AdapterConnection): Promise<void>;
}

/** Nest token for the registered adapters (an array). */
export const INTEGRATION_ADAPTERS = Symbol('INTEGRATION_ADAPTERS');
