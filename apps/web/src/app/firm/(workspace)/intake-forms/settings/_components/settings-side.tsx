'use client';

import {
  ArrowCounterClockwise,
  ArrowRight,
  Bell,
  CheckCircle,
  Circle,
  GearSix,
  type Icon,
  Lightbulb,
  Lightning,
  Palette,
  ShieldCheck,
  User,
} from '@phosphor-icons/react';
import type { IntakeSettingsChange, PortalInfo } from '@firmivra/types';
import { Button, discTones, Modal, Skeleton, tileTones, type TileTone } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { LoadFailed, Quiet, SideFrame, SideLink } from './settings-look';
import { type Check, changedAt, type Draft, type SectionId } from './settings-model';
import { MiniPreview } from './settings-preview';

const SHOWN_CHANGES = 3;

function RowsLoading({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" className="flex flex-col gap-3 py-1">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="flex items-center gap-3">
          <Skeleton className="size-5! rounded-full!" />
          <Skeleton className="flex-1" />
        </div>
      ))}
    </div>
  );
}

/**
 * Settings Checklist: the checks from the saved settings (settings-model `checklist`). Each line
 * opens its category; View All adds why each check is or is not done.
 */
export function SettingsChecklist({
  checks,
  loading,
  failed,
  onOpen,
}: {
  checks: Check[] | null;
  loading: boolean;
  failed: { error: unknown; retry: () => void } | null;
  onOpen: (section: SectionId) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <SideFrame
      title="Settings Checklist"
      testId="settings-checklist"
      action={
        checks ? (
          <SideLink expanded={expanded} onClick={() => setExpanded((open) => !open)}>
            {expanded ? 'Show Less' : 'View All'}
          </SideLink>
        ) : null
      }
    >
      {loading ? (
        <RowsLoading rows={7} />
      ) : failed || !checks ? (
        <LoadFailed error={failed?.error} onRetry={() => failed?.retry()} />
      ) : (
        <ul className="flex flex-col gap-1">
          {checks.map((check) => {
            const Mark = check.done ? CheckCircle : Circle;
            return (
              <li key={check.id}>
                <button
                  type="button"
                  onClick={() => onOpen(check.section)}
                  className="flex w-full items-start gap-3 rounded-md py-0.5 text-left hover:bg-canvas"
                >
                  <Mark
                    aria-hidden
                    weight={check.done ? 'fill' : 'regular'}
                    className={`size-5 shrink-0 ${check.done ? 'text-success' : 'text-control-border'}`}
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-text">
                      {check.label}
                      <span className="sr-only">{check.done ? ' (done)' : ' (not done)'}</span>
                    </span>
                    {expanded ? (
                      <span className="block text-xs text-muted">{check.detail}</span>
                    ) : null}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </SideFrame>
  );
}

type ChangeKind = 'reset' | 'branding' | 'notifications' | 'automation' | 'security' | 'client';
const CHANGE_LOOK: Record<ChangeKind | 'other', { icon: Icon; tone: TileTone }> = {
  reset: { icon: ArrowCounterClockwise, tone: 'grey' },
  branding: { icon: Palette, tone: 'amber' },
  notifications: { icon: Bell, tone: 'purple' },
  automation: { icon: Lightning, tone: 'amber' },
  security: { icon: ShieldCheck, tone: 'green' },
  client: { icon: User, tone: 'blue' },
  other: { icon: GearSix, tone: 'blue' },
};

/** The kind of a change, from the categories its line names (the API sends words, not codes). */
function kindOf(label: string): ChangeKind | 'other' {
  const text = label.toLowerCase();
  if (text.includes('reset')) return 'reset';
  if (text.includes('brand')) return 'branding';
  if (text.includes('notification') || text.includes('reminder')) return 'notifications';
  if (text.includes('automation')) return 'automation';
  if (text.includes('security')) return 'security';
  if (text.includes('client experience')) return 'client';
  return 'other';
}

/** A change's solid icon on its soft disc (the design: gear blue, bell purple, palette amber). */
function ChangeIcon({ label }: { label: string }) {
  const { icon: Glyph, tone } = CHANGE_LOOK[kindOf(label)];
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-full ${tileTones[tone]}`}
    >
      <Glyph aria-hidden weight="fill" className="size-4" />
    </span>
  );
}

function ChangeRows({ items, now }: { items: IntakeSettingsChange[]; now: number }) {
  return (
    <ol className="flex flex-col divide-y divide-divider">
      {items.map((change) => {
        return (
          <li key={change.id} className="flex items-center gap-3 py-1.5">
            <ChangeIcon label={change.label} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-heading">{change.label}</span>
              <span className="flex flex-wrap justify-between gap-x-2 text-xs text-muted">
                <time dateTime={change.at}>{changedAt(change.at, now)}</time>
                {change.by ? <span>{change.by}</span> : null}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Recent Changes: what changed, who and when, newest first; View All opens the full history. */
export function RecentChanges({ changes }: { changes: UseQueryResult<IntakeSettingsChange[]> }) {
  const [open, setOpen] = useState(false);
  // Read once: "Today at" is for this visit (render stays pure).
  const [now] = useState(() => Date.now());
  const items = changes.data ?? [];
  return (
    <SideFrame
      title="Recent Changes"
      testId="recent-changes"
      action={items.length > 0 ? <SideLink onClick={() => setOpen(true)}>View All</SideLink> : null}
    >
      {changes.isPending ? (
        <RowsLoading rows={3} />
      ) : changes.isError && !changes.data ? (
        <LoadFailed error={changes.error} onRetry={() => void changes.refetch()} />
      ) : items.length === 0 ? (
        <Quiet>No changes yet.</Quiet>
      ) : (
        <ChangeRows items={items.slice(0, SHOWN_CHANGES)} now={now} />
      )}
      <Modal
        open={open}
        title="Settings Change History"
        subtitle="Every change to the intake settings, newest first."
        onClose={() => setOpen(false)}
        footer={<Button onClick={() => setOpen(false)}>Close</Button>}
      >
        <div data-testid="changes-history">
          <ChangeRows items={items} now={now} />
        </div>
      </Modal>
    </SideFrame>
  );
}

/** Client Preview: a sample form's first page in the firm's branding; View Full Preview opens more. */
export function ClientPreviewFrame({
  draft,
  firmName,
  branding,
  onFullPreview,
}: {
  draft: Draft | null;
  firmName: string;
  branding: PortalInfo['branding'] | undefined;
  onFullPreview: () => void;
}) {
  return (
    <SideFrame
      title="Client Preview"
      testId="client-preview"
      action={<SideLink onClick={onFullPreview}>View Full Preview</SideLink>}
    >
      <div className="px-4 pb-1">
        <MiniPreview draft={draft} firmName={firmName} branding={branding} />
      </div>
    </SideFrame>
  );
}

/** Pro Tip, with the way to the Automations module (the shared rules, not a second schedule). */
export function SettingsProTip() {
  return (
    <div
      className="flex items-start gap-3 rounded-xl bg-info-soft p-3"
      data-testid="settings-pro-tip"
    >
      <span
        className={`flex size-10 shrink-0 items-center justify-center rounded-full ${discTones.blue}`}
      >
        <Lightbulb aria-hidden weight="fill" className="size-6" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-base font-bold text-action">Pro Tip:</p>
        <p className="text-xs text-text">
          Use automated reminders and follow-ups to increase completion rates and save time.
        </p>
        <Link href="/automations" className="mt-1 text-sm font-medium text-link underline">
          Go to Automations <ArrowRight aria-hidden weight="bold" className="inline size-4" />
        </Link>
      </div>
    </div>
  );
}
