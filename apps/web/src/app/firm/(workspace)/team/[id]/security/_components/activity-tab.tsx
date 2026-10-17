'use client';

import { Button, Callout, SearchField, Table } from '@firmivra/ui';
import { ClipboardText, Info } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { NOT_LOADED } from '../../../_components/quiet-card';
import { MEMBER_ERRORS, dateTime } from '../../_components/staff-parts';
import { useMember } from '../../_components/use-member';
import { Panel } from './panel';
import { SecurityShell } from './security-shell';
import { useCursorList } from './use-cursor-list';

/**
 * Activity & Audit tab (guide §14, §16): the audit trail by or about the member, newest first,
 * with a search over what is loaded and Load more. Never a password, code or token.
 */
export function ActivityTab({ id }: { id: string }) {
  const { member } = useMember(id);
  const list = useCursorList(['staff', 'activity', id, 'all'], (cursor) =>
    api.staff.activity(id, { limit: 50, ...(cursor ? { cursor } : {}) }),
  );
  const [search, setSearch] = useState('');
  const q = search.trim().toLowerCase();
  const rows = list.items.filter(
    (a) => !q || [a.label, a.action, a.actorName ?? ''].some((x) => x.toLowerCase().includes(q)),
  );
  return (
    <SecurityShell id={id} tab="activity">
      <Panel
        title="Activity & Audit"
        subtitle="What this person did, and what was done to their account, from the audit log."
        icon={ClipboardText}
        testId="activity-audit"
        action={
          <SearchField
            label="Search activity"
            placeholder="Search activity"
            value={search}
            minWidth="16rem"
            onChange={(event) => setSearch(event.target.value)}
          />
        }
      >
        <Table
          rows={rows}
          loading={list.pending}
          rowKey={(a) => a.id}
          caption="Activity and audit"
          dense
          showPagination={false}
          emptyTitle={
            list.failed
              ? 'Activity is not available'
              : q
                ? 'No matching activity'
                : 'No activity yet'
          }
          emptyText={
            list.failed
              ? NOT_LOADED
              : q
                ? 'Try another search.'
                : 'Sign-ins, changes and actions show here as they happen.'
          }
          columns={[
            { id: 'at', label: 'Date & Time', cell: (a) => dateTime(a.at) },
            {
              id: 'label',
              label: 'Activity',
              cell: (a) => <span className="font-medium text-heading">{a.label}</span>,
            },
            {
              id: 'by',
              label: 'By',
              cell: (a) => a.actorName ?? member?.name ?? 'This member',
            },
            {
              id: 'action',
              label: 'Event',
              cell: (a) => <code className="text-xs text-muted">{a.action}</code>,
            },
          ]}
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
      <Callout icon={Info} tone="navy" surface="plain" size="compact">
        Only Owners and Admins see this trail. It never shows a password, code or token, and the
        firm keeps it when the account is deactivated.
      </Callout>
    </SecurityShell>
  );
}
