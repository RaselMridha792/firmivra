import { z } from 'zod';
import { text } from '../clients/text.js';

// Staff Settings > Offices & Job Titles, Work Schedules (Octavia's SM8, review of Oct 23: company-
// defined custom saved schedules): the firm's saved work schedules (staff_work_schedules, R1's
// #1095). Create and Edit Staff offer the presets, then these (StaffFormOptions.workSchedules); a
// custom schedule is still allowed and stays on its staff record only. Owner and Admin add, rename,
// archive and restore; nothing is deleted. A staff record keeps its own schedule text: renaming or
// archiving a saved schedule changes no record.

const DateTime = z.iso.datetime({ offset: true });

export const StaffWorkScheduleId = z.uuid();

/** One saved schedule. */
export const StaffWorkSchedule = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Staff records whose work schedule is this name, ignoring letter case (any status). */
  staffCount: z.number().int(),
  archivedAt: DateTime.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type StaffWorkSchedule = z.infer<typeof StaffWorkSchedule>;

/** GET /business/staff-work-schedules: the live schedules by name, then the archived ones if asked. */
export const StaffWorkScheduleListQuery = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type StaffWorkScheduleListQuery = z.input<typeof StaffWorkScheduleListQuery>;

export const StaffWorkScheduleList = z.object({ items: z.array(StaffWorkSchedule) });
export type StaffWorkScheduleList = z.infer<typeof StaffWorkScheduleList>;

/**
 * POST /business/staff-work-schedules (201) and PATCH /business/staff-work-schedules/{id}
 * (rename). A live schedule of the same name, ignoring letter case, is 409 WORK_SCHEDULE_EXISTS;
 * renaming an archived one is 409 WORK_SCHEDULE_ARCHIVED (restore it first).
 */
export const SaveStaffWorkScheduleRequest = z.strictObject({ name: text(80) });
export type SaveStaffWorkScheduleRequest = z.input<typeof SaveStaffWorkScheduleRequest>;

// POST /business/staff-work-schedules/{id}/archive and /restore answer the schedule. Archiving
// takes it off Create and Edit Staff's list; restoring a schedule whose name a live one now has is
// 409 WORK_SCHEDULE_EXISTS. Both are idempotent.

/** Stable `error.code` values of these routes, besides the generic ones. */
export const StaffWorkScheduleErrorCode = z.enum([
  'WORK_SCHEDULE_EXISTS',
  'WORK_SCHEDULE_ARCHIVED',
]);
export type StaffWorkScheduleErrorCode = z.infer<typeof StaffWorkScheduleErrorCode>;
