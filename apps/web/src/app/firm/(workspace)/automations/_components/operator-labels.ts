import type { AutomationFieldType, AutomationOperator } from '@firmivra/types';

// AU-F23 (Octavia's Oct 28 review): each field type's operators, named for its data. A status
// reads Is, Is not, Is any of and Is none of; a number Equals, Greater than and Less than; a date
// Before, After, On and Within the last or next N days (the firm's days); text Is, Is not,
// Contains and Does not contain; and any field Is empty or Is not empty, which take no value.

const BY_TYPE: Partial<Record<AutomationFieldType, Partial<Record<AutomationOperator, string>>>> = {
  STATUS: { IS: 'Is', IS_NOT: 'Is not', INCLUDES: 'Is any of', EXCLUDES: 'Is none of' },
  LIST: { INCLUDES: 'Includes', EXCLUDES: 'Excludes' },
  NUMBER: { IS: 'Equals', GREATER_THAN: 'Greater than', LESS_THAN: 'Less than' },
  MONEY: { IS: 'Equals', GREATER_THAN: 'Greater than', LESS_THAN: 'Less than' },
  DATE: {
    BEFORE: 'Before',
    AFTER: 'After',
    ON: 'On',
    WITHIN_LAST: 'Within last N days',
    WITHIN_NEXT: 'Within next N days',
  },
  TEXT: { IS: 'Is', IS_NOT: 'Is not', CONTAINS: 'Contains', NOT_CONTAINS: 'Does not contain' },
  BOOLEAN: { IS: 'Is' },
};

export function operatorLabel(op: AutomationOperator, type: AutomationFieldType): string {
  if (op === 'EXISTS') return 'Is not empty';
  if (op === 'NOT_EXISTS') return 'Is empty';
  return BY_TYPE[type]?.[op] ?? op.charAt(0) + op.slice(1).toLowerCase().replace(/_/g, ' ');
}

/** Is empty and Is not empty take no value. */
export const takesNoValue = (op: AutomationOperator) => op === 'EXISTS' || op === 'NOT_EXISTS';
/** Is any of, Is none of, Includes and Excludes take one or more values. */
export const takesList = (op: AutomationOperator) => op === 'INCLUDES' || op === 'EXCLUDES';
/** Within the last or next N days take a number of days. */
export const takesDays = (op: AutomationOperator) => op === 'WITHIN_LAST' || op === 'WITHIN_NEXT';

/**
 * The value a condition sends: a number for a number field or a count of days, and cents for
 * money (typed in dollars). An empty box stays empty, so the API asks for a value.
 */
export function conditionValue(
  type: AutomationFieldType | undefined,
  op: AutomationOperator,
  text: string,
): string | number {
  if (text.trim() === '') return text;
  if (takesDays(op) || type === 'NUMBER') return Number(text);
  if (type === 'MONEY') return Math.round(Number(text) * 100);
  return text;
}

/** A saved value as the form shows it: money in dollars, a list comma-separated. */
export function conditionText(type: AutomationFieldType | undefined, value: unknown): string {
  if (Array.isArray(value)) return value.join(',');
  if (type === 'MONEY' && typeof value === 'number') return String(value / 100);
  return String(value ?? '');
}
