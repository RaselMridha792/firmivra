'use client';

import { Callout, Table } from '@firmivra/ui';
import { ChartBar, CreditCard, Info, Receipt, Rocket } from '@phosphor-icons/react';
import Link from 'next/link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import {
  Facts,
  Loaded,
  Quiet,
  SettingsCard,
  SettingsHeader,
} from '../../_components/settings-parts';

/** What each card says until Firmivra's subscription billing is connected for the firm. */
const NOT_CONNECTED = 'Your Firmivra subscription is not connected to this workspace yet.';

/**
 * Settings > Billing & Subscriptions (guide §11: plan, cycle, invoices, payment method, usage and
 * plan-change rules). No billing contract exists yet (Settings contract, "Pages with a menu item
 * but no design"), so Plan, Payment Method and Invoices keep their frames with a quiet line and
 * nothing invented; Usage shows the firm's staff users (`api.users.summary`). Client payments
 * are Payments & Payouts, not this page.
 */
export function BillingScreen() {
  const summary = useApiQuery(['users', 'summary'], () => api.users.summary());
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={CreditCard}
        title="Billing & Subscriptions"
        subtitle="Your Firmivra plan, usage, payment method, and invoices."
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SettingsCard
          title="Current Plan"
          subtitle="Your plan and billing cycle."
          icon={Rocket}
          tone="purple"
          testId="billing-plan"
        >
          <Quiet>{NOT_CONNECTED}</Quiet>
        </SettingsCard>
        <SettingsCard
          title="Usage"
          subtitle="What your firm uses today."
          icon={ChartBar}
          testId="billing-usage"
        >
          <Loaded query={summary}>
            {(s) => (
              <Facts
                rows={[
                  ['Staff users', s.total],
                  ['Active staff users', s.active],
                  ['Pending invitations', s.pendingInvitations],
                ]}
              />
            )}
          </Loaded>
        </SettingsCard>
        <SettingsCard
          title="Payment Method"
          subtitle="The card or account your subscription is paid with."
          icon={CreditCard}
          testId="billing-method"
        >
          <Quiet>{NOT_CONNECTED}</Quiet>
          <p className="text-xs text-muted">
            Card numbers are never stored in Firmivra; the payment provider keeps them.
          </p>
        </SettingsCard>
        <SettingsCard
          title="Invoices"
          subtitle="Your Firmivra invoices, newest first."
          icon={Receipt}
          testId="billing-invoices"
          className="lg:col-span-2"
        >
          <Table
            rows={[] as { id: string }[]}
            rowKey={(r) => r.id}
            caption="Subscription invoices"
            dense
            showPagination={false}
            columns={[
              { id: 'date', label: 'Date', cell: () => '' },
              { id: 'number', label: 'Invoice', cell: () => '' },
              { id: 'amount', label: 'Amount', cell: () => '' },
              { id: 'status', label: 'Status', cell: () => '' },
            ]}
            emptyTitle="No invoices to show"
            emptyText={NOT_CONNECTED}
          />
        </SettingsCard>
      </div>
      <Callout icon={Info} tone="navy" surface="plain" size="compact">
        Payments from your clients (invoices you send, Stripe payouts) are in{' '}
        <Link href="/settings/payments" className="font-semibold text-link hover:underline">
          Payments & Payouts
        </Link>
        . Plan changes and billing questions go to Firmivra Support.
      </Callout>
    </div>
  );
}
