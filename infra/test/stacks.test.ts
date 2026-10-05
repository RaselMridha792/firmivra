// Pins the decided dev settings (docs/SETUP-LOG.md) and the cdk-nag result, for the current
// CloudFront-domain setup and for the later switch to dev.firmivra.com (config only).
import { App, type Stack, Tags, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';
import { configFor, DEV_FIRMIVRA_COM, type EnvConfig } from '../src/config';
import { addNagSuppressions } from '../src/nag';
import { createStacks } from '../src/stacks';

function build(imageTag?: string, overrides: Partial<EnvConfig> = {}) {
  const app = new App({ context: { env: 'dev' } });
  const config = configFor('dev', overrides);
  const stacks = createStacks(app, config, imageTag);
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
const t = (name: 'network' | 'data' | 'auth' | 'app' | 'ci') => tpl(stacks[name]);

describe('cdk-nag', () => {
  it('has no unacknowledged findings: services at 0, with an image tag, and with the custom domain', () => {
    expect(() => app.synth()).not.toThrow();
    expect(() => build('abc1234').app.synth()).not.toThrow();
    expect(() => build(undefined, { customDomain: DEV_FIRMIVRA_COM }).app.synth()).not.toThrow();
  });
});

describe('network', () => {
  it('has no NAT gateway and two public plus two isolated subnets', () => {
    const net = t('network');
    net.resourceCountIs('AWS::EC2::NatGateway', 0);
    net.resourceCountIs('AWS::EC2::Subnet', 4);
    net.resourceCountIs('AWS::EC2::FlowLog', 1);
  });

  it('lets only traffic from inside the VPC reach the load balancer, on port 80', () => {
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
      expect.objectContaining({ FromPort: 80, ToPort: 80, CidrIp: '10.20.0.0/16' }),
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
    expect(cors(build(undefined, { cloudFrontHosts: hosts }).stacks)).toEqual([
      'https://d1.cloudfront.net',
      'https://d2.cloudfront.net',
      'https://d3.cloudfront.net',
    ]);
  });

  it('falls back to *.cloudfront.net only before the domains are known', () => {
    expect(cors(stacks)).toEqual(['https://*.cloudfront.net']);
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

describe('app: CloudFront default domains (current)', () => {
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

  it('starts services at 0 tasks without an image tag, 1 with one', () => {
    t('app').allResourcesProperties('AWS::ECS::Service', { DesiredCount: 0 });
    tpl(build('abc1234').stacks.app).allResourcesProperties('AWS::ECS::Service', {
      DesiredCount: 1,
    });
  });

  it('keeps logs for 14 days', () => {
    t('app').allResourcesProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
    t('network').allResourcesProperties('AWS::Logs::LogGroup', { RetentionInDays: 14 });
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

  it('has three distributions on *.cloudfront.net, each with /api/* to the API, through one VPC origin', () => {
    t('app').resourceCountIs('AWS::CloudFront::Distribution', 3);
    t('app').resourceCountIs('AWS::CloudFront::VpcOrigin', 1);
    for (const d of Object.values(t('app').findResources('AWS::CloudFront::Distribution')) as {
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
    t('app').resourceCountIs('AWS::CertificateManager::Certificate', 0);
    t('app').resourceCountIs('AWS::Route53::RecordSet', 0);
    expect(stacks.email).toBeUndefined();
  });

  it('gives the web app its host map and both apps their site URLs from the distributions', () => {
    const web = Object.values(
      t('app').findResources('AWS::ECS::TaskDefinition', {
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
    t('app').hasOutput('AdminUrl', {});
    t('app').hasOutput('AppUrl', {});
    t('app').hasOutput('PortalUrl', {});
  });
});

describe('app: switching to dev.firmivra.com is a config change only', () => {
  const custom = build(undefined, { customDomain: DEV_FIRMIVRA_COM }).stacks;

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
