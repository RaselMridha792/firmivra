// Pins the decided prod settings (Rasel, Oct 23; docs/work/R1-cicd.md, "Prod go-live checklist"):
// the same account as dev, plain Fargate with auto scaling from 2 to 6 tasks on CPU, a maximum
// that stays inside the database's connections, RDS t3.small with 14 days of backups, single-AZ,
// and a CI stack that reuses dev's account-wide GitHub OIDC provider and image cache. Nothing
// here talks to AWS: the stacks are synthesized in memory, as `cdk synth` does.
import { App, type Stack, Validations } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { AwsSolutionsChecks } from 'cdk-nag';
import { describe, expect, it } from 'vitest';
import { cdkJsonContext } from '../src/cdk-context';
import {
  API_DB_POOL_SIZE,
  apiConnectionPeak,
  configFor,
  DB_CONNECTION_HEADROOM,
  DB_MAX_CONNECTIONS,
  type EnvConfig,
  PENDING_ZONE_ID,
} from '../src/config';
import { addNagSuppressions } from '../src/nag';
import { createStacks } from '../src/stacks';

function build(overrides: Partial<EnvConfig> = {}) {
  const app = new App({ context: { ...cdkJsonContext(), env: 'prod' } });
  const config = configFor('prod', overrides, { allowPending: true });
  const stacks = createStacks(app, config);
  addNagSuppressions(stacks, config);
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  return { app, stacks, config };
}

const { app, stacks, config } = build();
const t = (stack: Stack | undefined) => {
  if (!stack) throw new Error('stack not created');
  return Template.fromStack(stack);
};

describe('prod config', () => {
  it('cannot be used to deploy until firmivra.com has its Route 53 zone id', () => {
    expect(() => configFor('prod')).toThrow(/no Route 53 zone id yet/);
    expect(config.customDomain?.hostedZoneId).toBe(PENDING_ZONE_ID);
    expect(config.customDomain?.hosts).toEqual({
      admin: 'admin.firmivra.com',
      app: 'app.firmivra.com',
      portal: 'portal.firmivra.com',
    });
    expect(config.cognitoEmail?.from).toBe('no-reply@firmivra.com');
    expect(config.sesSandboxSendFromAnyIdentity).toBe(false);
    expect(config.stripeSecretName).toBe('firmivra/prod/stripe');
  });

  it("keeps the API's connections inside the database's, rollouts included", () => {
    // 6 tasks, each with pg's pool of 10, twice over during a rolling deploy.
    expect(apiConnectionPeak(config)).toBe(6 * 2 * API_DB_POOL_SIZE);
    expect(apiConnectionPeak(config) + DB_CONNECTION_HEADROOM).toBeLessThanOrEqual(
      DB_MAX_CONNECTIONS['t3.small']!,
    );
    const tooMany = { ...config.task, autoScaling: { min: 2, max: 8, cpuPercent: 55 } };
    expect(() => configFor('prod', { task: tooMany }, { allowPending: true })).toThrow(
      /exceed db\.t3\.small/,
    );
    // Dev's single task fits its t3.micro too.
    expect(apiConnectionPeak(configFor('dev')) + DB_CONNECTION_HEADROOM).toBeLessThanOrEqual(
      DB_MAX_CONNECTIONS['t3.micro']!,
    );
  });
});

describe('prod stacks', () => {
  it('synthesize with no unacknowledged cdk-nag findings', () => {
    expect(() => app.synth()).not.toThrow();
    expect(Object.keys(stacks).filter((k) => stacks[k as keyof typeof stacks])).toEqual([
      'network',
      'data',
      'auth',
      'email',
      'app',
      'ci',
    ]);
  });

  it('run PostgreSQL on db.t3.small, single-AZ, with 14 days of backups and 20 to 100 GiB', () => {
    t(stacks.data).hasResourceProperties('AWS::RDS::DBInstance', {
      DBInstanceClass: 'db.t3.small',
      MultiAZ: false,
      BackupRetentionPeriod: 14,
      AllocatedStorage: '20',
      MaxAllocatedStorage: 100,
      DeletionProtection: true,
    });
  });

  it('run api and web on plain Fargate (no Spot) at 0.5 vCPU and 1 GB', () => {
    const app = t(stacks.app);
    app.allResourcesProperties('AWS::ECS::Service', {
      CapacityProviderStrategy: [{ CapacityProvider: 'FARGATE', Weight: 1 }],
    });
    for (const family of ['firmivra-prod-api', 'firmivra-prod-web']) {
      app.hasResourceProperties('AWS::ECS::TaskDefinition', {
        Family: family,
        Cpu: '512',
        Memory: '1024',
      });
    }
  });

  it('leave the task count to auto scaling: 2 to 6 per service on 55% CPU, 0 without an image', () => {
    const app = t(stacks.app);
    // No count in the template once there is an image: a deploy keeps a scaled-out service.
    app.allResourcesProperties('AWS::ECS::Service', {
      DesiredCount: { 'Fn::If': ['HasImage', { Ref: 'AWS::NoValue' }, 0] },
    });
    app.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 2);
    app.allResourcesProperties('AWS::ApplicationAutoScaling::ScalableTarget', {
      MinCapacity: { 'Fn::If': ['HasImage', 2, 0] },
      MaxCapacity: { 'Fn::If': ['HasImage', 6, 0] },
      ScalableDimension: 'ecs:service:DesiredCount',
      ServiceNamespace: 'ecs',
      RoleARN: Match.stringLikeRegexp(
        'aws-service-role/ecs.application-autoscaling.amazonaws.com/AWSServiceRoleForApplicationAutoScaling_ECSService',
      ),
    });
    app.resourceCountIs('AWS::ApplicationAutoScaling::ScalingPolicy', 2);
    app.allResourcesProperties('AWS::ApplicationAutoScaling::ScalingPolicy', {
      PolicyType: 'TargetTrackingScaling',
      TargetTrackingScalingPolicyConfiguration: {
        PredefinedMetricSpecification: { PredefinedMetricType: 'ECSServiceAverageCPUUtilization' },
        TargetValue: 55,
        ScaleOutCooldown: 60,
        ScaleInCooldown: 300,
      },
    });
  });

  it("reuse dev's GitHub OIDC provider and image cache, and add no pull request role", () => {
    const ci = t(stacks.ci);
    expect(Object.keys(ci.findResources('Custom::AWSCDKOpenIdConnectProvider'))).toEqual([]);
    ci.resourceCountIs('AWS::IAM::OIDCProvider', 0);
    ci.resourceCountIs('AWS::ECR::PullThroughCacheRule', 0);
    expect(stacks.ci.pullRequestRole).toBeUndefined();
    ci.resourceCountIs('AWS::IAM::Role', 1);
    ci.hasResourceProperties('AWS::IAM::Role', {
      RoleName: 'firmivra-prod-github-deploy',
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Principal: {
              Federated:
                'arn:aws:iam::778127141557:oidc-provider/token.actions.githubusercontent.com',
            },
            // Only the prod GitHub environment (v* tags, required reviewers), never dev's.
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub':
                  'repo:RaselMridha792@149437621/firmivra@1404534844:environment:prod',
              },
            },
          }),
        ],
      },
    });
  });
});

describe('dev keeps its settings', () => {
  const dev = createStacks(
    new App({ context: { ...cdkJsonContext(), env: 'dev' } }),
    configFor('dev'),
  );

  it('still owns the account-wide CI pieces', () => {
    const ci = Template.fromStack(dev.ci);
    ci.resourceCountIs('AWS::ECR::PullThroughCacheRule', 1);
    expect(dev.ci.pullRequestRole).toBeDefined();
    ci.resourceCountIs('AWS::IAM::Role', 2);
  });

  it('runs one task per service on Spot, with no auto scaling', () => {
    const app = Template.fromStack(dev.app);
    app.allResourcesProperties('AWS::ECS::Service', {
      DesiredCount: { 'Fn::If': ['HasImage', 1, 0] },
      CapacityProviderStrategy: [{ CapacityProvider: 'FARGATE_SPOT', Weight: 1 }],
    });
    app.resourceCountIs('AWS::ApplicationAutoScaling::ScalableTarget', 0);
  });
});
