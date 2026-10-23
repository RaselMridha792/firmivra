-- R1 (Rasel, Oct 24; Octavia's Tasks review A2, Drafts), first step: TaskStatus gets DRAFT, a
-- task saved with Save as Draft. Nothing is renamed or removed, and tasks.status keeps its
-- default OPEN. The new value is not used by any check, index, policy or row here (a new value
-- cannot be used in the transaction that adds it); r1_task_drafts, the next migration, adds the
-- rules that use it. Safe on dev: adding an enum value rewrites no row.

-- AlterEnum
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'OPEN';
