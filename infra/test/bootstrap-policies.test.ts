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
  SERVICE_LINKED_ROLES,
} from '../src/bootstrap-policies';
import { cdkJsonContext } from '../src/cdk-context';
import { configFor, DEV_FIRMIVRA_COM } from '../src/config';
import { createStacks } from '../src/stacks';
import { GUARDDUTY_MANAGED_RULE } from '../src/stacks/malware-scan';

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
  CloudWatch: 'cloudwatch',
  ElasticLoadBalancingV2: 'elasticloadbalancing',
  Events: 'events',
  GuardDuty: 'guardduty',
  IAM: 'iam',
  KMS: 'kms',
  Lambda: 'lambda',
  Logs: 'logs',
  RDS: 'rds',
  Route53: 'route53',
  S3: 's3',
  SES: 'ses',
  SNS: 'sns',
  SQS: 'sqs',
  SecretsManager: 'secretsmanager',
};

type RoleStatement = { Effect: string; Action: string | string[]; Resource: unknown };
type Doc = { Statement: RoleStatement[] };
/** Every statement our roles get: AWS::IAM::Policy resources and inline policies on AWS::IAM::Role. */
const roleStatements = (filter: (r: (typeof resources)[number]) => boolean = () => true) =>
  resources.filter(filter).flatMap((r) => {
    if (r.Type === 'AWS::IAM::Policy') return (r.Properties?.['PolicyDocument'] as Doc).Statement;
    if (r.Type !== 'AWS::IAM::Role') return [];
    const inline = (r.Properties?.['Policies'] ?? []) as { PolicyDocument: Doc }[];
    return inline.flatMap((p) => p.PolicyDocument.Statement);
  });
/** IAM's resource wildcard match (case-sensitive). */
const resourceMatches = (pattern: string, resource: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`).test(
    resource,
  );
/**
 * True when some Allow statement of the boundary allows this action on this resource. A resource
 * that is not a plain string (a reference to another stack's resource) only matches Resource "*".
 */
const boundaryAllows = (action: string, resource: unknown) =>
  boundary.Statement.some(
    (s) =>
      s.Effect === 'Allow' &&
      s.Action.some((pattern) => matches(pattern, action)) &&
      [s.Resource]
        .flat()
        .some((pattern) =>
          typeof resource === 'string' ? resourceMatches(pattern, resource) : pattern === '*',
        ),
  );

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
    const roleActions = roleStatements().flatMap((s) => s.Action);
    // Inline role policies count too (the malware plan role's).
    expect(roleActions).toContain('events:PutRule');
    const outside = [...new Set([...allowed(exec), ...roleActions])].filter(
      (action) => !allowed(boundary).some((pattern) => matches(pattern, action)),
    );
    expect(outside).toEqual([]);
  });

  it("keep each malware plan role action inside the boundary for that statement's resources", () => {
    const plan = roleStatements(
      (r) =>
        r.Type === 'AWS::IAM::Role' && r.Properties?.['RoleName'] === 'firmivra-dev-malware-scan',
    );
    expect(plan).toHaveLength(16); // 8 statements, in each of the two setups
    const pairs = plan.flatMap((s) =>
      [s.Action]
        .flat()
        .flatMap((action) => [s.Resource].flat().map((resource) => ({ action, resource }))),
    );
    expect(pairs.filter((p) => !boundaryAllows(p.action, p.resource))).toEqual([]);
    // Events only on GuardDuty's rule, S3 only on firmivra-*, KMS only through Services (*).
    const bucket = 'arn:aws:s3:::firmivra-dev-documents-778127141557';
    const rule = (n: string) => `arn:aws:events:${region}:${account}:rule/${n}`;
    expect(boundaryAllows('events:PutRule', rule('other'))).toBe(false);
    expect(
      boundaryAllows('events:PutRule', rule('DO-NOT-DELETE-AmazonGuardDutyMalwareProtectionS3-x')),
    ).toBe(true);
    expect(boundaryAllows('s3:GetObject', 'arn:aws:s3:::other-bucket/tenant/x')).toBe(false);
    expect(boundaryAllows('s3:GetObject', `${bucket}/tenant/x`)).toBe(true);
    expect(boundaryAllows('kms:Decrypt', { 'Fn::ImportValue': 'x' })).toBe(true);
    // Only GuardDutyManagedRules covers GuardDuty's rule: without it the plan goes to ERROR.
    const managedRule = `arn:aws:events:${region}:${account}:${GUARDDUTY_MANAGED_RULE}`;
    expect(
      boundary.Statement.filter(
        (s) =>
          s.Effect === 'Allow' &&
          [s.Resource].flat().some((r) => r !== '*' && resourceMatches(r, managedRule)),
      ).map((s) => s.Sid),
    ).toEqual(['GuardDutyManagedRules']);
  });

  it('let the execution role make only the malware plan and firmivra-* queues, rules, topics and alarms', () => {
    const sid = (id: string) => exec.Statement.find((s) => s.Sid === id);
    expect(sid('MalwareProtectionPlanCreate')).toEqual({
      Sid: 'MalwareProtectionPlanCreate',
      Effect: 'Allow',
      Action: ['guardduty:CreateMalwareProtectionPlan'],
      Resource: '*',
    });
    expect(sid('MalwareProtectionPlans')).toEqual({
      Sid: 'MalwareProtectionPlans',
      Effect: 'Allow',
      Action: [
        'guardduty:GetMalwareProtectionPlan',
        'guardduty:UpdateMalwareProtectionPlan',
        'guardduty:DeleteMalwareProtectionPlan',
        'guardduty:TagResource',
        'guardduty:UntagResource',
      ],
      Resource: `arn:aws:guardduty:${region}:${account}:malware-protection-plan/*`,
    });
    const named = sid('NamedResources');
    expect(named?.Action).toEqual(
      expect.arrayContaining(['cloudwatch:*', 'events:*', 'sns:*', 'sqs:*']),
    );
    expect(named?.Resource).toEqual(
      expect.arrayContaining([
        `arn:aws:cloudwatch:${region}:${account}:alarm:firmivra-*`,
        `arn:aws:events:${region}:${account}:rule/firmivra-*`,
        `arn:aws:sns:${region}:${account}:firmivra-*`,
        `arn:aws:sqs:${region}:${account}:firmivra-*`,
      ]),
    );
    // No other statement grants guardduty, sqs, events, sns or cloudwatch actions.
    const mine = ['NamedResources', 'MalwareProtectionPlanCreate', 'MalwareProtectionPlans'];
    const others = exec.Statement.filter((s) => !mine.includes(s.Sid)).flatMap((s) => s.Action);
    expect(others.filter((a) => /^(guardduty|sqs|events|sns|cloudwatch):/.test(a))).toEqual([]);
    // The plan role's PassRole: the existing Roles statement (role/firmivra-*).
    const roles = sid('Roles');
    expect(roles?.Action).toContain('iam:PassRole');
    expect(
      resourceMatches(
        String(roles?.Resource),
        `arn:aws:iam::${account}:role/firmivra-dev-malware-scan`,
      ),
    ).toBe(true);
  });

  it("cap GuardDuty's managed-rule actions to its DO-NOT-DELETE rules in the boundary", () => {
    expect(boundary.Statement.find((s) => s.Sid === 'GuardDutyManagedRules')).toEqual({
      Sid: 'GuardDutyManagedRules',
      Effect: 'Allow',
      Action: [
        'events:PutRule',
        'events:DeleteRule',
        'events:PutTargets',
        'events:RemoveTargets',
        'events:DescribeRule',
        'events:ListTargetsByRule',
      ],
      Resource: `arn:aws:events:${region}:${account}:${GUARDDUTY_MANAGED_RULE}`,
    });
    expect(boundary.Statement.find((s) => s.Sid === 'FirmivraQueuesRulesTopicsAlarms')).toEqual({
      Sid: 'FirmivraQueuesRulesTopicsAlarms',
      Effect: 'Allow',
      Action: ['sqs:*', 'events:*', 'sns:*', 'cloudwatch:*'],
      Resource: [
        `arn:aws:sqs:${region}:${account}:firmivra-*`,
        `arn:aws:events:${region}:${account}:rule/firmivra-*`,
        `arn:aws:sns:${region}:${account}:firmivra-*`,
        `arn:aws:cloudwatch:${region}:${account}:alarm:firmivra-*`,
      ],
    });
    // GuardDuty only for plans: never List, and none of the detector APIs.
    const guardduty = boundary.Statement.flatMap((s) => s.Action).filter((a) =>
      a.startsWith('guardduty:'),
    );
    expect(guardduty).toEqual([
      'guardduty:*MalwareProtectionPlan',
      'guardduty:TagResource',
      'guardduty:UntagResource',
    ]);
  });

  it('let both create only the listed service-linked roles, the Cognito SES role among them', () => {
    expect(SERVICE_LINKED_ROLES).toEqual([
      'ecs.amazonaws.com',
      'elasticloadbalancing.amazonaws.com',
      'rds.amazonaws.com',
      'vpcorigin.cloudfront.amazonaws.com',
      'email.cognito-idp.amazonaws.com',
    ]);
    for (const doc of [exec, boundary]) {
      const statements = doc.Statement.filter((s) =>
        s.Action.includes('iam:CreateServiceLinkedRole'),
      );
      expect(statements).toEqual([
        {
          Sid: 'ServiceLinkedRoles',
          Effect: 'Allow',
          Action: ['iam:CreateServiceLinkedRole'],
          Resource: `arn:aws:iam::${account}:role/aws-service-role/*`,
          Condition: { StringEquals: { 'iam:AWSServiceName': SERVICE_LINKED_ROLES } },
        },
      ]);
    }
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
