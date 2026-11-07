import { describe, expect, it } from 'vitest';
import {
  CreateApplicabilityRuleRequest,
  TAXED_AS,
  UpdateApplicabilityRuleRequest,
  classificationOf,
} from '../../src/index.js';

// CD-F14 (Octavia, Oct 28): one list of federal tax classifications; an LLC by its election.
describe('classificationOf', () => {
  it('reads what firms type, codes included', () => {
    for (const [text, kind] of [
      ['S_CORPORATION', 'S_CORPORATION'],
      ['S corp', 'S_CORPORATION'],
      ['S Corporation', 'S_CORPORATION'],
      ['1120-S', 'S_CORPORATION'],
      ['C-Corp', 'C_CORPORATION'],
      ['Corporation', 'C_CORPORATION'],
      ['Partnership', 'PARTNERSHIP'],
      ['LLP', 'PARTNERSHIP'],
      ['Sole prop', 'SOLE_PROPRIETOR'],
      ['Single-Member LLC', 'LLC_SINGLE_MEMBER'],
      ['LLC (Multi-Member)', 'LLC_MULTI_MEMBER'],
      ['Multi-member LLC', 'LLC_MULTI_MEMBER'],
      ['LLC taxed as S corp', 'LLC_S_ELECTION'],
      ['LLC with S election', 'LLC_S_ELECTION'],
      ['LLC electing C corporation', 'LLC_C_ELECTION'],
      ['501(c)(3) nonprofit', 'NONPROFIT'],
      ['Family trust', 'TRUST_ESTATE'],
      ['Individual', 'INDIVIDUAL'],
    ] as const) {
      expect(classificationOf(text), text).toBe(kind);
    }
  });

  it('says a bare LLC is not a tax classification, and knows no other text', () => {
    expect(classificationOf('LLC')).toBe('LLC');
    expect(classificationOf('Limited Liability Company')).toBe('LLC');
    expect(classificationOf('Cooperative')).toBeNull();
    expect(classificationOf('')).toBeNull();
    expect(classificationOf(null)).toBeNull();
  });

  it('taxes an LLC by its election or its default', () => {
    expect(TAXED_AS.LLC_SINGLE_MEMBER).toBe('SOLE_PROPRIETOR');
    expect(TAXED_AS.LLC_MULTI_MEMBER).toBe('PARTNERSHIP');
    expect(TAXED_AS.LLC_S_ELECTION).toBe('S_CORPORATION');
    expect(TAXED_AS.LLC_C_ELECTION).toBe('C_CORPORATION');
  });

  it('a rule names classifications from the list only', () => {
    const base = {
      name: 'S corps',
      target: { kind: 'RECURRENCE', id: '0199b6a1-0000-7000-8000-000000000001' },
    };
    expect(
      CreateApplicabilityRuleRequest.safeParse({ ...base, entityTypes: ['LLC_S_ELECTION'] })
        .success,
    ).toBe(true);
    expect(
      CreateApplicabilityRuleRequest.safeParse({ ...base, entityTypes: ['S corp'] }).success,
    ).toBe(false);
    expect(UpdateApplicabilityRuleRequest.safeParse({ entityTypes: ['LLC'] }).success).toBe(false);
  });
});
