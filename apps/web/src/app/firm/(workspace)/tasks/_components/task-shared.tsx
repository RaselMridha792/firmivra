import type { TaskPriority, TaskProgress, TaskRow, TaskStatus } from '@firmivra/types';
import { Badge } from '@firmivra/ui';
import {
  CheckCircle,
  Clock,
  Flag,
  Hourglass,
  Pause,
  Prohibit,
  Spinner,
} from '@phosphor-icons/react';

/** Every query of the Tasks module starts here: a change in one view refreshes the others. */
export const TASKS_KEY = ['tasks-work'] as const;

export const PROGRESS_LABEL: Record<TaskProgress, string> = {
  NOT_STARTED: 'Not Started',
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  WAITING: 'Waiting',
  BLOCKED: 'Blocked',
};
export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

/** The task's stage as the table shows it: Completed and Cancelled replace the progress. */
export function StatusPill({ task }: { task: Pick<TaskRow, 'status' | 'progress'> }) {
  if (task.status === 'DONE')
    return (
      <Badge tone="success" icon={CheckCircle}>
        Completed
      </Badge>
    );
  if (task.status === 'CANCELLED')
    return (
      <Badge tone="neutral" icon={Prohibit}>
        Cancelled
      </Badge>
    );
  const map = {
    NOT_STARTED: { tone: 'neutral', icon: Clock },
    PENDING: { tone: 'warning', icon: Hourglass },
    IN_PROGRESS: { tone: 'success', icon: Spinner },
    WAITING: { tone: 'info', icon: Pause },
    BLOCKED: { tone: 'danger', icon: Prohibit },
  } as const;
  const m = map[task.progress];
  return (
    <span className="whitespace-nowrap">
      <Badge tone={m.tone} icon={m.icon}>
        {PROGRESS_LABEL[task.progress]}
      </Badge>
    </span>
  );
}

export function PriorityPill({ priority }: { priority: TaskPriority }) {
  return (
    <Badge
      tone={priority === 'HIGH' ? 'danger' : priority === 'MEDIUM' ? 'info' : 'success'}
      icon={Flag}
    >
      {PRIORITY_LABEL[priority]}
    </Badge>
  );
}

/** "Oct 5, 2026" from a calendar date. */
export const dayText = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

/** "5:00 PM" from HH:MM. */
export const timeText = (hhmm: string) => {
  const [h = 0, m = 0] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

/** The due date as a table reads it: "Today", "Tomorrow" or the date; overdue is flagged by the caller. */
export function dueText(task: Pick<TaskRow, 'dueOn' | 'dueTime' | 'allDay'>): string {
  if (!task.dueOn) return 'No due date';
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const base =
    task.dueOn === today ? 'Today' : task.dueOn === tomorrow ? 'Tomorrow' : dayText(task.dueOn);
  return task.dueTime && !task.allDay ? `${base}, ${timeText(task.dueTime)}` : base;
}

export const shortName = (name: string) => {
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length < 2 ? name : `${parts[0]?.[0]}. ${parts.slice(1).join(' ')}`;
};

/** The API's task codes, in the firm's words. */
export const TASK_ERRORS: Record<string, string> = {
  DUPLICATE_NAME: 'This name is already used. Choose another.',
  SAVE_CONFLICT: 'Someone saved this task after you opened it. Reload and try again.',
  REQUIRED_ITEMS_OPEN: 'Finish the required checklist items first.',
  DEPENDENCY_OPEN: 'Finish the prerequisite task first.',
  DEPENDENCY_CYCLE: 'That prerequisite would make a loop.',
  TYPE_ARCHIVED: 'That task type is archived. Choose another.',
  INVALID_REMINDER: 'A reminder needs a due date, and cannot be after it.',
  INVALID_RECURRENCE: 'The recurrence settings conflict. Check them and try again.',
  SERIES_NOT_ACTIVE: 'The series is paused or ended.',
  OCCURRENCE_CLOSED: 'This occurrence is already made or skipped.',
  TASK_CLOSED: 'Reopen the task before this change.',
  ATTACHMENT_NOT_ALLOWED: 'That document cannot be attached to this task.',
};

export type { TaskStatus };
