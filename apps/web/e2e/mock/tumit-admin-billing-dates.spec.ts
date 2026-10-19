import { expect, test } from '@playwright/test';
import { invoiceErrors, type SaveInvoice } from '../../src/mocks/admin-billing';

const invoice: SaveInvoice = {
  firmId: '0199b6a3-0000-7000-8000-000000000001',
  clientId: '0199d1a0-0b01-7000-8000-000000000001',
  number: 'INV-CALENDAR-TEST',
  issueDate: '2026-01-01',
  dueDate: '2030-12-31',
  type: 'STANDARD',
  currency: 'USD',
  paymentTerms: 'NET_30',
  reference: '',
  notes: '',
  lines: [
    { description: 'Synthetic advisory service', quantity: 1, rateCents: 10000, taxRateId: null },
  ],
  discountCents: 0,
  allowOnlinePayment: false,
  send: false,
  estimateId: null,
  attachments: [],
  keepAttachmentIds: [],
};

// Date.parse normalizes some impossible dates instead of rejecting them. The shared Billing
// date rule must reject those inputs before any document, payment or schedule is saved.
const impossibleDates = ['2026-02-29', '2026-02-30', '2026-04-31', '2026-13-01', 'not-a-date'];

test('invoice issue dates reject impossible calendar days without throwing', () => {
  for (const issueDate of impossibleDates) {
    expect(invoiceErrors({ ...invoice, issueDate }).fields.issueDate, issueDate).toBeDefined();
  }
});

test('invoice due dates reject impossible calendar days without throwing', () => {
  for (const dueDate of impossibleDates) {
    expect(invoiceErrors({ ...invoice, dueDate }).fields.dueDate, dueDate).toBeDefined();
  }
});

test('invoice dates accept real leap days and month ends', () => {
  for (const issueDate of ['2024-02-29', '2026-02-28', '2026-04-30', '2028-02-29']) {
    expect(invoiceErrors({ ...invoice, issueDate }).fields, issueDate).toEqual({});
    expect(invoiceErrors({ ...invoice, issueDate, dueDate: issueDate }).fields, issueDate).toEqual(
      {},
    );
  }
});
