# T07 canonical appointments

Twenty-six guarded firm/portal endpoints configure appointment types, recurring working hours,
blocked time, provider selection, available slots, booking, detail updates, rescheduling,
cancellation and history. Portal clientId is derived from the current active ClientAccount.
STAFF manage their own calendar and book only assigned clients; OWNER/ADMIN manage the firm.
Every read/mutation is audited with identifiers, never appointment instructions or messages.

Both booking routes require Idempotency-Key (8–128 characters). A per-firm/actor hash and
the canonical input fingerprint are stored under a unique constraint; simultaneous retries
return the same appointment and create one history/job set. Changed payloads return 409
IDEMPOTENCY_CONFLICT. A retry after cancellation/rescheduling returns the same canonical row
in its current state and never restores the original slot. Keys/fingerprints are not returned
or audited. Each retry rechecks current client access; different actors have separate key spaces.

Every mutation locks the Business row, then rechecks current identity/role and the active provider.
Provider advisory locks serialize slot/hour/block changes. Booking/reschedule also require the
valid named `appointments_no_overlap` GiST exclusion constraint, covering business/provider and
the half-open occupied interval for BOOKED rows. A missing/wrong constraint fails 503. Actual
Postgres concurrency tests demonstrate one 201/one 409 and reject direct app-role overlapping
writes even when the API locks are skipped. Same-firm composite foreign keys and forced RLS
are part of the isolated draft fixture contract; Rasel owns all production migrations.

Availability scans actual UTC minutes against firm-local hours, including the entire buffered
interval. It preserves both real DST-fold instants and cannot create nonexistent gap times.
Ranges are bounded to 31 days. More than 1000 available slots return nextFrom for continuation;
provider lists have scoped cursors. Existing appointments snapshot duration, buffers and display
names, so editing a type does not move existing bookings. Explicit isIntroCall types must be
5 minutes and PHONE only; their classification is not inferred from a display name.

Reschedule updates the same id, increments version and appends history. Detail updates are firm
only and client-visible; meeting URLs require HTTPS without embedded credentials. Cancellation
is idempotent and invalidates all pending/leased older-version notice jobs. Portal changes after
the start are rejected; fee/cancellation-window/provider policies need Rasel/Fahad confirmation.
Deleting a block never deletes an appointment; hour/block changes cannot invalidate live bookings.

AppointmentJobs schedules durable change notices for the active provider and current client
accounts, plus beta reminder defaults 24 hours and 1 hour before start when still in the future.
runDue(trustedBusinessId) uses leased FOR UPDATE SKIP LOCKED jobs, status/version/recipient checks,
idempotency keys and safe retry backoff. QUEUED means accepted by R6, not actually delivered.
Only generic template/ids are sent to AppointmentNotifier. R6 must enqueue durably, honor consent,
deduplicate and recheck appointment version/recipient at actual delivery. Rasel must register
the internal worker with his scheduler; no public worker endpoint, unscoped tenant sweep, fake
sender or memory timer is introduced. Default sending port is unavailable and jobs retry safely.

Tests use isolated synthetic fixtures under apps/api/test/fixtures; those are not migrations
and never run against the normal local or production database. The frontend is unchanged.
