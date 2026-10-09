import type { EsignFieldType, EsignRecipientRole, EsignTemplateVisibility } from '@firmivra/types';

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

/** Each recipient role's name, as the recipients step and templates show it. */
export const RECIPIENT_ROLE_LABELS: Record<EsignRecipientRole, string> = {
  CLIENT: 'Client',
  SPOUSE: 'Spouse',
  BUSINESS_OWNER: 'Business owner',
  EMPLOYEE: 'Employee',
  PREPARER: 'Preparer',
  MANAGER: 'Manager',
  WITNESS: 'Witness',
  CUSTOM: 'Other',
};

/** A role's name: its own label when the sender gave one. */
export const roleName = (r: { role: EsignRecipientRole; roleLabel: string | null }) =>
  r.roleLabel ?? RECIPIENT_ROLE_LABELS[r.role];

/** Who may use a template. */
export const VISIBILITY_LABELS: Record<EsignTemplateVisibility, string> = {
  FIRM: 'Everyone in the firm',
  PRIVATE: 'Only its owner',
};
