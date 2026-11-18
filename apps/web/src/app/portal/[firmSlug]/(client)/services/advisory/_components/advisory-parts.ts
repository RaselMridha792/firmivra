import type {
  AdvisoryActionStatus,
  AdvisoryArea,
  AdvisoryGoalStatus,
  AdvisoryRecommendationStatus,
  AdvisoryServiceStatus,
  MyAdvisoryPlanState,
} from '@firmivra/types';

// BA-CP: the words and tones the client's Business Advisory pages use for the firm's statuses.

type Tone = 'info' | 'success' | 'warning' | 'danger' | 'neutral' | 'purple';

export const PLAN_STATE_TONE: Record<MyAdvisoryPlanState, Tone> = {
  DELIVERED: 'success',
  IN_PREPARATION: 'neutral',
};

export const REC_STATUS: Record<AdvisoryRecommendationStatus, [string, Tone]> = {
  PROPOSED: ['Proposed', 'info'],
  ACCEPTED: ['Accepted', 'purple'],
  IN_PROGRESS: ['In progress', 'warning'],
  IMPLEMENTED: ['Implemented', 'success'],
  NOT_APPLICABLE: ['Not applicable', 'neutral'],
  DECLINED: ['Declined', 'neutral'],
};

export const TASK_STATUS: Record<AdvisoryActionStatus, [string, Tone]> = {
  NOT_STARTED: ['Not started', 'neutral'],
  IN_PROGRESS: ['In progress', 'warning'],
  DONE: ['Done', 'success'],
  CANCELLED: ['Cancelled', 'neutral'],
};

export const GOAL_STATUS: Record<AdvisoryGoalStatus, string> = {
  NOT_STARTED: 'Not started',
  PLANNING: 'Planning',
  IN_PROGRESS: 'In progress',
  ON_TRACK: 'On track',
  AT_RISK: 'At risk',
  OVERDUE: 'Overdue',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export const SERVICE_STATUS: Record<AdvisoryServiceStatus, string> = {
  INTERESTED: 'Interested',
  PROPOSED: 'Proposed',
  ACCEPTED: 'Accepted',
  IN_PROGRESS: 'In progress',
  AWAITING_CLIENT: 'Waiting on you',
  COMPLETED: 'Completed',
  DECLINED: 'Declined',
  ON_HOLD: 'On hold',
};

export const AREA: Record<AdvisoryArea, string> = {
  REVENUE_GROWTH: 'Revenue Growth',
  PROFITABILITY: 'Profitability',
  FUNDING: 'Funding',
  EXPANSION: 'Expansion',
  STAFFING: 'Staffing',
  OPERATIONS: 'Operations',
  MARKETING_SALES: 'Marketing / Sales',
  BUSINESS_SETUP: 'Business Setup',
  FINANCIAL_MANAGEMENT: 'Financial Management',
};

const DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
/** A timestamp, or a calendar date (read at noon so no time zone moves it a day). */
export const dayText = (value: string) =>
  DAY.format(new Date(value.length === 10 ? `${value}T12:00:00` : value));

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
export const money = (cents: number) => MONEY.format(cents / 100);
