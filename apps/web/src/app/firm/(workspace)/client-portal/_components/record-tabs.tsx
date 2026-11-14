'use client';

import type { InvoiceStatus, TaxReturnStatus } from '@firmivra/types';
import { Badge, Button, Card } from '@firmivra/ui';
import { CalendarPlus, ChatCircleText, FilePlus, Megaphone, Receipt } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { dayText, timeText } from './activity-labels';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const DAY_MS = 86_400_000;

function Section({
  title,
  testId,
  actions,
  children,
}: {
  title: string;
  testId: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0" data-testid={testId}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-heading">{title}</h2>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </Card>
  );
}

/** The client's conversations with the firm (canonical Messages), newest first, with unread. */
export function PortalMessages({
  clientId,
  communications = false,
}: {
  clientId: string;
  communications?: boolean;
}) {
  const router = useRouter();
  const threads = useApiQuery(['client-portal', 'threads', clientId], () =>
    api.messages.listForClient(clientId),
  );
  return (
    <Section
      title={communications ? 'Communications' : 'Messages'}
      testId="portal-messages"
      actions={
        <>
          <Button
            onClick={() => router.push(`/messages/new?clientId=${encodeURIComponent(clientId)}`)}
          >
            <ChatCircleText aria-hidden className="size-4" /> New Message
          </Button>
          {communications ? (
            <Button variant="outline" onClick={() => router.push('/communications')}>
              <Megaphone aria-hidden className="size-4" /> Communications
            </Button>
          ) : null}
        </>
      }
    >
      {communications ? (
        <p className="mb-3 text-sm text-muted">
          The firm&apos;s secure portal messages with this client. Announcements and campaigns are
          sent from Communications.
        </p>
      ) : null}
      <PageState
        query={threads}
        empty="No messages with this client yet."
        isEmpty={(d) => d.items.length === 0}
      >
        {(d) => (
          <ul className="flex flex-col divide-y divide-divider">
            {d.items.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/clients/${clientId}/messages?thread=${t.id}`)}
                  className="flex w-full items-start gap-3 py-3 text-left hover:bg-canvas"
                >
                  <ChatCircleText aria-hidden className="mt-0.5 size-5 text-action" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold text-heading">{t.subject}</span>
                      {t.unreadCount > 0 ? (
                        <Badge tone="info">{t.unreadCount} unread</Badge>
                      ) : (
                        <Badge tone="neutral">Read</Badge>
                      )}
                    </span>
                    {t.lastMessage ? (
                      <span className="block truncate text-sm text-muted">
                        {t.lastMessage.senderName}: {t.lastMessage.excerpt}
                      </span>
                    ) : null}
                  </span>
                  {t.lastMessage ? (
                    <span className="text-xs whitespace-nowrap text-muted">
                      {dayText(t.lastMessage.createdAt)}
                    </span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PageState>
    </Section>
  );
}

/** Upcoming and past appointments of the client (canonical Appointments, 60 days each way). */
export function PortalAppointments({ clientId }: { clientId: string }) {
  const router = useRouter();
  // The calendar list reads at most 62 days at a time: the next 60 and the past 60.
  const [now] = useState(() => Date.now());
  const upcoming = useApiQuery(['client-portal', 'appointments', clientId, 'next'], () =>
    api.appointments.list({
      clientId,
      from: new Date(now).toISOString(),
      to: new Date(now + 60 * DAY_MS).toISOString(),
    }),
  );
  const past = useApiQuery(['client-portal', 'appointments', clientId, 'past'], () =>
    api.appointments.list({
      clientId,
      from: new Date(now - 60 * DAY_MS).toISOString(),
      to: new Date(now).toISOString(),
    }),
  );
  const rows = (items: NonNullable<typeof upcoming.data>) => (
    <ul className="flex flex-col divide-y divide-divider">
      {items.map((a) => (
        <li key={a.id}>
          <button
            type="button"
            onClick={() => router.push(`/calendar/${a.id}`)}
            className="flex w-full items-center gap-3 py-3 text-left hover:bg-canvas"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-heading">
                {a.restricted ? 'Busy' : (a.type?.name ?? 'Appointment')}
              </span>
              <span className="block text-sm text-muted">
                {dayText(a.startsAt)} {timeText(a.startsAt)} · {a.staff.name}
              </span>
            </span>
            <Badge
              tone={
                a.status === 'SCHEDULED' ? 'info' : a.status === 'COMPLETED' ? 'success' : 'neutral'
              }
            >
              {a.status.charAt(0) + a.status.slice(1).toLowerCase().replace('_', ' ')}
            </Badge>
          </button>
        </li>
      ))}
    </ul>
  );
  return (
    <Section
      title="Appointments"
      testId="portal-appointments"
      actions={
        <Button
          onClick={() => router.push(`/calendar/new?clientId=${encodeURIComponent(clientId)}`)}
        >
          <CalendarPlus aria-hidden className="size-4" /> Schedule
        </Button>
      }
    >
      <h3 className="mb-1 font-semibold text-heading">Upcoming</h3>
      <PageState
        query={upcoming}
        empty="Nothing scheduled in the next 60 days."
        isEmpty={(d) => d.length === 0}
      >
        {rows}
      </PageState>
      <h3 className="mt-4 mb-1 font-semibold text-heading">Past 60 days</h3>
      <PageState
        query={past}
        empty="No appointments in the past 60 days."
        isEmpty={(d) => d.length === 0}
      >
        {rows}
      </PageState>
    </Section>
  );
}

const RETURN_STATUS: Record<
  TaxReturnStatus,
  { label: string; tone: 'info' | 'success' | 'danger' | 'neutral' }
> = {
  IN_PROGRESS: { label: 'In Progress', tone: 'info' },
  FILED: { label: 'Filed', tone: 'info' },
  ACCEPTED: { label: 'Accepted', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  COMPLETED: { label: 'Completed', tone: 'success' },
};

/** The client's personal and business returns (canonical Tax Returns). */
export function PortalTaxReturns({ clientId }: { clientId: string }) {
  const router = useRouter();
  const returns = useApiQuery(['client-portal', 'tax-returns', clientId], () =>
    api.taxReturns.listForClient(clientId),
  );
  return (
    <Section title="Tax Returns" testId="portal-tax-returns">
      <PageState
        query={returns}
        empty="No tax returns for this client yet."
        isEmpty={(d) => d.length === 0}
      >
        {(d) => (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Tax Year</th>
                  <th className="py-2 pr-3 font-medium">Return Type</th>
                  <th className="py-2 pr-3 font-medium">Form</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium">Filed</th>
                </tr>
              </thead>
              <tbody>
                {d.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-t border-divider hover:bg-canvas"
                    onClick={() => router.push(`/tax-returns/${r.id}`)}
                  >
                    <td className="py-2 pr-3 font-semibold text-heading">
                      {r.taxYear}
                      {r.quarter ? ` Q${r.quarter}` : ''}
                    </td>
                    <td className="py-2 pr-3 text-text">
                      {r.filingType === 'BUSINESS' ? 'Business' : 'Personal'}
                    </td>
                    <td className="py-2 pr-3 text-text">{r.formType ?? '—'}</td>
                    <td className="py-2 pr-3">
                      <Badge tone={RETURN_STATUS[r.status].tone}>
                        {RETURN_STATUS[r.status].label}
                      </Badge>
                    </td>
                    <td className="py-2 text-text">
                      {r.filedOn ? dayText(`${r.filedOn}T12:00:00Z`) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageState>
    </Section>
  );
}

const INVOICE_STATUS: Record<
  InvoiceStatus,
  { label: string; tone: 'info' | 'success' | 'danger' | 'neutral' | 'warning' }
> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SCHEDULED: { label: 'Scheduled', tone: 'info' },
  OPEN: { label: 'Open', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  CANCELED: { label: 'Canceled', tone: 'neutral' },
};

/** Invoices, balances and status (canonical Invoices & Payments), with the outstanding total. */
export function PortalInvoices({ clientId }: { clientId: string }) {
  const router = useRouter();
  const invoices = useApiQuery(['client-portal', 'invoices', clientId], () =>
    api.invoices.list({ clientId, limit: 50 }),
  );
  const owed = (invoices.data?.items ?? [])
    .filter((i) => i.status === 'OPEN')
    .reduce((sum, i) => sum + i.balanceDueCents, 0);
  return (
    <Section
      title="Invoices & Payments"
      testId="portal-invoices"
      actions={
        <Button
          onClick={() => router.push(`/invoices/new?clientId=${encodeURIComponent(clientId)}`)}
        >
          <FilePlus aria-hidden className="size-4" /> New Invoice
        </Button>
      }
    >
      <p className="mb-3 flex items-center gap-2 text-sm text-text">
        <Receipt aria-hidden className="size-4 text-action" /> Outstanding balance:{' '}
        <span className={`font-semibold ${owed > 0 ? 'text-danger' : 'text-success'}`}>
          {money.format(owed / 100)}
        </span>
      </p>
      <PageState
        query={invoices}
        empty="No invoices for this client yet."
        isEmpty={(d) => d.items.length === 0}
      >
        {(d) => (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Invoice</th>
                  <th className="py-2 pr-3 font-medium">Title</th>
                  <th className="py-2 pr-3 font-medium">Due</th>
                  <th className="py-2 pr-3 font-medium">Total</th>
                  <th className="py-2 pr-3 font-medium">Balance</th>
                  <th className="py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map((i) => (
                  <tr
                    key={i.id}
                    className="cursor-pointer border-t border-divider hover:bg-canvas"
                    onClick={() => router.push(`/invoices/${i.id}`)}
                  >
                    <td className="py-2 pr-3 font-semibold text-heading">{i.number}</td>
                    <td className="py-2 pr-3 text-text">{i.title}</td>
                    <td className="py-2 pr-3 text-text">
                      {i.dueOn ? dayText(`${i.dueOn}T12:00:00Z`) : '—'}
                    </td>
                    <td className="py-2 pr-3 text-text">{money.format(i.totalCents / 100)}</td>
                    <td className="py-2 pr-3 text-text">{money.format(i.balanceDueCents / 100)}</td>
                    <td className="py-2">
                      <Badge tone={INVOICE_STATUS[i.status].tone}>
                        {INVOICE_STATUS[i.status].label}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PageState>
    </Section>
  );
}
