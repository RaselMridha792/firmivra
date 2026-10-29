// IP-F02 and IP-F13 with R1's #1220: a firm keeps its own payment terms (`net_<days>`, 1 to 365,
// at most 12) beside Due on Receipt, Net 7, Net 14 and Net 30.
import { describe, expect, it } from 'vitest';
import {
  offeredPaymentTerms,
  PaymentTerm,
  paymentTermDays,
  paymentTermLabel,
  UpdatePaymentPreferencesRequest,
} from '../../src/index.js';

describe('payment terms', () => {
  it('reads the standard terms and a firm’s own as days', () => {
    expect(
      ['due_on_receipt', 'net_7', 'net_14', 'net_30', 'net_1', 'net_45', 'net_365'].map(
        paymentTermDays,
      ),
    ).toEqual([0, 7, 14, 30, 1, 45, 365]);
    for (const code of ['net_0', 'net_366', 'net_07', 'net_', 'net_4.5', 'NET_45', 'due']) {
      expect(paymentTermDays(code), code).toBeNull();
      expect(PaymentTerm.safeParse(code).success, code).toBe(false);
    }
    expect(paymentTermLabel('due_on_receipt')).toBe('Due on Receipt');
    expect(paymentTermLabel('net_45')).toBe('Net 45');
  });

  it('offers the standard four, then the firm’s own by days', () => {
    expect(offeredPaymentTerms([])).toEqual(['due_on_receipt', 'net_7', 'net_14', 'net_30']);
    expect(offeredPaymentTerms([90, 45]).slice(4)).toEqual(['net_45', 'net_90']);
  });
});

describe('the firm’s own terms in Settings > Payments', () => {
  const body = (customTermDays: number[], defaultTerms = 'net_14') => ({
    invoiceDefaults: { invoicePrefix: 'INV-', defaultTerms, defaultMemo: null, customTermDays },
    reminders: {
      sendReminders: false,
      reminderDaysBefore: 3,
      notifyOverdue: false,
      overdueReminderDays: 7,
      autoReceipts: false,
      autoApplyPayments: false,
      retryAttempts: 0,
      retryIntervalDays: 3,
    },
    taxesAndFees: {
      lateFeeEnabled: false,
      lateFeeType: null,
      lateFeePercent: null,
      lateFeeCents: null,
      tippingEnabled: false,
      requirePaymentBeforeDue: false,
    },
    updatedAt: null,
  });
  const messages = (b: object) =>
    UpdatePaymentPreferencesRequest.safeParse(b).error?.issues.map((i) => i.message) ?? [];

  it('takes 1 to 365 days, at most 12, none repeated or standard', () => {
    expect(messages(body([45, 60, 90], 'net_60'))).toEqual([]);
    expect(messages(body([0]))).toEqual(['Use 1 to 365 days']);
    expect(messages(body([366]))).toEqual(['Use 1 to 365 days']);
    expect(messages(body([30]))).toEqual(['Net 30 is already a standard term']);
    expect(messages(body([45, 45]))).toEqual(['Net 45 is in your list already']);
    expect(messages(body(Array.from({ length: 13 }, (_, i) => 40 + i)))).toEqual([
      'Keep at most 12 of your own terms',
    ]);
  });

  it('makes the default one of the offered terms', () => {
    expect(messages(body([45], 'net_90'))).toEqual(['Choose default terms from the list']);
    expect(messages(body([], 'net_45'))).toEqual(['Choose default terms from the list']);
  });
});
