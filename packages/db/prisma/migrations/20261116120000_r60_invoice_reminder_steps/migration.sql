-- r60_invoice_reminder_steps (R60, Nov 16; the lead's approval under Rasel's packages/db delegation):
-- Invoices Review 2 I-N04. A firm's invoice reminders go out on several days before the due date
-- (0: on the due date), and the overdue notice repeats up to a cap. The steps already sent are not
-- stored: the reminder job's notices are once per invoice, step and due date by their event key.
-- reminder_days_before stays for now (the API keeps it equal to the list's largest day).

-- AlterTable
ALTER TABLE "payment_settings" ADD COLUMN     "overdue_reminder_max" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "reminder_days_before_list" INTEGER[] DEFAULT ARRAY[3]::INTEGER[];

-- Each firm keeps the day it had.
UPDATE payment_settings
   SET reminder_days_before_list = ARRAY[COALESCE(reminder_days_before, 3)];

-- ---------- Data rules Prisma cannot express ----------

-- Prisma keeps list columns nullable, so the check also refuses NULL: always a list of one to five
-- days, one dimension, no NULL element, each 0 to 60; and one to twelve overdue repeats.
ALTER TABLE payment_settings ADD CONSTRAINT payment_settings_reminder_steps
  CHECK (reminder_days_before_list IS NOT NULL
         AND coalesce(array_ndims(reminder_days_before_list), 1) = 1
         AND cardinality(reminder_days_before_list) BETWEEN 1 AND 5
         AND array_position(reminder_days_before_list, NULL) IS NULL
         AND 0 <= ALL (reminder_days_before_list) AND 60 >= ALL (reminder_days_before_list)
         AND overdue_reminder_max BETWEEN 1 AND 12);
