import type {
  LeadPipelineSummary,
  LeadPriority,
  LeadSource,
  LeadPipelineStatus,
} from '@firmivra/types';
import type { KpiTrend } from '@firmivra/ui';

export const LEAD_PIPELINE_KEY = ['lead-pipeline'] as const;

export const SOURCES: { value: LeadSource; label: string }[] = [
  { value: 'BEGIN_ONLINE', label: 'Begin Online' },
  { value: 'WEBSITE_FORM', label: 'Website Form' },
  { value: 'FACEBOOK_AD', label: 'Facebook Ad' },
  { value: 'INSTAGRAM', label: 'Instagram' },
  { value: 'GOOGLE_AD', label: 'Google Ad' },
  { value: 'REFERRAL', label: 'Referral' },
  { value: 'PHONE_CALL', label: 'Phone Call' },
  { value: 'WALK_IN', label: 'Walk In' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'EVENT', label: 'Event' },
  { value: 'OTHER', label: 'Other' },
];

export const STAGES: { value: LeadPipelineStatus; label: string }[] = [
  { value: 'SUBMITTED', label: 'New Lead' },
  { value: 'IN_REVIEW', label: 'In Review' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'IN_FOLLOW_UP', label: 'In Follow-Up' },
  { value: 'APPOINTMENT_SCHEDULED', label: 'Appointment Scheduled' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'CONVERTED', label: 'Converted' },
  { value: 'DECLINED', label: 'Not Qualified' },
  { value: 'LOST', label: 'No Response' },
];

export const PRIORITIES: { value: LeadPriority; label: string }[] = [
  { value: 'HOT', label: 'Hot' },
  { value: 'WARM', label: 'Warm' },
  { value: 'COLD', label: 'Cold' },
];

export const SOURCE_LABELS = Object.fromEntries(
  SOURCES.map((item) => [item.value, item.label]),
) as Record<LeadSource, string>;

export const STAGE_LABELS = Object.fromEntries(
  STAGES.map((item) => [item.value, item.label]),
) as Record<LeadPipelineStatus, string>;

export const PRIORITY_LABELS = Object.fromEntries(
  PRIORITIES.map((item) => [item.value, item.label]),
) as Record<LeadPriority, string>;

export function stageTone(
  stage: LeadPipelineStatus,
): 'info' | 'purple' | 'warning' | 'success' | 'danger' | 'neutral' {
  switch (stage) {
    case 'SUBMITTED':
    case 'IN_REVIEW':
      return 'info';
    case 'CONTACTED':
      return 'purple';
    case 'IN_FOLLOW_UP':
      return 'warning';
    case 'APPOINTMENT_SCHEDULED':
      return 'danger';
    case 'QUALIFIED':
    case 'CONVERTED':
      return 'success';
    case 'DECLINED':
      return 'danger';
    case 'LOST':
      return 'neutral';
  }
}

export function priorityTone(priority: LeadPriority): 'danger' | 'warning' | 'info' {
  if (priority === 'HOT') return 'danger';
  if (priority === 'WARM') return 'warning';
  return 'info';
}

export function fullName(firstName: string, lastName: string, fallback: string) {
  return `${firstName} ${lastName}`.trim() || fallback;
}

export function dateLabel(value: string, withTime = false) {
  const date = new Date(value);
  return date.toLocaleString('en-US', {
    ...(withTime
      ? { dateStyle: 'medium' as const, timeStyle: 'short' as const }
      : { dateStyle: 'medium' as const }),
  });
}

export function summaryTrend(
  count: LeadPipelineSummary['total'],
  decreasesAreGood = false,
): KpiTrend | undefined {
  if (count.previous === null) return undefined;
  const change = count.value - count.previous;
  if (change === 0) return { text: 'No change', direction: 'flat' };
  if (count.previous === 0) return undefined;
  const percent = Math.round((Math.abs(change) / count.previous) * 100);
  const up = change > 0;
  return {
    text: `${percent}%`,
    direction: up ? 'up' : 'down',
    good: decreasesAreGood ? !up : up,
  };
}
