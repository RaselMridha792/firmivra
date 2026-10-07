# T05 application data

Three read-only Super Admin endpoints use the existing guards and platform scope.
List filtering and cursors are bound to the platform actor and filters. Detail projects
an explicit safe form allowlist; raw JSON never crosses the API. No approval or firm-data
access is introduced.

History uses the draft `firm_application_histories` contract through Database.withScope.
Missing tables or absent forced RLS return 503 SCHEMA_NOT_READY. Rasel R4 owns history
writes and production migrations. The isolated API test fixture is not a migration;
the app role can SELECT history but cannot mutate it. R4/Fahad must confirm the DTO mapping.
