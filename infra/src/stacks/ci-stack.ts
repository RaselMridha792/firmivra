import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as ecr from 'aws-cdk-lib/aws-ecr';
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
/** The pull-through cache's repository prefix: `<registry>/ecr-public/docker/library/node:22-alpine`. */
export const ECR_PUBLIC_CACHE_PREFIX = 'ecr-public';

export class CiStack extends Stack {
  readonly deployRole: iam.Role;
  readonly pullRequestRole: iam.Role;

  constructor(scope: Construct, id: string, props: CiStackProps) {
    super(scope, id, props);
    const { config, app } = props;
    const { owner, ownerId, repo: name, repoId } = config.github;
    // Immutable OIDC subject (repo setting "use_immutable_subject"): owner and repo with their ids.
    const repo = `repo:${owner}@${ownerId}/${name}@${repoId}`;

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

    // Base images (node, postgres) through our own ECR: the anonymous public.ecr.aws limit
    // ("toomanyrequests: Data limit exceeded") failed CI and Deploy dev. A pull-through cache needs
    // no upstream credentials for ECR Public; the first pull of a tag creates the repository from
    // the template below and stores the image, later pulls come from our registry.
    new ecr.CfnPullThroughCacheRule(this, 'EcrPublicCache', {
      ecrRepositoryPrefix: ECR_PUBLIC_CACHE_PREFIX,
      upstreamRegistry: 'ecr-public',
      upstreamRegistryUrl: 'public.ecr.aws',
    });
    new ecr.CfnRepositoryCreationTemplate(this, 'EcrPublicCacheTemplate', {
      prefix: ECR_PUBLIC_CACHE_PREFIX,
      appliedFor: ['PULL_THROUGH_CACHE'],
      description: 'Cached public base images (node, postgres): keep the newest few',
      imageTagMutability: 'MUTABLE',
      lifecyclePolicy: JSON.stringify({
        rules: [
          {
            rulePriority: 1,
            description: 'Keep the 5 newest images per repository',
            selection: { tagStatus: 'any', countType: 'imageCountMoreThan', countNumber: 5 },
            action: { type: 'expire' },
          },
        ],
      }),
    });
    const cachedImages = `arn:aws:ecr:${this.region}:${this.account}:repository/${ECR_PUBLIC_CACHE_PREFIX}/*`;
    const pullCached = new iam.PolicyStatement({
      sid: 'PullCachedPublicImages',
      actions: [
        'ecr:BatchCheckLayerAvailability',
        'ecr:BatchGetImage',
        'ecr:GetDownloadUrlForLayer',
        // The first pull of a tag: create the repository and import the image from upstream.
        'ecr:BatchImportUpstreamImage',
        'ecr:CreateRepository',
      ],
      resources: [cachedImages],
    });
    role.addToPolicy(pullCached);

    // Pull requests of this repo: base images from the cache, nothing else. A pull request has
    // no GitHub environment, so it cannot use the deploy role. Fork pull requests get no OIDC
    // token at all (GitHub withholds id-token from forks), so they fall back to another mirror.
    this.pullRequestRole = new iam.Role(this, 'PullRequestRole', {
      roleName: resourceName(config, 'github-ci-pull'),
      description:
        'GitHub Actions pull requests of the Firmivra repo: pull cached base images only',
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(github.oidcProviderArn, {
        StringEquals: {
          'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          'token.actions.githubusercontent.com:sub': `${repo}:pull_request`,
        },
      }),
    });
    this.pullRequestRole.addToPolicy(
      new iam.PolicyStatement({ actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }),
    );
    this.pullRequestRole.addToPolicy(pullCached);

    new CfnOutput(this, 'PullRequestRoleArn', { value: this.pullRequestRole.roleArn });
    new CfnOutput(this, 'BaseImageRegistry', {
      value: `${this.account}.dkr.ecr.${this.region}.amazonaws.com/${ECR_PUBLIC_CACHE_PREFIX}`,
    });
  }
}
