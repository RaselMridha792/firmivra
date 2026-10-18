import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  PutSecretValueCommand,
  ResourceExistsException,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { Injectable } from '@nestjs/common';

// Where a connection's secrets live (OAuth tokens, an API key, a signing secret). The database
// holds only `secret_ref`, a NAME that points here, never the secret (a check refuses a value that
// looks like a token). Production uses AWS Secrets Manager, named per firm and connection, under
// the firm's own prefix; development and tests use an in-memory store that is refused in
// production. A secret is written once per change, read only by the adapter that needs it, and
// removed on disconnect. Nothing here returns a secret to a caller of the API.

export interface SecretStore {
  /** Saves `value` under `ref` (a new secret or a new version) and returns the ref. */
  put(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | null>;
  remove(ref: string): Promise<void>;
}

/** Nest token for the SecretStore picked by SECRETS_MODE (tests replace it). */
export const SECRET_STORE = Symbol('SECRET_STORE');

/** The name of a connection's secret: under the firm, so a name never crosses firms. */
export const secretRefOf = (businessId: string, connectionId: string) =>
  `firmivra/tenant/${businessId}/integrations/${connectionId}`;

/** Development and tests only: lost on restart (a connection is then reconnected). */
@Injectable()
export class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();
  put(ref: string, value: string) {
    this.values.set(ref, value);
    return Promise.resolve();
  }
  get(ref: string) {
    return Promise.resolve(this.values.get(ref) ?? null);
  }
  remove(ref: string) {
    this.values.delete(ref);
    return Promise.resolve();
  }
}

export class AwsSecretsManagerStore implements SecretStore {
  constructor(private readonly client: SecretsManagerClient) {}

  async put(ref: string, value: string): Promise<void> {
    try {
      await this.client.send(new CreateSecretCommand({ Name: ref, SecretString: value }));
    } catch (error) {
      if (!(error instanceof ResourceExistsException)) throw error;
      await this.client.send(new PutSecretValueCommand({ SecretId: ref, SecretString: value }));
    }
  }

  async get(ref: string): Promise<string | null> {
    try {
      const out = await this.client.send(new GetSecretValueCommand({ SecretId: ref }));
      return out.SecretString ?? null;
    } catch (error) {
      if (error instanceof ResourceNotFoundException) return null;
      throw error;
    }
  }

  async remove(ref: string): Promise<void> {
    try {
      await this.client.send(new DeleteSecretCommand({ SecretId: ref, RecoveryWindowInDays: 7 }));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    }
  }
}

/** SECRETS_MODE=aws uses Secrets Manager; local (the default outside production) the memory store. */
export function createSecretStore(env: NodeJS.ProcessEnv = process.env): SecretStore {
  const mode = env.SECRETS_MODE ?? (env.NODE_ENV === 'production' ? 'aws' : 'local');
  if (mode === 'aws') {
    return new AwsSecretsManagerStore(
      new SecretsManagerClient({ region: env.AWS_REGION ?? 'us-east-1' }),
    );
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('SECRETS_MODE=local is not allowed in production');
  }
  return new MemorySecretStore();
}
