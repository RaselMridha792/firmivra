import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { type EnvConfig, resourceName } from '../config';

export interface AuthStackProps extends StackProps {
  config: EnvConfig;
}

/**
 * The reset code email per pool (Rasel, Oct 8). Cognito uses the same verification message for
 * sign-up confirmation and attribute verification; our pools never send those (AUTH-DESIGN.md).
 */
export const RESET_EMAIL = {
  staff: {
    subject: 'Firmivra password reset code',
    body: 'Your Firmivra password reset code is {####}',
  },
  clients: {
    subject: 'Client portal password reset code',
    body: 'Your client portal password reset code is {####}. Enter it on the page where you asked to reset your password.',
  },
} as const;

type ResetEmail = (typeof RESET_EMAIL)[keyof typeof RESET_EMAIL];

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
 * - Cognito sends one email of its own: the ForgotPassword code, through our SES identity when
 *   the environment has a custom domain (config.cognitoEmail), else with Cognito's default sender
 *   (docs/AUTH-DESIGN.md, "Password reset email").
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

    const email =
      config.customDomain && config.cognitoEmail
        ? cognito.UserPoolEmail.withSES({
            fromEmail: config.cognitoEmail.from,
            sesVerifiedDomain: config.cognitoEmail.sesVerifiedDomain,
            configurationSetName: config.cognitoEmail.configurationSet,
          })
        : cognito.UserPoolEmail.withCognito();

    // Refresh tokens (the longest a session lasts without signing in again): shorter where an
    // account can see more. Clients: 30 days for now (Rasel, Oct 5).
    const pool = (name: string, mfa: cognito.Mfa, refresh: Duration, reset: ResetEmail) =>
      this.pool(config, { name, mfa, refreshTokenValidity: refresh, email, reset });
    this.staff = pool('staff', cognito.Mfa.REQUIRED, Duration.days(7), RESET_EMAIL.staff);
    this.clients = pool('clients', cognito.Mfa.OPTIONAL, Duration.days(30), RESET_EMAIL.clients);
    this.admins = pool('admins', cognito.Mfa.REQUIRED, Duration.days(1), RESET_EMAIL.staff);

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
    {
      name,
      mfa,
      refreshTokenValidity,
      email,
      reset,
    }: {
      name: string;
      mfa: cognito.Mfa;
      refreshTokenValidity: Duration;
      email: cognito.UserPoolEmail;
      reset: ResetEmail;
    },
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
      email,
      userVerification: {
        emailSubject: reset.subject,
        emailBody: reset.body,
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
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
