// AU-F23 (Octavia's Oct 28 review): each field type's operators read for its data; Is empty and
// Is not empty take no value, and the any-of operators take a list.
import { describe, expect, it } from 'vitest';
import { operatorLabel, takesList, takesNoValue } from './operator-labels';

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
  });

  it('knows which operators take no value and which take a list', () => {
    expect(takesNoValue('EXISTS')).toBe(true);
    expect(takesNoValue('IS')).toBe(false);
    expect(takesList('INCLUDES')).toBe(true);
    expect(takesList('IS_NOT')).toBe(false);
  });
});
