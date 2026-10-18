'use client';

import { Toast } from '@firmivra/ui';
import { ArrowLeft, ArrowRight, ArrowsClockwise } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { CalendarImport } from './calendar-import';
import { CalendarLibrary } from './calendar-library';
import { LogsTab } from './logs-tab';
import { RecurringList } from './recurring-list';
import { RecurringSetup } from './recurring-setup';
import { RulesTab } from './rules-tab';
import { outlined } from './compliance-shared';

type Tab = 'setup' | 'import' | 'library' | 'rules' | 'manage' | 'logs';
const TABS: { id: Tab; label: string }[] = [
  { id: 'setup', label: 'Setup Recurring Deadline' },
  { id: 'import', label: 'Import Government Calendar' },
  { id: 'library', label: 'Calendar Library' },
  { id: 'rules', label: 'Applicability Rules' },
  { id: 'manage', label: 'Manage Existing Recurring' },
  { id: 'logs', label: 'Logs' },
];

/** /compliance/recurring/new: Recurring Deadline & Government Calendar Setup, in six tabs. */
export function SetupScreen({
  tab,
  editId,
  fromDeadline,
  saved,
}: {
  tab: string | undefined;
  editId: string | undefined;
  fromDeadline?: string | undefined;
  saved?: string | undefined;
}) {
  const first: Tab = (TABS.find((t) => t.id === tab)?.id ?? 'setup') as Tab;
  const [current, setCurrent] = useState<Tab>(first);
  const [message, setMessage] = useState<string | undefined>(saved ? `${saved} saved.` : undefined);
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="setup-page">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
        <Link href="/compliance" aria-label="Back to Compliance & Deadlines" className="text-link">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
        </Link>
        <Link href="/compliance" className="text-link">
          Compliance &amp; Deadlines
        </Link>
        <span aria-hidden className="text-muted">
          ›
        </span>
        <span className="font-semibold text-heading">Recurring Deadline Setup</span>
      </nav>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <ArrowsClockwise aria-hidden weight="bold" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              Recurring Deadline &amp; Government Calendar Setup
            </h1>
            <p className="text-base text-muted">
              Create recurring deadlines, import government calendars, and set applicability rules.
            </p>
          </div>
        </div>
        <Link href="/compliance" className={outlined}>
          <ArrowRight aria-hidden weight="bold" className="size-4 rotate-180" /> Back to Deadlines
        </Link>
      </header>
      {message ? (
        <Toast message={message} tone="success" onDismiss={() => setMessage(undefined)} />
      ) : null}
      <nav
        aria-label="Setup tabs"
        role="tablist"
        className="flex overflow-x-auto border-b border-divider"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={current === t.id}
            onClick={() => setCurrent(t.id)}
            className={`-mb-px min-h-11 shrink-0 border-b-2 px-4 text-sm whitespace-nowrap ${current === t.id ? 'border-action font-semibold text-action' : 'border-transparent font-medium text-heading hover:text-action'}`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {current === 'setup' ? (
        <RecurringSetup
          {...(editId ? { editId } : {})}
          {...(fromDeadline ? { fromDeadline } : {})}
        />
      ) : null}
      {current === 'import' ? (
        <CalendarImport
          onImported={(name) => {
            setMessage(`${name} imported as a draft. Verify and publish it in the library.`);
            setCurrent('library');
          }}
        />
      ) : null}
      {current === 'library' ? <CalendarLibrary /> : null}
      {current === 'rules' ? <RulesTab /> : null}
      {current === 'manage' ? (
        <section
          className="min-w-0 rounded-xl bg-surface p-4 shadow-md"
          aria-label="Manage Existing Recurring"
        >
          <RecurringList testId="manage-rows" />
        </section>
      ) : null}
      {current === 'logs' ? <LogsTab /> : null}
    </div>
  );
}
