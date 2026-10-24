-- R1 (Rasel, Oct 24; Octavia's Tasks review A2, Drafts), second step: the rules for DRAFT tasks
-- (Save as Draft, the Drafts tab: reopen, edit, publish once valid).
-- - A draft needs no client (Rasel): tasks.client_id is nullable, and only a DRAFT may leave it
--   empty. A clientless draft has its creator (the API shows it to them alone, since the reach
--   rules go by client) and no engagement: the engagement's foreign key also carries client_id,
--   so without a client it would check nothing. It is a GENERAL task (a NAME_CHANGE task is the
--   portal's request, never a draft). The existing triggers already keep a clientless draft from
--   having a deadline, an occurrence or an attachment: each needs the task's client.
-- - A draft only becomes OPEN (published), and no task goes back to DRAFT, so "task created"
--   (audit, notifications, automations) happens once, at publish.
-- tasks keeps its policy and grants. Safe on dev: DROP NOT NULL changes no row, every existing
-- row has a client and is not a draft, so the new check holds for all of them, and the trigger
-- only fires on a status change to or from DRAFT.

-- AlterTable
ALTER TABLE "tasks" ALTER COLUMN "client_id" DROP NOT NULL;

-- ---------- A task has a client unless it is a draft ----------
ALTER TABLE tasks ADD CONSTRAINT tasks_client_unless_draft
  CHECK (client_id IS NOT NULL
         OR (status = 'DRAFT' AND created_by_user_id IS NOT NULL AND engagement_id IS NULL));
ALTER TABLE tasks ADD CONSTRAINT tasks_draft_general
  CHECK (status <> 'DRAFT' OR kind = 'GENERAL');

-- ---------- A draft is published once, as OPEN ----------
CREATE FUNCTION tasks_draft_rules() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.status = 'DRAFT' THEN
    RAISE EXCEPTION 'tasks: a task never goes back to DRAFT'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> 'OPEN' THEN
    RAISE EXCEPTION 'tasks: a draft is published as OPEN first'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER tasks_draft_rules
  BEFORE UPDATE OF status ON tasks
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status
                     AND (OLD.status = 'DRAFT' OR NEW.status = 'DRAFT'))
  EXECUTE FUNCTION tasks_draft_rules();
