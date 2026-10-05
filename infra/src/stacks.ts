import { type App, Aspects, type IAspect, RemovalPolicy } from 'aws-cdk-lib';
import { CfnLogGroup } from 'aws-cdk-lib/aws-logs';
import type { IConstruct } from 'constructs';
import { type EnvConfig, resourceName } from './config';
import { AppStack } from './stacks/app-stack';
import { AuthStack } from './stacks/auth-stack';
import { CiStack } from './stacks/ci-stack';
import { DataStack } from './stacks/data-stack';
import { EmailStack } from './stacks/email-stack';
import { NetworkStack } from './stacks/network-stack';

/** All stacks of one environment: firmivra-<env>-network, -data, -auth, -email, -app, -ci. */
export function createStacks(app: App, config: EnvConfig, imageTag?: string) {
  const env = { account: config.account, region: config.region };
  const id = (n: string) => resourceName(config, n);

  const network = new NetworkStack(app, id('network'), {
    env,
    config,
    description: 'Firmivra: VPC, subnets, security groups',
  });
  const data = new DataStack(app, id('data'), {
    env,
    config,
    vpc: network.vpc,
    dbSg: network.dbSg,
    terminationProtection: true,
    description: 'Firmivra: PostgreSQL, database secrets, documents bucket and key',
  });
  const auth = new AuthStack(app, id('auth'), {
    env,
    config,
    terminationProtection: true,
    description: 'Firmivra: Cognito user pools (staff, clients, admins)',
  });
  // SES needs a verified domain: only with a custom domain (emails are logged until then).
  const email = config.customDomain
    ? new EmailStack(app, id('email'), {
        env,
        config,
        description: 'Firmivra: SES domain identity, DKIM, MAIL FROM, DMARC',
      })
    : undefined;
  const appStack = new AppStack(app, id('app'), {
    env,
    config,
    network,
    data,
    auth,
    email,
    imageTag,
    description: 'Firmivra: ECR, ECS services, load balancer, CloudFront, DNS',
  });
  const ci = new CiStack(app, id('ci'), {
    env,
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
