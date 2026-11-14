'use client';

import { roleCan } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import Link from 'next/link';
import { useFirm } from '../../../../../../components/firm-context';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { dateText } from '../../_components/client-parts';
import { money } from '../../_components/list-parts';

// Clients Review 2 (G11): the client's billing at a glance on Overview, from the client's
// invoices (GET /business/invoices?clientId=, the firm's scope): open invoices and what they
// still owe, how many are overdue, the last payment received (GET /business/invoices/payments
// ?clientId=: Stripe's and recorded ones, partial payments included), and the way into Invoices
// filtered to the client. Shown where the member's role can view Invoices & Payments; the API checks again.

/** The newest 100 invoices are plenty for a client's figures; more says so. */
const LIMIT = 100;

export function BillingCard({ clientId }: { clientId: string }) {
  const { role } = useFirm();
  const may = !!role && roleCan(role, 'INVOICES_PAYMENTS', 'VIEW');
  const q = useApiQuery(['invoices', clientId, 'billing-card'], () =>
    may ? api.invoices.list({ clientId, limit: LIMIT }) : Promise.resolve(null),
  );
  // Any payment since the firm began: the newest received one (voided or refunded ones skipped).
  const payments = useApiQuery(['invoices', clientId, 'billing-card', 'payments'], () =>
    may
      ? api.invoices.payments({ clientId, from: '2000-01-01', pageSize: 25 })
      : Promise.resolve(null),
  );
  if (!may) return null;
  const items = q.data?.items ?? [];
  const open = items.filter((i) => i.status === 'OPEN');
  const balance = open.reduce((n, i) => n + i.balanceDueCents, 0);
  const overdue = open.filter((i) => i.overdue).length;
  const last = payments.data?.items.find((p) => p.status === 'RECEIVED');
  const facts: [string, string][] = [
    ['Open invoices', String(open.length)],
    ['Balance due', money(balance)],
    ['Overdue', String(overdue)],
    [
      'Last payment',
      payments.isError
        ? 'Not available'
        : last
          ? `${dateText(`${last.receivedOn}T12:00:00Z`)} · ${money(last.amountCents)}`
          : payments.isPending
            ? 'Loading…'
            : 'None yet',
    ],
  ];
  return (
    <Card
      title={
        <span className="flex flex-wrap items-center justify-between gap-2">
          Billing
          <Link
            href={`/clients/${clientId}/invoices`}
            className="text-sm font-medium text-link hover:underline"
          >
            View Invoices
          </Link>
        </span>
      }
    >
      <div data-testid="client-billing">
        {q.isError ? (
          <p role="alert" className="text-sm text-danger">
            Billing is not available right now.
          </p>
        ) : q.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              {facts.map(([label, value]) => (
                <div key={label} className="flex min-w-0 flex-col gap-1">
                  <dt className="text-xs font-medium text-muted">{label}</dt>
                  <dd
                    className={`text-sm font-semibold wrap-anywhere ${
                      label === 'Overdue' && overdue > 0 ? 'text-danger' : 'text-heading'
                    }`}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {q.data?.nextCursor ? (
              <p className="mt-3 text-xs text-muted">
                From the newest {LIMIT} invoices; Invoices lists them all.
              </p>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
