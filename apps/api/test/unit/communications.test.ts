// R55 Communications: the segment criteria catalog, the filters it builds, and address masks.
import { describe, expect, it } from 'vitest';
import {
  fieldsFor,
  mask,
  summarize,
  validateCriteria,
  whereFor,
  type Criteria,
} from '../../src/communications/communications.common.js';

const crit = (over: Partial<Criteria> = {}): Criteria => ({
  logic: 'AND',
  conditions: [],
  groups: [],
  ...over,
});

describe('segment criteria', () => {
  it('offers clients and leads their own fields', () => {
    expect(fieldsFor('CLIENTS').every((f) => f.audience === 'CLIENTS')).toBe(true);
    expect(fieldsFor('LEADS').every((f) => f.audience === 'LEADS')).toBe(true);
    expect(fieldsFor('BOTH').length).toBe(fieldsFor('CLIENTS').length + fieldsFor('LEADS').length);
  });

  it('builds a filter for each side and ignores the other side’s fields', () => {
    const c = crit({
      conditions: [
        { field: 'client.status', op: 'IS_ANY_OF', value: ['ACTIVE', 'NEW'] },
        { field: 'lead.status', op: 'IS', value: 'QUALIFIED' },
      ],
    });
    expect(whereFor(c, 'client', 'BOTH')).toEqual({
      AND: [{ status: { in: ['ACTIVE', 'NEW'] } }],
    });
    expect(whereFor(c, 'lead', 'BOTH')).toEqual({ AND: [{ status: { equals: 'QUALIFIED' } }] });
  });

  it('joins with OR and nests one level of groups', () => {
    const c = crit({
      logic: 'OR',
      conditions: [{ field: 'client.status', op: 'IS', value: 'ACTIVE' }],
      groups: [
        {
          logic: 'AND',
          conditions: [{ field: 'client.accountType', op: 'IS', value: 'BUSINESS' }],
        },
      ],
    });
    expect(whereFor(c, 'client', 'CLIENTS')).toEqual({
      OR: [{ status: { equals: 'ACTIVE' } }, { AND: [{ accountType: { equals: 'BUSINESS' } }] }],
    });
  });

  it('matches everyone when there are no conditions', () => {
    expect(whereFor(crit(), 'client', 'CLIENTS')).toEqual({});
    expect(summarize(crit())).toBe('Everyone');
  });

  it.each([
    ['an unknown field', { field: 'client.ssn', op: 'IS', value: 'x' }, 'CLIENTS'],
    [
      'an operator the field does not take',
      { field: 'client.status', op: 'BEFORE', value: '2026-01-01' },
      'CLIENTS',
    ],
    [
      'a value the field does not hold',
      { field: 'client.status', op: 'IS', value: 'NOPE' },
      'CLIENTS',
    ],
    ['a missing value', { field: 'client.status', op: 'IS_ANY_OF', value: [] }, 'CLIENTS'],
    ['a bad date', { field: 'client.clientSince', op: 'BEFORE', value: 'soon' }, 'CLIENTS'],
    ['a field of the other audience', { field: 'lead.status', op: 'IS', value: 'LOST' }, 'CLIENTS'],
  ] as const)('refuses %s', (_why, cond, audience) => {
    expect(() => validateCriteria(crit({ conditions: [{ ...cond }] }), audience)).toThrow();
  });

  it('summarizes in plain words', () => {
    expect(
      summarize(
        crit({
          conditions: [{ field: 'client.status', op: 'IS_ANY_OF', value: ['ACTIVE', 'NEW'] }],
        }),
      ),
    ).toBe('Client status is any of ACTIVE, NEW');
  });
});

describe('masks', () => {
  it('hides an address and a number but keeps enough to recognise them', () => {
    expect(mask('jamie@example.com')).toBe('j***@example.com');
    expect(mask('+15551231234')).toBe('***-***-1234');
    expect(mask(null)).toBe('');
  });
});
