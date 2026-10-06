import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { type EnvConfig, resourceName } from '../config';

export interface AuthStackProps extends StackProps {
  config: EnvConfig;
}

export interface PoolOutput {
  pool: cognito.UserPool;
  client: cognito.UserPoolClient;
}

/**
 * Three Cognito user pools (docs/AUTH-DESIGN.md): staff, clients, Super Admin.
 * - Cognito only says who someone is; firm and role live in our database.
 * - Usernames are UUIDs the API generates; email is a normal attribute, not a sign-in alias.
 * - No self sign-up and no hosted UI: our API calls Cognito with a confidential app client.
 * - Plus tier: threat protection with compromised-credential checks (blocked).
 * Cognito sends forgot-password codes with its default sender until SES for dev.firmivra.com is
 * verified (open point in the auth design: SES branding needs a custom email sender).
 */
export class AuthStack extends Stack {
  readonly staff: PoolOutput;
  readonly clients: PoolOutput;
  readonly admins: PoolOutput;
  /** Client secrets of the three API app clients, injected into the API task. */
  readonly clientSecrets: secretsmanager.Secret;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;

    // Refresh tokens (the longest a session lasts without signing in again): shorter where an
    // account can see more. Clients: 30 days for now (Rasel, Oct 5).
    this.staff = this.pool(config, 'staff', cognito.Mfa.REQUIRED, Duration.days(7));
    this.clients = this.pool(config, 'clients', cognito.Mfa.OPTIONAL, Duration.days(30));
    this.admins = this.pool(config, 'admins', cognito.Mfa.REQUIRED, Duration.days(1));

    this.clientSecrets = new secretsmanager.Secret(this, 'ApiClientSecrets', {
      secretName: `firmivra/${config.envName}/cognito/api-clients`,
      description: 'Client secrets of the API app clients (staff, clients, admins pools)',
      secretObjectValue: {
        STAFF: this.staff.client.userPoolClientSecret,
        CLIENTS: this.clients.client.userPoolClientSecret,
        ADMINS: this.admins.client.userPoolClientSecret,
      },
    });
  }

  private pool(
    config: EnvConfig,
    name: string,
    mfa: cognito.Mfa,
    refreshTokenValidity: Duration,
  ): PoolOutput {
    const id = name.charAt(0).toUpperCase() + name.slice(1);
    const pool = new cognito.UserPool(this, `${id}Pool`, {
      userPoolName: resourceName(config, name),
      signInAliases: { username: true },
      signInCaseSensitive: false,
      selfSignUpEnabled: false,
      standardAttributes: {
        email: { required: true, mutable: true },
        phoneNumber: { required: false, mutable: true },
      },
      mfa,
      mfaSecondFactor: { otp: true, sms: false },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
        tempPasswordValidity: Duration.days(7),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      featurePlan: cognito.FeaturePlan.PLUS,
      standardThreatProtectionMode: cognito.StandardThreatProtectionMode.FULL_FUNCTION,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });

    // Compromised credentials: block sign-in, sign-up and password change with a leaked password.
    new cognito.CfnUserPoolRiskConfigurationAttachment(this, `${id}RiskConfig`, {
      userPoolId: pool.userPoolId,
      clientId: 'ALL',
      compromisedCredentialsRiskConfiguration: {
        actions: { eventAction: 'BLOCK' },
        eventFilter: ['SIGN_IN', 'SIGN_UP', 'PASSWORD_CHANGE'],
      },
    });

    const client = pool.addClient('ApiClient', {
      userPoolClientName: resourceName(config, `${name}-api`),
      generateSecret: true,
      authFlows: { adminUserPassword: true },
      disableOAuth: true,
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(15),
      idTokenValidity: Duration.minutes(15),
      refreshTokenValidity,
    });
    return { pool, client };
  }
}
