import { Validations } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';
import { type EnvConfig, resourceName } from './config';
import type { createStacks } from './stacks';

/**
 * cdk-nag (AWS Solutions) findings accepted on purpose, each with its reason.
 * Everything not listed here fails `cdk synth`. Prod gets its own review (Multi-AZ, WAF, logging).
 */
export function addNagSuppressions(
  stacks: ReturnType<typeof createStacks>,
  config: EnvConfig,
): void {
  const ack = (scope: IConstruct, rule: string, reason: string) =>
    Validations.of(scope).acknowledge({ id: `AwsSolutions::AwsSolutions-${rule}`, reason });
  const { data, auth, app, ci } = stacks;
  const arn = `${config.region}:${config.account}`;

  // ---------- Data ----------
  ack(data.db, 'RDS3', 'Dev runs single-AZ to keep cost down (decided Oct 5); prod is Multi-AZ.');
  ack(
    data.db,
    'RDS11',
    'Default port 5432: the database is in isolated subnets and only the API security group can reach it.',
  );
  ack(
    data.db,
    'SMG4',
    'Owner password rotation needs a rotation Lambda with a Secrets Manager endpoint ($7/month without a NAT gateway). Rotated by hand in dev.',
  );
  ack(
    data.appDbSecret,
    'SMG4',
    'The migration task writes this password into the database; rotating means a new value and a migration run. Done by hand in dev.',
  );

  // ---------- Auth ----------
  for (const p of [auth.staff, auth.clients, auth.admins]) {
    ack(
      p.pool,
      'COG1',
      'docs/AUTH-DESIGN.md: at least 12 characters with upper, lower and number; symbols not required (NIST 800-63B favours length over composition rules). Compromised-password checks are on.',
    );
  }
  ack(
    auth.clients.pool,
    'COG2',
    'docs/AUTH-DESIGN.md: MFA is optional for clients (TOTP), required for staff and Super Admin.',
  );
  ack(
    auth.clientSecrets,
    'SMG4',
    'Cognito app client secrets cannot be rotated in place; a new client is created when needed.',
  );
  ack(
    auth,
    'IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
    'CDK-managed custom resource that reads the app client secrets once at deploy time; it only writes its own logs.',
  );

  // ---------- App ----------
  ack(
    app.cluster,
    'ECS4',
    'Container Insights costs a few dollars a month per cluster; off in dev, on in prod.',
  );
  const apiTask = app.node.findChild('ApiTask');
  for (const task of [apiTask, app.node.findChild('WebTask'), app.migrateTask]) {
    ack(
      task,
      'ECS2',
      'Only non-secret settings are plain environment variables; passwords and client secrets come from Secrets Manager.',
    );
    ack(
      task,
      'IAM5[Resource::*]',
      'ecr:GetAuthorizationToken has no resource-level permissions; on the API role also sns:Publish to a phone number (SMS), which has no resource ARN.',
    );
  }
  ack(
    apiTask,
    `IAM5[Resource::arn:aws:s3:::${resourceName(config, 'documents')}-${config.account}/tenant/*]`,
    'Object keys are per business under tenant/<businessId>/; access is limited to that prefix.',
  );
  ack(
    app.node.findChild('OriginVerifySecret'),
    'SMG4',
    'Rotating the CloudFront origin header needs CloudFront and the listener updated together; done by redeploying the app stack.',
  );
  ack(
    app.node.findChild('AlbLogs'),
    'S1',
    'This bucket is itself the access-log destination for the load balancer.',
  );
  for (const distribution of Object.values(app.distributions)) {
    ack(
      distribution,
      'CFR1',
      'No geo restriction: firms are in the US and the team works from Bangladesh.',
    );
    ack(
      distribution,
      'CFR2',
      'AWS WAF (about $8/month per web ACL) is not used in dev; prod gets a web ACL.',
    );
    ack(
      distribution,
      'CFR3',
      'Dev relies on the load balancer access logs; CloudFront logs are enabled in prod.',
    );
    if (!config.customDomain) {
      ack(
        distribution,
        'CFR4',
        'The default *.cloudfront.net certificate does not allow choosing the minimum TLS version; TLSv1.2_2021 is set once the custom domain certificate is used.',
      );
    }
  }

  // ---------- CI ----------
  const role = ci.deployRole;
  ack(role, 'IAM5[Resource::*]', 'ecr:GetAuthorizationToken has no resource-level permissions.');
  ack(
    role,
    `IAM5[Resource::arn:aws:ecs:${arn}:task-definition/${resourceName(config, 'migrate')}:*]`,
    'Any revision of the migration task definition (each deploy registers a new one).',
  );
  ack(
    role,
    `IAM5[Resource::arn:aws:ecs:${arn}:task/${resourceName(config, 'cluster')}/*]`,
    "Task ids are generated per run; limited to this environment's cluster.",
  );
  ack(
    role,
    `IAM5[Resource::arn:aws:cloudformation:${arn}:stack/firmivra-${config.envName}-*/*]`,
    "Read outputs of this environment's stacks only (stack ids end in a generated suffix).",
  );
}
