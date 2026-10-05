import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as ses from 'aws-cdk-lib/aws-ses';
import type { Construct } from 'constructs';
import { type EnvConfig, resourceName } from '../config';

export interface EmailStackProps extends StackProps {
  config: EnvConfig;
}

/**
 * Email: SES domain identity for the environment's domain (DKIM, custom MAIL FROM, DMARC),
 * records written into the Route 53 zone. Verification completes once the domain is delegated
 * (GoDaddy NS records). SES production access is requested after that (docs/SETUP-LOG.md).
 * SMS: no CloudFormation resources. Leaving the SNS sandbox and the toll-free number are console
 * steps; the API task gets permission to publish SMS in the app stack.
 */
export class EmailStack extends Stack {
  readonly identity: ses.EmailIdentity;
  readonly configurationSet: ses.ConfigurationSet;
  readonly fromAddress: string;

  constructor(scope: Construct, id: string, props: EmailStackProps) {
    super(scope, id, props);
    const { config } = props;

    const zone = route53.PublicHostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: config.hostedZoneId,
      zoneName: config.domain,
    });

    this.configurationSet = new ses.ConfigurationSet(this, 'ConfigurationSet', {
      configurationSetName: resourceName(config, 'email'),
      reputationMetrics: true,
      sendingEnabled: true,
      suppressionReasons: ses.SuppressionReasons.BOUNCES_AND_COMPLAINTS,
      tlsPolicy: ses.ConfigurationSetTlsPolicy.REQUIRE,
    });

    this.identity = new ses.EmailIdentity(this, 'DomainIdentity', {
      identity: ses.Identity.publicHostedZone(zone),
      mailFromDomain: `mail.${config.domain}`,
      configurationSet: this.configurationSet,
    });

    new route53.TxtRecord(this, 'Dmarc', {
      zone,
      recordName: `_dmarc.${config.domain}`,
      values: ['v=DMARC1; p=quarantine; adkim=s; aspf=s'],
      ttl: Duration.hours(1),
    });

    this.fromAddress = `no-reply@${config.domain}`;
  }
}
