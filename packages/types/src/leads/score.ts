import type { LeadSource, LeadStatus } from '../db-enums.js';
import { LEAD_STATUS_LABELS, type LeadPipelineStatus, type LeadScore } from './pipeline.js';

// Lead scoring v1 (Leads checklist "lead scoring"): a number from 0 to 100 that says how likely a
// lead is to become a client, computed when the lead is read (nothing is stored). The API (the Lead
// Profile) and the web mock both call `scoreLead`, so they always agree. Synthetic data only.

/** Every weight of the score, in one place. Points; the parts add up to at most 100. */
export const LEAD_SCORE_WEIGHTS = {
  /** At most 20: how reachable the lead is and whether they named what they need. */
  contact: { email: 8, phone: 8, service: 4 },
  /** At most 15: how the lead came to the firm. */
  source: {
    REFERRAL: 15,
    WALK_IN: 12,
    PHONE_CALL: 12,
    BEGIN_ONLINE: 10,
    WEBSITE_FORM: 10,
    EMAIL: 8,
    EVENT: 8,
    GOOGLE_AD: 6,
    FACEBOOK_AD: 6,
    INSTAGRAM: 6,
    OTHER: 4,
  } satisfies Record<LeadSource, number>,
  /** At most 30: how far along the pipeline the lead is; a lost or declined lead scores 0 here. */
  stage: {
    DRAFT: 0,
    EXPIRED: 0,
    SUBMITTED: 0,
    IN_REVIEW: 5,
    CONTACTED: 10,
    IN_FOLLOW_UP: 15,
    APPOINTMENT_SCHEDULED: 25,
    QUALIFIED: 30,
    CONVERTED: 30,
    DECLINED: 0,
    LOST: 0,
  } satisfies Record<LeadStatus, number>,
  /** At most 35: what was recorded in the last `days` days, each counted, then capped. */
  activity: { days: 30, reply: 10, call: 5, meeting: 10, form: 10, max: 35 },
  /** No recorded activity for a while takes points off (the longer wait wins). */
  stale: [
    { days: 30, points: -20 },
    { days: 14, points: -10 },
  ],
  /** Below `medium` is Low; below `high` is Medium; from `high` up, High Intent. */
  labels: { medium: 40, high: 70 },
} as const;

const SOURCE_WORDS: Record<LeadSource, string> = {
  BEGIN_ONLINE: 'Begin Online',
  WEBSITE_FORM: 'Website Form',
  FACEBOOK_AD: 'Facebook Ad',
  INSTAGRAM: 'Instagram',
  GOOGLE_AD: 'Google Ad',
  REFERRAL: 'Referral',
  PHONE_CALL: 'Phone Call',
  WALK_IN: 'Walk-In',
  EMAIL: 'Email',
  EVENT: 'Event',
  OTHER: 'Other',
};

/** What the score is computed from. */
export interface LeadScoreInput {
  hasEmail: boolean;
  hasPhone: boolean;
  /** How many services of interest the lead has. */
  services: number;
  source: LeadSource;
  status: LeadStatus;
  /** Counts recorded in the last `LEAD_SCORE_WEIGHTS.activity.days` days. */
  recent: { replies: number; calls: number; meetings: number; forms: number };
  /** Whole days since the newest recorded activity (or since the lead was made, if none). */
  idleDays: number;
}

const DAY_MS = 86_400_000;

/** Whole days from `since` to `now` (0 for a moment in the future). */
export function idleDaysSince(since: Date | string, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(since).getTime()) / DAY_MS));
}

/** The start of the window the activity part counts (30 days before `now`). */
export function leadScoreActivitySince(now: Date = new Date()): Date {
  return new Date(now.getTime() - LEAD_SCORE_WEIGHTS.activity.days * DAY_MS);
}

/** Low under 40, Medium from 40 to 69, High Intent from 70. */
export function leadScoreLabel(value: number): LeadScore['label'] {
  if (value >= LEAD_SCORE_WEIGHTS.labels.high) return 'High Intent';
  if (value >= LEAD_SCORE_WEIGHTS.labels.medium) return 'Medium';
  return 'Low';
}

const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const listed = (parts: string[]) =>
  parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

/**
 * The lead's score: its value (0 to 100), its label, and the parts that gave or took points, in
 * plain words, in this order: contact details, service, source, stage, recent activity, waiting.
 */
export function scoreLead(input: LeadScoreInput): LeadScore {
  const w = LEAD_SCORE_WEIGHTS;
  const factors: LeadScore['factors'] = [];
  const add = (label: string, points: number) => {
    if (points !== 0) factors.push({ label, points });
  };

  if (input.hasEmail && input.hasPhone)
    add('Email and phone on file', w.contact.email + w.contact.phone);
  else if (input.hasEmail) add('Email on file', w.contact.email);
  else if (input.hasPhone) add('Phone on file', w.contact.phone);
  if (input.services > 0) add('Interested in a service', w.contact.service);
  add(`Source: ${SOURCE_WORDS[input.source]}`, w.source[input.source]);
  const stage = w.stage[input.status];
  if (stage) add(`Stage: ${LEAD_STATUS_LABELS[input.status as LeadPipelineStatus]}`, stage);

  const { replies, calls, meetings, forms } = input.recent;
  const parts = [
    replies ? counted(replies, 'reply', 'replies') : '',
    calls ? counted(calls, 'call', 'calls') : '',
    meetings ? counted(meetings, 'meeting or appointment', 'meetings or appointments') : '',
    forms ? counted(forms, 'form submitted', 'forms submitted') : '',
  ].filter(Boolean);
  const earned =
    replies * w.activity.reply +
    calls * w.activity.call +
    meetings * w.activity.meeting +
    forms * w.activity.form;
  const activity = Math.min(earned, w.activity.max);
  add(
    `${listed(parts)} in the last ${w.activity.days} days${earned > w.activity.max ? ` (at most ${w.activity.max})` : ''}`,
    activity,
  );

  const stale = w.stale.find((s) => input.idleDays >= s.days);
  if (stale) add(`No activity for ${input.idleDays} days`, stale.points);

  const total = factors.reduce((sum, f) => sum + f.points, 0);
  const value = Math.min(100, Math.max(0, total));
  return { value, label: leadScoreLabel(value), factors };
}
