'use client';

import type { TaskOverviewQuery } from '@firmivra/types';
import { useState } from 'react';
import { newTaskHref } from './new-task-href';
import { TaskTable } from './task-table';

/**
 * A service workspace's open tasks for one client (Octavia's SH4): each with its status as a
 * dropdown and the Tasks module's own action menu and dialogs, here in the workspace; a task's
 * pages and Create Task get Back to it. Payroll and Bookkeeping use it; Tax Returns can too.
 */
export function ServiceTasks({
  clientId,
  engagementId,
  period,
  pageSize = 5,
  caption,
  emptyText = 'No open tasks for this client.',
}: {
  clientId: string;
  engagementId?: string;
  period?: string;
  pageSize?: number;
  caption: string;
  emptyText?: string;
}) {
  const [query, setQuery] = useState<TaskOverviewQuery>({
    view: 'all',
    status: 'OPEN',
    clientId,
    ...(engagementId ? { engagementId } : {}),
    pageSize,
  });
  return (
    <TaskTable
      compact
      inlineStatus
      hideBulk
      query={query}
      onQuery={(change) => setQuery((q) => ({ ...q, ...change }))}
      caption={caption}
      emptyText={emptyText}
      newTaskHref={newTaskHref({ clientId, engagementId, period })}
    />
  );
}
