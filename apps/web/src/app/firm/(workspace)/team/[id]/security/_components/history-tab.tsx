'use client';

import type { StaffLoginEvent } from '@firmivra/types';
import { Button, Callout, Select, Table } from '@firmivra/ui';
import { ChartBar, ClockCounterClockwise, Info } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { NOT_LOADED } from '../../../_components/quiet-card';
import { MEMBER_ERRORS, dateTime } from '../../_components/staff-parts';
import { Panel } from './panel';
import { LOGIN_COLUMNS } from './security-cards';
import { SecurityShell } from './security-shell';
import { useCursorList } from './use-cursor-list';

type Outcome = 'all' | StaffLoginEvent['outcome'];

const quiet = 'rounded-lg bg-subtle p-4 text-sm text-muted';

/**
 * Login History tab (guide §14): every sign-in attempt, newest first, with All / Success / Failed,
 * Load more, and a summary of what is shown. Place and IP are approximate telemetry.
 */
export function HistoryTab({ id }: { id: string }) {
  const list = useCursorList(['staff', 'login-history', id, 'all'], (cursor) =>
    api.staff.loginHistory(id, { limit: 50, ...(cursor ? { cursor } : {}) }),
  );
  const [outcome, setOutcome] = useState<Outcome>('all');
  const rows = list.items.filter((e) => outcome === 'all' || e.outcome === outcome);
  const ok = list.items.filter((e) => e.outcome === 'SUCCESS');
  const failed = list.items.filter((e) => e.outcome === 'FAILED');
  const facts: [string, string][] = [
    ['Sign-ins shown', String(list.items.length)],
    ['Successful', String(ok.length)],
    ['Failed', String(failed.length)],
    ['Last successful', ok[0] ? dateTime(ok[0].at) : '—'],
    ['Last failed', failed[0] ? dateTime(failed[0].at) : '—'],
  ];
  return (
    <SecurityShell id={id} tab="history">
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-3">
        <Panel
          title="Login History"
          subtitle="Every sign-in attempt for this user, newest first."
          icon={ClockCounterClockwise}
          testId="login-history-all"
          className="min-[1440px]:col-span-2"
          action={
            <Select
              label="Status"
              hideLabel
              options={[
                { value: 'all', label: 'All attempts' },
                { value: 'SUCCESS', label: 'Successful' },
                { value: 'FAILED', label: 'Failed' },
              ]}
              value={outcome}
              onChange={(event) => setOutcome(event.target.value as Outcome)}
            />
          }
        >
          <Table
            rows={rows}
            loading={list.pending}
            rowKey={(e) => `${e.at}-${e.ip ?? ''}-${e.outcome}`}
            caption="Login history"
            dense
            showPagination={false}
            emptyTitle={
              list.failed
                ? 'Login history is not available'
                : outcome === 'all'
                  ? 'No sign-ins yet'
                  : 'No matching sign-ins'
            }
            emptyText={
              list.failed
                ? NOT_LOADED
                : outcome === 'all'
                  ? 'Sign-ins show here once this person signs in.'
                  : 'Try another status.'
            }
            columns={LOGIN_COLUMNS}
          />
          {list.moreError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(list.moreError, MEMBER_ERRORS)}
            </p>
          ) : null}
          {list.hasMore ? (
            <Button
              variant="secondary"
              className="self-center"
              disabled={list.loadingMore}
              onClick={list.loadMore}
            >
              Load more
            </Button>
          ) : null}
        </Panel>
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-1">
          <Panel title="Sign-in Summary" icon={ChartBar} testId="sign-in-summary">
            {list.failed ? (
              <p className={quiet}>{NOT_LOADED}</p>
            ) : (
              <dl className="flex flex-col divide-y divide-divider">
                {facts.map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between gap-3 py-2">
                    <dt className="text-sm text-heading">{label}</dt>
                    <dd className="text-sm font-semibold text-link">
                      {list.pending ? '…' : value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Panel>
          <Callout icon={Info} tone="navy" surface="plain" size="compact">
            Location and IP address are approximate security telemetry, not proof of where someone
            was. Only Owners and Admins see them.
          </Callout>
        </div>
      </div>
    </SecurityShell>
  );
}
