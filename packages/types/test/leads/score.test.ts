import { describe, expect, it } from 'vitest';
import {
  idleDaysSince,
  LEAD_SCORE_WEIGHTS,
  type LeadScoreInput,
  leadScoreLabel,
  scoreLead,
} from '../../src/index.js';

// Lead scoring v1 (Leads checklist "lead scoring"): the one rule the API and the web mock share.
const none = { replies: 0, calls: 0, meetings: 0, forms: 0 };
const lead = (over: Partial<LeadScoreInput> = {}): LeadScoreInput => ({
  hasEmail: true,
  hasPhone: false,
  services: 0,
  source: 'OTHER',
  status: 'SUBMITTED',
  recent: none,
  idleDays: 0,
  ...over,
});

describe('scoreLead', () => {
  it('labels at the boundaries: 39 Low, 40 Medium, 69 Medium, 70 High Intent', () => {
    expect([39, 40, 69, 70].map(leadScoreLabel)).toEqual([
      'Low',
      'Medium',
      'Medium',
      'High Intent',
    ]);
    // 8 email + 4 service + 12 walk-in + 15 in follow-up = 39; one call more makes 44.
    const low = scoreLead(lead({ services: 1, source: 'WALK_IN', status: 'IN_FOLLOW_UP' }));
    expect([low.value, low.label]).toEqual([39, 'Low']);
    // 8 + 12 + 10 contacted + 10 form = 40.
    const medium = scoreLead(
      lead({ source: 'PHONE_CALL', status: 'CONTACTED', recent: { ...none, forms: 1 } }),
    );
    expect([medium.value, medium.label]).toEqual([40, 'Medium']);
    // 16 + 4 + 4 other + 25 appointment + 20 (two calls, one meeting) = 69.
    const high69 = scoreLead(
      lead({
        hasPhone: true,
        services: 2,
        status: 'APPOINTMENT_SCHEDULED',
        recent: { ...none, calls: 2, meetings: 1 },
      }),
    );
    expect([high69.value, high69.label]).toEqual([69, 'Medium']);
    // 16 + 4 + 15 referral + 25 + 10 (one reply) = 70.
    const high = scoreLead(
      lead({
        hasPhone: true,
        services: 1,
        source: 'REFERRAL',
        status: 'APPOINTMENT_SCHEDULED',
        recent: { ...none, replies: 1 },
      }),
    );
    expect([high.value, high.label]).toEqual([70, 'High Intent']);
    expect(high.factors).toEqual([
      { label: 'Email and phone on file', points: 16 },
      { label: 'Interested in a service', points: 4 },
      { label: 'Source: Referral', points: 15 },
      { label: 'Stage: Appointment Scheduled', points: 25 },
      { label: '1 reply in the last 30 days', points: 10 },
    ]);
  });

  it('caps recent activity at 35, scores a lost lead 0 for its stage, and stays within 0 to 100', () => {
    const busy = scoreLead(
      lead({
        hasPhone: true,
        services: 1,
        source: 'REFERRAL',
        status: 'QUALIFIED',
        recent: { replies: 2, calls: 3, meetings: 1, forms: 1 },
      }),
    );
    expect(busy.value).toBe(100);
    expect(busy.factors.at(-1)).toEqual({
      label:
        '2 replies, 3 calls, 1 meeting or appointment and 1 form submitted in the last 30 days (at most 35)',
      points: LEAD_SCORE_WEIGHTS.activity.max,
    });
    const lost = scoreLead(lead({ status: 'LOST', idleDays: 45 }));
    expect(lost.factors).toEqual([
      { label: 'Email on file', points: 8 },
      { label: 'Source: Other', points: 4 },
      { label: 'No activity for 45 days', points: -20 },
    ]);
    expect([lost.value, lost.label]).toEqual([0, 'Low']);
  });

  it('takes 10 points off from 14 idle days and 20 from 30', () => {
    const at = (idleDays: number) => scoreLead(lead({ source: 'REFERRAL', idleDays })).value;
    expect([at(13), at(14), at(29), at(30)]).toEqual([23, 13, 13, 3]);
    expect(idleDaysSince('2026-11-01T12:00:00Z', new Date('2026-11-15T11:59:59Z'))).toBe(13);
    expect(idleDaysSince('2026-11-01T12:00:00Z', new Date('2026-11-15T12:00:00Z'))).toBe(14);
  });
});
