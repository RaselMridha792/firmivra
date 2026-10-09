import { type App, Aspects, type IAspect, PermissionsBoundary, RemovalPolicy } from 'aws-cdk-lib';
import { CfnLogGroup } from 'aws-cdk-lib/aws-logs';
import type { IConstruct } from 'constructs';
import { PERMISSIONS_BOUNDARY_NAME } from './bootstrap-policies';
import { type EnvConfig, resourceName } from './config';
import { AppStack } from './stacks/app-stack';
import { AuthStack } from './stacks/auth-stack';
import { CiStack } from './stacks/ci-stack';
import { DataStack } from './stacks/data-stack';
import { EmailStack } from './stacks/email-stack';
import { NetworkStack } from './stacks/network-stack';

/** All stacks of one environment: firmivra-<env>-network, -data, -auth, -email, -app, -ci. */
export function createStacks(app: App, config: EnvConfig) {
  // Every role our stacks create carries the boundary; the CDK execution role refuses roles without it.
  const common = {
    env: { account: config.account, region: config.region },
    permissionsBoundary: PermissionsBoundary.fromName(PERMISSIONS_BOUNDARY_NAME),
  };
  const id = (n: string) => resourceName(config, n);

  const network = new NetworkStack(app, id('network'), {
    ...common,
    config,
    description: 'Firmivra: VPC, subnets, security groups',
  });
  const data = new DataStack(app, id('data'), {
    ...common,
    config,
    vpc: network.vpc,
    dbSg: network.dbSg,
    terminationProtection: true,
    description: 'Firmivra: PostgreSQL, database secrets, documents bucket and key',
  });
  const auth = new AuthStack(app, id('auth'), {
    ...common,
    config,
    terminationProtection: true,
    description: 'Firmivra: Cognito user pools (staff, clients, admins)',
  });
  // SES needs a verified domain: only with a custom domain (emails are logged until then).
  const email = config.customDomain
    ? new EmailStack(app, id('email'), {
        ...common,
        config,
        description: 'Firmivra: SES domain identity, DKIM, MAIL FROM, DMARC',
      })
    : undefined;
  // Cognito sends its reset codes through the email stack's SES identity (by name, see config).
  if (email) auth.addStackDependency(email, 'Cognito sends through the email stack SES identity');
  const appStack = new AppStack(app, id('app'), {
    ...common,
    config,
    network,
    data,
    auth,
    email,
    description: 'Firmivra: ECR, ECS services, load balancer, CloudFront, DNS',
  });
  const ci = new CiStack(app, id('ci'), {
    ...common,
    config,
    app: appStack,
    description: 'Firmivra: GitHub OIDC deploy role',
  });
  const all = [network, data, auth, email, appStack, ci];
  for (const stack of all) {
    if (stack) Aspects.of(stack).add(new LogGroupRules(config.logRetentionDays));
  }
  return { network, data, auth, email, app: appStack, ci };
}

/**
 * Every log group keeps logs for the configured days and is deleted with its stack, also the
 * ones CDK helpers create (by default those keep logs for two years and are left behind).
 */
class LogGroupRules implements IAspect {
  constructor(private readonly days: number) {}

  visit(node: IConstruct): void {
    if (!(node instanceof CfnLogGroup)) return;
    node.retentionInDays = this.days;
    node.applyRemovalPolicy(RemovalPolicy.DESTROY);
  }
}
