-- Local development only. Runs once, when the postgres volume is first created.
-- Creates the API's database role: it can log in but cannot bypass row-level security.
-- Step 6.3 migrations grant it table access and add the RLS policies.
-- In AWS the role's password comes from Secrets Manager, never from this file.
CREATE ROLE firmivra_app LOGIN PASSWORD 'firmivra_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT CONNECT ON DATABASE firmivra TO firmivra_app;
GRANT USAGE ON SCHEMA public TO firmivra_app;
