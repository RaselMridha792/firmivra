// AU-F23 (Octavia's Oct 28 review): each field type's operators read for its data; Is empty and
// Is not empty take no value, and the any-of operators take a list.
import { describe, expect, it } from 'vitest';
import {
  conditionText,
  conditionValue,
  operatorLabel,
  takesDays,
  takesList,
  takesNoValue,
} from './operator-labels';

describe('operatorLabel', () => {
  it('names each operator for its field type', () => {
    expect(operatorLabel('IS', 'STATUS')).toBe('Is');
    expect(operatorLabel('INCLUDES', 'STATUS')).toBe('Is any of');
    expect(operatorLabel('EXCLUDES', 'STATUS')).toBe('Is none of');
    expect(operatorLabel('INCLUDES', 'LIST')).toBe('Includes');
    expect(operatorLabel('IS', 'NUMBER')).toBe('Equals');
    expect(operatorLabel('GREATER_THAN', 'MONEY')).toBe('Greater than');
    expect(operatorLabel('BEFORE', 'DATE')).toBe('Before');
    expect(operatorLabel('CONTAINS', 'TEXT')).toBe('Contains');
    expect(operatorLabel('EXISTS', 'DATE')).toBe('Is not empty');
    expect(operatorLabel('NOT_EXISTS', 'TEXT')).toBe('Is empty');
    expect(operatorLabel('ON', 'DATE')).toBe('On');
    expect(operatorLabel('WITHIN_LAST', 'DATE')).toBe('Within last N days');
    expect(operatorLabel('WITHIN_NEXT', 'DATE')).toBe('Within next N days');
    expect(operatorLabel('NOT_CONTAINS', 'TEXT')).toBe('Does not contain');
  });

  it('sends numbers, days and cents as numbers, and shows money in dollars', () => {
    expect(conditionValue('NUMBER', 'GREATER_THAN', '3')).toBe(3);
    expect(conditionValue('DATE', 'WITHIN_NEXT', '7')).toBe(7);
    expect(conditionValue('DATE', 'ON', '2026-11-07')).toBe('2026-11-07');
    expect(conditionValue('MONEY', 'GREATER_THAN', '12.5')).toBe(1250);
    expect(conditionValue('MONEY', 'GREATER_THAN', '')).toBe('');
    expect(conditionText('MONEY', 1250)).toBe('12.5');
    expect(conditionText('STATUS', ['A', 'B'])).toBe('A,B');
    expect(takesDays('WITHIN_LAST')).toBe(true);
    expect(takesDays('BEFORE')).toBe(false);
  });

  it('knows which operators take no value and which take a list', () => {
    expect(takesNoValue('EXISTS')).toBe(true);
    expect(takesNoValue('IS')).toBe(false);
    expect(takesList('INCLUDES')).toBe(true);
    expect(takesList('IS_NOT')).toBe(false);
  });
});
