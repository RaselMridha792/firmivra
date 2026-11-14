import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { MemberRef } from '../clients/schemas.js';
import { clearable, text } from '../clients/text.js';
// PRIVATE or SHARED, and the reminder units: the database's enums.
import { ProjectDeadlineVisibility, TaskReminderUnit } from '../db-enums.js';
import { OkResponse } from '../schemas.js';

// Tax Planning Review 2, approved addition "Project Deadlines" (R56; tables in
// r56_project_deadlines): a staff member's own deadline (name, date and time, description,
// service, optional client, several reminders), kept apart from the Tax Calendar and the Super
// Admin's mandatory deadlines.
// Firm routes: /api/v1/business/tax-planning/project-deadlines (the Tax Planning module).
// - PRIVATE (the default) is its owner's only, Owner and Admin included. SHARED adds the
//   coworkers it is shared with. Anyone else gets 404, as for a deadline that does not exist.
// - Only the owner edits, shares or deletes it (403 OWNER_ONLY for a coworker it is shared
//   with); the owner and those coworkers mark it complete and reopen it.
// - A Staff member names only a client assigned to them. A coworker who may not see the client
//   (a Staff member it is not assigned to) gets the deadline without it (`client` null,
//   `clientHidden` true).

const DateTime = z.iso.datetime({ offset: true });

export const ProjectDeadlineId = z.uuid();
/** A reminder's unit as typed (the database's TaskReminderUnit). */
export const ProjectDeadlineReminderUnit = TaskReminderUnit;
export type ProjectDeadlineReminderUnit = TaskReminderUnit;

/** Minutes in each unit; a reminder is `amount` units before the due time. */
export const PROJECT_DEADLINE_UNIT_MINUTES: Record<ProjectDeadlineReminderUnit, number> = {
  MINUTES: 1,
  HOURS: 60,
  DAYS: 1440,
};
/** A reminder is at most a year before the due time. */
export const PROJECT_DEADLINE_MAX_REMINDER_MINUTES = 525_600;
export const PROJECT_DEADLINE_MAX_REMINDERS = 5;
export const PROJECT_DEADLINE_MAX_SHARES = 25;

export const ProjectDeadlineReminder = z.object({
  amount: z.number().int(),
  unit: ProjectDeadlineReminderUnit,
  /** In the bell of the owner and every coworker it is shared with. */
  inApp: z.boolean(),
  /** And by email to them. */
  email: z.boolean(),
  sentAt: DateTime.nullable(),
});
export type ProjectDeadlineReminder = z.infer<typeof ProjectDeadlineReminder>;

export const ProjectDeadline = z.object({
  id: z.uuid(),
  name: z.string(),
  dueAt: DateTime,
  description: z.string().nullable(),
  service: z.object({ id: z.uuid(), name: z.string() }),
  client: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** A client the caller may not see (Staff not assigned to it): not named. */
  clientHidden: z.boolean(),
  owner: MemberRef,
  visibility: ProjectDeadlineVisibility,
  sharedWith: z.array(MemberRef),
  reminders: z.array(ProjectDeadlineReminder),
  completedAt: DateTime.nullable(),
  completedBy: MemberRef.nullable(),
  /** The caller owns it: they edit, share and delete it. */
  mine: z.boolean(),
  createdAt: DateTime,
});
export type ProjectDeadline = z.infer<typeof ProjectDeadline>;

export const ProjectDeadlineList = z.object({ items: z.array(ProjectDeadline) });
export type ProjectDeadlineList = z.infer<typeof ProjectDeadlineList>;

/**
 * Open (not completed) by default, soonest first; completed, most recently due first.
 * `scope`: the caller's own, the ones shared with them, or both.
 */
export const ProjectDeadlinesQuery = z.strictObject({
  status: z.enum(['open', 'completed', 'all']).default('open'),
  scope: z.enum(['all', 'mine', 'shared']).default('all'),
});
export type ProjectDeadlinesQuery = z.input<typeof ProjectDeadlinesQuery>;

export const ProjectDeadlineReminderInput = z
  .strictObject({
    amount: z.number().int().min(0),
    unit: ProjectDeadlineReminderUnit,
    inApp: z.boolean().default(true),
    email: z.boolean().default(false),
  })
  .refine(
    (r) =>
      r.amount * PROJECT_DEADLINE_UNIT_MINUTES[r.unit] <= PROJECT_DEADLINE_MAX_REMINDER_MINUTES,
    { message: 'A reminder is at most a year before', path: ['amount'] },
  )
  .refine((r) => r.inApp || r.email, {
    message: 'Choose in-app, email or both',
    path: ['inApp'],
  });
export type ProjectDeadlineReminderInput = z.input<typeof ProjectDeadlineReminderInput>;

/**
 * Add Deadline, and Edit (the whole deadline again). A SHARED deadline names one to
 * PROJECT_DEADLINE_MAX_SHARES coworkers (active members of the firm, never the owner); PRIVATE
 * names none. Reminders are each at a different time.
 */
export const SaveProjectDeadlineRequest = z
  .strictObject({
    name: text(200),
    dueAt: DateTime,
    description: clearable(text(4000, 'many')),
    serviceId: z.uuid(),
    clientId: z.uuid().nullable().optional(),
    visibility: ProjectDeadlineVisibility.default('PRIVATE'),
    sharedWithUserIds: z.array(z.uuid()).max(PROJECT_DEADLINE_MAX_SHARES).default([]),
    reminders: z
      .array(ProjectDeadlineReminderInput)
      .max(
        PROJECT_DEADLINE_MAX_REMINDERS,
        `Use at most ${PROJECT_DEADLINE_MAX_REMINDERS} reminders`,
      )
      .default([]),
  })
  .superRefine((body, ctx) => {
    if (body.visibility === 'SHARED' && body.sharedWithUserIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sharedWithUserIds'],
        message: 'Choose the coworkers to share it with',
      });
    }
    if (body.visibility === 'PRIVATE' && body.sharedWithUserIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['sharedWithUserIds'],
        message: 'A private deadline is shared with no one',
      });
    }
    if (new Set(body.sharedWithUserIds).size !== body.sharedWithUserIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['sharedWithUserIds'],
        message: 'Name each coworker once',
      });
    }
    const times = body.reminders.map((r) => r.amount * PROJECT_DEADLINE_UNIT_MINUTES[r.unit]);
    if (new Set(times).size !== times.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['reminders'],
        message: 'Each reminder is at a different time',
      });
    }
  });
export type SaveProjectDeadlineRequest = z.input<typeof SaveProjectDeadlineRequest>;

/** Stable `error.code` values of these routes, besides the generic ones. */
export const ProjectDeadlineErrorCode = z.enum([
  /** 403: only the deadline's owner edits, shares or deletes it. */
  'OWNER_ONLY',
]);
export type ProjectDeadlineErrorCode = z.infer<typeof ProjectDeadlineErrorCode>;

const BASE = '/business/tax-planning/project-deadlines';
const one = (id: string) => `${BASE}/${parseInput(ProjectDeadlineId, id)}`;

/**
 * `api.projectDeadlines`: the caller's project deadlines and the ones shared with them. Bad input
 * rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createProjectDeadlinesClient(request: ApiRequest) {
  return {
    list: async (query: ProjectDeadlinesQuery = {}): Promise<ProjectDeadlineList['items']> =>
      (
        await request(
          ProjectDeadlineList,
          `${BASE}${toQuery(parseInput(ProjectDeadlinesQuery, query))}`,
        )
      ).items,
    get: async (id: string): Promise<ProjectDeadline> => request(ProjectDeadline, one(id)),
    create: async (body: SaveProjectDeadlineRequest): Promise<ProjectDeadline> =>
      request(ProjectDeadline, BASE, {
        method: 'POST',
        body: parseInput(SaveProjectDeadlineRequest, body),
      }),
    /** The owner saves the whole deadline again (Edit). */
    update: async (id: string, body: SaveProjectDeadlineRequest): Promise<ProjectDeadline> =>
      request(ProjectDeadline, one(id), {
        method: 'PUT',
        body: parseInput(SaveProjectDeadlineRequest, body),
      }),
    complete: async (id: string): Promise<ProjectDeadline> =>
      request(ProjectDeadline, `${one(id)}/complete`, { method: 'POST' }),
    reopen: async (id: string): Promise<ProjectDeadline> =>
      request(ProjectDeadline, `${one(id)}/reopen`, { method: 'POST' }),
    remove: async (id: string): Promise<OkResponse> =>
      request(OkResponse, one(id), { method: 'DELETE' }),
  };
}
export type ProjectDeadlinesClient = ReturnType<typeof createProjectDeadlinesClient>;
