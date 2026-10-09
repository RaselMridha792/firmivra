// Pins the decided dev settings (docs/SETUP-LOG.md) and the cdk-nag result, for the current
// CloudFront-domain setup and for the later switch to dev.firmivra.com (config only).
import { App, type Stack, Tags, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';
import { cdkJsonContext } from '../src/cdk-context';
import { configFor, DEV_FIRMIVRA_COM, type EnvConfig, resourceName } from '../src/config';
import { FIRM_KEY_PURPOSE, FIRM_KEY_TAG } from '../src/firm-key-policy';
import { addNagSuppressions } from '../src/nag';
import { createStacks } from '../src/stacks';
import { RESET_EMAIL } from '../src/stacks/auth-stack';
import { SCAN_LOG_MARKERS, SCAN_RESULTS_QUEUE } from '../src/stacks/malware-scan';

function build(overrides: Partial<EnvConfig> = {}) {
  const app = new App({ context: { ...cdkJsonContext(), env: 'dev' } });
  const config = configFor('dev', overrides);
  const stacks = createStacks(app, config);
  Tags.of(app).add('project', 'firmivra');
  Tags.of(app).add('env', 'dev');
  addNagSuppressions(stacks, config);
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return { app, stacks };
}

const { app, stacks } = build();
const tpl = (stack: Stack | undefined) => {
  if (!stack) throw new Error('stack not created');
  return Template.fromStack(stack);
};
const t = (name: 'network' | 'data' | 'auth' | 'email' | 'app' | 'ci') => tpl(stacks[name]);
/** The setup before the switch (and after switching back): customDomain unset. */
const cloudFront = build({ customDomain: undefined }).stacks;

describe('cdk-nag', () => {
  it('has no unacknowledged findings: on the custom domain and on CloudFront domains', () => {
    expect(() => app.synth()).not.toThrow();
    expect(() => build({ customDomain: undefined }).app.synth()).not.toThrow();
  });
});

describe('network', () => {
  it('has no NAT gateway and two public plus two isolated subnets', () => {
    const net = t('network');
    net.resourceCountIs('AWS::EC2::NatGateway', 0);
    net.resourceCountIs('AWS::EC2::Subnet', 4);
    net.resourceCountIs('AWS::EC2::FlowLog', 1);
  });

  it('lets only CloudFront (through the VPC origin) reach the load balancer, on port 80', () => {
    const net = t('network');
    const [albId] = Object.keys(
      net.findResources('AWS::EC2::SecurityGroup', {
        Properties: { GroupName: 'firmivra-dev-alb' },
      }),
    );
    const ingress = Object.values(
      net.findResources('AWS::EC2::SecurityGroupIngress', {
        Properties: { GroupId: { 'Fn::GetAtt': [albId, 'GroupId'] } },
      }),
    ) as { Properties: Record<string, unknown> }[];
    const inline = Object.values(
      net.findResources('AWS::EC2::SecurityGroup', {
        Properties: { GroupName: 'firmivra-dev-alb' },
      }),
    ).flatMap(
      (g) =>
        (g as { Properties: { SecurityGroupIngress?: unknown[] } }).Properties
          .SecurityGroupIngress ?? [],
    );
    expect([...ingress.map((r) => r.Properties), ...inline]).toEqual([
      expect.objectContaining({ FromPort: 80, ToPort: 80, SourcePrefixListId: expect.any(String) }),
    ]);
  });
});

describe('data', () => {
  it('runs PostgreSQL 16 on db.t3.micro, single-AZ, encrypted, private, protected', () => {
    t('data').hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      EngineVersion: '16',
      DBInstanceClass: 'db.t3.micro',
      MultiAZ: false,
      PubliclyAccessible: false,
      StorageEncrypted: true,
      DeletionProtection: true,
      BackupRetentionPeriod: 7,
    });
  });

  it('keeps documents private, versioned and encrypted with the documents key', () => {
    t('data').hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'firmivra-dev-documents-778127141557',
      VersioningConfiguration: { Status: 'Enabled' },
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({
            ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }),
          }),
        ],
      },
    });
  });
});

describe('documents CORS', () => {
  const cors = (stacks: ReturnType<typeof build>['stacks']) =>
    (
      Object.values(
        tpl(stacks.data).findResources('AWS::S3::Bucket', {
          Properties: { BucketName: 'firmivra-dev-documents-778127141557' },
        }),
      )[0] as { Properties: { CorsConfiguration: { CorsRules: { AllowedOrigins: string[] }[] } } }
    ).Properties.CorsConfiguration.CorsRules[0]!.AllowedOrigins;

  it('allows only the three exact CloudFront domains once they are in config', () => {
    const hosts = {
      admin: 'd1.cloudfront.net',
      app: 'd2.cloudfront.net',
      portal: 'd3.cloudfront.net',
    };
    expect(cors(build({ customDomain: undefined, cloudFrontHosts: hosts }).stacks)).toEqual([
      'https://d1.cloudfront.net',
      'https://d2.cloudfront.net',
      'https://d3.cloudfront.net',
    ]);
  });

  it('falls back to *.cloudfront.net only before the domains are known', () => {
    expect(cors(cloudFront)).toEqual(['https://*.cloudfront.net']);
  });

  it('allows only the three dev.firmivra.com sites with the custom domain (current)', () => {
    expect(cors(stacks)).toEqual([
      'https://admin.dev.firmivra.com',
      'https://app.dev.firmivra.com',
      'https://portal.dev.firmivra.com',
    ]);
  });
});

describe('auth (docs/AUTH-DESIGN.md)', () => {
  const pool = (name: string) =>
    Object.values(
      t('auth').findResources('AWS::Cognito::UserPool', {
        Properties: { UserPoolName: `firmivra-dev-${name}` },
      }),
    )[0] as { Properties: Record<string, unknown> };

  it('has three Plus-tier pools with threat protection enforced', () => {
    for (const name of ['staff', 'clients', 'admins']) {
      expect(pool(name).Properties).toMatchObject({
        UserPoolTier: 'PLUS',
        UserPoolAddOns: { AdvancedSecurityMode: 'ENFORCED' },
        AdminCreateUserConfig: { AllowAdminCreateUserOnly: true },
      });
    }
  });

  it('requires MFA for staff and Super Admin, optional for clients, TOTP only', () => {
    expect(pool('staff').Properties['MfaConfiguration']).toBe('ON');
    expect(pool('admins').Properties['MfaConfiguration']).toBe('ON');
    expect(pool('clients').Properties['MfaConfiguration']).toBe('OPTIONAL');
    expect(pool('staff').Properties['EnabledMfas']).toEqual(['SOFTWARE_TOKEN_MFA']);
  });

  it('gives the API one confidential client per pool, no hosted UI', () => {
    const clients = t('auth').findResources('AWS::Cognito::UserPoolClient');
    expect(Object.keys(clients)).toHaveLength(3);
    for (const c of Object.values(clients) as { Properties: Record<string, unknown> }[]) {
      expect(c.Properties).toMatchObject({
        GenerateSecret: true,
        AllowedOAuthFlowsUserPoolClient: false,
        PreventUserExistenceErrors: 'ENABLED',
        ExplicitAuthFlows: ['ALLOW_ADMIN_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH'],
      });
    }
  });

  it('keeps sessions shortest where an account sees most: admins 1 day, staff 7, clients 30', () => {
    for (const [name, days] of [
      ['admins', 1],
      ['staff', 7],
      ['clients', 30],
    ] as const) {
      t('auth').hasResourceProperties('AWS::Cognito::UserPoolClient', {
        ClientName: `firmivra-dev-${name}-api`,
        AccessTokenValidity: 15,
        IdTokenValidity: 15,
        RefreshTokenValidity: days * 24 * 60,
        TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'minutes' },
      });
    }
  });

  it('blocks compromised credentials', () => {
    t('auth').resourceCountIs('AWS::Cognito::UserPoolRiskConfigurationAttachment', 3);
    t('auth').hasResourceProperties('AWS::Cognito::UserPoolRiskConfigurationAttachment', {
      CompromisedCredentialsRiskConfiguration: { Actions: { EventAction: 'BLOCK' } },
    });
  });
});

describe('app', () => {
  it('runs api and web on Fargate Spot at 0.25 vCPU / 0.5 GB, x86', () => {
    for (const family of ['firmivra-dev-api', 'firmivra-dev-web', 'firmivra-dev-migrate']) {
      t('app').hasResourceProperties('AWS::ECS::TaskDefinition', {
        Family: family,
        Cpu: '256',
        Memory: '512',
        RuntimePlatform: { CpuArchitecture: 'X86_64', OperatingSystemFamily: 'LINUX' },
      });
    }
    t('app').hasResourceProperties('AWS::ECS::Service', {
      CapacityProviderStrategy: [{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }],
    });
  });

  it('takes the running image tags from stack parameters, set only by the deploy pipeline', () => {
    for (const p of ['ImageTag', 'MigrateImageTag']) {
      t('app').hasParameter(p, {
        Type: 'String',
        Default: 'none',
        AllowedPattern: '^(none|[0-9a-f]{40})$',
      });
    }
    const image = (repository: string, parameter: string) =>
      Match.objectLike({
        Image: {
          'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp(`:$`), { Ref: parameter }])],
        },
        Name: repository,
      });
    for (const [family, container, parameter] of [
      ['firmivra-dev-api', 'api', 'ImageTag'],
      ['firmivra-dev-web', 'web', 'ImageTag'],
      ['firmivra-dev-migrate', 'migrate', 'MigrateImageTag'],
    ] as const) {
      t('app').hasResourceProperties('AWS::ECS::TaskDefinition', {
        Family: family,
        ContainerDefinitions: [image(container, parameter)],
      });
    }
  });

  it('marks the migrate task as dev and gives it the pools link-dev-users reads', () => {
    t('app').hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: 'firmivra-dev-migrate',
      ContainerDefinitions: [
        Match.objectLike({
          Environment: Match.arrayWith([
            { Name: 'APP_ENV', Value: 'dev' },
            Match.objectLike({ Name: 'COGNITO_STAFF_USER_POOL_ID' }),
            Match.objectLike({ Name: 'COGNITO_ADMINS_USER_POOL_ID' }),
          ]),
        }),
      ],
    });
  });

  it('lets the migrate task only look users up (ListUsers) in the staff and admins pools', () => {
    type Policy = { Properties: { Roles: unknown; PolicyDocument: { Statement: unknown[] } } };
    const policies = Object.values(t('app').findResources('AWS::IAM::Policy')) as Policy[];
    const statements = policies
      .filter((p) => JSON.stringify(p.Properties.Roles).includes('MigrateTaskTaskRole'))
      .flatMap((p) => p.Properties.PolicyDocument.Statement) as {
      Action: string | string[];
      Resource: unknown;
    }[];
    expect(statements.flatMap((s) => [s.Action].flat())).toEqual(
      statements.map(() => 'cognito-idp:ListUsers'),
    );
    const resources = JSON.stringify(statements.map((s) => s.Resource));
    expect(resources).toMatch(/StaffPool/);
    expect(resources).toMatch(/AdminsPool/);
    expect(resources).not.toMatch(/ClientsPool/);
  });

  it('lets the API look users up by sub (ListUsers) in all three pools', () => {
    type Policy = { Properties: { Roles: unknown; PolicyDocument: { Statement: unknown[] } } };
    const policies = Object.values(t('app').findResources('AWS::IAM::Policy')) as Policy[];
    const listUsers = policies
      .filter((p) => JSON.stringify(p.Properties.Roles).includes('ApiTaskTaskRole'))
      .flatMap(
        (p) => p.Properties.PolicyDocument.Statement as { Action: unknown; Resource: unknown }[],
      )
      .filter((s) => [s.Action].flat().includes('cognito-idp:ListUsers'));
    const resources = JSON.stringify(listUsers.map((s) => s.Resource));
    for (const pool of ['StaffPool', 'ClientsPool', 'AdminsPool']) expect(resources).toMatch(pool);
  });

  it('runs 0 tasks while ImageTag is none, then the configured count', () => {
    t('app').hasCondition('HasImage', {
      'Fn::Not': [{ 'Fn::Equals': [{ Ref: 'ImageTag' }, 'none'] }],
    });
    t('app').allResourcesProperties('AWS::ECS::Service', {
      DesiredCount: { 'Fn::If': ['HasImage', 1, 0] },
    });
  });

  it('has an internal load balancer on HTTP 80 that refuses requests without the origin header', () => {
    t('app').hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', {
      Scheme: 'internal',
    });
    t('app').hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 80,
      Protocol: 'HTTP',
      DefaultActions: [
        Match.objectLike({
          Type: 'fixed-response',
          FixedResponseConfig: Match.objectLike({ StatusCode: '403' }),
        }),
      ],
    });
  });
});

type Statement = {
  Sid?: string;
  Effect: 'Allow' | 'Deny';
  Action: string | string[];
  Resource: unknown;
  Condition?: Record<string, Record<string, unknown>>;
};
type Policy = { Properties: { Roles: unknown; PolicyDocument: { Statement: Statement[] } } };
/** Every statement of the inline policies on the role whose logical id contains `role`. */
const roleStatements = (template: Template, role: string) =>
  (Object.values(template.findResources('AWS::IAM::Policy')) as Policy[])
    .filter((p) => JSON.stringify(p.Properties.Roles).includes(role))
    .flatMap((p) => p.Properties.PolicyDocument.Statement);
const actionsOf = (s: Statement) => [s.Action].flat();
const container = (template: Template, family: string) =>
  (
    Object.values(
      template.findResources('AWS::ECS::TaskDefinition', { Properties: { Family: family } }),
    )[0] as {
      Properties: {
        ContainerDefinitions: {
          Environment: { Name: string; Value: unknown }[];
          Secrets?: { Name: string; ValueFrom: unknown }[];
        }[];
      };
    }
  ).Properties.ContainerDefinitions[0]!;

describe('app: firm KMS keys on the API task role (R1 step 14)', () => {
  const statements = roleStatements(t('app'), 'ApiTaskTaskRole');
  const keys = 'arn:aws:kms:us-east-1:778127141557:key/*';
  const requestTags = {
    StringEquals: {
      'aws:RequestTag/firmivra:env': 'dev',
      'aws:RequestTag/firmivra:purpose': 'firm-data',
    },
    StringLike: { 'aws:RequestTag/firmivra:businessId': '????????-????-????-????-????????????' },
    'ForAllValues:StringEquals': {
      'aws:TagKeys': ['firmivra:env', 'firmivra:businessId', 'firmivra:purpose'],
    },
  };

  /** A firm key of dev: env and purpose tags, KMS key material, one Region. */
  const firmKey = {
    'aws:ResourceTag/firmivra:env': 'dev',
    'aws:ResourceTag/firmivra:purpose': 'firm-data',
    'kms:KeyOrigin': 'AWS_KMS',
  };
  const tagNeverRewrites = {
    'aws:ResourceTag/firmivra:env': 'dev',
    'aws:ResourceTag/firmivra:businessId': '${aws:RequestTag/firmivra:businessId}',
    'aws:ResourceTag/firmivra:purpose': 'firm-data',
  };

  it('has exactly the seven FirmKeys statements', () => {
    const firm = Object.fromEntries(
      statements.filter((s) => s.Sid?.startsWith('FirmKeys')).map((s) => [s.Sid, s]),
    );
    expect(firm).toEqual({
      FirmKeysCreate: {
        Sid: 'FirmKeysCreate',
        Effect: 'Allow',
        Action: 'kms:CreateKey',
        Resource: '*',
        Condition: {
          ...requestTags,
          StringEquals: {
            ...requestTags.StringEquals,
            'kms:KeySpec': 'SYMMETRIC_DEFAULT',
            'kms:KeyUsage': 'ENCRYPT_DECRYPT',
            'kms:KeyOrigin': 'AWS_KMS',
          },
          Bool: { 'kms:MultiRegion': 'false' },
        },
      },
      FirmKeysTagOnCreate: {
        Sid: 'FirmKeysTagOnCreate',
        Effect: 'Allow',
        Action: 'kms:TagResource',
        Resource: keys,
        Condition: {
          ...requestTags,
          StringEqualsIfExists: tagNeverRewrites,
          Null: { 'kms:ResourceAliases': 'true', 'aws:ResourceTag/project': 'true' },
        },
      },
      FirmKeysAliasName: {
        Sid: 'FirmKeysAliasName',
        Effect: 'Allow',
        Action: 'kms:CreateAlias',
        Resource: 'arn:aws:kms:us-east-1:778127141557:alias/firmivra/dev/business/*',
      },
      FirmKeysAliasKey: {
        Sid: 'FirmKeysAliasKey',
        Effect: 'Allow',
        Action: 'kms:CreateAlias',
        Resource: keys,
        Condition: { StringEquals: firmKey, Bool: { 'kms:MultiRegion': 'false' } },
      },
      FirmKeysRead: {
        Sid: 'FirmKeysRead',
        Effect: 'Allow',
        Action: ['kms:DescribeKey', 'kms:GetKeyPolicy', 'kms:ListGrants', 'kms:ListResourceTags'],
        Resource: keys,
        Condition: { StringEquals: { 'aws:ResourceTag/firmivra:env': 'dev' } },
      },
      FirmKeysUse: {
        Sid: 'FirmKeysUse',
        Effect: 'Allow',
        Action: ['kms:Decrypt', 'kms:GenerateDataKey'],
        Resource: keys,
        Condition: {
          StringEquals: {
            ...firmKey,
            'kms:EncryptionContext:businessId': '${aws:ResourceTag/firmivra:businessId}',
          },
          Bool: { 'kms:MultiRegion': 'false' },
        },
      },
      FirmKeysNoLockoutBypass: {
        Sid: 'FirmKeysNoLockoutBypass',
        Effect: 'Deny',
        Action: 'kms:CreateKey',
        Resource: '*',
        Condition: { Bool: { 'kms:BypassPolicyLockoutSafetyCheck': 'true' } },
      },
    });
    // The same names as the API's adapter (apps/api/src/firm-applications/firm-keys.ts).
    expect(FIRM_KEY_TAG).toEqual({
      env: 'firmivra:env',
      businessId: 'firmivra:businessId',
      purpose: 'firmivra:purpose',
    });
    expect(FIRM_KEY_PURPOSE).toBe('firm-data');
  });

  it('never lets the API delete, disable, re-tag or re-point a key, or change its policy', () => {
    const allowed = statements.filter((s) => s.Effect === 'Allow').flatMap(actionsOf);
    for (const action of [
      'kms:ScheduleKeyDeletion',
      'kms:DisableKey',
      'kms:PutKeyPolicy',
      'kms:UntagResource',
      'kms:UpdateAlias',
      'kms:DeleteAlias',
      'kms:CreateGrant',
    ]) {
      expect(allowed).not.toContain(action);
    }
    expect(allowed.filter((a) => a.includes('*'))).toEqual([]);
    // The only TagResource sets the three firm tags, never changes a firm tag a key already has
    // to another value, and never touches a key with an alias or a CDK key.
    const tagging = statements.filter((s) => actionsOf(s).includes('kms:TagResource'));
    expect(tagging.map((s) => s.Sid)).toEqual(['FirmKeysTagOnCreate']);
    expect(tagging[0]?.Condition?.['StringEqualsIfExists']).toEqual(tagNeverRewrites);
    expect(tagging[0]?.Condition?.['Null']).toEqual({
      'kms:ResourceAliases': 'true',
      'aws:ResourceTag/project': 'true',
    });
    expect(tagging[0]?.Condition).toMatchObject(requestTags);
    const creating = statements.filter(
      (s) => s.Effect === 'Allow' && actionsOf(s).includes('kms:CreateKey'),
    );
    expect(creating).toHaveLength(1);
    expect(creating[0]?.Condition).toMatchObject({
      StringLike: requestTags.StringLike,
      'ForAllValues:StringEquals': requestTags['ForAllValues:StringEquals'],
      StringEquals: requestTags.StringEquals,
    });
  });

  it('uses a firm key only with its env tag and the encryption context of its own business', () => {
    const using = statements.filter(
      (s) =>
        s.Effect === 'Allow' &&
        actionsOf(s).some((a) => a === 'kms:GenerateDataKey' || a === 'kms:Decrypt'),
    );
    expect(using.map((s) => s.Sid).sort()).toEqual(['DocumentsKey', 'FirmKeysUse']);
    for (const s of using) {
      if (s.Sid === 'DocumentsKey') {
        // The CDK documents key alone, by its ARN from the data stack.
        expect(JSON.stringify(s.Resource)).toContain('DocumentsKey');
        expect(JSON.stringify(s.Resource)).not.toContain('*');
      } else {
        expect(s.Condition?.['StringEquals']).toEqual({
          ...firmKey,
          'kms:EncryptionContext:businessId': '${aws:ResourceTag/firmivra:businessId}',
        });
      }
    }
  });

  it('denies CreateKey with the key policy lockout check bypassed', () => {
    expect(statements.filter((s) => s.Effect === 'Deny')).toEqual([
      expect.objectContaining({
        Sid: 'FirmKeysNoLockoutBypass',
        Action: 'kms:CreateKey',
        Condition: { Bool: { 'kms:BypassPolicyLockoutSafetyCheck': 'true' } },
      }),
    ]);
  });

  it('gives the API APP_ENV=dev and KMS_MODE=kms, and the web and migrate roles no KMS rights', () => {
    const env = Object.fromEntries(
      container(t('app'), 'firmivra-dev-api').Environment.map((e) => [e.Name, e.Value]),
    );
    expect(env).toMatchObject({ APP_ENV: 'dev', KMS_MODE: 'kms' });
    for (const role of ['WebTaskTaskRole', 'MigrateTaskTaskRole']) {
      const kms = roleStatements(t('app'), role)
        .flatMap(actionsOf)
        .filter((a) => a.startsWith('kms:'));
      expect(kms).toEqual([]);
    }
  });
});

describe('app: the EIN-hash key of R4 (R1 step 14)', () => {
  const einHashKey = () =>
    t('app').findResources('AWS::SecretsManager::Secret', {
      Properties: { Name: 'firmivra/dev/firm-applications/ein-hash-key' },
    });

  it('is generated once, never rotated, and kept if the stack is deleted', () => {
    // Never change these: a new name or new generation settings make a new value, and every
    // stored ein_hash would stop matching.
    const secrets = einHashKey();
    expect(Object.keys(secrets)).toHaveLength(1);
    const secret = Object.values(secrets)[0] as {
      Properties: Record<string, unknown>;
      DeletionPolicy: string;
      UpdateReplacePolicy: string;
    };
    expect(secret.Properties['GenerateSecretString']).toEqual({
      PasswordLength: 64,
      ExcludePunctuation: true,
      ExcludeUppercase: true,
      ExcludeCharacters: 'ghijklmnopqrstuvwxyz',
      IncludeSpace: false,
    });
    expect(secret.DeletionPolicy).toBe('RetainExceptOnCreate');
    expect(secret.UpdateReplacePolicy).toBe('Retain');
    t('app').resourceCountIs('AWS::SecretsManager::RotationSchedule', 0);
  });

  it('reaches only the API container, as EIN_HASH_KEY', () => {
    const [id] = Object.keys(einHashKey());
    const api = container(t('app'), 'firmivra-dev-api');
    expect(api.Secrets?.find((s) => s.Name === 'EIN_HASH_KEY')?.ValueFrom).toEqual({ Ref: id });
    for (const family of ['firmivra-dev-web', 'firmivra-dev-migrate']) {
      expect(JSON.stringify(container(t('app'), family))).not.toContain(id!);
    }
    const reading = (Object.values(t('app').findResources('AWS::IAM::Policy')) as Policy[]).filter(
      (p) => JSON.stringify(p.Properties.PolicyDocument).includes(id!),
    );
    expect(reading.map((p) => JSON.stringify(p.Properties.Roles))).toEqual([
      expect.stringContaining('ApiTaskExecutionRole'),
    ]);
  });
});

describe('auth: reset codes through SES (R1 step 14)', () => {
  const byName = (template: Template, name: string) =>
    (
      Object.values(
        template.findResources('AWS::Cognito::UserPool', {
          Properties: { UserPoolName: `firmivra-dev-${name}` },
        }),
      )[0] as { Properties: Record<string, unknown> }
    ).Properties;
  const wording = (name: string) => (name === 'clients' ? RESET_EMAIL.clients : RESET_EMAIL.staff);

  it('has the decided wording', () => {
    expect(RESET_EMAIL.staff.body).toBe('Your Firmivra password reset code is {####}');
    expect(RESET_EMAIL.clients.body).toBe(
      'Your client portal password reset code is {####}. Enter it on the page where you asked to reset your password.',
    );
  });

  const setups = [
    {
      setup: 'dev.firmivra.com: through the email stack SES identity',
      template: () => t('auth'),
      sending: {
        EmailSendingAccount: 'DEVELOPER',
        From: 'no-reply@dev.firmivra.com',
        SourceArn: 'arn:aws:ses:us-east-1:778127141557:identity/dev.firmivra.com',
        ConfigurationSet: 'firmivra-dev-email',
      },
    },
    {
      setup: 'CloudFront domains: the Cognito default sender',
      template: () => tpl(cloudFront.auth),
      sending: { EmailSendingAccount: 'COGNITO_DEFAULT' },
    },
  ];
  for (const { setup, template, sending } of setups) {
    it(`sends each pool's reset code with its wording (${setup})`, () => {
      for (const name of ['staff', 'clients', 'admins']) {
        const pool = byName(template(), name);
        const { subject, body } = wording(name);
        expect(pool['EmailConfiguration']).toEqual(sending);
        expect(pool).toMatchObject({
          EmailVerificationSubject: subject,
          EmailVerificationMessage: body,
          VerificationMessageTemplate: {
            DefaultEmailOption: 'CONFIRM_WITH_CODE',
            EmailSubject: subject,
            EmailMessage: body,
          },
        });
        // Nothing makes Cognito send the same message to verify a changed attribute.
        expect(pool['AutoVerifiedAttributes']).toBeUndefined();
        expect(pool['UserAttributeUpdateSettings']).toBeUndefined();
      }
    });
  }

  it('names the email stack resources in config, without a cross-stack reference', () => {
    expect(JSON.stringify(t('auth').toJSON())).not.toMatch(/Fn::ImportValue|Fn::GetStackOutput/);
    expect(stacks.auth.dependencies).toContain(stacks.email);
    const config = configFor('dev');
    expect(config.cognitoEmail).toEqual({
      from: stacks.email?.fromAddress,
      sesVerifiedDomain: config.customDomain?.zoneName,
      configurationSet: resourceName(config, 'email'),
    });
    t('email').hasResourceProperties('AWS::SES::ConfigurationSet', {
      Name: config.cognitoEmail?.configurationSet,
    });
    t('email').hasResourceProperties('AWS::SES::EmailIdentity', {
      EmailIdentity: config.cognitoEmail?.sesVerifiedDomain,
    });
  });
});

describe('app: CloudFront default domains (without customDomain)', () => {
  it('has three distributions on *.cloudfront.net, each with /api/* to the API, through one VPC origin', () => {
    tpl(cloudFront.app).resourceCountIs('AWS::CloudFront::Distribution', 3);
    tpl(cloudFront.app).resourceCountIs('AWS::CloudFront::VpcOrigin', 1);
    for (const d of Object.values(
      tpl(cloudFront.app).findResources('AWS::CloudFront::Distribution'),
    ) as {
      Properties: { DistributionConfig: Record<string, unknown> };
    }[]) {
      const config = d.Properties.DistributionConfig;
      expect(config['Aliases']).toBeUndefined();
      expect(config['CacheBehaviors']).toEqual(
        expect.arrayContaining([expect.objectContaining({ PathPattern: '/api/*' })]),
      );
      expect(JSON.stringify(config['Origins'])).toContain('VpcOriginConfig');
    }
  });

  it('creates no certificate, no DNS records and no email stack', () => {
    tpl(cloudFront.app).resourceCountIs('AWS::CertificateManager::Certificate', 0);
    tpl(cloudFront.app).resourceCountIs('AWS::Route53::RecordSet', 0);
    expect(cloudFront.email).toBeUndefined();
  });

  it('gives the web app its host map and both apps their site URLs from the distributions', () => {
    const web = Object.values(
      tpl(cloudFront.app).findResources('AWS::ECS::TaskDefinition', {
        Properties: { Family: 'firmivra-dev-web' },
      }),
    )[0] as {
      Properties: { ContainerDefinitions: { Environment: { Name: string; Value: unknown }[] }[] };
    };
    const env = Object.fromEntries(
      web.Properties.ContainerDefinitions[0]!.Environment.map((e) => [e.Name, e.Value]),
    );
    for (const key of ['ADMIN_HOST', 'APP_HOST', 'PORTAL_HOST']) {
      expect(JSON.stringify(env[key])).toContain('DomainName');
    }
    expect(JSON.stringify(env['PORTAL_BASE_URL'])).toContain('https://');
    tpl(cloudFront.app).hasOutput('AdminUrl', {});
    tpl(cloudFront.app).hasOutput('AppUrl', {});
    tpl(cloudFront.app).hasOutput('PortalUrl', {});
  });
});

describe('app: dev.firmivra.com (current) is a config change only', () => {
  const custom = build({ customDomain: DEV_FIRMIVRA_COM }).stacks;

  it('adds the certificate, the aliases and the DNS records', () => {
    const a = tpl(custom.app);
    a.resourceCountIs('AWS::CertificateManager::Certificate', 1);
    for (const host of ['admin', 'app', 'portal'].map((s) => `${s}.dev.firmivra.com`)) {
      a.hasResourceProperties('AWS::CloudFront::Distribution', {
        DistributionConfig: Match.objectLike({
          Aliases: [host],
          ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: 'TLSv1.2_2021' }),
        }),
      });
    }
    a.resourceCountIs('AWS::Route53::RecordSet', 6);
  });

  it('adds the SES email stack and points the apps at the custom hosts', () => {
    expect(custom.email).toBeDefined();
    const web = Object.values(
      tpl(custom.app).findResources('AWS::ECS::TaskDefinition', {
        Properties: { Family: 'firmivra-dev-web' },
      }),
    )[0] as {
      Properties: { ContainerDefinitions: { Environment: { Name: string; Value: unknown }[] }[] };
    };
    const env = Object.fromEntries(
      web.Properties.ContainerDefinitions[0]!.Environment.map((e) => [e.Name, e.Value]),
    );
    expect(env).toMatchObject({
      ADMIN_HOST: 'admin.dev.firmivra.com',
      APP_HOST: 'app.dev.firmivra.com',
      PORTAL_HOST: 'portal.dev.firmivra.com',
      PORTAL_BASE_URL: 'https://portal.dev.firmivra.com',
    });
    tpl(custom.data).hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'firmivra-dev-documents-778127141557',
      CorsConfiguration: {
        CorsRules: [
          Match.objectLike({
            AllowedOrigins: [
              'https://admin.dev.firmivra.com',
              'https://app.dev.firmivra.com',
              'https://portal.dev.firmivra.com',
            ],
          }),
        ],
      },
    });
  });
});

describe('app: GuardDuty malware scan (R1 step 19)', () => {
  const a = () => t('app');
  const bucket = 'arn:aws:s3:::firmivra-dev-documents-778127141557';
  const objects = [`${bucket}/malware-protection-resource-validation-object`, `${bucket}/tenant/*`];
  const managedRule =
    'arn:aws:events:us-east-1:778127141557:rule/DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3*';
  const only = (type: string, props: Record<string, unknown> = {}) => {
    const found = Object.entries(a().findResources(type, { Properties: props }));
    expect(found).toHaveLength(1);
    const [id, r] = found[0]!;
    // The project and env tags are pinned once, on the plan.
    const { Tags: tags, ...rest } = (r as { Properties: Record<string, unknown> }).Properties;
    return { id, props: rest, tags };
  };
  const planRole = () => only('AWS::IAM::Role', { RoleName: 'firmivra-dev-malware-scan' });
  const queue = () => only('AWS::SQS::Queue', { QueueName: 'firmivra-dev-malware-scan-results' });
  const dlq = () => only('AWS::SQS::Queue', { QueueName: 'firmivra-dev-malware-scan-results-dlq' });
  const rule = (n: string) => only('AWS::Events::Rule', { Name: `firmivra-dev-malware-scan-${n}` });
  const topic = () => only('AWS::SNS::Topic', { TopicName: 'firmivra-dev-alarms' });
  const arnOf = (id: string) => ({ 'Fn::GetAtt': [id, 'Arn'] });

  it('scans every new object under tenant/ of the documents bucket and tags it', () => {
    const plan = only('AWS::GuardDuty::MalwareProtectionPlan');
    expect(plan.props).toMatchObject({
      ProtectedResource: {
        S3Bucket: {
          BucketName: 'firmivra-dev-documents-778127141557',
          ObjectPrefixes: ['tenant/'],
        },
      },
      Actions: { Tagging: { Status: 'ENABLED' } },
      Role: arnOf(planRole().id),
    });
    expect(plan.tags).toEqual([
      { Key: 'env', Value: 'dev' },
      { Key: 'project', Value: 'firmivra' },
    ]);
  });

  it("gives the plan role AWS's template, narrowed to tenant/ and the validation object", () => {
    const role = planRole().props;
    expect(role['AssumeRolePolicyDocument']).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: { Service: 'malware-protection-plan.guardduty.amazonaws.com' },
          Action: 'sts:AssumeRole',
        },
      ],
    });
    const policies = role['Policies'] as { PolicyName: string; PolicyDocument: unknown }[];
    expect(policies.map((p) => p.PolicyName)).toEqual(['MalwareScan']);
    expect(policies[0]!.PolicyDocument).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'ManagedRule',
          Effect: 'Allow',
          Action: [
            'events:DeleteRule',
            'events:PutRule',
            'events:PutTargets',
            'events:RemoveTargets',
          ],
          Resource: managedRule,
          Condition: {
            StringLike: { 'events:ManagedBy': 'malware-protection-plan.guardduty.amazonaws.com' },
          },
        },
        {
          Sid: 'ManagedRuleRead',
          Effect: 'Allow',
          Action: ['events:DescribeRule', 'events:ListTargetsByRule'],
          Resource: managedRule,
        },
        {
          Sid: 'BucketEventBridge',
          Effect: 'Allow',
          Action: ['s3:GetBucketNotification', 's3:PutBucketNotification'],
          Resource: bucket,
        },
        { Sid: 'BucketOwnership', Effect: 'Allow', Action: 's3:ListBucket', Resource: bucket },
        { Sid: 'ValidationObject', Effect: 'Allow', Action: 's3:PutObject', Resource: objects[0] },
        {
          Sid: 'Scan',
          Effect: 'Allow',
          Action: ['s3:GetObject', 's3:GetObjectVersion'],
          Resource: objects,
        },
        {
          Sid: 'Tag',
          Effect: 'Allow',
          Action: [
            's3:GetObjectTagging',
            's3:GetObjectVersionTagging',
            's3:PutObjectTagging',
            's3:PutObjectVersionTagging',
          ],
          Resource: objects,
        },
        {
          Sid: 'DocumentsKey',
          Effect: 'Allow',
          Action: ['kms:Decrypt', 'kms:GenerateDataKey'],
          // The documents key, by the data stack's existing output: no new export.
          Resource: {
            'Fn::GetStackOutput': expect.objectContaining({
              StackName: 'firmivra-dev-data',
              OutputName: expect.stringContaining('DocumentsKey'),
            }),
          },
          Condition: { StringLike: { 'kms:ViaService': 's3.us-east-1.amazonaws.com' } },
        },
      ],
    });
    // No delete, and nothing on the bucket ARN beyond listing and its EventBridge setting.
    const statements = (policies[0]!.PolicyDocument as { Statement: Statement[] }).Statement;
    const all = statements.flatMap(actionsOf);
    expect(all.filter((x) => x.includes('Delete') && x.startsWith('s3:'))).toEqual([]);
    expect(all.filter((x) => x.includes('*'))).toEqual([]);
    expect(
      statements
        .filter((s) => s.Resource === bucket)
        .flatMap(actionsOf)
        .sort(),
    ).toEqual(['s3:GetBucketNotification', 's3:ListBucket', 's3:PutBucketNotification']);
    // No AWS::IAM::Policy adds anything to the plan role.
    expect(roleStatements(a(), planRole().id)).toEqual([]);
  });

  it('keeps results 4 days, makes them visible again after 120 s and dead-letters after about 32 minutes', () => {
    expect(queue().props).toEqual({
      QueueName: 'firmivra-dev-malware-scan-results',
      SqsManagedSseEnabled: true,
      VisibilityTimeout: 120,
      ReceiveMessageWaitTimeSeconds: 20,
      MessageRetentionPeriod: 4 * 24 * 3600,
      RedrivePolicy: { maxReceiveCount: 20, deadLetterTargetArn: arnOf(dlq().id) },
    });
    expect(dlq().props).toEqual({
      QueueName: 'firmivra-dev-malware-scan-results-dlq',
      SqsManagedSseEnabled: true,
      MessageRetentionPeriod: 14 * 24 * 3600,
    });
    // A result with no record yet: the API's 5 early retries at 20 s, then 120 s each.
    const q = SCAN_RESULTS_QUEUE;
    const waited =
      q.earlyRetries * q.earlyRetrySeconds +
      (q.maxReceiveCount - q.earlyRetries) * q.visibilityTimeoutSeconds;
    expect(waited).toBe(1900);
    expect(waited).toBeGreaterThanOrEqual(2 * 15 * 60); // twice the upload ticket's 15 minutes
    expect(waited).toBeLessThan(40 * 60); // below the stuck alarm
    // The consumer's worst case (a 15 s transaction, 2 s pool wait, a 30 s S3 read) fits twice.
    expect(q.visibilityTimeoutSeconds).toBeGreaterThanOrEqual(2 * (15 + 2 + 30));
  });

  it('lets only the results rule send to the queue and its dead-letter queue, over TLS', () => {
    const resultsRule = rule('results').id;
    for (const [q, sid] of [
      [queue().id, 'EventsFromScanRule'],
      [dlq().id, 'EventsFromScanRuleFailures'],
    ] as const) {
      const policy = only('AWS::SQS::QueuePolicy', { Queues: [{ Ref: q }] });
      expect((policy.props['PolicyDocument'] as { Statement: unknown[] }).Statement).toEqual([
        {
          Effect: 'Deny',
          Principal: { AWS: '*' },
          Action: 'sqs:*',
          Resource: arnOf(q),
          Condition: { Bool: { 'aws:SecureTransport': 'false' } },
        },
        {
          Sid: sid,
          Effect: 'Allow',
          Principal: { Service: 'events.amazonaws.com' },
          Action: 'sqs:SendMessage',
          Resource: arnOf(q),
          Condition: { ArnEquals: { 'aws:SourceArn': arnOf(resultsRule) } },
        },
      ]);
    }
  });

  it("sends this account's results for the documents bucket to the queue, also on-demand rescans", () => {
    const { props } = rule('results');
    // No `resources` filter: an on-demand scan's event is not documented to carry the plan ARN.
    expect(props['EventPattern']).toEqual({
      source: ['aws.guardduty'],
      'detail-type': ['GuardDuty Malware Protection Object Scan Result'],
      account: ['778127141557'],
      detail: { s3ObjectDetails: { bucketName: ['firmivra-dev-documents-778127141557'] } },
    });
    expect(props['Targets']).toEqual([
      {
        Id: 'Target0',
        Arn: arnOf(queue().id),
        DeadLetterConfig: { Arn: arnOf(dlq().id) },
        RetryPolicy: { MaximumEventAgeInSeconds: 86400, MaximumRetryAttempts: 185 },
      },
    ]);
  });

  it("sends the plan's status changes and failed tagging to the alarm topic", () => {
    const { props } = rule('plan-health');
    const plan = only('AWS::GuardDuty::MalwareProtectionPlan').id;
    expect(props['EventPattern']).toEqual({
      source: ['aws.guardduty'],
      'detail-type': [
        'GuardDuty Malware Protection Resource Status Active',
        'GuardDuty Malware Protection Resource Status Warning',
        'GuardDuty Malware Protection Resource Status warning',
        'GuardDuty Malware Protection Resource Status Error',
        'GuardDuty Malware Protection Post Scan Action Failed',
      ],
      resources: [arnOf(plan)],
    });
    expect(props['Targets']).toEqual([{ Id: 'Target0', Arn: { Ref: topic().id } }]);
  });

  it('has an alarm topic with no subscription, published to only by our alarms and that rule', () => {
    expect(topic().props).toEqual({
      TopicName: 'firmivra-dev-alarms',
      DisplayName: 'Firmivra dev alarms',
    });
    a().resourceCountIs('AWS::SNS::Subscription', 0); // Rasel subscribes by CLI after the deploy
    const ref = { Ref: topic().id };
    const policy = only('AWS::SNS::TopicPolicy', { Topics: [ref] });
    expect((policy.props['PolicyDocument'] as { Statement: unknown[] }).Statement).toEqual([
      {
        Sid: 'AllowPublishThroughSSLOnly',
        Effect: 'Deny',
        Principal: '*',
        Action: 'sns:Publish',
        Resource: ref,
        Condition: { Bool: { 'aws:SecureTransport': 'false' } },
      },
      {
        Sid: 'CloudWatchAlarms',
        Effect: 'Allow',
        Principal: { Service: 'cloudwatch.amazonaws.com' },
        Action: 'sns:Publish',
        Resource: ref,
        Condition: {
          ArnLike: {
            'aws:SourceArn': 'arn:aws:cloudwatch:us-east-1:778127141557:alarm:firmivra-dev-*',
          },
          StringEquals: { 'aws:SourceAccount': '778127141557' },
        },
      },
      {
        Sid: 'EventsFromPlanHealthRule',
        Effect: 'Allow',
        Principal: { Service: 'events.amazonaws.com' },
        Action: 'sns:Publish',
        Resource: ref,
        Condition: { ArnEquals: { 'aws:SourceArn': arnOf(rule('plan-health').id) } },
      },
    ]);
  });

  it('alarms on dead letters, a stuck queue and the consumer markers, each emailing ALARM and OK', () => {
    const ref = { Ref: topic().id };
    const alarms = Object.values(a().findResources('AWS::CloudWatch::Alarm')).map(
      (r) => (r as { Properties: Record<string, unknown> }).Properties,
    );
    const sqsMetric = (q: string, metric: string) => ({
      Namespace: 'AWS/SQS',
      MetricName: metric,
      Dimensions: [{ Name: 'QueueName', Value: { 'Fn::GetAtt': [q, 'QueueName'] } }],
    });
    const logMetric = (metric: string) => ({ Namespace: 'Firmivra/dev', MetricName: metric });
    const expected = [
      ['dead-letters', sqsMetric(dlq().id, 'ApproximateNumberOfMessagesVisible'), 'Maximum', 1],
      ['stuck', sqsMetric(queue().id, 'ApproximateAgeOfOldestMessage'), 'Maximum', 2400],
      ['unfinished', logMetric('ScanUnfinished'), 'Sum', 1],
      ['rejected', logMetric('ScanRejected'), 'Sum', 1],
      ['last-receive', logMetric('ScanLastReceive'), 'Sum', 1],
    ] as const;
    expect(alarms.map((x) => x['AlarmName'])).toEqual(
      expected.map(([n]) => `firmivra-dev-malware-scan-${n}`),
    );
    for (const [i, [, metric, statistic, threshold]] of expected.entries()) {
      expect(alarms[i]).toMatchObject({
        ...metric,
        Statistic: statistic,
        Threshold: threshold,
        Period: 300,
        EvaluationPeriods: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
        TreatMissingData: 'notBreaching',
        AlarmActions: [ref],
        OKActions: [ref],
      });
    }
    const filters = Object.values(a().findResources('AWS::Logs::MetricFilter')).map(
      (r) => (r as { Properties: Record<string, unknown> }).Properties,
    );
    const apiLogs = only('AWS::Logs::LogGroup', { LogGroupName: '/firmivra/dev/api' }).id;
    expect(filters).toEqual(
      (
        [
          ['unfinished', 'ScanUnfinished'],
          ['rejected', 'ScanRejected'],
          ['lastReceive', 'ScanLastReceive'],
        ] as const
      ).map(([key, metric]) => ({
        LogGroupName: { Ref: apiLogs },
        FilterPattern: `"${SCAN_LOG_MARKERS[key]}"`,
        MetricTransformations: [
          { MetricName: metric, MetricNamespace: 'Firmivra/dev', MetricValue: '1' },
        ],
      })),
    );
    expect(SCAN_LOG_MARKERS).toEqual({
      unfinished: 'SCAN_UNFINISHED',
      rejected: 'SCAN_REJECTED',
      lastReceive: 'SCAN_LAST_RECEIVE',
    });
  });

  it('lets only the API task role read the queue, and gives only the API its URL', () => {
    const api = roleStatements(a(), 'ApiTaskTaskRole').filter((s) => s.Sid === 'ScanResultsQueue');
    expect(api).toEqual([
      {
        Sid: 'ScanResultsQueue',
        Effect: 'Allow',
        Action: ['sqs:ChangeMessageVisibility', 'sqs:DeleteMessage', 'sqs:ReceiveMessage'],
        Resource: arnOf(queue().id),
      },
    ]);
    const sqsAnywhere = (Object.values(a().findResources('AWS::IAM::Policy')) as Policy[])
      .flatMap((p) => p.Properties.PolicyDocument.Statement)
      .filter((s) => actionsOf(s).some((x) => x.startsWith('sqs:')));
    expect(sqsAnywhere).toEqual(api);
    const env = (family: string) =>
      Object.fromEntries(container(a(), family).Environment.map((e) => [e.Name, e.Value]));
    expect(env('firmivra-dev-api')['SCAN_RESULTS_QUEUE_URL']).toEqual({ Ref: queue().id });
    for (const family of ['firmivra-dev-web', 'firmivra-dev-migrate']) {
      expect(env(family)['SCAN_RESULTS_QUEUE_URL']).toBeUndefined();
    }
  });

  it('gives the API container 60 s after SIGTERM to finish the scan result in hand', () => {
    expect(container(a(), 'firmivra-dev-api')).toMatchObject({ StopTimeout: 60 });
    for (const family of ['firmivra-dev-web', 'firmivra-dev-migrate']) {
      expect(container(a(), family)).not.toHaveProperty('StopTimeout');
    }
  });

  it("outputs what Rasel's commands read", () => {
    for (const output of [
      'AlarmTopicArn',
      'MalwareProtectionPlanId',
      'MalwareScanRoleArn',
      'ScanResultsQueueUrl',
      'ScanResultsQueueArn',
      'ScanResultsDeadLetterQueueArn',
    ]) {
      a().hasOutput(output, {});
    }
  });

  it('leaves the data stack alone: the documents key keeps only the root statement', () => {
    const key = Object.values(t('data').findResources('AWS::KMS::Key'))[0] as {
      Properties: { KeyPolicy: { Statement: unknown[] } };
    };
    expect(key.Properties.KeyPolicy.Statement).toEqual([
      {
        Effect: 'Allow',
        Principal: { AWS: 'arn:aws:iam::778127141557:root' },
        Action: 'kms:*',
        Resource: '*',
      },
    ]);
    // The bucket sets no notifications: GuardDuty's EventBridge setting is left alone.
    const documents = Object.values(
      t('data').findResources('AWS::S3::Bucket', {
        Properties: { BucketName: 'firmivra-dev-documents-778127141557' },
      }),
    )[0] as { Properties: Record<string, unknown> };
    expect(documents.Properties['NotificationConfiguration']).toBeUndefined();
  });
});

describe('ci', () => {
  it('trusts only the dev and prod GitHub environments of the Firmivra repo', () => {
    t('ci').hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'firmivra-dev-github-deploy',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub': [
                  'repo:RaselMridha792@149437621/firmivra@1404534844:environment:dev',
                  'repo:RaselMridha792@149437621/firmivra@1404534844:environment:prod',
                ],
              },
            },
          }),
        ],
      },
    });
  });
});

describe('retained resources', () => {
  it('are kept on update and delete, but cleaned up when the first create fails', () => {
    for (const name of ['network', 'data', 'auth', 'app', 'ci'] as const) {
      const resources = t(name).toJSON()['Resources'] as Record<
        string,
        { DeletionPolicy?: string }
      >;
      const plainRetain = Object.entries(resources)
        .filter(([, r]) => r.DeletionPolicy === 'Retain')
        .map(([id]) => `${name}/${id}`);
      expect(plainRetain).toEqual([]);
    }
  });
});

describe('log groups', () => {
  it('keep logs for 14 days and are deleted with their stack, also the ones CDK helpers create', () => {
    const retention = (['network', 'data', 'auth', 'app', 'ci'] as const).flatMap((name) =>
      Object.entries(t(name).findResources('AWS::Logs::LogGroup')).map(
        ([id, r]) =>
          `${name}/${id}: ${String(r['Properties']?.['RetentionInDays'])} ${String(r['DeletionPolicy'])}`,
      ),
    );
    expect(retention.length).toBeGreaterThan(0);
    expect(retention.filter((line) => !line.endsWith(': 14 Delete'))).toEqual([]);
    t('auth').resourceCountIs('AWS::Logs::LogGroup', 1);
  });
});

describe('tags', () => {
  it('tags resources with project=firmivra and env=dev', () => {
    for (const [stack, type] of [
      ['network', 'AWS::EC2::VPC'],
      ['data', 'AWS::RDS::DBInstance'],
      ['app', 'AWS::ECS::Cluster'],
    ] as const) {
      t(stack).hasResourceProperties(type, {
        Tags: Match.arrayWith([
          { Key: 'env', Value: 'dev' },
          { Key: 'project', Value: 'firmivra' },
        ]),
      });
    }
  });
});
