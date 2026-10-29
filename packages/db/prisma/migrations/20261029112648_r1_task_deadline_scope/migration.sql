-- R1 (Rasel's card, Oct 29; Octavia's Compliance review CD-F01): a deadline's Create Task made a
-- second task on a repeat when no template was chosen, because tasks_one_per_deadline_template
-- only holds when both deadline_id and template_id are set. The API now gives such a task a fixed
-- idempotency key made from the deadline and the template (or none), with the scope
-- 'deadline:<deadline id>', so a double-click, refresh, retry or concurrent request finds the first
-- task through the existing unique (business_id, idempotency_key). This only adds that scope to
-- the rule of r1_task_idempotency_keys; a task linked to a deadline by hand keeps its own key (or
-- none). No backfill: every existing row keeps its key and scope (the two tasks Octavia kept as
-- evidence have none). tasks keeps its policies and grants.
-- Safe on dev: no lock_timeout (a timed-out migration is recorded as failed, P3009). It locks
-- tasks only, while the new CHECK reads the table once; every existing scope already passes it.

-- ---------- The scopes ----------
-- The route, and for Duplicate the task and for a deadline's Create Task the deadline in the URL,
-- as the API stores ids (lower case). A NULL scope passes here; tasks_idempotency_pair allows it
-- only without a key.
ALTER TABLE tasks DROP CONSTRAINT tasks_idempotency_scope;
ALTER TABLE tasks ADD CONSTRAINT tasks_idempotency_scope
  CHECK (idempotency_scope ~ '^(create|draft|(duplicate|deadline):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$');
