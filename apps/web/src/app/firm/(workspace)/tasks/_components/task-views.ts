/**
 * The Tasks overview's eight views; `?view=` on /tasks opens one (the template editor returns to
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
  // Octavia's A2.
  'drafts',
] as const;
export type TaskView = (typeof TASK_VIEWS)[number];
