// Pins the decided dev settings (docs/SETUP-LOG.md) and the cdk-nag result.
// Runs without AWS credentials: lookups (CloudFront prefix list) get CDK's placeholder values.
import { App, Tags, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';
import { configFor } from '../src/config';
import { addNagSuppressions } from '../src/nag';
import { createStacks } from '../src/stacks';

function build(imageTag?: string) {
  const app = new App({ context: { env: 'dev' } });
  const config = configFor('dev');
  const stacks = createStacks(app, config, imageTag);
  Tags.of(app).add('project', 'firmivra');
  Tags.of(app).add('env', 'dev');
  addNagSuppressions(stacks, config);
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return { app, stacks };
}

const { app, stacks } = build();
const t = (stack: keyof typeof stacks) => Template.fromStack(stacks[stack]);

describe('cdk-nag', () => {
  it('has no unacknowledged findings (services at 0 and with an image tag)', () => {
    expect(() => app.synth()).not.toThrow();
    expect(() => build('abc1234').app.synth()).not.toThrow();
  });
});

describe('network', () => {
  it('has no NAT gateway and two public plus two isolated subnets', () => {
    const net = t('network');
    net.resourceCountIs('AWS::EC2::NatGateway', 0);
    net.resourceCountIs('AWS::EC2::Subnet', 4);
    net.resourceCountIs('AWS::EC2::FlowLog', 1);
  });

  it('lets only CloudFront reach the load balancer, on 443', () => {
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
    expect(ingress.map((r) => r.Properties)).toEqual([
      expect.objectContaining({
        FromPort: 443,
        ToPort: 443,
        SourcePrefixListId: expect.any(String),
      }),
    ]);
  });
});

describe('data', () => {
  it('runs PostgreSQL 16 on db.t4g.micro, single-AZ, encrypted, private, protected', () => {
    t('data').hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      EngineVersion: '16',
      DBInstanceClass: 'db.t4g.micro',
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
      NetworkConfiguration: {
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: 'ENABLED' }),
      },
    });
  });

  it('starts services at 0 tasks without an image tag, 1 with one', () => {
    t('app').allResourcesProperties('AWS::ECS::Service', { DesiredCount: 0 });
    Template.fromStack(build('abc1234').stacks.app).allResourcesProperties('AWS::ECS::Service', {
      DesiredCount: 1,
    });
  });

  it('keeps logs for 14 days', () => {
    t('app').allResourcesProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
    t('network').allResourcesProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
  });

  it('serves the three sites through CloudFront with /api/* to the API', () => {
    t('app').hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        Aliases: ['admin.dev.firmivra.com', 'app.dev.firmivra.com', 'portal.dev.firmivra.com'],
        CacheBehaviors: Match.arrayWith([Match.objectLike({ PathPattern: '/api/*' })]),
      }),
    });
  });

  it('refuses load balancer requests without the CloudFront origin header', () => {
    t('app').hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      Port: 443,
      DefaultActions: [
        Match.objectLike({
          Type: 'fixed-response',
          FixedResponseConfig: Match.objectLike({ StatusCode: '403' }),
        }),
      ],
    });
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
                  'repo:RaselMridha792/firmivra:environment:dev',
                  'repo:RaselMridha792/firmivra:environment:prod',
                ],
              },
            },
          }),
        ],
      },
    });
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
