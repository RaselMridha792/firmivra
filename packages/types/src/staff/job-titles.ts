import { z } from 'zod';
import { text } from '../clients/text.js';

// Staff Settings > Offices & Job Titles (Octavia's SM3 and SM11, review of Oct 23): the firm's
// saved job titles (staff_job_titles, R1's #1074). Create and Edit Staff offer them in "Select or
// enter job title" (StaffFormOptions.jobTitles); a custom title is still allowed and stays on its
// staff record only. Owner and Admin add, rename, archive and restore; nothing is deleted. A staff
// record keeps its own title text: renaming or archiving a saved title changes no record.
// Offices are Location Management's (Settings > Locations): StaffFormOptions.offices lists the
// firm's active locations, managed there, not here.

const DateTime = z.iso.datetime({ offset: true });

export const StaffJobTitleId = z.uuid();

/** One saved title. */
export const StaffJobTitle = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Staff records whose job title is this name, ignoring letter case (any status). */
  staffCount: z.number().int(),
  archivedAt: DateTime.nullable(),
  createdAt: DateTime,
  updatedAt: DateTime,
});
export type StaffJobTitle = z.infer<typeof StaffJobTitle>;

/** GET /business/staff-job-titles: the live titles by name, then the archived ones if asked. */
export const StaffJobTitleListQuery = z.strictObject({
  includeArchived: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type StaffJobTitleListQuery = z.input<typeof StaffJobTitleListQuery>;

export const StaffJobTitleList = z.object({ items: z.array(StaffJobTitle) });
export type StaffJobTitleList = z.infer<typeof StaffJobTitleList>;

/**
 * POST /business/staff-job-titles (201) and PATCH /business/staff-job-titles/{id} (rename). A live
 * title of the same name, ignoring letter case, is 409 JOB_TITLE_EXISTS; renaming an archived one
 * is 409 JOB_TITLE_ARCHIVED (restore it first).
 */
export const SaveStaffJobTitleRequest = z.strictObject({ name: text(80) });
export type SaveStaffJobTitleRequest = z.input<typeof SaveStaffJobTitleRequest>;

// POST /business/staff-job-titles/{id}/archive and /restore answer the title. Archiving takes it
// off Create and Edit Staff's list; restoring a title whose name a live one now has is 409
// JOB_TITLE_EXISTS. Both are idempotent.

/** Stable `error.code` values of these routes, besides the generic ones. */
export const StaffJobTitleErrorCode = z.enum(['JOB_TITLE_EXISTS', 'JOB_TITLE_ARCHIVED']);
export type StaffJobTitleErrorCode = z.infer<typeof StaffJobTitleErrorCode>;
