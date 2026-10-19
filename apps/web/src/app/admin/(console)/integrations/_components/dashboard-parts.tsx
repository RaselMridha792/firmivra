'use client';

import { Card, Skeleton, discTones, tintTones } from '@firmivra/ui';
import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

/**
 * Parts of the Integrations dashboard (firmivra-integrations-admin-dashboard.jpg): the tinted
 * summary cards that also filter the platform list (docx §2), the panels with a tinted header
 * band, and the catalog's small stat cards.
 */

export type DashboardTone = 'blue' | 'green' | 'amber' | 'grey' | 'purple';

const CARD_TONES: Record<DashboardTone, string> = {
  blue: 'border-folder-border bg-info-soft',
  green: 'border-success/20 bg-success-soft',
  amber: 'border-gold/25 bg-amber-surface',
  grey: 'border-border bg-disabled/60',
  purple: 'border-purple/20 bg-purple-soft',
};
/** The icon behind each card: a soft tile, or a solid disc (Active's check, Disabled's dots). */
const ICON_LOOK: Record<DashboardTone, string> = {
  blue: tintTones.blue,
  green: discTones.green,
  amber: tintTones.amber,
  grey: 'bg-muted text-on-action',
  purple: tintTones.purple,
};

/** One summary card: a button that filters the platform list, pressed while its filter is on. */
export function SummaryCard({
  tone,
  icon: Glyph,
  value,
  label,
  note,
  loading,
  pressed,
  disabled,
  onClick,
  testId,
}: {
  tone: DashboardTone;
  icon: Icon;
  value: ReactNode;
  label: string;
  note: string;
  loading: boolean;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-w-0 items-center gap-4 rounded-xl border p-5 text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default disabled:hover:shadow-none ${CARD_TONES[tone]} ${pressed ? 'ring-2 ring-action' : ''}`}
    >
      <span
        className={`flex size-14 shrink-0 items-center justify-center rounded-full ${ICON_LOOK[tone]}`}
      >
        <Glyph aria-hidden weight="fill" className="size-7" />
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        {loading ? (
          <Skeleton className="h-8 w-14" />
        ) : (
          <span
            data-testid={`${testId}-value`}
            className="text-3xl leading-none font-bold text-heading"
          >
            {value}
          </span>
        )}
        <span className="text-base text-heading">{label}</span>
        <span className="text-sm text-muted">{note}</span>
      </span>
    </button>
  );
}

const BAND_TONES = {
  blue: 'bg-canvas',
  purple: 'bg-purple-soft',
  green: 'bg-success-soft/60',
} as const;

/** A panel with the design's tinted header band: title, one line, and the panel's button. */
export function DashboardPanel({
  title,
  subtitle,
  band,
  action,
  children,
  testId,
  className = '',
}: {
  title: string;
  subtitle: string;
  band: keyof typeof BAND_TONES;
  action?: ReactNode;
  children: ReactNode;
  testId: string;
  className?: string;
}) {
  return (
    <Card
      data-testid={testId}
      className={`flex min-w-0 flex-col overflow-hidden p-0! ${className}`}
    >
      <div
        className={`flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4 ${BAND_TONES[band]}`}
      >
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-heading">{title}</h2>
          <p className="text-sm text-text">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** One of the catalog panel's four small cards. */
export function MiniStat({
  tone,
  icon: Glyph,
  value,
  label,
  note,
  loading,
  testId,
}: {
  tone: DashboardTone;
  icon: Icon;
  value: ReactNode;
  label: string;
  note?: string;
  loading: boolean;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <span
        className={`flex size-11 shrink-0 items-center justify-center rounded-full ${ICON_LOOK[tone]}`}
      >
        <Glyph aria-hidden weight="fill" className="size-6" />
      </span>
      <span className="flex min-w-0 flex-col">
        {loading ? (
          <Skeleton className="h-6 w-10" />
        ) : (
          <span
            data-testid={`${testId}-value`}
            className="text-2xl leading-tight font-bold text-heading"
          >
            {value}
          </span>
        )}
        <span className="text-sm leading-snug text-heading">{label}</span>
        {note ? <span className="text-xs text-muted">{note}</span> : null}
      </span>
    </div>
  );
}
