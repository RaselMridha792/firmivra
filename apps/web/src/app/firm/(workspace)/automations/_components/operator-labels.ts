import type { AutomationFieldType, AutomationOperator } from '@firmivra/types';

// AU-F23 (Octavia's Oct 28 review): each field type's operators, named for its data. The catalog's
// operators are kept (no new ones); only their words change. A status reads Is, Is not, Is any of
// and Is none of; a number Equals, Greater than and Less than; a date Before and After; text Is,
// Is not and Contains; and any field Is empty or Is not empty, which take no value.

const BY_TYPE: Partial<Record<AutomationFieldType, Partial<Record<AutomationOperator, string>>>> = {
  STATUS: { IS: 'Is', IS_NOT: 'Is not', INCLUDES: 'Is any of', EXCLUDES: 'Is none of' },
  LIST: { INCLUDES: 'Includes', EXCLUDES: 'Excludes' },
  NUMBER: { IS: 'Equals', GREATER_THAN: 'Greater than', LESS_THAN: 'Less than' },
  MONEY: { IS: 'Equals', GREATER_THAN: 'Greater than', LESS_THAN: 'Less than' },
  DATE: { BEFORE: 'Before', AFTER: 'After' },
  TEXT: { IS: 'Is', IS_NOT: 'Is not', CONTAINS: 'Contains' },
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
