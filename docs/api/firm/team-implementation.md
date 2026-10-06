# T03 team implementation

All four routes use existing identity/tenant/role guards, strict shared Zod inputs,
firm-scoped database reads and safe AuditService entries. OWNER/ADMIN list members;
STAFF and CLIENT cannot manage the team. Tokens, hashes and invite URLs are never returned.

Writes lock this firm's Business row and re-read the actor's active membership after the lock,
so a concurrent demotion/deactivation cannot reuse the guard's earlier role. The transaction
retains at least one active owner. Administrators manage staff but cannot manage owners or peer
administrators or promote a staff member to owner. This conservative policy awaits Rasel review.
Deactivation changes Membership only; other memberships and User identity remain intact.

Cursor pages use descending createdAt/id and bind to firm, caller, endpoint/filter hash.
They do not trust cursor identity to select a firm or disclose raw search/filter values.

`InviteResender` is the integration port for Rasel's service. That adapter must atomically
recheck the actor and INVITED target, revoke/create the invite and enqueue safe delivery with
rate limits. Until published/wired, the route returns 503 INTEGRATION_NOT_READY. Tests replace
the port to verify delegation; they do not claim to test real sending.

Tests cover every endpoint, foreign firm/id denial, wrong roles, injected context, pagination,
last-owner races, per-firm deactivation and exact secret-free invite delegation.
