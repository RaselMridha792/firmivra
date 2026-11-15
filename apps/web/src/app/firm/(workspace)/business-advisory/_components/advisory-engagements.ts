import {
  ADVISORY_ENGAGED_STATUSES,
  type AdvisoryWorkstream,
  type Engagement,
} from '@firmivra/types';

/** "Growth Strategy: Fake plan", as Upload Document words an engagement. */
const engagementLabel = (e: Engagement) =>
  `${e.service.name}${e.taxYear ? ` ${e.taxYear}` : ''}${e.title && e.title !== e.service.name ? `: ${e.title}` : ''}`;

/**
 * A service files and requests can go to. `serviceId` is the documents API's (an engagement);
 * with `workstreamId`, the service is under way but has no engagement yet, and
 * api.advisory.workstreamEngagement starts it on the first upload or request (A-12, A-13).
 */
export interface FileChoice {
  serviceId: string;
  serviceName: string;
  workstreamId?: string;
}

/**
 * The engagements on advisory services: all of them (the files' filter), and where files and
 * requests can go: each ACTIVE one, plus each service under way that has none yet.
 */
export function advisoryEngagements(
  engagements: readonly Engagement[],
  workstreams: readonly Pick<AdvisoryWorkstream, 'id' | 'serviceId' | 'serviceName' | 'status'>[],
) {
  const ids = new Set(workstreams.map((w) => w.serviceId));
  const all = engagements.filter((e) => ids.has(e.service.id));
  const active = all.filter((e) => e.status === 'ACTIVE');
  const pick = (list: typeof all): FileChoice[] =>
    list.map((e) => ({ serviceId: e.id, serviceName: engagementLabel(e) }));
  const started = new Set(active.map((e) => e.service.id));
  const toStart: FileChoice[] = workstreams
    .filter((w) => ADVISORY_ENGAGED_STATUSES.includes(w.status) && !started.has(w.serviceId))
    .map((w) => ({
      serviceId: `workstream:${w.id}`,
      serviceName: w.serviceName,
      workstreamId: w.id,
    }));
  return {
    ids: new Set(all.map((e) => e.id)),
    all: pick(all),
    open: [...pick(active), ...toStart],
  };
}
