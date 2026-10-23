/**
 * The Tasks overview's seven views; `?view=` on /tasks opens one (the template editor returns to
 * `templates`). No imports, so the server page can read it.
 */
export const TASK_VIEWS = [
  'mine',
  'all',
  'client',
  'project',
  'recurring',
  'templates',
  'completed',
] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
