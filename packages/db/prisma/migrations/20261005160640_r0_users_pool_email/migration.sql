-- One staff or Super Admin identity per email in each pool, so sign-in (R2) can look a person up
-- by (pool, email). Clients are excluded on purpose: a client has one user per firm
-- (docs/AUTH-DESIGN.md, Usernames), so the same email can have several CLIENT users; for them
-- client_accounts (business_id, email) is the unique key. Emails are stored lower-case (CHECK).
-- Prisma cannot express a partial unique index, so it lives only here (see packages/db/README.md).
CREATE UNIQUE INDEX users_pool_email_staff_admin_key ON users (pool, email) WHERE pool <> 'CLIENT';
