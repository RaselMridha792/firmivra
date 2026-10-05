import type { App } from 'aws-cdk-lib';
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
  const email = new EmailStack(app, id('email'), {
    env,
    config,
    description: 'Firmivra: SES domain identity, DKIM, MAIL FROM, DMARC',
  });
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
  return { network, data, auth, email, app: appStack, ci };
}
