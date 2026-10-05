// The execution policy and the boundary must cover what our stacks create and what our roles do;
// otherwise a deploy fails half-way. Checked for the current setup and the custom-domain switch.
import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import {
  cfnExecPolicy,
  PERMISSIONS_BOUNDARY_NAME,
  type PolicyDocument,
  permissionsBoundary,
  policySize,
} from '../src/bootstrap-policies';
import { cdkJsonContext } from '../src/cdk-context';
import { configFor, DEV_FIRMIVRA_COM } from '../src/config';
import { createStacks } from '../src/stacks';

const { account, region } = configFor('dev');
const exec = cfnExecPolicy(account, region);
const boundary = permissionsBoundary(account, region);

type Resources = Record<string, { Type: string; Properties?: Record<string, unknown> }>;
const templates = [undefined, DEV_FIRMIVRA_COM].flatMap((customDomain) => {
  const app = new App({ context: { ...cdkJsonContext(), env: 'dev' } });
  const stacks = createStacks(app, configFor('dev', { customDomain }));
  return Object.values(stacks)
    .filter((s) => s !== undefined)
    .map((s) => ({
      name: s.stackName,
      resources: Template.fromStack(s).toJSON()['Resources'] as Resources,
    }));
});
const resources = templates.flatMap((t) =>
  Object.entries(t.resources).map(([id, r]) => ({ id: `${t.name}/${id}`, ...r })),
);

const allowed = (doc: PolicyDocument, skipSids: string[] = []) =>
  doc.Statement.filter((s) => s.Effect === 'Allow' && !skipSids.includes(s.Sid)).flatMap(
    (s) => s.Action,
  );
const matches = (pattern: string, action: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`, 'i').test(
    action,
  );

/** IAM service prefix for each CloudFormation resource type our stacks use. */
const SERVICE: Record<string, string> = {
  CertificateManager: 'acm',
  CloudFront: 'cloudfront',
  Cognito: 'cognito-idp',
  EC2: 'ec2',
  ECR: 'ecr',
  ECS: 'ecs',
  ElasticLoadBalancingV2: 'elasticloadbalancing',
  IAM: 'iam',
  KMS: 'kms',
  Lambda: 'lambda',
  Logs: 'logs',
  RDS: 'rds',
  Route53: 'route53',
  S3: 's3',
  SES: 'ses',
  SecretsManager: 'secretsmanager',
};

describe('bootstrap policies', () => {
  it('fit the IAM managed policy size limit', () => {
    expect(policySize(exec)).toBeLessThan(6144);
    expect(policySize(boundary)).toBeLessThan(6144);
  });

  it('put the boundary on every role in every stack', () => {
    const roles = resources.filter((r) => r.Type === 'AWS::IAM::Role');
    expect(roles.length).toBeGreaterThan(5);
    const without = roles
      .filter(
        (r) =>
          !JSON.stringify(r.Properties?.['PermissionsBoundary'] ?? '').includes(
            `:policy/${PERMISSIONS_BOUNDARY_NAME}`,
          ),
      )
      .map((r) => r.id);
    expect(without).toEqual([]);
  });

  it('let the execution role change every resource type our stacks use', () => {
    const writeActions = allowed(exec, ['Read']);
    const missing = [...new Set(resources.map((r) => r.Type))].filter((type) => {
      const service = type.startsWith('Custom::') ? 'lambda' : SERVICE[type.split('::')[1] ?? ''];
      return !service || !writeActions.some((a) => a.startsWith(`${service}:`));
    });
    expect(missing).toEqual([]);
  });

  it('keep every action of the execution role and of our roles inside the boundary', () => {
    const roleActions = resources
      .filter((r) => r.Type === 'AWS::IAM::Policy')
      .flatMap((r) => {
        const doc = r.Properties?.['PolicyDocument'] as {
          Statement: { Action: string | string[] }[];
        };
        return doc.Statement.flatMap((s) => s.Action);
      });
    const outside = [...new Set([...allowed(exec), ...roleActions])].filter(
      (action) => !allowed(boundary).some((pattern) => matches(pattern, action)),
    );
    expect(outside).toEqual([]);
  });

  it('refuse roles without the boundary, boundary removal and changes to themselves', () => {
    const denies = boundary.Statement.filter((s) => s.Effect === 'Deny');
    expect(denies.map((s) => s.Sid)).toEqual([
      'DenyRolesWithoutThisBoundary',
      'DenyBoundaryRemoval',
      'DenyGuardrailChanges',
      'DenyCdkBootstrapRoleChanges',
    ]);
    expect(JSON.stringify(denies[0]?.Condition)).toContain(`policy/${PERMISSIONS_BOUNDARY_NAME}`);
    expect(denies[2]?.Resource).toEqual([
      `arn:aws:iam::${account}:policy/${PERMISSIONS_BOUNDARY_NAME}`,
      `arn:aws:iam::${account}:policy/firmivra-cdk-cfn-exec`,
    ]);
  });
});
