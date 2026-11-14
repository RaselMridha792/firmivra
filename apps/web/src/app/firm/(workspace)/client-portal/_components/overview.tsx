'use client';

import type { ClientPortalSummary, PortalSummaryDays } from '@firmivra/types';
import { Card, IconTile, type KpiTone, Select } from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import {
  CalendarBlank,
  CaretRight,
  ChatCircleText,
  ClipboardText,
  CurrencyDollar,
  FileText,
  Receipt,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../components/page-state';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { activityOf, dayText, timeText } from './activity-labels';
import type { PortalTabId } from './client-panel';

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const RANGES: { value: PortalSummaryDays; label: string }[] = [
  { value: '7', label: 'Last 7 Days' },
  { value: '30', label: 'Last 30 Days' },
  { value: '90', label: 'Last 90 Days' },
];

/** Frame 1's Overview (instructions 4 and 5): Portal Summary and Recent Activity. */
export function PortalOverview({
  clientId,
  onTab,
}: {
  clientId: string;
  onTab: (tab: PortalTabId) => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PortalSummaryCard clientId={clientId} onTab={onTab} />
      <RecentActivity clientId={clientId} />
    </div>
  );
}

interface SummaryTile {
  key: keyof Omit<ClientPortalSummary, 'days'>;
  tab: PortalTabId;
  label: string;
  icon: Icon;
  tone: KpiTone;
  value: (s: ClientPortalSummary) => number | null;
  line: (s: ClientPortalSummary) => { text: string; alert?: boolean } | null;
}

const TILES: SummaryTile[] = [
  {
    key: 'documents',
    tab: 'documents',
    label: 'Documents',
    icon: FileText,
    tone: 'blue',
    value: (s) => s.documents?.added ?? null,
    line: (s) =>
      s.documents
        ? {
            text: `${s.documents.pendingReview} pending review`,
            alert: s.documents.pendingReview > 0,
          }
        : null,
  },
  {
    key: 'messages',
    tab: 'messages',
    label: 'Messages',
    icon: ChatCircleText,
    tone: 'blue',
    value: (s) => s.messages?.inRange ?? null,
    line: (s) =>
      s.messages ? { text: `${s.messages.unread} unread`, alert: s.messages.unread > 0 } : null,
  },
  {
    key: 'appointments',
    tab: 'appointments',
    label: 'Appointments',
    icon: CalendarBlank,
    tone: 'blue',
    value: (s) => s.appointments?.upcoming ?? null,
    line: (s) =>
      s.appointments
        ? {
            text: s.appointments.next ? `Next: ${dayText(s.appointments.next)}` : 'None upcoming',
          }
        : null,
  },
  {
    key: 'taxReturns',
    tab: 'tax-returns',
    label: 'Tax Returns',
    icon: Receipt,
    tone: 'green',
    value: (s) => s.taxReturns?.total ?? null,
    line: (s) => (s.taxReturns ? { text: `${s.taxReturns.inProgress} in progress` } : null),
  },
  {
    key: 'invoices',
    tab: 'invoices',
    label: 'Invoices & Payments',
    icon: CurrencyDollar,
    tone: 'red',
    value: (s) => s.invoices?.issued ?? null,
    line: (s) =>
      s.invoices
        ? {
            text: `${money.format(s.invoices.outstandingCents / 100)} outstanding`,
            alert: s.invoices.outstandingCents > 0,
          }
        : null,
  },
  {
    key: 'intakeForms',
    tab: 'intake-forms',
    label: 'Intake Forms',
    icon: ClipboardText,
    tone: 'purple',
    value: (s) => s.intakeForms?.sent ?? null,
    line: (s) =>
      s.intakeForms
        ? {
            text: `${s.intakeForms.pending} pending${s.intakeForms.needsReview ? `, ${s.intakeForms.needsReview} to review` : ''}`,
          }
        : null,
  },
];

/** Six cards for the range; each opens its tab. A module the member can't see has no card. */
function PortalSummaryCard({
  clientId,
  onTab,
}: {
  clientId: string;
  onTab: (tab: PortalTabId) => void;
}) {
  const [days, setDays] = useState<PortalSummaryDays>('30');
  const summary = useApiQuery(['client-portal', 'summary', clientId, days], () =>
    api.clientPortal.summary(clientId, days),
  );
  return (
    <section data-testid="portal-summary">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-heading">Portal Summary</h3>
          <p className="text-sm text-muted">
            Quick view of your client&apos;s portal activity and records.
          </p>
        </div>
        <div className="w-44">
          <Select
            label="Range"
            hideLabel
            value={days}
            onChange={(e) => setDays(e.target.value as PortalSummaryDays)}
            options={RANGES}
          />
        </div>
      </div>
      <PageState query={summary}>
        {(s) => (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {TILES.filter((t) => s[t.key] !== null).map((t) => {
              const line = t.line(s);
              return (
                <button
                  key={t.key}
                  type="button"
                  data-testid={`summary-${t.key}`}
                  onClick={() => onTab(t.tab)}
                  className="flex items-center gap-3 rounded-card border border-divider bg-surface p-4 text-left hover:bg-canvas"
                >
                  <IconTile icon={t.icon} tone={t.tone} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-heading">{t.label}</span>
                    <span className="block text-2xl font-bold text-heading">{t.value(s)}</span>
                    {line ? (
                      <span
                        className={`block text-sm ${line.alert ? 'text-danger' : 'text-muted'}`}
                      >
                        {line.text}
                      </span>
                    ) : null}
                  </span>
                  <CaretRight aria-hidden className="size-4 text-muted" />
                </button>
              );
            })}
          </div>
        )}
      </PageState>
    </section>
  );
}

/** The latest portal events of this client (developer instructions 4 and 24). */
function RecentActivity({ clientId }: { clientId: string }) {
  const router = useRouter();
  const activity = useApiQuery(['client-portal', 'activity', clientId, 'recent'], () =>
    api.clientPortal.activity(clientId, { limit: 5 }),
  );
  return (
    <Card data-testid="recent-activity">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold text-heading">Recent Activity</h3>
          <p className="text-sm text-muted">Latest portal activity for this client.</p>
        </div>
        <button
          type="button"
          className="text-sm font-medium text-action underline"
          onClick={() => router.push(`/client-portal/${clientId}/activity`)}
        >
          View All Activity
        </button>
      </div>
      <PageState
        query={activity}
        empty="No portal activity recorded yet. Sign-ins, uploads, messages and payments show here as they happen."
        isEmpty={(page) => page.items.length === 0}
      >
        {(page) => (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Date</th>
                  <th className="py-2 pr-4 font-medium">Activity</th>
                  <th className="py-2 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((e) => {
                  const kind = activityOf(e.type);
                  const Glyph = kind.icon;
                  return (
                    <tr key={e.id} className="border-t border-divider">
                      <td className="py-2 pr-4 whitespace-nowrap text-text">
                        {dayText(e.at)} <span className="text-muted">{timeText(e.at)}</span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-2 text-text">
                          <Glyph aria-hidden className="size-4 text-action" /> {kind.label}
                        </span>
                      </td>
                      <td className="py-2 text-muted">
                        {e.actor.name ?? (e.actor.kind === 'CLIENT' ? 'Client' : 'Firmivra')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </PageState>
    </Card>
  );
}
