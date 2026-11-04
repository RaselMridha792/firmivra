-- R1 (Rasel's card "Approve all four", Oct 29 11:19:57Z, second of four; Octavia's Automations
-- review AU-F29): the Manual Event Confirmation master in the firm's Automation settings. OFF by
-- default (AU-Y07): while it is false nobody reports an external event by hand. Only Owner and
-- Admin change it; the API writes the audit entry (actor and time), so no extra columns. No
-- backfill: existing rows take the default. automation_settings keeps its policies and grants
-- (table-wide, so they cover the new column).
-- Safe on dev: a constant default needs no table rewrite; it locks automation_settings only.

-- AlterTable
ALTER TABLE "automation_settings" ADD COLUMN     "manual_confirmation_enabled" BOOLEAN NOT NULL DEFAULT false;
