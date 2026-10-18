'use client';

import {
  ADMIN_ROLES,
  PAYMENT_METHODS,
  type BillingSettings,
} from '../../../../../../mocks/admin-billing';
import {
  ADMIN_ROLE_LABELS,
  optionsOf,
  PAYMENT_METHOD_LABELS,
} from '../../_components/billing-labels';
import {
  CheckboxGroup,
  RadioGroup,
  SettingsCard,
  ToggleRow,
  type SettingsForm,
} from './settings-parts';

/**
 * Payments (docx §15): the payment methods firms may take, partial and over-payments, AutoPay,
 * receipts, who may refund and whether a reason is required, and how the processor is used.
 */

type Payments = BillingSettings['payments'];

export function PaymentsTab({ form }: { form: SettingsForm | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SettingsCard
        title="Payment Methods"
        description="The ways clients can pay; a method that is off can't be recorded or offered."
        testId="settings-payment-methods"
      >
        {form ? (
          <CheckboxGroup
            legend="Supported payment methods"
            options={optionsOf(PAYMENT_METHODS, PAYMENT_METHOD_LABELS)}
            value={form.value.payments.methods}
            error={form.errors['payments.methods']}
            onChange={(methods) => form.patch('payments', { methods })}
          />
        ) : null}
      </SettingsCard>
      <SettingsCard
        title="Payment Options"
        description="How payments are applied to invoices on every firm."
      >
        {form ? <PaymentOptions form={form} /> : null}
      </SettingsCard>
      <SettingsCard title="Refunds" description="Who can issue refunds and what they must record.">
        {form ? <Refunds form={form} /> : null}
      </SettingsCard>
      <SettingsCard
        title="Payment Processor"
        description="How card and ACH payments are taken and refunded."
      >
        {form ? (
          <RadioGroup
            legend="Processor handling"
            value={form.value.payments.processor}
            options={[
              {
                value: 'STRIPE',
                label: 'Stripe: card and ACH payments online; refunds go back through Stripe',
              },
              {
                value: 'MANUAL_ONLY',
                label: 'Manual only: payments and refunds are recorded by hand',
              },
            ]}
            onChange={(processor) => form.patch('payments', { processor })}
          />
        ) : null}
      </SettingsCard>
    </div>
  );
}

function PaymentOptions({ form }: { form: SettingsForm }) {
  const p = form.value.payments;
  const set = (value: Partial<Payments>) => form.patch('payments', value);
  return (
    <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
      <ToggleRow
        label="Allow Partial Payments"
        description="The same switch as Enable Partial Payments on General."
        checked={form.value.general.enablePartialPayments}
        onChange={(enablePartialPayments) => form.patch('general', { enablePartialPayments })}
      />
      <ToggleRow
        label="Allow Overpayments"
        description="Accept a payment above the balance; the extra stays as credit."
        checked={p.allowOverpayments}
        onChange={(allowOverpayments) => set({ allowOverpayments })}
      />
      <ToggleRow
        label="Enable AutoPay"
        description="Clients can save a card or bank account and pay invoices automatically."
        checked={p.autoPay}
        onChange={(autoPay) => set({ autoPay })}
      />
      <ToggleRow
        label="Send Receipts Automatically"
        description="Email a receipt to the client after each completed payment."
        checked={p.sendReceipts}
        onChange={(sendReceipts) => set({ sendReceipts })}
      />
    </div>
  );
}

function Refunds({ form }: { form: SettingsForm }) {
  const refunders = form.value.permissions.ISSUE_REFUNDS;
  return (
    <div className="flex flex-col gap-4">
      <ToggleRow
        label="Require a Refund Reason"
        description="A refund can't be confirmed without a reason, which goes to the audit log."
        checked={form.value.payments.requireRefundReason}
        onChange={(requireRefundReason) => form.patch('payments', { requireRefundReason })}
      />
      <CheckboxGroup
        legend="Who can issue refunds"
        options={optionsOf(ADMIN_ROLES, ADMIN_ROLE_LABELS)}
        value={refunders}
        hint="The same as Issue refunds on Permissions."
        columns="sm:grid-cols-2 xl:grid-cols-4"
        onChange={(ISSUE_REFUNDS) => form.patch('permissions', { ISSUE_REFUNDS })}
      />
    </div>
  );
}
