'use client';

import { ApiRequestError } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import {
  CalendarBlank,
  CheckCircle,
  CheckSquare,
  ClockCounterClockwise,
  FileArrowUp,
  FileText,
  Files,
  IdentificationBadge,
  PaperPlaneTilt,
  UserCircle,
  UsersThree,
} from '@phosphor-icons/react';
import { errorMessage } from '../../../../../lib/errors';
import { Panel } from './review-panels';
import { TR_ERRORS, card, quiet } from './tr-shared';

const NOT_AVAILABLE = 'Not available right now.';

/** A panel's frame with the quiet line instead of its content. */
const Frame = ({ title, icon }: { title: string; icon?: typeof CheckCircle }) => (
  <Panel title={title} {...(icon ? { icon } : {})}>
    <p className={quiet}>{NOT_AVAILABLE}</p>
  </Panel>
);

const FRAME2_CARDS: [string, typeof CheckCircle][] = [
  ['Filing Deadline', CalendarBlank],
  ['Extension', FileArrowUp],
  ['Assigned Preparer', UsersThree],
  ['Assigned Reviewer', IdentificationBadge],
  ['Filing Status', UserCircle],
  ['Prior Year', ClockCounterClockwise],
];
const FRAME2_TABS = [
  'Overview',
  'Intake & Documents',
  'Preparation',
  'Review',
  'E-Signatures',
  'E-File',
  'Payments & Refunds',
  'Notes',
  'Activity',
];

/**
 * A return that could not load: the page keeps every frame of its design (cards, tabs, panels)
 * with a quiet line in each, and one Retry at the top. A return that does not exist (404) says
 * so instead, with no frames.
 */
export function UnavailableReturn({
  error,
  frame,
  onRetry,
}: {
  error: unknown;
  frame: 2 | 3;
  onRetry: () => void;
}) {
  const missing = error instanceof ApiRequestError && error.status === 404;
  const alert = (
    <p
      role="alert"
      className="flex flex-wrap items-center gap-3 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
      data-testid="return-error"
    >
      {missing
        ? 'This return does not exist, or you cannot open it.'
        : 'This return could not load.'}{' '}
      {missing ? null : errorMessage(error, TR_ERRORS)}
      {missing ? null : (
        <Button variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </p>
  );
  if (missing) return alert;
  if (frame === 2) {
    return (
      <>
        {alert}
        <ul
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6"
          aria-label="Return summary"
        >
          {FRAME2_CARDS.map(([title, Glyph]) => (
            <li key={title} className={`${card} flex items-start gap-2.5 p-3`}>
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-action"
              >
                <Glyph weight="fill" className="size-5" />
              </span>
              <span className="flex flex-col text-sm">
                <span className="font-medium text-heading">{title}</span>
                <span className="text-muted">—</span>
              </span>
            </li>
          ))}
        </ul>
        <ul
          className="flex justify-between gap-6 overflow-x-auto border-b border-divider"
          aria-label="Return sections"
        >
          {FRAME2_TABS.map((t, i) => (
            <li
              key={t}
              className={`-mb-px border-b-2 py-2 text-base font-medium ${i === 0 ? 'border-action text-action' : 'border-transparent text-muted'}`}
            >
              {t}
            </li>
          ))}
        </ul>
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            <Frame title="Return Progress" />
            <div className="grid min-w-0 gap-4 lg:grid-cols-2">
              <Frame title="Client Details" icon={UserCircle} />
              <Frame title="Document Checklist" icon={Files} />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <Frame title="Upcoming Tasks" icon={CheckSquare} />
            <Frame title="Recent Activity" icon={ClockCounterClockwise} />
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      {alert}
      <ul className="flex flex-wrap justify-end gap-3" aria-label="Return summary">
        {['Filing Status', 'Filing Deadline', 'Extension', 'Return Progress'].map((t) => (
          <li
            key={t}
            className="flex min-w-36 flex-col gap-1 rounded-xl border border-divider bg-surface px-3 py-2 text-sm"
          >
            <span className="font-medium text-heading">{t}</span>
            <span className="text-muted">—</span>
          </li>
        ))}
      </ul>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,7fr)_minmax(0,4fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <Frame title="Return Workflow" />
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="flex min-w-0 flex-col gap-4">
              <Frame title="Return Details" icon={FileText} />
              <Frame title="Federal & State Summary" />
              <Frame title="Notes" />
            </div>
            <div className="flex min-w-0 flex-col gap-4">
              <Frame title="Return Validation" icon={CheckCircle} />
              <Frame title="Required Approvals" icon={CheckCircle} />
              <Frame title="Documents" icon={FileText} />
            </div>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Frame title="E-File & Filing Status" icon={PaperPlaneTilt} />
          <Frame title="Client Signatures" icon={CheckCircle} />
          <Frame title="Next Steps" />
        </div>
      </div>
    </>
  );
}
