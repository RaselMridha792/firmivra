'use client';

import { Button, Card, IconTile, type KpiTone } from '@firmivra/ui';
import {
  ArrowRight,
  Clock,
  Database,
  DeviceMobile,
  FileText,
  Flag,
  Info,
  Key,
  Lock,
  LockKey,
  LockSimpleOpen,
  MagnifyingGlass,
  MapPin,
  PaperPlaneTilt,
  Plugs,
  Prohibit,
  UserGear,
  UserMinus,
  WarningCircle,
  type Icon,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type {
  AuditEventDetail,
  AvailableAction,
  QuickFact,
  ResponseAction,
  RiskKind,
} from '../../../../../../../mocks/admin-audit-security';
import {
  formatClock,
  formatStamp,
  Loaded,
  QuietLine,
  SEVERITY_LABELS,
} from '../../../_components/audit-parts';

/** The right column of the event details (firmivra-audit-security-event-dashboard.jpg). */

type DetailQuery = UseQueryResult<AuditEventDetail>;

function RailCard({
  title,
  icon,
  tone,
  testId,
  children,
}: {
  title: string;
  icon: Icon;
  tone: KpiTone;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Card data-testid={testId} className="flex min-w-0 items-start gap-4 p-5!">
      <IconTile icon={icon} tone={tone} />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <h2 className="text-lg font-bold text-heading">{title}</h2>
        {children}
      </div>
    </Card>
  );
}

const RISK_ICONS: Record<RiskKind, Icon> = {
  attempts: WarningCircle,
  device: DeviceMobile,
  time: Clock,
  lock: LockKey,
  privilege: UserGear,
  data: Database,
  integration: Plugs,
  location: MapPin,
};

export function RiskIndicators({ query }: { query: DetailQuery }) {
  return (
    <RailCard title="Risk Indicators" icon={MagnifyingGlass} tone="red" testId="risk-indicators">
      <Loaded query={query} rows={4}>
        {({ event }) => (
          <>
            {event.risk.indicators.length ? (
              <ul className="flex flex-col gap-2 rounded-lg bg-danger-soft p-3 text-sm text-heading">
                {event.risk.indicators.map((indicator) => {
                  const Glyph = RISK_ICONS[indicator.kind];
                  return (
                    <li key={indicator.label} className="flex items-center gap-3">
                      <Glyph aria-hidden weight="fill" className="size-4.5 shrink-0 text-danger" />
                      {indicator.label}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <QuietLine>No risk indicators for this event.</QuietLine>
            )}
            <dl className="flex flex-col gap-1 text-xs text-muted">
              <div className="flex gap-1">
                <dt>Risk score:</dt>
                <dd>{event.risk.score === null ? 'Not scored' : `${event.risk.score} of 100`}</dd>
              </div>
              {event.risk.rule ? (
                <div className="flex gap-1">
                  <dt>Rule:</dt>
                  <dd>{event.risk.rule}</dd>
                </div>
              ) : null}
              <div className="flex gap-1">
                <dt>Why {SEVERITY_LABELS[event.severity]}:</dt>
                <dd>{event.risk.reason.replace(/^[A-Za-z]+: /, '')}</dd>
              </div>
            </dl>
          </>
        )}
      </Loaded>
    </RailCard>
  );
}

const ACTION_ICONS: Record<ResponseAction, Icon> = {
  RESET_PASSWORD: Lock,
  UNLOCK_ACCOUNT: LockSimpleOpen,
  FORCE_LOGOUT: Prohibit,
  MARK_REVIEWED: Flag,
  SEND_ALERT: PaperPlaneTilt,
  SUSPEND_USER: UserMinus,
  RESET_MFA: Key,
  DISABLE_INTEGRATION: Plugs,
};

export function RecommendedActions({
  query,
  onAction,
}: {
  query: DetailQuery;
  onAction: (action: AvailableAction) => void;
}) {
  return (
    <RailCard title="Recommended Actions" icon={Info} tone="blue" testId="recommended-actions">
      <Loaded query={query} rows={4}>
        {({ event, actions }) => (
          <>
            <ul className="flex list-disc flex-col gap-1.5 rounded-lg bg-info-soft py-3 pr-3 pl-8 text-sm text-text marker:text-heading">
              {event.recommendations.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 min-[1440px]:grid-cols-2">
              {actions.map((item, index) => {
                const Glyph = ACTION_ICONS[item.action];
                return (
                  <Button
                    key={item.action}
                    variant={index === 0 ? 'primary' : 'secondary'}
                    disabled={!item.enabled}
                    title={item.reason ?? undefined}
                    onClick={() => onAction(item)}
                    className={
                      index < 2 ? '' : 'sm:col-span-2 xl:col-span-1 min-[1440px]:col-span-2'
                    }
                  >
                    <Glyph aria-hidden weight="fill" className="size-4.5 shrink-0" />
                    {item.label}
                  </Button>
                );
              })}
            </div>
            {actions.some((item) => !item.enabled) ? (
              <ul className="flex flex-col gap-1 text-xs text-muted">
                {actions
                  .filter((item) => !item.enabled)
                  .map((item) => (
                    <li key={item.action}>
                      {item.label}: {item.reason}
                    </li>
                  ))}
              </ul>
            ) : null}
          </>
        )}
      </Loaded>
    </RailCard>
  );
}

const factText = (fact: QuickFact) =>
  fact.at
    ? fact.show === 'time'
      ? formatClock(fact.at)
      : formatStamp(fact.at)
    : (fact.value ?? '—');

export function QuickInfo({ query, onRelated }: { query: DetailQuery; onRelated: () => void }) {
  return (
    <RailCard title="Quick Info" icon={FileText} tone="blue" testId="quick-info">
      <Loaded query={query} rows={4}>
        {({ event, relatedTotal }) => (
          <dl className="flex flex-col gap-3 text-sm">
            {event.quickInfo.map((fact) => (
              <div key={fact.label} className="grid grid-cols-5 gap-3">
                <dt className="col-span-2 text-text">{fact.label}</dt>
                <dd className="col-span-3 min-w-0 wrap-anywhere text-heading">
                  {fact.at ? <time dateTime={fact.at}>{factText(fact)}</time> : factText(fact)}
                </dd>
              </div>
            ))}
            <div className="grid grid-cols-5 gap-3">
              <dt className="col-span-2 text-text">Related Events</dt>
              <dd className="col-span-3">
                {relatedTotal ? (
                  <button
                    type="button"
                    onClick={onRelated}
                    className="inline-flex items-center gap-2 text-left font-semibold text-link hover:underline"
                  >
                    View {relatedTotal} related {relatedTotal === 1 ? 'event' : 'events'}
                    <ArrowRight aria-hidden weight="bold" className="size-4 shrink-0" />
                  </button>
                ) : (
                  <span className="text-muted">None</span>
                )}
              </dd>
            </div>
          </dl>
        )}
      </Loaded>
    </RailCard>
  );
}
