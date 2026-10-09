import {
  CfnCondition,
  CfnOutput,
  CfnParameter,
  Duration,
  Fn,
  RemovalPolicy,
  Stack,
  type StackProps,
  Token,
} from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import type { Construct } from 'constructs';
import { type EnvConfig, resourceName } from '../config';
import { firmKeyStatements } from '../firm-key-policy';
import type { AuthStack } from './auth-stack';
import type { DataStack } from './data-stack';
import type { EmailStack } from './email-stack';
import { MalwareScan } from './malware-scan';
import type { NetworkStack } from './network-stack';

export type Site = 'admin' | 'app' | 'portal';
const SITES: Site[] = ['admin', 'app', 'portal'];

export interface AppStackProps extends StackProps {
  config: EnvConfig;
  network: NetworkStack;
  data: DataStack;
  auth: AuthStack;
  /** Only with a custom domain; without it the API logs emails instead of sending them. */
  email?: EmailStack;
}

/** Value of the image tag parameters before the first image exists: services run 0 tasks. */
export const NO_IMAGE = 'none';

/**
 * The running app: ECR repositories, an ECS cluster on Fargate (Spot in dev), the API and web
 * services behind one internal load balancer, a one-off migration task, and one CloudFront
 * distribution per site (admin, app, portal), each sending /api/* to the API.
 * CloudFront reaches the load balancer through a VPC origin: no public load balancer, no
 * certificate needed on it. Without config.customDomain the sites use their *.cloudfront.net
 * domains; with it they get the certificate, aliases and DNS records.
 * Also the alarm topic, and GuardDuty's malware scan of uploads with its result queue (malware-scan.ts).
 */
export class AppStack extends Stack {
  readonly repositories: Record<'api' | 'web' | 'migrate', ecr.Repository>;
  readonly cluster: ecs.Cluster;
  readonly migrateTask: ecs.FargateTaskDefinition;
  readonly migrateLogGroup: logs.LogGroup;
  readonly distributions: Record<Site, cloudfront.Distribution>;
  /** Host name of each site (custom host, or the CloudFront domain). */
  readonly siteHosts: Record<Site, string>;
  /** Alarm emails (Rasel subscribes by CLI after the deploy; no address in the repo). */
  readonly alarmTopic: sns.Topic;
  readonly malwareScan: MalwareScan;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { config, network, data, auth, email } = props;
    const name = (n: string) => resourceName(config, n);
    const domain = config.customDomain;

    // ---------- Running release ----------
    // The stack's parameters own the running image tags (commit shas). Only deploy-dev.yml sets them:
    // MigrateImageTag first, then ImageTag after the migration task succeeds. A cdk deploy without
    // --parameters keeps the previous values, so an infra change never swaps or stops the images.
    const tagParameter = (id: string, description: string) =>
      new CfnParameter(this, id, {
        type: 'String',
        default: NO_IMAGE,
        allowedPattern: `^(${NO_IMAGE}|[0-9a-f]{40})$`,
        description,
      }).valueAsString;
    const tag = tagParameter('ImageTag', 'Commit sha of the api and web images (deploy-dev.yml)');
    const migrateTag = tagParameter(
      'MigrateImageTag',
      'Commit sha of the migration image (deploy-dev.yml)',
    );
    const hasImage = new CfnCondition(this, 'HasImage', {
      expression: Fn.conditionNot(Fn.conditionEquals(tag, NO_IMAGE)),
    });
    const desiredCount = Token.asNumber(Fn.conditionIf(hasImage.logicalId, config.task.count, 0));

    // ---------- Images ----------
    const repository = (key: 'api' | 'web' | 'migrate') =>
      new ecr.Repository(this, `${key}Repository`, {
        repositoryName: name(key),
        imageScanOnPush: true,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        lifecycleRules: [{ maxImageCount: 10, description: 'Keep the last 10 images' }],
        removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
      });
    this.repositories = {
      api: repository('api'),
      web: repository('web'),
      migrate: repository('migrate'),
    };

    // ---------- Internal load balancer, only reachable through CloudFront ----------
    const originSecret = new secretsmanager.Secret(this, 'OriginVerifySecret', {
      secretName: `firmivra/${config.envName}/cloudfront/origin-verify`,
      description: 'Header value CloudFront sends and the load balancer requires',
      generateSecretString: { excludePunctuation: true, passwordLength: 48 },
    });
    const originHeader = originSecret.secretValue.unsafeUnwrap();

    const albLogs = new s3.Bucket(this, 'AlbLogs', {
      bucketName: `${name('alb-logs')}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(30) }],
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: name('alb'),
      vpc: network.vpc,
      internetFacing: false,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroup: network.albSg,
      dropInvalidHeaderFields: true,
    });
    alb.logAccessLogs(albLogs, 'alb');
    const listener = alb.addListener('Http', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Forbidden',
      }),
    });

    // ---------- CloudFront: one distribution per site ----------
    const vpcOrigin = new cloudfront.VpcOrigin(this, 'AlbVpcOrigin', {
      vpcOriginName: name('alb'),
      endpoint: cloudfront.VpcOriginEndpoint.applicationLoadBalancer(alb),
      httpPort: 80,
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
    });
    const certificate = domain
      ? new acm.Certificate(this, 'Certificate', {
          domainName: domain.zoneName,
          subjectAlternativeNames: [`*.${domain.zoneName}`],
          validation: acm.CertificateValidation.fromDns(
            route53.PublicHostedZone.fromHostedZoneAttributes(this, 'Zone', {
              hostedZoneId: domain.hostedZoneId,
              zoneName: domain.zoneName,
            }),
          ),
        })
      : undefined;

    const distribution = (site: Site) => {
      const origin = origins.VpcOrigin.withVpcOrigin(vpcOrigin, {
        customHeaders: { 'X-Origin-Verify': originHeader },
        readTimeout: Duration.seconds(30),
      });
      const dynamic: cloudfront.BehaviorOptions = {
        origin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        // Host is forwarded: the web app picks the site from it (ADMIN_HOST, APP_HOST, PORTAL_HOST).
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
      };
      return new cloudfront.Distribution(this, `${site}Distribution`, {
        comment: name(site),
        ...(domain && certificate
          ? {
              domainNames: [domain.hosts[site]],
              certificate,
              minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
            }
          : {}),
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
        defaultBehavior: dynamic,
        additionalBehaviors: {
          '/api/*': dynamic,
          '/_next/static/*': {
            origin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
          },
        },
      });
    };
    this.distributions = {
      admin: distribution('admin'),
      app: distribution('app'),
      portal: distribution('portal'),
    };
    this.siteHosts = {
      admin: domain?.hosts.admin ?? this.distributions.admin.distributionDomainName,
      app: domain?.hosts.app ?? this.distributions.app.distributionDomainName,
      portal: domain?.hosts.portal ?? this.distributions.portal.distributionDomainName,
    };
    if (domain) {
      const zone = route53.PublicHostedZone.fromHostedZoneAttributes(this, 'SitesZone', {
        hostedZoneId: domain.hostedZoneId,
        zoneName: domain.zoneName,
      });
      for (const site of SITES) {
        const target = route53.RecordTarget.fromAlias(
          new targets.CloudFrontTarget(this.distributions[site]),
        );
        new route53.ARecord(this, `${site}A`, { zone, recordName: domain.hosts[site], target });
        new route53.AaaaRecord(this, `${site}Aaaa`, {
          zone,
          recordName: domain.hosts[site],
          target,
        });
      }
    }

    const sites = {
      ADMIN_BASE_URL: `https://${this.siteHosts.admin}`,
      APP_BASE_URL: `https://${this.siteHosts.app}`,
      PORTAL_BASE_URL: `https://${this.siteHosts.portal}`,
    };
    const database = {
      DB_HOST: data.db.dbInstanceEndpointAddress,
      DB_PORT: data.db.dbInstanceEndpointPort,
      DB_NAME: 'firmivra',
    };
    const platform = {
      cpuArchitecture: ecs.CpuArchitecture.X86_64,
      operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    };

    // ---------- Cluster and logs ----------
    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: name('cluster'),
      vpc: network.vpc,
      enableFargateCapacityProviders: true,
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });
    const logGroup = (key: string) =>
      new logs.LogGroup(this, `${key}Logs`, {
        logGroupName: `/firmivra/${config.envName}/${key}`,
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      });
    const apiLogs = logGroup('api');

    // ---------- Alarms and the malware scan of uploads (R1 step 19) ----------
    // Not encrypted: CloudWatch and EventBridge cannot publish to a topic under aws/sns, and a
    // customer managed key is $1/month. It carries alarm states and plan status (names, ids and
    // codes), never firm or client data. Revisit for prod.
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', {
      topicName: name('alarms'),
      displayName: `Firmivra ${config.envName} alarms`,
      enforceSSL: true,
    });
    // A topic policy replaces SNS's default one, so CloudWatch needs its own statement.
    this.alarmTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'CloudWatchAlarms',
        principals: [new iam.ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.alarmTopic.topicArn],
        conditions: {
          ArnLike: {
            'aws:SourceArn': `arn:aws:cloudwatch:${config.region}:${config.account}:alarm:${name('*')}`,
          },
          StringEquals: { 'aws:SourceAccount': config.account },
        },
      }),
    );
    this.malwareScan = new MalwareScan(this, 'MalwareScan', {
      config,
      bucketName: `${name('documents')}-${this.account}`,
      documentsKey: data.documentsKey,
      alarmTopic: this.alarmTopic,
      apiLogs,
    });

    // ---------- API ----------
    // R4 submit: HMAC-SHA256 of the EIN into firm_applications.ein_hash (the duplicate-EIN check).
    // Never rotate it and never change its name or generation settings: CloudFormation would make a
    // new value and every stored hash would stop matching. Kept if the stack is deleted.
    // 64 hex characters: 32 random bytes.
    const einHashKey = new secretsmanager.Secret(this, 'EinHashKey', {
      secretName: `firmivra/${config.envName}/firm-applications/ein-hash-key`,
      description: 'HMAC key for firm_applications.ein_hash (R4). Never rotate or regenerate.',
      generateSecretString: {
        passwordLength: 64,
        excludePunctuation: true,
        excludeUppercase: true,
        excludeCharacters: 'ghijklmnopqrstuvwxyz',
        includeSpace: false,
      },
      removalPolicy: RemovalPolicy.RETAIN_ON_UPDATE_OR_DELETE,
    });
    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      family: name('api'),
      cpu: config.task.cpu,
      memoryLimitMiB: config.task.memoryMiB,
      runtimePlatform: platform,
    });
    apiTask.addContainer('api', {
      image: ecs.ContainerImage.fromEcrRepository(this.repositories.api, tag),
      portMappings: [{ containerPort: 4000 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup: apiLogs }),
      // SIGTERM comes at the start of a Fargate Spot interruption's two minutes; 60 s lets the scan
      // result in hand (about 48 s worst case) and open requests finish before SIGKILL.
      stopTimeout: Duration.seconds(60),
      environment: {
        NODE_ENV: 'production',
        AUTH_MODE: 'cognito',
        LOG_LEVEL: 'info',
        API_PORT: '4000',
        ...sites,
        ...database,
        DB_APP_USER: 'firmivra_app',
        AWS_REGION: config.region,
        COGNITO_REGION: config.region,
        COGNITO_STAFF_USER_POOL_ID: auth.staff.pool.userPoolId,
        COGNITO_STAFF_CLIENT_ID: auth.staff.client.userPoolClientId,
        COGNITO_CLIENTS_USER_POOL_ID: auth.clients.pool.userPoolId,
        COGNITO_CLIENTS_CLIENT_ID: auth.clients.client.userPoolClientId,
        COGNITO_ADMINS_USER_POOL_ID: auth.admins.pool.userPoolId,
        COGNITO_ADMINS_CLIENT_ID: auth.admins.client.userPoolClientId,
        S3_DOCUMENTS_BUCKET: data.documentsBucket.bucketName,
        KMS_MODE: 'kms',
        // The firm keys' env tag and alias (firm-keys.ts); the create-firm-key command runs only on dev.
        APP_ENV: config.envName,
        DOCUMENTS_KMS_KEY_ID: data.documentsKey.keyArn,
        ...(email
          ? {
              EMAIL_MODE: 'ses',
              EMAIL_FROM: email.fromAddress,
              SES_CONFIGURATION_SET: email.configurationSet.configurationSetName,
            }
          : { EMAIL_MODE: 'log' }),
        SMS_MODE: 'sns',
        SCAN_RESULTS_QUEUE_URL: this.malwareScan.queue.queueUrl,
      },
      secrets: {
        DB_APP_PASSWORD: ecs.Secret.fromSecretsManager(data.appDbSecret, 'password'),
        COGNITO_STAFF_CLIENT_SECRET: ecs.Secret.fromSecretsManager(auth.clientSecrets, 'STAFF'),
        COGNITO_CLIENTS_CLIENT_SECRET: ecs.Secret.fromSecretsManager(auth.clientSecrets, 'CLIENTS'),
        COGNITO_ADMINS_CLIENT_SECRET: ecs.Secret.fromSecretsManager(auth.clientSecrets, 'ADMINS'),
        EIN_HASH_KEY: ecs.Secret.fromSecretsManager(einHashKey),
      },
    });
    const apiRole = apiTask.taskRole;
    // Documents: only object actions, only under tenant/ (files live at tenant/<businessId>/...).
    apiRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'TenantDocuments',
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
        resources: [`arn:aws:s3:::${name('documents')}-${this.account}/tenant/*`],
      }),
    );
    apiRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'DocumentsKey',
        actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
        resources: [data.documentsKey.keyArn],
      }),
    );
    // Each firm's own key (src/firm-key-policy.ts): make, name and use, all tag-conditioned.
    for (const statement of firmKeyStatements(config.envName, config.region, config.account)) {
      apiRole.addToPrincipalPolicy(statement);
    }
    // Scan results: read, delete, and make a result without a record visible again sooner. No
    // dead-letter queue and no KMS (SSE-SQS).
    apiRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'ScanResultsQueue',
        actions: ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:ChangeMessageVisibility'],
        resources: [this.malwareScan.queue.queueArn],
      }),
    );
    email?.identity.grantSendEmail(apiRole);
    apiRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'SmsToPhoneNumbers',
        actions: ['sns:Publish'],
        resources: ['*'], // SMS to a phone number has no resource ARN
      }),
    );
    for (const pool of [auth.staff.pool, auth.clients.pool, auth.admins.pool]) {
      pool.grant(
        apiRole,
        'cognito-idp:AdminInitiateAuth',
        'cognito-idp:AdminRespondToAuthChallenge',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:AdminGetUser',
        'cognito-idp:AdminUpdateUserAttributes',
        'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminUserGlobalSignOut',
        'cognito-idp:AdminDisableUser',
        'cognito-idp:AdminEnableUser',
        // Find a user's username by sub: our pools sign in by username, and AdminGetUser does not
        // take the sub there (Oct 7).
        'cognito-idp:ListUsers',
      );
    }

    // ---------- Web ----------
    const webTask = new ecs.FargateTaskDefinition(this, 'WebTask', {
      family: name('web'),
      cpu: config.task.cpu,
      memoryLimitMiB: config.task.memoryMiB,
      runtimePlatform: platform,
    });
    webTask.addContainer('web', {
      image: ecs.ContainerImage.fromEcrRepository(this.repositories.web, tag),
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'web', logGroup: logGroup('web') }),
      environment: {
        PORT: '3000',
        HOSTNAME: '0.0.0.0',
        NEXT_TELEMETRY_DISABLED: '1',
        ADMIN_HOST: this.siteHosts.admin,
        APP_HOST: this.siteHosts.app,
        PORTAL_HOST: this.siteHosts.portal,
        ...sites,
      },
    });

    // ---------- Migration (one-off task, started by the deploy pipeline) ----------
    this.migrateTask = new ecs.FargateTaskDefinition(this, 'MigrateTask', {
      family: name('migrate'),
      cpu: config.task.cpu,
      memoryLimitMiB: config.task.memoryMiB,
      runtimePlatform: platform,
    });
    this.migrateLogGroup = logGroup('migrate');
    this.migrateTask.addContainer('migrate', {
      image: ecs.ContainerImage.fromEcrRepository(this.repositories.migrate, migrateTag),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'migrate',
        logGroup: this.migrateLogGroup,
      }),
      // APP_ENV and the pools: scripts/link-dev-users.mjs (one-off dev command in this image) runs
      // only in dev, and reads each person's email and name from Cognito by sub.
      environment: {
        ...database,
        DB_APP_USER: 'firmivra_app',
        APP_ENV: config.envName,
        AWS_REGION: config.region,
        COGNITO_STAFF_USER_POOL_ID: auth.staff.pool.userPoolId,
        COGNITO_ADMINS_USER_POOL_ID: auth.admins.pool.userPoolId,
      },
      secrets: {
        DB_OWNER_USER: ecs.Secret.fromSecretsManager(data.ownerSecret, 'username'),
        DB_OWNER_PASSWORD: ecs.Secret.fromSecretsManager(data.ownerSecret, 'password'),
        DB_APP_PASSWORD: ecs.Secret.fromSecretsManager(data.appDbSecret, 'password'),
      },
    });
    // Read-only, only the two pools link-dev-users reads (no clients pool). ListUsers with the
    // filter sub = "<sub>" finds the user and its attributes; AdminGetUser does not take the sub
    // in pools that sign in by username.
    for (const pool of [auth.staff.pool, auth.admins.pool]) {
      pool.grant(this.migrateTask.taskRole, 'cognito-idp:ListUsers');
    }

    // ---------- Services ----------
    const service = (
      key: 'api' | 'web',
      taskDefinition: ecs.FargateTaskDefinition,
      sg: ec2.ISecurityGroup,
    ) =>
      new ecs.FargateService(this, `${key}Service`, {
        serviceName: name(key),
        cluster: this.cluster,
        taskDefinition,
        desiredCount,
        assignPublicIp: true,
        vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
        securityGroups: [sg],
        capacityProviderStrategies: [
          { capacityProvider: config.task.spot ? 'FARGATE_SPOT' : 'FARGATE', weight: 1 },
        ],
        circuitBreaker: { rollback: true },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        healthCheckGracePeriod: Duration.seconds(60),
      });
    const apiService = service('api', apiTask, network.apiSg);
    const webService = service('web', webTask, network.webSg);

    const targetGroup = (key: string, port: number, healthPath: string) =>
      new elbv2.ApplicationTargetGroup(this, `${key}Targets`, {
        targetGroupName: name(key),
        vpc: network.vpc,
        port,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targetType: elbv2.TargetType.IP,
        deregistrationDelay: Duration.seconds(30),
        healthCheck: { path: healthPath, healthyHttpCodes: '200', interval: Duration.seconds(30) },
      });
    const apiTargets = targetGroup('api', 4000, '/api/v1/health');
    const webTargets = targetGroup('web', 3000, '/healthz');
    apiService.attachToApplicationTargetGroup(apiTargets);
    webService.attachToApplicationTargetGroup(webTargets);
    const fromCloudFront = elbv2.ListenerCondition.httpHeader('X-Origin-Verify', [originHeader]);
    listener.addAction('Api', {
      priority: 10,
      conditions: [fromCloudFront, elbv2.ListenerCondition.pathPatterns(['/api/*'])],
      action: elbv2.ListenerAction.forward([apiTargets]),
    });
    listener.addAction('Web', {
      priority: 20,
      conditions: [fromCloudFront],
      action: elbv2.ListenerAction.forward([webTargets]),
    });

    // ---------- Outputs for people and the deploy pipeline ----------
    new CfnOutput(this, 'AdminUrl', { value: sites.ADMIN_BASE_URL });
    new CfnOutput(this, 'AppUrl', { value: sites.APP_BASE_URL });
    new CfnOutput(this, 'PortalUrl', { value: sites.PORTAL_BASE_URL });
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new CfnOutput(this, 'MigrateTaskDefinition', { value: this.migrateTask.family });
    new CfnOutput(this, 'MigrateLogGroup', { value: this.migrateLogGroup.logGroupName });
    new CfnOutput(this, 'TaskSubnets', {
      value: network.vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnetIds.join(','),
    });
    new CfnOutput(this, 'MigrateSecurityGroup', { value: network.apiSg.securityGroupId });
    // Rasel's step 19 commands (docs/SETUP-LOG.md).
    new CfnOutput(this, 'AlarmTopicArn', { value: this.alarmTopic.topicArn });
    new CfnOutput(this, 'MalwareProtectionPlanId', {
      value: this.malwareScan.plan.attrMalwareProtectionPlanId,
    });
    new CfnOutput(this, 'MalwareScanRoleArn', { value: this.malwareScan.planRole.roleArn });
    new CfnOutput(this, 'ScanResultsQueueUrl', { value: this.malwareScan.queue.queueUrl });
    new CfnOutput(this, 'ScanResultsQueueArn', { value: this.malwareScan.queue.queueArn });
    new CfnOutput(this, 'ScanResultsDeadLetterQueueArn', {
      value: this.malwareScan.deadLetterQueue.queueArn,
    });
  }
}
