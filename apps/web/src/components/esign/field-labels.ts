import type { EsignFieldType } from '@firmivra/types';

/** Each field type's name, as the field editor's palette and the fields on the page show it. */
export const FIELD_TYPE_LABELS: Record<EsignFieldType, string> = {
  SIGNATURE: 'Signature',
  INITIALS: 'Initials',
  DATE_SIGNED: 'Date signed',
  PRINTED_NAME: 'Name',
  EMAIL: 'Email',
  PHONE: 'Phone',
  ADDRESS: 'Address',
  TEXT: 'Text',
  CHECKBOX: 'Checkbox',
  RADIO: 'Choice',
  DROPDOWN: 'Dropdown',
  ATTACHMENT: 'Attachment',
};
