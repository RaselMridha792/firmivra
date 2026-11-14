-- The firm's tax season (R1, Nov 14; Dashboard Review 2 "Tax season context", the lead's approval
-- under Rasel's packages/db delegation until Nov 17): the dashboard header shows Tax Season or
-- Off-Season from the firm's settings, never hard-coded. A season is `MM-DD` to `MM-DD`, every year
-- in the firm's time zone, and may run across Jan 1 (Dec 1 to Apr 30). Feb 29 is not a choice, so
-- every year has the day. Both set or both null; null means no season, and the dashboard shows
-- none. business_settings already has FORCE RLS (the firm's own row only) and table-level grants
-- to the app role, so the new columns need no policy or grant of their own. No backfill: every
-- firm starts without a season (LVP sets its own in Settings).

-- AlterTable
ALTER TABLE "business_settings" ADD COLUMN     "tax_season_end" TEXT,
ADD COLUMN     "tax_season_start" TEXT;

-- A real day of a month (never Feb 29), and two different days, both set or both null.
ALTER TABLE business_settings
  ADD CONSTRAINT business_settings_tax_season CHECK (
    (tax_season_start IS NULL AND tax_season_end IS NULL)
    OR (
      -- Explicit: with one side null the rest is NULL, and a CHECK lets NULL through.
      tax_season_start IS NOT NULL AND tax_season_end IS NOT NULL
      AND tax_season_start ~'^((01|03|05|07|08|10|12)-(0[1-9]|[12][0-9]|3[01])|(04|06|09|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-8]))$'
      AND tax_season_end ~ '^((01|03|05|07|08|10|12)-(0[1-9]|[12][0-9]|3[01])|(04|06|09|11)-(0[1-9]|[12][0-9]|30)|02-(0[1-9]|1[0-9]|2[0-8]))$'
      AND tax_season_start <> tax_season_end
    )
  );
