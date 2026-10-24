'use client';

import {
  BILLING_PAYMENT_METHOD_LABELS,
  FIRM_BILLING_INVOICE_RANGE_LABELS,
  type FirmBillingInvoiceRange,
  type FirmBillingOverview,
  type FirmBillingRequest,
  type FirmBillingRequestKind,
  PROFILE_CHANGE_STATUS_LABELS,
  SUBSCRIPTION_CYCLE_LABELS,
  type SupportTicketStatus,
} from '@firmivra/types';
import { Badge, Button, Callout, Select, Table, Toast } from '@firmivra/ui';
import {
  ArrowDown,
  ArrowUp,
  ChartBar,
  CreditCard,
  DownloadSimple,
  Eye,
  FileText,
  Info,
  PencilSimple,
  Receipt,
  Rocket,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { Loaded, Quiet, SettingsCard, SettingsHeader } from '../../_components/settings-parts';
import {
  BILLING,
  ChangePlanModal,
  ContactModal,
  InvoiceModal,
  PlanDetailsModal,
  UsageModal,
} from './billing-dialogs';
import {
  INVOICE_TONES,
  SUBSCRIPTION_TONES,
  day,
  invoiceLabel,
  money,
  per,
  period,
  subscriptionLabel,
} from './billing-format';

/** What a card says until Firmivra connects the firm's subscription. */
const NOT_CONNECTED = 'Your Firmivra subscription is not connected to this workspace yet.';
/** Plan changes stop while the subscription is not in force. */
const ENDED = new Set(['SUSPENDED', 'EXPIRED', 'CANCELLED']);

const REQUEST_TONES: Record<SupportTicketStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  OPEN: 'info',
  IN_PROGRESS: 'info',
  WAITING_ON_CUSTOMER: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

type Dialog =
  | { kind: 'plan' }
  | { kind: 'usage' }
  | { kind: 'change'; direction: 'UPGRADE' | 'DOWNGRADE' }
  | { kind: 'contact' }
  | { kind: 'invoice'; id: string };

/** The newest request of a kind, its status and Firmivra's latest reply. */
function RequestLine({
  requests,
  kind,
}: {
  requests: readonly FirmBillingRequest[];
  kind: FirmBillingRequestKind;
}) {
  const latest = requests.find((r) => r.kind === kind);
  if (!latest) return null;
  return (
    <div data-testid={`billing-request-${kind.toLowerCase()}`} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone={REQUEST_TONES[latest.status]} dot>
          {PROFILE_CHANGE_STATUS_LABELS[latest.status]}
        </Badge>
        <span className="font-semibold text-heading">Request {latest.number}</span>
        <span className="text-muted">
          {latest.summary} · sent {new Date(latest.submittedAt).toLocaleDateString('en-US')}
        </span>
      </div>
      {latest.latestReply ? (
        <p className="text-sm text-text">
          <span className="font-semibold text-heading">Firmivra: </span>
          {latest.latestReply.body}
        </p>
      ) : null}
    </div>
  );
}

/** One measure's bar: in use against its allowance ("8 / 10"). */
function Meter({ label, used, allowed }: { label: string; used: number; allowed: number | null }) {
  const percent = allowed ? Math.min(100, Math.round((used * 100) / allowed)) : 0;
  return (
    <div className="grid grid-cols-[7rem_1fr_auto] items-center gap-3 text-sm">
      <span className="text-heading">{label}</span>
      <span
        role="progressbar"
        aria-label={`${label}: ${used} of ${allowed ?? 'no limit'}`}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-2.5 overflow-hidden rounded-pill bg-disabled"
      >
        <span
          className={`block h-full rounded-pill ${allowed !== null && used > allowed ? 'bg-danger' : percent >= 100 ? 'bg-gold' : 'bg-action'}`}
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="text-right font-semibold text-heading">
        {used} / {allowed ?? 'No limit'}
      </span>
    </div>
  );
}

function PlanCard({ data, open }: { data: FirmBillingOverview; open: (d: Dialog) => void }) {
  const s = data.subscription;
  if (!s) return <Quiet>{NOT_CONNECTED}</Quiet>;
  const can = (direction: 'UPGRADE' | 'DOWNGRADE') =>
    data.plans.some((p) => p.direction === direction);
  const ended = ENDED.has(s.status);
  return (
    <>
      <div className="flex flex-col gap-1 text-sm text-text">
        <p className="font-semibold text-heading">
          {s.plan.name} · {money(s.priceCents)}
          {per(s.billingCycle)}
        </p>
        <p>Billing cycle: {SUBSCRIPTION_CYCLE_LABELS[s.billingCycle]}</p>
        <p>Next billing date: {s.nextBillingOn ? day(s.nextBillingOn) : 'None scheduled'}</p>
        {s.trialEndsOn && s.status === 'TRIAL' ? <p>Trial ends: {day(s.trialEndsOn)}</p> : null}
        {s.accessEndsOn ? <p>Access ends: {day(s.accessEndsOn)}</p> : null}
      </div>
      <hr className="border-divider" />
      {ended ? (
        <p className="text-sm text-muted">
          Plan changes are not available while the subscription is{' '}
          {subscriptionLabel(s.status).toLowerCase()}. Contact Firmivra Support to restore it.
        </p>
      ) : (
        <p className="text-sm text-muted">
          Review pricing and effective date before confirming a plan change.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {ended ? null : (
          <>
            <Button
              disabled={!can('UPGRADE')}
              title={can('UPGRADE') ? undefined : 'You are on the highest plan'}
              onClick={() => open({ kind: 'change', direction: 'UPGRADE' })}
            >
              <ArrowUp aria-hidden weight="bold" className="size-4" />
              Upgrade Plan
            </Button>
            <Button
              variant="outline"
              disabled={!can('DOWNGRADE')}
              title={can('DOWNGRADE') ? undefined : 'You are on the lowest plan'}
              onClick={() => open({ kind: 'change', direction: 'DOWNGRADE' })}
            >
              <ArrowDown aria-hidden weight="bold" className="size-4" />
              Downgrade Plan
            </Button>
          </>
        )}
        <Button variant="outline" onClick={() => open({ kind: 'plan' })}>
          <FileText aria-hidden weight="fill" className="size-4" />
          View plan details
        </Button>
      </div>
      <RequestLine requests={data.requests} kind="PLAN_CHANGE" />
    </>
  );
}

function InvoicesCard({ open }: { open: (d: Dialog) => void }) {
  const [range, setRange] = useState<FirmBillingInvoiceRange>('6M');
  const [page, setPage] = useState(1);
  const size = 10;
  const list = useApiQuery([...BILLING, 'invoices', range, page], () =>
    api.firmBilling.invoices({ range, page, pageSize: size }),
  );
  return (
    <SettingsCard
      title="Invoices"
      subtitle="Firmivra subscription invoices • newest first."
      icon={FileText}
      testId="billing-invoices"
      action={
        <div className="w-48">
          <Select
            label="Invoice period"
            hideLabel
            value={range}
            options={(
              Object.keys(FIRM_BILLING_INVOICE_RANGE_LABELS) as FirmBillingInvoiceRange[]
            ).map((r) => ({ value: r, label: FIRM_BILLING_INVOICE_RANGE_LABELS[r] }))}
            onChange={(e) => {
              setRange(e.target.value as FirmBillingInvoiceRange);
              setPage(1);
            }}
          />
        </div>
      }
    >
      {list.isError ? (
        <Quiet>Invoices can&apos;t be loaded right now. Try again in a moment.</Quiet>
      ) : (
        <Table
          rows={list.data?.items ?? []}
          rowKey={(r) => r.id}
          caption="Subscription invoices"
          loading={list.isPending}
          dense
          noun="invoices"
          emptyTitle="No invoices to show"
          emptyText="Firmivra has not issued an invoice in this period."
          server={{
            page: list.data?.page ?? 1,
            total: list.data?.total ?? 0,
            hasNext: (list.data?.page ?? 1) * size < (list.data?.total ?? 0),
            hasPrevious: (list.data?.page ?? 1) > 1,
            onNext: () => setPage(page + 1),
            onPrevious: () => setPage(Math.max(1, page - 1)),
            onPage: (n: number) => setPage(n),
            onSort: () => undefined,
          }}
          columns={[
            { id: 'number', label: 'Invoice', cell: (r) => r.number },
            { id: 'date', label: 'Date', cell: (r) => day(r.invoiceDate) },
            { id: 'amount', label: 'Amount', cell: (r) => money(r.totalCents) },
            {
              id: 'status',
              label: 'Status',
              cell: (r) => (
                <Badge tone={INVOICE_TONES[r.status]} dot>
                  {invoiceLabel(r.status)}
                </Badge>
              ),
            },
            {
              id: 'actions',
              label: 'Actions',
              cell: (r) => (
                <span className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    aria-label={`View ${r.number}`}
                    onClick={() => open({ kind: 'invoice', id: r.id })}
                  >
                    <Eye aria-hidden weight="fill" className="size-4" />
                    View
                  </Button>
                  <a
                    href={api.firmBilling.invoicePdfUrl(r.id)}
                    aria-label={`Download ${r.number} as PDF`}
                    className="inline-flex min-h-11 items-center gap-2 rounded-control border border-action px-4 text-sm font-medium text-action hover:bg-folder-surface"
                  >
                    <DownloadSimple aria-hidden weight="bold" className="size-4" />
                    Download PDF
                  </a>
                </span>
              ),
            },
          ]}
        />
      )}
    </SettingsCard>
  );
}

/** The middle card: Payment Method on the left, Billing Details on the right. */
function MethodAndDetails({
  data,
  loading,
  open,
}: {
  data: FirmBillingOverview | undefined;
  loading: boolean;
  open: (d: Dialog) => void;
}) {
  const half = (title: string, subtitle: string, testId: string, body: ReactNode) => (
    <div data-testid={testId} className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-info-soft text-action"
        >
          {testId === 'billing-method' ? (
            <CreditCard weight="fill" className="size-6" />
          ) : (
            <Receipt weight="fill" className="size-6" />
          )}
        </span>
        <div>
          <h2 className="text-lg font-bold text-heading">{title}</h2>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
      </div>
      {body}
    </div>
  );
  const query = { isPending: loading, data };
  return (
    <section
      aria-label="Payment Method and Billing Details"
      className="grid gap-4 rounded-xl border border-divider bg-surface p-4 shadow-sm lg:grid-cols-[1.6fr_1fr] lg:divide-x lg:divide-divider"
    >
      {half(
        'Payment Method',
        'The card or account your subscription is paid with.',
        'billing-method',
        <Loaded query={query}>
          {(d) => (
            <>
              <div className="rounded-lg bg-subtle p-4 text-sm">
                <p className="font-semibold text-heading">No payment method on file</p>
                <p className="text-muted">
                  Firmivra records your subscription payments. Card payments to Firmivra are not set
                  up yet, so no card or account is saved here.
                </p>
              </div>
              {d.lastPayment ? (
                <p className="text-sm text-text">
                  Last payment: {BILLING_PAYMENT_METHOD_LABELS[d.lastPayment.method]},{' '}
                  {money(d.lastPayment.amountCents)} on {day(d.lastPayment.paidOn)} (
                  {d.lastPayment.invoiceNumber})
                </p>
              ) : (
                <p className="text-sm text-muted">No payment recorded yet.</p>
              )}
            </>
          )}
        </Loaded>,
      )}
      <div className="lg:pl-4">
        {half(
          'Billing Details',
          'Your billing contact and address.',
          'billing-details',
          <Loaded query={query}>
            {(d) => {
              const b = d.billingDetails;
              return (
                <>
                  <div className="flex flex-col text-sm text-heading">
                    <p className="font-semibold">{b.legalName ?? b.companyName}</p>
                    {b.address.length ? (
                      b.address.map((line) => <p key={line}>{line}</p>)
                    ) : (
                      <p className="text-muted">No address on Company Profile yet.</p>
                    )}
                    <p className="mt-2">
                      {b.contactName ?? 'No billing contact recorded'}
                      {b.contactEmail ? (
                        <span className="block text-muted">{b.contactEmail}</span>
                      ) : null}
                    </p>
                    {b.paymentTermDays ? (
                      <p className="text-muted">Payment terms: {b.paymentTermDays} days</p>
                    ) : null}
                  </div>
                  <Button
                    variant="outline"
                    className="w-fit"
                    onClick={() => open({ kind: 'contact' })}
                  >
                    <PencilSimple aria-hidden weight="fill" className="size-4" />
                    Edit Billing Details
                  </Button>
                  <RequestLine requests={d.requests} kind="BILLING_CONTACT" />
                </>
              );
            }}
          </Loaded>,
        )}
      </div>
    </section>
  );
}

/**
 * Settings > Billing & Subscriptions (firmivra-billing-subscriptions-dashboard-1.jpg; her Billing
 * guide of Oct 18): the current plan with Upgrade, Downgrade and View plan details; the current
 * billing period's usage; Payment Method and Billing Details; and the invoices with View and
 * Download PDF. A plan change or a new billing contact is a request to Firmivra
 * (`api.firmBilling`). Client payments are Payments & Payouts, not this page.
 */
export function BillingScreen() {
  const overview = useApiQuery(BILLING, () => api.firmBilling.overview());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [sent, setSent] = useState<FirmBillingRequest | null>(null);
  const data = overview.data;
  const s = data?.subscription;
  const done = (request: FirmBillingRequest) => {
    setDialog(null);
    setSent(request);
  };
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={CreditCard}
        title="Billing & Subscriptions"
        subtitle="Manage your company's Firmivra subscription."
      />
      {sent ? (
        <Toast
          message={`Request ${sent.number} sent to Firmivra. Its status shows on this page.`}
          onDismiss={() => setSent(null)}
        />
      ) : null}
      {s?.status === 'PAST_DUE' ? (
        <Callout icon={Info} tone="amber" surface="warning" size="compact">
          A payment is past due. Open the overdue invoice below, or contact Firmivra Support.
        </Callout>
      ) : null}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SettingsCard
          title="Your current plan"
          icon={Rocket}
          tone="purple"
          testId="billing-plan"
          action={
            s ? (
              <Badge tone={SUBSCRIPTION_TONES[s.status]} dot>
                {subscriptionLabel(s.status)}
              </Badge>
            ) : undefined
          }
        >
          <Loaded query={overview}>{(d) => <PlanCard data={d} open={setDialog} />}</Loaded>
        </SettingsCard>
        <SettingsCard
          title="Current billing period"
          icon={ChartBar}
          testId="billing-usage"
          action={
            s?.periodStart && s.periodEnd ? (
              <span className="text-sm text-muted">{period(s.periodStart, s.periodEnd)}</span>
            ) : undefined
          }
        >
          <Loaded query={overview}>
            {(d) => (
              <>
                <div className="flex flex-col gap-3">
                  <Meter label="Staff seats" {...d.usage.seats} />
                  <Meter label="Locations" {...d.usage.locations} />
                </div>
                <hr className="border-divider" />
                <Button
                  variant="outline"
                  className="w-fit"
                  onClick={() => setDialog({ kind: 'usage' })}
                >
                  <ChartBar aria-hidden weight="fill" className="size-4" />
                  View Usage Details
                </Button>
              </>
            )}
          </Loaded>
        </SettingsCard>
      </div>
      <MethodAndDetails data={data} loading={overview.isPending} open={setDialog} />
      <InvoicesCard open={setDialog} />
      <Callout icon={Info} tone="navy" surface="plain" size="compact">
        <span>
          Payments from your clients (invoices you send, Stripe payouts) are in{' '}
          <Link href="/settings/payments" className="font-semibold text-link hover:underline">
            Payments & Payouts
          </Link>
          .
        </span>
      </Callout>
      {dialog?.kind === 'plan' && s ? (
        <PlanDetailsModal subscription={s} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'usage' && data ? (
        <UsageModal overview={data} onClose={() => setDialog(null)} />
      ) : null}
      {dialog?.kind === 'change' && data?.subscription ? (
        <ChangePlanModal
          overview={data}
          direction={dialog.direction}
          onClose={() => setDialog(null)}
          onSent={done}
        />
      ) : null}
      {dialog?.kind === 'contact' && data ? (
        <ContactModal details={data.billingDetails} onClose={() => setDialog(null)} onSent={done} />
      ) : null}
      {dialog?.kind === 'invoice' ? (
        <InvoiceModal id={dialog.id} onClose={() => setDialog(null)} />
      ) : null}
    </div>
  );
}
