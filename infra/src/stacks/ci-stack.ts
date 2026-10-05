import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import { type EnvConfig, resourceName } from '../config';
import type { AppStack } from './app-stack';

export interface CiStackProps extends StackProps {
  config: EnvConfig;
  app: AppStack;
}

/**
 * GitHub Actions deploy access without stored AWS keys (OIDC).
 * Trust: only jobs of RaselMridha792/firmivra running in the GitHub environments `dev` or `prod`
 * (docs/SETUP-LOG.md). GitHub limits those environments to `main` and `v*` tags.
 * Permissions: push images to this environment's ECR repositories, run the migration task,
 * and `cdk deploy` through the CDK bootstrap roles.
 */
export class CiStack extends Stack {
  readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);
    const { config, app } = props;
    const repo = `repo:${config.github.owner}/${config.github.repo}`;

    const github = new iam.OidcProviderNative(this, 'GitHubOidc', {
      url: 'https://token.actions.githubusercontent.com',
      clientIds: ['sts.amazonaws.com'],
    });

    this.deployRole = new iam.Role(this, 'DeployRole', {
      roleName: resourceName(config, 'github-deploy'),
      description: 'GitHub Actions deploys (environments dev and prod of the Firmivra repo only)',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(github.oidcProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': [
            `${repo}:environment:dev`,
            `${repo}:environment:prod`,
          ],
        },
      }),
    });
    const role = this.deployRole;

    // Images
    role.addToPolicy(
      new iam.PolicyStatement({ actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }),
    );
    for (const repository of Object.values(app.repositories)) repository.grantPullPush(role);

    // cdk deploy: through the bootstrap roles (qualifier hnb659fds)
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['sts:AssumeRole'],
        resources: ['deploy', 'file-publishing', 'image-publishing', 'lookup'].map(
          (r) =>
            `arn:aws:iam::${this.account}:role/cdk-hnb659fds-${r}-role-${this.account}-${this.region}`,
        ),
      }),
    );

    // Migration task
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:RunTask'],
        resources: [
          `arn:aws:ecs:${this.region}:${this.account}:task-definition/${app.migrateTask.family}:*`,
        ],
        conditions: { ArnEquals: { 'ecs:cluster': app.cluster.clusterArn } },
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:DescribeTasks'],
        resources: [
          `arn:aws:ecs:${this.region}:${this.account}:task/${resourceName(config, 'cluster')}/*`,
        ],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [
          app.migrateTask.taskRole.roleArn,
          app.migrateTask.obtainExecutionRole().roleArn,
        ],
      }),
    );
    app.migrateLogGroup.grantRead(role);

    // Read stack outputs (cluster, subnets, security group)
    role.addToPolicy(
      new iam.PolicyStatement({
        actions: ['cloudformation:DescribeStacks'],
        resources: [
          `arn:aws:cloudformation:${this.region}:${this.account}:stack/firmivra-${config.envName}-*/*`,
        ],
      }),
    );
  }
}
