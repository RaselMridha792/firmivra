import type { MyTaskRow, MyTaskStatus } from '@firmivra/types';

// Client Portal Review One T16: a firm's task as the client reads it, in Your Next Steps and on
// the task's own page.

export const MY_TASK_LABELS: Record<MyTaskStatus, string> = {
  TO_DO: 'To do',
  IN_PROGRESS: 'In progress',
  WAITING_ON_YOU: 'Waiting on you',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
};

export const MY_TASK_TONES: Record<MyTaskStatus, 'info' | 'warning' | 'success' | 'neutral'> = {
  TO_DO: 'info',
  IN_PROGRESS: 'info',
  WAITING_ON_YOU: 'warning',
  ON_HOLD: 'neutral',
  COMPLETED: 'success',
};

/** "Dec 1, 2026" or "Dec 1, 2026 at 2:30 PM" (the firm's time). */
export function taskDue(t: Pick<MyTaskRow, 'dueOn' | 'dueTime'>): string | null {
  if (!t.dueOn) return null;
  const day = new Date(`${t.dueOn}T00:00:00`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  if (!t.dueTime) return day;
  const [h = 0, m = 0] = t.dueTime.split(':').map(Number);
  const time = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
  return `${day} at ${time}`;
}
