import type {
  AdminRole,
  BillingCapability,
  BillingFirmStatus,
  CreditNoteStatus,
  CreditReason,
  Currency,
  EstimateStatus,
  EstimateTemplate,
  InvoiceStatus,
  InvoiceType,
  PaymentMethod,
  PaymentStatus,
  PaymentTerms,
  RecurringFrequency,
  RecurringStatus,
  RefundMethod,
  TemplateKind,
} from '../../../../../mocks/admin-billing';

/** The words the Billing pages show for each value of the mock's enumerations. */

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Draft',
  PENDING: 'Pending',
  PARTIALLY_PAID: 'Partially Paid',
  PAID: 'Paid',
  OVERDUE: 'Overdue',
  VOIDED: 'Voided',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially Refunded',
};
export const INVOICE_TYPE_LABELS: Record<InvoiceType, string> = {
  STANDARD: 'Standard Invoice',
  DEPOSIT: 'Deposit Invoice',
  PROGRESS: 'Progress Invoice',
  FINAL: 'Final Invoice',
  ADJUSTMENT: 'Adjustment Invoice',
};
export const CURRENCY_LABELS: Record<Currency, string> = {
  USD: 'USD ($)',
  CAD: 'CAD ($)',
  EUR: 'EUR (€)',
  GBP: 'GBP (£)',
};
export const PAYMENT_TERMS_LABELS: Record<PaymentTerms, string> = {
  DUE_ON_RECEIPT: 'Due on Receipt',
  NET_7: 'Net 7',
  NET_15: 'Net 15',
  NET_30: 'Net 30',
  NET_45: 'Net 45',
  NET_60: 'Net 60',
};
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CREDIT_CARD: 'Credit Card',
  ACH: 'ACH Transfer',
  BANK_TRANSFER: 'Bank Transfer',
  CHECK: 'Check',
  CASH: 'Cash',
  MANUAL: 'Manual Entry',
};
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  COMPLETED: 'Completed',
  PENDING: 'Pending',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially Refunded',
};
export const REFUND_METHOD_LABELS: Record<RefundMethod, string> = {
  ORIGINAL: 'Original payment method',
  CHECK: 'Check',
  BANK_TRANSFER: 'Bank Transfer',
  CASH: 'Cash',
};
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  CONVERTED: 'Converted',
};
export const ESTIMATE_TEMPLATE_LABELS: Record<EstimateTemplate, string> = {
  STANDARD: 'Standard Estimate',
  DETAILED: 'Detailed Estimate',
  SIMPLE: 'Simple Estimate',
};
export const CREDIT_NOTE_STATUS_LABELS: Record<CreditNoteStatus, string> = {
  DRAFT: 'Draft',
  AVAILABLE: 'Available',
  APPLIED: 'Applied',
  PARTIALLY_APPLIED: 'Partially Applied',
  REFUNDED: 'Refunded',
  VOIDED: 'Voided',
};
export const CREDIT_REASON_LABELS: Record<CreditReason, string> = {
  SERVICE_ISSUE: 'Service issue',
  BILLING_ERROR: 'Billing error',
  DUPLICATE_CHARGE: 'Duplicate charge',
  CANCELLATION: 'Cancellation',
  PRICE_ADJUSTMENT: 'Price adjustment',
  GOODWILL: 'Goodwill credit',
  OTHER: 'Other',
};
export const RECURRING_FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMIANNUALLY: 'Every 6 months',
  ANNUALLY: 'Annually',
  CUSTOM: 'Custom',
};
export const RECURRING_STATUS_LABELS: Record<RecurringStatus, string> = {
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  CANCELED: 'Canceled',
};
export const FIRM_STATUS_LABELS: Record<BillingFirmStatus, string> = {
  ACTIVE: 'Active',
  PENDING_SETUP: 'Pending Setup',
  SUSPENDED: 'Suspended',
};
export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  OWNER: 'Owner / Super Admin',
  ADMIN: 'Admin',
  BILLING: 'Billing Staff',
  SUPPORT: 'Support',
};
export const BILLING_CAPABILITY_LABELS: Record<BillingCapability, string> = {
  CREATE_INVOICES: 'Create invoices',
  EDIT_INVOICES: 'Edit invoices',
  SEND_INVOICES: 'Send and resend invoices',
  VOID_INVOICES: 'Void invoices',
  RECORD_PAYMENTS: 'Record payments',
  ISSUE_REFUNDS: 'Issue refunds',
  CREATE_CREDIT_NOTES: 'Create credit notes',
  APPLY_CREDITS: 'Apply credits',
  VOID_CREDIT_NOTES: 'Void credit notes',
  MANAGE_RECURRING: 'Create, edit and cancel recurring invoices',
  EDIT_SETTINGS: 'Edit Billing Settings',
  VIEW_CROSS_FIRM: 'View billing across firms',
};
export const TEMPLATE_KIND_LABELS: Record<TemplateKind, string> = {
  INVOICE: 'Invoice',
  ESTIMATE: 'Estimate',
  RECEIPT: 'Receipt',
  CREDIT_NOTE: 'Credit Note',
  PAYMENT_REMINDER: 'Payment Reminder',
  REFUND_CONFIRMATION: 'Refund Confirmation',
};

/** `{ value, label }` choices for a Select, in the enumeration's order. */
export function optionsOf<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: labels[value] }));
}

/** errorMessage() overrides for the Billing error codes (lib/errors). */
export const BILLING_ERRORS: Record<string, string> = {
  DUPLICATE_NUMBER: 'That number is already used. Choose another one.',
  ALREADY_CONVERTED: 'This estimate was already converted to an invoice.',
  ALREADY_ISSUED: 'This credit note is already issued.',
  DUPLICATE_OCCURRENCE: 'An invoice already exists for this scheduled date.',
  HAS_PAYMENTS: 'Payments or credits are on this record. Refund or remove them first.',
  INVOICE_VOIDED: 'This invoice is voided.',
  INVALID_STATE: "This can't be done in the record's current status.",
  FIRM_UNAVAILABLE: 'This firm is not active, so it cannot get new billing documents.',
  BILLING_SETUP_INCOMPLETE:
    "This firm hasn't finished its payment and tax setup, so it can't send.",
  CLIENT_EMAIL_MISSING: 'This client has no email address to send to.',
  TOTAL_BELOW_PAID: 'The new total is less than what was already paid.',
  AMOUNT_TOO_HIGH: 'The amount is more than is available.',
  ATTACHMENTS_DISABLED: 'Attachments are turned off in Billing Settings.',
  ESTIMATES_DISABLED: 'Estimates are turned off in Billing Settings.',
  CREDIT_NOTES_DISABLED: 'Credit notes are turned off in Billing Settings.',
};
