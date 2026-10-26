import type { Engagement } from '@firmivra/types';

/** "Growth Strategy: Fake plan", as Upload Document words an engagement. */
const engagementLabel = (e: Engagement) =>
  `${e.service.name}${e.taxYear ? ` ${e.taxYear}` : ''}${e.title && e.title !== e.service.name ? `: ${e.title}` : ''}`;

/** The engagements on advisory services: all of them (the files' filter), and the ACTIVE ones. */
export function advisoryEngagements(
  engagements: readonly Engagement[],
  workstreams: readonly { serviceId: string }[],
) {
  const ids = new Set(workstreams.map((w) => w.serviceId));
  const all = engagements.filter((e) => ids.has(e.service.id));
  const pick = (list: typeof all) =>
    list.map((e) => ({ serviceId: e.id, serviceName: engagementLabel(e) }));
  return {
    ids: new Set(all.map((e) => e.id)),
    all: pick(all),
    open: pick(all.filter((e) => e.status === 'ACTIVE')),
  };
}
