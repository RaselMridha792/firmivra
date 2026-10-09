import { describe, expect, it } from 'vitest';
import {
  ConvertLeadRequest,
  DeclineLeadRequest,
  ListLeadsQuery,
  ReviewedLeadStatus,
} from '../../src/index.js';

describe('leads contract', () => {
  it('never lists a draft or an expired draft', () => {
    expect(ReviewedLeadStatus.options).toEqual(['SUBMITTED', 'IN_REVIEW', 'CONVERTED', 'DECLINED']);
    expect(ListLeadsQuery.safeParse({ status: 'DRAFT' }).success).toBe(false);
    expect(ListLeadsQuery.safeParse({ status: 'EXPIRED' }).success).toBe(false);
  });

  it('pages 25 by default and at most 100', () => {
    expect(ListLeadsQuery.parse({}).limit).toBe(25);
    expect(ListLeadsQuery.parse({ limit: '100' }).limit).toBe(100);
    expect(ListLeadsQuery.safeParse({ limit: 101 }).success).toBe(false);
    expect(ListLeadsQuery.safeParse({ businessId: 'x' }).success).toBe(false);
  });

  it('converts with the invite on by default', () => {
    expect(ConvertLeadRequest.parse({})).toEqual({ sendPortalInvite: true });
    expect(ConvertLeadRequest.safeParse({ clientId: 'nope' }).success).toBe(false);
    expect(ConvertLeadRequest.safeParse({ accountType: 'TRUST' }).success).toBe(false);
    expect(ConvertLeadRequest.safeParse({ title: '‮evil' }).success).toBe(false);
  });

  it('needs a real decline reason', () => {
    expect(DeclineLeadRequest.safeParse({ reason: '   ' }).success).toBe(false);
    expect(DeclineLeadRequest.safeParse({ reason: 'x'.repeat(1001) }).success).toBe(false);
    expect(DeclineLeadRequest.parse({ reason: ' Not a fit.\nThanks ' }).reason).toBe(
      'Not a fit.\nThanks',
    );
  });
});
