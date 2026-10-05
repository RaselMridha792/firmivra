import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import { type EnvConfig, resourceName } from '../config';

const VPC_CIDR = '10.20.0.0/16';

export interface NetworkStackProps extends StackProps {
  config: EnvConfig;
}

/**
 * VPC with public subnets (load balancer and Fargate tasks with public IPs, no NAT gateway in dev)
 * and isolated subnets (database, no internet route). All security groups live here so other
 * stacks can reference them without circular dependencies.
 */
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly albSg: ec2.SecurityGroup;
  readonly apiSg: ec2.SecurityGroup;
  readonly webSg: ec2.SecurityGroup;
  readonly dbSg: ec2.SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;

    const flowLogs = new logs.LogGroup(this, 'FlowLogs', {
      logGroupName: `/firmivra/${config.envName}/vpc-flow-logs`,
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: resourceName(config, 'vpc'),
      ipAddresses: ec2.IpAddresses.cidr(VPC_CIDR),
      availabilityZones: config.availabilityZones,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
          mapPublicIpOnLaunch: false,
        },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
      // Free: S3 traffic from the VPC stays on the AWS network.
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
      // Rejected traffic only: enough for security review, almost no log volume.
      flowLogs: {
        rejected: {
          destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogs),
          trafficType: ec2.FlowLogTrafficType.REJECT,
        },
      },
    });

    // Internal load balancer: CloudFront reaches it through a VPC origin, inside the VPC only.
    this.albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      securityGroupName: resourceName(config, 'alb'),
      description: 'Internal load balancer: HTTP from the CloudFront VPC origin (inside the VPC)',
      allowAllOutbound: false,
    });
    // VPC origin traffic keeps CloudFront's origin-facing source addresses (seen in the flow log,
    // Oct 5), not the VPC range. Only our own VPC origin can reach this internal load balancer.
    const cloudFront = ec2.PrefixList.fromLookup(this, 'CloudFrontOriginFacing', {
      prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
    });
    this.albSg.addIngressRule(
      ec2.Peer.prefixList(cloudFront.prefixListId),
      ec2.Port.tcp(80),
      'HTTP from CloudFront through the VPC origin',
    );

    // Tasks have public IPs for outbound calls (Cognito, SES, Stripe) but accept traffic only from the ALB.
    this.apiSg = new ec2.SecurityGroup(this, 'ApiSg', {
      vpc: this.vpc,
      securityGroupName: resourceName(config, 'api'),
      description: 'API tasks and the migration task',
      allowAllOutbound: true,
    });
    this.webSg = new ec2.SecurityGroup(this, 'WebSg', {
      vpc: this.vpc,
      securityGroupName: resourceName(config, 'web'),
      description: 'Web tasks',
      allowAllOutbound: true,
    });
    this.apiSg.addIngressRule(this.albSg, ec2.Port.tcp(4000), 'API from the load balancer');
    this.webSg.addIngressRule(this.albSg, ec2.Port.tcp(3000), 'Web from the load balancer');
    this.albSg.addEgressRule(this.apiSg, ec2.Port.tcp(4000), 'To API tasks');
    this.albSg.addEgressRule(this.webSg, ec2.Port.tcp(3000), 'To web tasks');

    // The database accepts connections from API and migration tasks only; the web app never connects.
    this.dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: this.vpc,
      securityGroupName: resourceName(config, 'db'),
      description: 'PostgreSQL: from API and migration tasks only',
      allowAllOutbound: false,
    });
    this.dbSg.addIngressRule(this.apiSg, ec2.Port.tcp(5432), 'PostgreSQL from API tasks');
  }
}
