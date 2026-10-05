import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';
import { type EnvConfig, resourceName } from '../config';

export interface DataStackProps extends StackProps {
  config: EnvConfig;
  vpc: ec2.IVpc;
  dbSg: ec2.ISecurityGroup;
}

/**
 * PostgreSQL (single-AZ db.t4g.micro in dev), the secrets for its two roles, and the documents
 * bucket with its KMS key. Per-business KMS keys are created by the API later (Sprint 3).
 */
export class DataStack extends Stack {
  readonly db: rds.DatabaseInstance;
  /** Owner role: migrations only (`firmivra_owner`). */
  readonly ownerSecret: secretsmanager.ISecret;
  /** App role used by the API (`firmivra_app`, no BYPASSRLS). The migration task sets its password. */
  readonly appDbSecret: secretsmanager.Secret;
  readonly documentsKey: kms.Key;
  readonly documentsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.db = new rds.DatabaseInstance(this, 'Postgres', {
      instanceIdentifier: resourceName(config, 'postgres'),
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.dbSg],
      multiAz: false,
      publiclyAccessible: false,
      databaseName: 'firmivra',
      credentials: rds.Credentials.fromGeneratedSecret('firmivra_owner', {
        secretName: `firmivra/${config.envName}/db/owner`,
      }),
      storageType: rds.StorageType.GP3,
      allocatedStorage: config.db.allocatedStorageGiB,
      maxAllocatedStorage: config.db.maxAllocatedStorageGiB,
      storageEncrypted: true,
      iamAuthentication: true,
      backupRetention: Duration.days(config.db.backupDays),
      preferredBackupWindow: '07:00-07:30', // 3:00 US Eastern, 13:00 Dhaka
      preferredMaintenanceWindow: 'sun:07:30-sun:08:00',
      autoMinorVersionUpgrade: true,
      allowMajorVersionUpgrade: false,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });
    this.ownerSecret = this.db.secret!;

    this.appDbSecret = new secretsmanager.Secret(this, 'AppDbSecret', {
      secretName: `firmivra/${config.envName}/db/app`,
      description:
        'Password of the firmivra_app role (no BYPASSRLS). Set in the database by the migration task.',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'firmivra_app' }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 40,
      },
    });

    this.documentsKey = new kms.Key(this, 'DocumentsKey', {
      alias: `alias/firmivra/${config.envName}/documents`,
      description: 'Firmivra documents bucket (per-business keys come later)',
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const accessLogs = new s3.Bucket(this, 'AccessLogs', {
      bucketName: `${resourceName(config, 'access-logs')}-${this.account}`,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      lifecycleRules: [{ expiration: Duration.days(90) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.documentsBucket = new s3.Bucket(this, 'Documents', {
      bucketName: `${resourceName(config, 'documents')}-${this.account}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.documentsKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      serverAccessLogsBucket: accessLogs,
      serverAccessLogsPrefix: 'documents/',
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.HEAD],
          // Browser uploads come from the portal and the firm workspace.
          allowedOrigins: config.customDomain
            ? [
                `https://${config.customDomain.hosts.portal}`,
                `https://${config.customDomain.hosts.app}`,
              ]
            : ['https://*.cloudfront.net'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        {
          noncurrentVersionExpiration: Duration.days(30),
          abortIncompleteMultipartUploadAfter: Duration.days(1),
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
