import { describe, expect, it } from 'vitest';
import {
  type FilterDraft,
  type FilterField,
  amountOf,
  conditionsOf,
  draftProblem,
  newDraft,
  onField,
  toCondition,
} from './filter-rules';

const field = (key: string, type: FilterField['type'], options: string[] = []): FilterField => ({
  key,
  label: key[0]!.toUpperCase() + key.slice(1),
  type,
  options: options.map((value) => ({ value, label: value })),
});
const total = field('total', 'MONEY');
const status = field('status', 'STATUS', ['OPEN', 'PAID']);
const issued = field('issuedOn', 'DATE');
const client = field('client', 'TEXT');
const draft = (over: Partial<FilterDraft>): FilterDraft => ({ ...newDraft(total), ...over });

describe('report filter rules (RP-F02, F09, F10, Octavia Oct 28)', () => {
  it('start a filter with an operator its type takes, never "is" on a number', () => {
    expect(newDraft(total).op).toBe('EQUALS');
    expect(newDraft(status).op).toBe('IS');
    expect(newDraft(client).op).toBe('CONTAINS');
    expect(newDraft(issued).op).toBe('ON');
    // Moving to another field keeps an operator it takes, else its first.
    expect(onField(draft({ op: 'GREATER_THAN', value: '5' }), field('days', 'NUMBER'))).toEqual({
      field: 'days',
      op: 'GREATER_THAN',
      value: '',
      to: '',
      values: [],
    });
    expect(onField(draft({ op: 'GREATER_THAN' }), status).op).toBe('IS');
  });

  it('read money in dollars and send cents: "Total above 500" is the $2,000 invoice, not $5', () => {
    expect(amountOf('MONEY', '500')).toBe(50_000);
    expect(amountOf('MONEY', '$1,250.50')).toBe(125_050);
    expect(amountOf('MONEY', '12.345')).toBeNull();
    expect(amountOf('PERCENT', '15%')).toBe(15);
    expect(amountOf('NUMBER', 'abc')).toBeNull();
    expect(toCondition(total, draft({ op: 'GREATER_THAN', value: '500' }))).toEqual({
      field: 'total',
      op: 'GREATER_THAN',
      value: 50_000,
    });
    expect(toCondition(total, draft({ op: 'BETWEEN', value: '100', to: '250.50' }))).toEqual({
      field: 'total',
      op: 'BETWEEN',
      value: { from: 10_000, to: 25_050 },
    });
  });

  it('name what does not fit, in its own field, before Apply', () => {
    expect(draftProblem(total, draft({ op: 'GREATER_THAN', value: 'abc' }))).toBe(
      'Enter an amount in dollars, like 500 or 500.50.',
    );
    expect(draftProblem(total, draft({ op: 'BETWEEN', value: '500', to: '100' }))).toBe(
      'The first value must not be above the second.',
    );
    expect(
      draftProblem(issued, {
        ...newDraft(issued),
        op: 'BETWEEN',
        value: '2026-10-26',
        to: '2026-10-24',
      }),
    ).toBe('The start date must be on or before the end date.');
    expect(draftProblem(status, { ...newDraft(status), op: 'IS_ANY_OF' })).toBe(
      'Choose at least one.',
    );
    expect(draftProblem(client, { ...newDraft(client), value: '  ' })).toBe('Enter some text.');
    expect(draftProblem(client, { ...newDraft(client), op: 'IS_EMPTY' })).toBeNull();
    expect(draftProblem(total, draft({ op: 'IS' }))).toBe('Choose how to compare Total.');
  });

  it('send only the filters that fit, and say which do not', () => {
    const { conditions, problems } = conditionsOf(
      [total, status, issued],
      [
        draft({ op: 'GREATER_THAN', value: '500' }),
        { ...newDraft(status), value: 'PAID' },
        draft({ op: 'LESS_THAN', value: 'abc' }),
        { ...newDraft(status), op: 'IS_NONE_OF', values: ['OPEN'] },
        { ...newDraft(issued), op: 'RELATIVE', value: 'last_30_days' },
      ],
    );
    expect(conditions).toEqual([
      { field: 'total', op: 'GREATER_THAN', value: 50_000 },
      { field: 'status', op: 'IS', value: 'PAID' },
      { field: 'status', op: 'IS_NONE_OF', value: ['OPEN'] },
      { field: 'issuedOn', op: 'RELATIVE', value: 'last_30_days' },
    ]);
    expect(problems).toEqual([
      null,
      null,
      'Enter an amount in dollars, like 500 or 500.50.',
      null,
      null,
    ]);
  });
});
