'use client';

import { PORTAL_MODULE_LABELS } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import { CheckCircle, Eye, LockSimple, WarningCircle } from '@phosphor-icons/react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { dayText } from '../activity-labels';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * Open Client Portal (developer instructions 3, 14 and 26; the lead's decision of Nov 14): a
 * read-only staff preview of what this client sees in their portal: the firm's heading and
 * welcome, their menu after the firm's and their own switches, and what waits on them. It never
 * uses or opens a client session, has no actions, and opening it is audited.
 */
export function PortalPreview({ clientId }: { clientId: string }) {
  const preview = useApiQuery(['client-portal', 'preview', clientId], () =>
    api.clientPortal.preview(clientId),
  );
  const pending = useApiQuery(['client-portal', 'pending', clientId], () =>
    api.clientPortal.pendingActions(clientId),
  );
  return (
    <div className="@container flex min-w-0 flex-col gap-4" data-testid="portal-preview">
      <p
        role="note"
        className="flex items-center gap-2 rounded-card border border-warning bg-warning-soft px-4 py-3 text-sm text-text"
      >
        <Eye aria-hidden weight="bold" className="size-5 text-warning" />
        Staff preview, read only: what this client sees in their portal. Nothing here acts as the
        client, and this view is recorded.
      </p>
      <PageState query={preview}>
        {(p) => (
          <Card className="!p-0 min-w-0 overflow-hidden">
            <header className="bg-firm-sidebar px-6 py-5 text-on-firm-sidebar">
              <p className="text-sm uppercase tracking-brand">{p.firmName}</p>
              <h2 className="font-display text-2xl font-bold">
                {p.portalHeader ?? 'Client Portal'}
              </h2>
            </header>
            <div className="grid gap-6 p-6 @3xl:grid-cols-[14rem_minmax(0,1fr)]">
              <nav aria-label="The client's portal menu" data-testid="preview-menu">
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">
                  Their menu
                </p>
                <ul className="flex flex-col gap-1 text-sm">
                  <li className="rounded-md bg-canvas px-3 py-2 font-medium text-heading">Home</li>
                  {p.areas.map((a) => (
                    <li
                      key={a.module}
                      className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 ${a.visible ? 'text-text' : 'text-muted line-through'}`}
                    >
                      {PORTAL_MODULE_LABELS[a.module]}
                      {a.visible ? null : <LockSimple aria-label="Hidden" className="size-4" />}
                    </li>
                  ))}
                  <li className="rounded-md px-3 py-2 text-text">My Profile</li>
                </ul>
              </nav>
              <div className="flex min-w-0 flex-col gap-4">
                <div>
                  <h3 className="text-xl font-semibold text-heading">
                    Hi {p.clientName.split(/\s+/)[0]},
                  </h3>
                  <p className="text-text">
                    {p.welcomeMessage ?? 'Welcome to your secure client portal.'}
                  </p>
                </div>
                <section data-testid="preview-next-steps">
                  <h4 className="mb-2 font-semibold text-heading">Your next steps</h4>
                  <PageState
                    query={pending}
                    empty="Nothing is waiting on you right now."
                    isEmpty={(d) => d.items.length === 0}
                  >
                    {(d) => (
                      <ul className="flex flex-col gap-2">
                        {d.items
                          .filter((a) => a.kind !== 'INTAKE_SUBMITTED')
                          .map((a) => (
                            <li
                              key={a.kind}
                              className="flex items-center gap-3 rounded-card border border-divider p-3 text-sm"
                            >
                              {a.overdue ? (
                                <WarningCircle aria-hidden className="size-5 text-danger" />
                              ) : (
                                <CheckCircle aria-hidden className="size-5 text-action" />
                              )}
                              <span className="min-w-0 flex-1">
                                <span className="block font-medium text-heading">
                                  {a.kind === 'INVOICE_OUTSTANDING' && a.amountCents !== null
                                    ? `Pay ${money.format(a.amountCents / 100)} (${a.title})`
                                    : a.title}
                                </span>
                                {a.dueOn || a.at ? (
                                  <span className="block text-muted">
                                    {a.at
                                      ? dayText(a.at)
                                      : `Due ${dayText(`${a.dueOn}T12:00:00Z`)}`}
                                  </span>
                                ) : null}
                              </span>
                              {a.count > 1 ? <Badge tone="info">{a.count}</Badge> : null}
                            </li>
                          ))}
                      </ul>
                    )}
                  </PageState>
                </section>
              </div>
            </div>
          </Card>
        )}
      </PageState>
    </div>
  );
}
