import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
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
import type { Construct } from 'constructs';
import { type EnvConfig, resourceName } from '../config';
import type { AuthStack } from './auth-stack';
import type { DataStack } from './data-stack';
import type { EmailStack } from './email-stack';
import type { NetworkStack } from './network-stack';

export interface AppStackProps extends StackProps {
  config: EnvConfig;
  network: NetworkStack;
  data: DataStack;
  auth: AuthStack;
  email: EmailStack;
  /** Image tag (commit sha) to run. Without one the services stay at 0 tasks (first deploy). */
  imageTag?: string;
}

/**
 * The running app: ECR repositories, an ECS cluster on Fargate (Spot in dev), the API and web
 * services behind one load balancer, a one-off migration task, and CloudFront for
 * admin., app. and portal.<domain> with /api/* going to the API.
 * The certificate is validated through Route 53, so this stack needs the domain delegated first.
 */
export class AppStack extends Stack {
  readonly repositories: Record<'api' | 'web' | 'migrate', ecr.Repository>;
  readonly cluster: ecs.Cluster;
  readonly migrateTask: ecs.FargateTaskDefinition;
  readonly migrateLogGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: AppStackProps) {
    super(scope, id, props);
    const { config, network, data, auth, email } = props;
    const name = (n: string) => resourceName(config, n);
    const tag = props.imageTag ?? 'none';
    const desiredCount = props.imageTag ? 1 : 0;

    const zone = route53.PublicHostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.domain,
    });
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: config.domain,
      subjectAlternativeNames: [`*.${config.domain}`],
      validation: acm.CertificateValidation.fromDns(zone),
    });

    // ---------- Images ----------
    const repository = (key: 'api' | 'web' | 'migrate') =>
      new ecr.Repository(this, `${key}Repository`, {
        repositoryName: name(key),
        imageScanOnPush: true,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        lifecycleRules: [{ maxImageCount: 10, description: 'Keep the last 10 images' }],
        removalPolicy: RemovalPolicy.RETAIN,
      });
    this.repositories = {
      api: repository('api'),
      web: repository('web'),
      migrate: repository('migrate'),
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

    const sites = {
      APP_BASE_URL: `https://app.${config.domain}`,
      PORTAL_BASE_URL: `https://portal.${config.domain}`,
      ADMIN_BASE_URL: `https://admin.${config.domain}`,
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

    // ---------- API ----------
    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      family: name('api'),
      cpu: config.task.cpu,
      memoryLimitMiB: config.task.memoryMiB,
      runtimePlatform: platform,
    });
    apiTask.addContainer('api', {
      image: ecs.ContainerImage.fromEcrRepository(this.repositories.api, tag),
      portMappings: [{ containerPort: 4000 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'api', logGroup: logGroup('api') }),
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
        DOCUMENTS_KMS_KEY_ID: data.documentsKey.keyArn,
        EMAIL_MODE: 'ses',
        EMAIL_FROM: email.fromAddress,
        SES_CONFIGURATION_SET: email.configurationSet.configurationSetName,
        SMS_MODE: 'sns',
      },
      secrets: {
        DB_APP_PASSWORD: ecs.Secret.fromSecretsManager(data.appDbSecret, 'password'),
        COGNITO_STAFF_CLIENT_SECRET: ecs.Secret.fromSecretsManager(auth.clientSecrets, 'STAFF'),
        COGNITO_CLIENTS_CLIENT_SECRET: ecs.Secret.fromSecretsManager(auth.clientSecrets, 'CLIENTS'),
        COGNITO_ADMINS_CLIENT_SECRET: ecs.Secret.fromSecretsManager(auth.clientSecrets, 'ADMINS'),
      },
    });
    const apiRole = apiTask.taskRole;
    // Documents: only object actions, only under tenant/ (files live at tenant/<businessId>/...).
    apiRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'TenantDocuments',
        actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject', 's3:AbortMultipartUpload'],
        resources: [`arn:aws:s3:::${resourceName(config, 'documents')}-${this.account}/tenant/*`],
      }),
    );
    apiRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        sid: 'DocumentsKey',
        actions: ['kms:Decrypt', 'kms:GenerateDataKey'],
        resources: [data.documentsKey.keyArn],
      }),
    );
    email.identity.grantSendEmail(apiRole);
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
      environment: { PORT: '3000', HOSTNAME: '0.0.0.0', NEXT_TELEMETRY_DISABLED: '1', ...sites },
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
      image: ecs.ContainerImage.fromEcrRepository(this.repositories.migrate, tag),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'migrate', logGroup: this.migrateLogGroup }),
      environment: { ...database, DB_APP_USER: 'firmivra_app' },
      secrets: {
        DB_OWNER_USER: ecs.Secret.fromSecretsManager(data.ownerSecret, 'username'),
        DB_OWNER_PASSWORD: ecs.Secret.fromSecretsManager(data.ownerSecret, 'password'),
        DB_APP_PASSWORD: ecs.Secret.fromSecretsManager(data.appDbSecret, 'password'),
      },
    });

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

    // ---------- Load balancer: only CloudFront, only with the origin secret ----------
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
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      loadBalancerName: name('alb'),
      vpc: network.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: network.albSg,
      dropInvalidHeaderFields: true,
    });
    alb.logAccessLogs(albLogs, 'alb');

    const listener = alb.addListener('Https', {
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
      certificates: [certificate],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      open: false,
      defaultAction: elbv2.ListenerAction.fixedResponse(403, {
        contentType: 'text/plain',
        messageBody: 'Forbidden',
      }),
    });
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

    const originHost = `origin.${config.domain}`;
    new route53.ARecord(this, 'OriginRecord', {
      zone,
      recordName: originHost,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(alb)),
    });

    // ---------- CloudFront ----------
    const origin = new origins.HttpOrigin(originHost, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
      customHeaders: { 'X-Origin-Verify': originHeader },
      readTimeout: Duration.seconds(30),
    });
    const dynamic: cloudfront.BehaviorOptions = {
      origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Host is forwarded: the web app picks admin/app/portal from it.
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
    };
    const siteNames = ['admin', 'app', 'portal'].map((s) => `${s}.${config.domain}`);
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: name('sites'),
      domainNames: siteNames,
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
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
    for (const site of siteNames) {
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(distribution));
      new route53.ARecord(this, `${site}-A`, { zone, recordName: site, target });
      new route53.AaaaRecord(this, `${site}-AAAA`, { zone, recordName: site, target });
    }

    // ---------- Outputs for the deploy pipeline ----------
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new CfnOutput(this, 'MigrateTaskDefinition', { value: this.migrateTask.family });
    new CfnOutput(this, 'TaskSubnets', {
      value: network.vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }).subnetIds.join(','),
    });
    new CfnOutput(this, 'MigrateSecurityGroup', { value: network.apiSg.securityGroupId });
    new CfnOutput(this, 'DistributionDomain', { value: distribution.distributionDomainName });
  }
}
