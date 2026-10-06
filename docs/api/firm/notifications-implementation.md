# T06 notification center

Ten guarded firm/portal routes list, count, mark read and manage only the current user's
preferences. Record targets are typed and reauthorized by NotificationTargets on each read;
the default hides every unresolved target. No arbitrary URL or recipient-selection HTTP route.

Internal create requires a verified request context and a currently active same-firm recipient.
The database unique event key deduplicates retries/concurrent events. The `in_app` snapshot hides
email/SMS-only rows from bell list/count/read; changing preferences does not erase old history.
Audits contain ids/category,
never message content. Optional preferences suppress new events when every channel is disabled.

NotificationDelivery is the Rasel R6 integration port. R6 supplies supported/mandatory policy and
durably enqueues generic notifications with recipient consent checks and a stable idempotency key.
The sending request contains no private content or email/phone address. Failure may occur after
the bell row commits: callers retry the same eventKey, and R6 must deduplicate delivery. This
does not claim that a sender/outbox/consent service exists. Default policy/sender returns 503
NOTIFY_NOT_READY; frontend preferences and internal creation need the real adapter.

Database.withScope provides transaction-local tenant scope. New notifications/preferences tables
require Rasel migrations with forced RLS and the indexed unique/page keys in the isolated test
fixture. Missing or unprotected schema fails 503 SCHEMA_NOT_READY. Fixture code is test-only,
not a production migration. R6/Fahad must confirm policy, target-access adapters and DTOs.
