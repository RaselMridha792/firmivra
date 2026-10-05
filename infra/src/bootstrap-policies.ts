// The two IAM managed policies around `cdk deploy` (Step 8, docs/SETUP-LOG.md). Rasel creates
// and updates them with the AWS CLI (scripts/bootstrap-policies.ts prints them); they are not in
// a stack, because CloudFormation must not be able to change its own limits.
//
// - firmivra-cdk-cfn-exec: replaces AdministratorAccess on the CDK CloudFormation execution role.
//   Only the services and resource names our stacks use.
// - firmivra-permissions-boundary: on the execution role and on every role our stacks create.
//   Caps what any of them can do, and stops a role from creating a role without this boundary.
import { DEV_FIRMIVRA_COM } from './config';

export const CFN_EXEC_POLICY_NAME = 'firmivra-cdk-cfn-exec';
export const PERMISSIONS_BOUNDARY_NAME = 'firmivra-permissions-boundary';
const CDK_QUALIFIER = 'hnb659fds';

interface Statement {
  Sid: string;
  Effect: 'Allow' | 'Deny';
  Action: string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}
export interface PolicyDocument {
  Version: '2012-10-17';
  Statement: Statement[];
}

/** Every hosted zone a config can switch to (customDomain); the policy may change records only there. */
const HOSTED_ZONE_IDS = [DEV_FIRMIVRA_COM.hostedZoneId];

/** Service-linked roles that our resources need the first time they are created. */
const SERVICE_LINKED_ROLES = [
  'ecs.amazonaws.com',
  'elasticloadbalancing.amazonaws.com',
  'rds.amazonaws.com',
  'vpcorigin.cloudfront.amazonaws.com',
];

const serviceLinkedRoles = (resource: string): Statement => ({
  Sid: 'ServiceLinkedRoles',
  Effect: 'Allow',
  Action: ['iam:CreateServiceLinkedRole'],
  Resource: resource,
  Condition: { StringEquals: { 'iam:AWSServiceName': SERVICE_LINKED_ROLES } },
});

function arns(account: string, region: string) {
  const policy = (name: string) => `arn:aws:iam::${account}:policy/${name}`;
  return {
    boundary: policy(PERMISSIONS_BOUNDARY_NAME),
    guardrails: [policy(PERMISSIONS_BOUNDARY_NAME), policy(CFN_EXEC_POLICY_NAME)],
    roles: `arn:aws:iam::${account}:role/firmivra-*`,
    serviceLinkedRoles: `arn:aws:iam::${account}:role/aws-service-role/*`,
    cdkRoles: `arn:aws:iam::${account}:role/cdk-${CDK_QUALIFIER}-*`,
    githubOidc: `arn:aws:iam::${account}:oidc-provider/token.actions.githubusercontent.com`,
    // Matches the buckets and the objects in them.
    buckets: 'arn:aws:s3:::firmivra-*',
    cdkAssets: `arn:aws:s3:::cdk-${CDK_QUALIFIER}-assets-${account}-${region}/*`,
    secrets: `arn:aws:secretsmanager:${region}:${account}:secret:firmivra/*`,
  };
}

/** The CloudFormation execution role's permissions: what our stacks create, by name where AWS allows. */
export function cfnExecPolicy(account: string, region: string): PolicyDocument {
  const a = arns(account, region);
  const r = (service: string, resource: string) =>
    `arn:aws:${service}:${region}:${account}:${resource}`;
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'Read',
        Effect: 'Allow',
        Action: [
          'acm:Describe*',
          'acm:List*',
          'cloudfront:Get*',
          'cloudfront:List*',
          'cognito-idp:Describe*',
          'cognito-idp:Get*',
          'cognito-idp:List*',
          'ec2:Describe*',
          'ecr:Describe*',
          'ecs:Describe*',
          'ecs:List*',
          'elasticloadbalancing:Describe*',
          'iam:Get*',
          'iam:List*',
          'kms:Describe*',
          'kms:Get*',
          'kms:List*',
          'lambda:Get*',
          'lambda:List*',
          'logs:Describe*',
          'logs:ListTagsForResource',
          'rds:Describe*',
          'rds:ListTagsForResource',
          'route53:Get*',
          'route53:List*',
          'secretsmanager:GetRandomPassword',
          'ses:Get*',
          'ses:List*',
        ],
        Resource: '*',
      },
      {
        Sid: 'StackOutputsAndBootstrapVersion',
        Effect: 'Allow',
        Action: ['cloudformation:DescribeStacks', 'ssm:GetParameters'],
        Resource: [
          r('cloudformation', 'stack/firmivra-*/*'),
          r('ssm', `parameter/cdk-bootstrap/${CDK_QUALIFIER}/version`),
        ],
      },
      {
        Sid: 'Network',
        Effect: 'Allow',
        Action: [
          'ec2:*Vpc',
          'ec2:*VpcAttribute',
          'ec2:*VpcEndpoint*',
          'ec2:*Subnet*',
          'ec2:*RouteTable*',
          'ec2:CreateRoute',
          'ec2:DeleteRoute',
          'ec2:ReplaceRoute',
          'ec2:*InternetGateway*',
          'ec2:*SecurityGroup*',
          'ec2:*FlowLogs',
          'ec2:CreateTags',
          'ec2:DeleteTags',
        ],
        Resource: '*',
      },
      {
        Sid: 'Services',
        Effect: 'Allow',
        Action: ['acm:*', 'cloudfront:*', 'cognito-idp:*', 'ecs:*', 'kms:*', 'ses:*'],
        Resource: '*',
      },
      {
        Sid: 'NamedResources',
        Effect: 'Allow',
        Action: [
          'ecr:*',
          'elasticloadbalancing:*',
          'lambda:*',
          'logs:*',
          'rds:*',
          's3:*',
          'secretsmanager:*',
        ],
        Resource: [
          r('ecr', 'repository/firmivra-*'),
          r('elasticloadbalancing', '*firmivra-*'),
          r('lambda', 'function:firmivra-*'),
          r('logs', 'log-group:/firmivra/*'),
          r('logs', 'log-group:/aws/lambda/firmivra-*'),
          r('rds', '*:firmivra-*'),
          r('rds', 'pg:default*'),
          r('rds', 'og:default*'),
          a.buckets,
          a.secrets,
        ],
      },
      { Sid: 'LambdaCode', Effect: 'Allow', Action: ['s3:GetObject'], Resource: a.cdkAssets },
      {
        Sid: 'DnsRecords',
        Effect: 'Allow',
        Action: ['route53:ChangeResourceRecordSets', 'route53:ChangeTagsForResource'],
        Resource: HOSTED_ZONE_IDS.map((id) => `arn:aws:route53:::hostedzone/${id}`),
      },
      {
        Sid: 'Roles',
        Effect: 'Allow',
        Action: [
          'iam:DeleteRole',
          'iam:UpdateRole',
          'iam:UpdateRoleDescription',
          'iam:UpdateAssumeRolePolicy',
          'iam:TagRole',
          'iam:UntagRole',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PassRole',
        ],
        Resource: a.roles,
      },
      {
        Sid: 'RolesOnlyWithBoundary',
        Effect: 'Allow',
        Action: ['iam:CreateRole', 'iam:PutRolePermissionsBoundary'],
        Resource: a.roles,
        Condition: { StringEquals: { 'iam:PermissionsBoundary': a.boundary } },
      },
      {
        Sid: 'OnlyLambdaLoggingManagedPolicy',
        Effect: 'Allow',
        Action: ['iam:AttachRolePolicy'],
        Resource: a.roles,
        Condition: {
          ArnEquals: {
            'iam:PolicyARN': 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
          },
        },
      },
      {
        Sid: 'GitHubOidcProvider',
        Effect: 'Allow',
        Action: [
          'iam:CreateOpenIDConnectProvider',
          'iam:DeleteOpenIDConnectProvider',
          'iam:UpdateOpenIDConnectProviderThumbprint',
          'iam:AddClientIDToOpenIDConnectProvider',
          'iam:RemoveClientIDFromOpenIDConnectProvider',
          'iam:TagOpenIDConnectProvider',
          'iam:UntagOpenIDConnectProvider',
        ],
        Resource: a.githubOidc,
      },
      serviceLinkedRoles(a.serviceLinkedRoles),
    ],
  };
}

/**
 * The boundary on the execution role and on every role our stacks create: the services we use,
 * IAM only for firmivra-* roles, S3 and secrets only for firmivra-* names, and no way around it.
 */
export function permissionsBoundary(account: string, region: string): PolicyDocument {
  const a = arns(account, region);
  return {
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'Services',
        Effect: 'Allow',
        Action: [
          'acm:*',
          'cloudfront:*',
          'cognito-idp:*',
          'ec2:*',
          'ecr:*',
          'ecs:*',
          'elasticloadbalancing:*',
          'kms:*',
          'lambda:*',
          'logs:*',
          'rds:*',
          'route53:*',
          'ses:*',
          'sns:Publish',
          'cloudformation:Describe*',
          'cloudformation:Get*',
          'cloudformation:List*',
          'ssm:GetParameter*',
          'sts:GetCallerIdentity',
          'iam:Get*',
          'iam:List*',
          'secretsmanager:GetRandomPassword',
        ],
        Resource: '*',
      },
      {
        Sid: 'FirmivraNames',
        Effect: 'Allow',
        Action: ['iam:*', 's3:*', 'secretsmanager:*'],
        Resource: [a.roles, a.githubOidc, a.buckets, a.secrets],
      },
      serviceLinkedRoles(a.serviceLinkedRoles),
      { Sid: 'LambdaCode', Effect: 'Allow', Action: ['s3:GetObject'], Resource: a.cdkAssets },
      { Sid: 'CdkDeployRoles', Effect: 'Allow', Action: ['sts:AssumeRole'], Resource: a.cdkRoles },
      {
        Sid: 'DenyRolesWithoutThisBoundary',
        Effect: 'Deny',
        Action: ['iam:CreateRole', 'iam:PutRolePermissionsBoundary'],
        Resource: '*',
        Condition: { StringNotEquals: { 'iam:PermissionsBoundary': a.boundary } },
      },
      {
        Sid: 'DenyBoundaryRemoval',
        Effect: 'Deny',
        Action: ['iam:DeleteRolePermissionsBoundary'],
        Resource: '*',
      },
      {
        Sid: 'DenyGuardrailChanges',
        Effect: 'Deny',
        Action: [
          'iam:CreatePolicyVersion',
          'iam:DeletePolicy',
          'iam:DeletePolicyVersion',
          'iam:SetDefaultPolicyVersion',
        ],
        Resource: a.guardrails,
      },
      {
        Sid: 'DenyCdkBootstrapRoleChanges',
        Effect: 'Deny',
        Action: [
          'iam:AttachRolePolicy',
          'iam:DetachRolePolicy',
          'iam:PutRolePolicy',
          'iam:DeleteRolePolicy',
          'iam:UpdateAssumeRolePolicy',
          'iam:DeleteRole',
        ],
        Resource: a.cdkRoles,
      },
    ],
  };
}

/** IAM managed policies are limited to 6,144 characters, not counting white space. */
export const policySize = (doc: PolicyDocument) => JSON.stringify(doc).length;
