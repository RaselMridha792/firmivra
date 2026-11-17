import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import type * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { type EnvConfig, resourceName } from '../config';

export interface AppAlarmsProps {
  config: EnvConfig;
  alarmTopic: sns.ITopic;
  alb: elbv2.IApplicationLoadBalancer;
  targets: { api: elbv2.ApplicationTargetGroup; web: elbv2.ApplicationTargetGroup };
}

/** Five minutes: the period of every alarm here except the target health ones. */
const PERIOD = Duration.minutes(5);

/**
 * The running app's alarms (prod launch readiness, Nov 17): server errors from the API and from
 * the load balancer, targets that fail their health checks or are all gone, and the database's
 * free storage and CPU. Each one emails the env's alarm topic on ALARM and on OK, as the malware
 * scan's alarms do.
 *
 * The database is named by its instance identifier (the data stack's `resourceName(config,
 * 'postgres')`), not by reference: a reference would add a cross-stack export, and prod's data
 * stack is deployed by hand while Deploy prod deploys only this stack.
 *
 * Missing data is NOT_BREACHING throughout: no requests means no 5xx data points, and the load
 * balancer reports target counts every minute while the target groups exist.
 */
export class AppAlarms extends Construct {
  readonly alarms: cloudwatch.Alarm[] = [];

  constructor(scope: Construct, id: string, props: AppAlarmsProps) {
    super(scope, id);
    const { config, alarmTopic, alb, targets } = props;
    const notify = new actions.SnsAction(alarmTopic);
    const alarm = (
      key: string,
      metric: cloudwatch.IMetric,
      o: {
        threshold: number;
        periods: number;
        below?: boolean;
        description: string;
      },
    ) => {
      const a = new cloudwatch.Alarm(this, key, {
        alarmName: resourceName(config, key),
        alarmDescription: o.description,
        metric,
        threshold: o.threshold,
        evaluationPeriods: o.periods,
        datapointsToAlarm: o.periods,
        comparisonOperator: o.below
          ? cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD
          : cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      a.addAlarmAction(notify);
      a.addOkAction(notify);
      this.alarms.push(a);
    };

    // ---------- Server errors ----------
    alarm(
      'api-5xx',
      targets.api.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        statistic: 'Sum',
        period: PERIOD,
      }),
      {
        threshold: 10,
        periods: 1,
        description:
          'The API answered 10 or more 5xx responses in 5 minutes. Look at the API log group for level 50 lines.',
      },
    );
    alarm(
      'alb-5xx',
      alb.metrics.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, {
        statistic: 'Sum',
        period: PERIOD,
      }),
      {
        threshold: 10,
        periods: 1,
        description:
          'The load balancer itself answered 10 or more 5xx (502/503/504) in 5 minutes: no healthy target, or targets timing out.',
      },
    );

    // ---------- Target health (1-minute data from the load balancer) ----------
    for (const [svc, tg] of Object.entries(targets)) {
      alarm(
        `${svc}-unhealthy-targets`,
        tg.metrics.unhealthyHostCount({ statistic: 'Maximum', period: Duration.minutes(1) }),
        {
          threshold: 1,
          // A target turns unhealthy after 60 s of failed checks; 3 more minutes rule out a
          // rollout's replaced task.
          periods: 3,
          description: `A ${svc} task has failed its health check for 3 minutes in a row.`,
        },
      );
      alarm(
        `${svc}-no-healthy-targets`,
        tg.metrics.healthyHostCount({ statistic: 'Minimum', period: Duration.minutes(1) }),
        {
          threshold: 1,
          periods: 2,
          below: true,
          description: `No healthy ${svc} task for 2 minutes: the ${svc} site is down.`,
        },
      );
    }

    // ---------- Database ----------
    const db = (metricName: string, statistic: string) =>
      new cloudwatch.Metric({
        namespace: 'AWS/RDS',
        metricName,
        dimensionsMap: { DBInstanceIdentifier: resourceName(config, 'postgres') },
        statistic,
        period: PERIOD,
      });
    alarm('db-free-storage', db('FreeStorageSpace', 'Minimum'), {
      threshold: 2 * 1024 ** 3,
      periods: 3,
      below: true,
      description: `The database has had under 2 GiB free for 15 minutes. Storage grows by itself up to ${config.db.maxAllocatedStorageGiB} GiB, at most once every 6 hours: check whether it reached that maximum.`,
    });
    alarm('db-cpu', db('CPUUtilization', 'Average'), {
      threshold: 80,
      periods: 3,
      description: `The database's CPU has averaged 80% or more for 15 minutes (${config.db.instanceClass}).`,
    });
  }
}
