'use client';

import type { ClientOverviewSummary } from '@firmivra/types';
import { KpiCard, type KpiTone } from '@firmivra/ui';
import {
  Briefcase,
  CalendarBlank,
  ChatCircleDots,
  ClipboardText,
  CurrencyDollar,
  FileX,
} from '@phosphor-icons/react';
import { OriginLink } from '../../../../../../components/origin-link';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { money } from '../../_components/list-parts';

type Card = {
  key: string;
  label: string;
  icon: typeof CurrencyDollar;
  tone: KpiTone;
  value: (s: ClientOverviewSummary) => string;
  note?: (s: ClientOverviewSummary) => string | undefined;
  /** Where the card opens (Back comes to this client); null when there is nothing to open. */
  href: (s: ClientOverviewSummary, clientId: string) => string | null;
};

/** "Nov 24, 2026" and "2:00 PM": the appointment in the firm's time zone. */
function when(iso: string, timeZone: string): [string, string] {
  const at = new Date(iso);
  return [
    at.toLocaleDateString('en-US', { timeZone, month: 'short', day: 'numeric', year: 'numeric' }),
    at.toLocaleTimeString('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }),
  ];
}

const CARDS: Card[] = [
  {
    key: 'balance',
    label: 'Balance due',
    icon: CurrencyDollar,
    tone: 'red',
    value: (s) => money(s.balanceDueCents),
    note: (s) =>
      s.openInvoices
        ? `${s.openInvoices} open invoice${s.openInvoices === 1 ? '' : 's'}`
        : undefined,
    href: (_, id) => `/clients/${id}/invoices`,
  },
  {
    key: 'documents',
    label: 'Missing documents',
    icon: FileX,
    tone: 'amber',
    value: (s) => String(s.missingDocuments),
    href: (_, id) => `/clients/${id}/documents`,
  },
  {
    key: 'messages',
    label: 'Unread messages',
    icon: ChatCircleDots,
    tone: 'blue',
    value: (s) => String(s.unreadMessages),
    href: (_, id) => `/clients/${id}/messages?unread=1`,
  },
  {
    key: 'intake',
    label: 'Open intake forms',
    icon: ClipboardText,
    tone: 'purple',
    value: (s) => String(s.openIntakeForms),
    href: (_, id) => `/clients/${id}/intake-forms`,
  },
  {
    key: 'services',
    label: 'Active services',
    icon: Briefcase,
    tone: 'green',
    value: (s) => String(s.activeServices),
    href: (_, id) => `/clients/${id}/services`,
  },
  {
    key: 'appointment',
    label: 'Next appointment',
    icon: CalendarBlank,
    tone: 'blue',
    value: (s) => (s.nextAppointment ? when(s.nextAppointment.startsAt, s.timeZone)[0] : 'None'),
    note: (s) =>
      s.nextAppointment
        ? [when(s.nextAppointment.startsAt, s.timeZone)[1], s.nextAppointment.typeName]
            .filter(Boolean)
            .join(' · ')
        : 'None scheduled',
    href: (s) => (s.nextAppointment ? `/calendar/${s.nextAppointment.id}` : null),
  },
];

/**
 * Clients Review 2 N8-12: the client's summaries at the top of Overview (GET
 * /business/clients/{id}/summary): balance due, missing documents, unread messages, open intake
 * forms, active services and the next appointment, each counted from the place its card opens:
 * the client's Invoices, Documents, Messages (unread), Intake Forms and Services tabs, and the
 * appointment itself, each with Back to this client. Dates are the firm's.
 */
export function ClientSummaryCards({ clientId }: { clientId: string }) {
  const q = useApiQuery(['clients', clientId, 'overview-summary'], () =>
    api.clients.overviewSummary(clientId),
  );
  const s = q.data;
  return (
    <section
      aria-label="Client summaries"
      data-testid="client-summary"
      className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3 lg:col-span-2"
    >
      {q.isError ? (
        <p role="alert" className="text-sm text-danger sm:col-span-2 xl:col-span-3">
          The client&apos;s summaries are not available right now.
        </p>
      ) : (
        CARDS.map((c) => {
          const card = (
            <KpiCard
              icon={c.icon}
              tone={c.tone}
              label={c.label}
              loading={q.isPending}
              value={s ? c.value(s) : '—'}
              note={s ? c.note?.(s) : undefined}
              align="top"
            />
          );
          const href = s ? c.href(s, clientId) : null;
          return href ? (
            <OriginLink
              key={c.key}
              href={href}
              data-testid={`summary-${c.key}`}
              className="block rounded-xl hover:brightness-95 focus-visible:outline-2 focus-visible:outline-focus"
            >
              {card}
            </OriginLink>
          ) : (
            <div key={c.key} data-testid={`summary-${c.key}`}>
              {card}
            </div>
          );
        })
      )}
    </section>
  );
}
