# T08 audit viewer and resource directory

Owners filter/page their own append-only audit events. The response allowlists typed metadata
and excludes IP/user agent, document/legal text, unknown JSON, secrets and arbitrary strings.
Every viewer access is itself audited. No audit edit/delete/export operation is added.

The Super Admin route uses ApprovedSupportAccess.withFirm: Rasel must verify current owner
approval, actor, expiry and revocation, then supply the approved business-scoped transaction.
The viewer never queries tenant AuditLog through forPlatform or creates an auth/support guard.
The default adapter fails 503 SUPPORT_NOT_READY. Tests use a separate test-only adapter against
the existing grant table/DB approval rules, demonstrating denial before approval, after revocation,
after expiry and for another firm; those tests do not claim the production adapter is published.

External links use one firm-owned table with forced RLS. OWNER/ADMIN list/create/edit/deactivate;
there is no hard delete or server-side fetch/redirect. HTTPS destinations are limited to exact
IRS/SBA/FDIC/Census host names, with no embedded credentials, query strings, fragments or nonstandard
ports. Portal rows are active, ordered by the three spec sections and projected without icon keys.
Both active ClientAccount and canonical Client must be BUSINESS; Individual access returns 403.
Unsafe legacy destinations are omitted from the client response.

initializeDirectory is an internal setup hook: it inserts the eight approved spec resources into
an empty firm directory once, preserving all later edits. Rasel's activation/setup integration
must call it with verified firm/manager context. New icon keys need Rasel's firm-owned asset check;
the default returns 503 for new keys and null signed URLs. No storage service is implemented here.

Isolated synthetic SQL fixtures are test contracts, not production migrations. Schema, approved
domain changes, support/storage adapters and frontend agreement remain explicit handoffs.
