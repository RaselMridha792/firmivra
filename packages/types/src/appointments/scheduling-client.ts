import { z } from 'zod';
import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse } from '../schemas.js';
import { AppointmentId, AppointmentTypeId, MemberId } from './schemas.js';
import {
  AgendaPage,
  AgendaQuery,
  AppointmentDraft,
  AppointmentDraftList,
  AppointmentNoteRequest,
  AppointmentNoticeSettings,
  AppointmentRecord,
  AppointmentsSummary,
  AppointmentsSummaryQuery,
  AppointmentTypeConfig,
  AvailabilityRules,
  ConflictCheckRequest,
  ConflictResult,
  ContactSearchQuery,
  ContactSearchResult,
  RemindersSent,
  SaveAppointmentDraftRequest,
  ScheduleAppointmentRequest,
  SchedulingOptions,
  SendReminderRequest,
  SendRemindersRequest,
  SetAppointmentNoticeSettingsRequest,
  SetAppointmentTypeConfigRequest,
  SetAvailabilityRulesRequest,
  StaffDay,
  StaffDayQuery,
  UpdateAppointmentDetailsRequest,
} from './scheduling.js';

const APPOINTMENTS = '/business/appointments';
const DRAFTS = '/business/appointment-drafts';
const appointment = (id: string) => `${APPOINTMENTS}/${parseInput(AppointmentId, id)}`;
const draft = (id: string) => `${DRAFTS}/${parseInput(z.uuid(), id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });
const put = (body: unknown) => ({ method: 'PUT', body });

/**
 * `api.scheduling` (apps/web/src/lib/api.ts): the Appointments workspace beyond R12's
 * `api.appointments` (which keeps book, reschedule, cancel, complete, no-show and slots on the
 * same records). Everyone at the firm uses it under R12's visibility rule; types and notice
 * settings are Owner and Admin. Bad input rejects with ApiRequestError(400, 'VALIDATION_FAILED').
 */
export function createSchedulingClient(request: ApiRequest) {
  return {
    summary: async (query: AppointmentsSummaryQuery = {}): Promise<AppointmentsSummary> =>
      request(
        AppointmentsSummary,
        `${APPOINTMENTS}/summary${toQuery(parseInput(AppointmentsSummaryQuery, query))}`,
      ),
    /** Calendar, List, Today and Upcoming: the same records, filtered. */
    agenda: async (query: AgendaQuery): Promise<AgendaPage> =>
      request(AgendaPage, `${APPOINTMENTS}/agenda${toQuery(parseInput(AgendaQuery, query))}`),
    options: async (): Promise<SchedulingOptions> =>
      request(SchedulingOptions, `${APPOINTMENTS}/options`),
    /** The Client / Lead search box: clients and leads the signed-in person may see. */
    contacts: async (query: ContactSearchQuery): Promise<ContactSearchResult['items']> =>
      (
        await request(
          ContactSearchResult,
          `${APPOINTMENTS}/contacts${toQuery(parseInput(ContactSearchQuery, query))}`,
        )
      ).items,

    record: async (id: string): Promise<AppointmentRecord> =>
      request(AppointmentRecord, `${appointment(id)}/record`),
    /** Schedule Appointment. 409 SCHEDULING_CONFLICT unless overridden. Retry-safe. */
    schedule: async (body: ScheduleAppointmentRequest): Promise<AppointmentRecord> =>
      request(
        AppointmentRecord,
        `${APPOINTMENTS}/schedule`,
        post(parseInput(ScheduleAppointmentRequest, body)),
      ),
    /** Edit Existing: same record and history. 409 SAVE_CONFLICT on a stale version. */
    updateDetails: async (
      id: string,
      body: UpdateAppointmentDetailsRequest,
    ): Promise<AppointmentRecord> =>
      request(AppointmentRecord, `${appointment(id)}/details`, {
        method: 'PATCH',
        body: parseInput(UpdateAppointmentDetailsRequest, body),
      }),
    confirm: async (id: string): Promise<AppointmentRecord> =>
      request(AppointmentRecord, `${appointment(id)}/confirm`, post()),
    /** Send Reminder now; the automatic schedule is unchanged. */
    sendReminder: async (id: string, body: SendReminderRequest = {}): Promise<RemindersSent> =>
      request(
        RemindersSent,
        `${appointment(id)}/send-reminder`,
        post(parseInput(SendReminderRequest, body)),
      ),
    sendReminders: async (body: SendRemindersRequest): Promise<RemindersSent> =>
      request(
        RemindersSent,
        `${APPOINTMENTS}/reminders/send`,
        post(parseInput(SendRemindersRequest, body)),
      ),
    /** Add Notes: appends to the internal notes with who and when. */
    addNote: async (id: string, body: AppointmentNoteRequest): Promise<AppointmentRecord> =>
      request(
        AppointmentRecord,
        `${appointment(id)}/notes`,
        post(parseInput(AppointmentNoteRequest, body)),
      ),
    /** Duplicate: a draft with the permitted fields, opened in the form. */
    duplicate: async (id: string): Promise<AppointmentDraft> =>
      request(AppointmentDraft, `${appointment(id)}/duplicate`, post()),

    drafts: async (): Promise<AppointmentDraft[]> =>
      (await request(AppointmentDraftList, DRAFTS)).items,
    createDraft: async (body: SaveAppointmentDraftRequest): Promise<AppointmentDraft> =>
      request(AppointmentDraft, DRAFTS, post(parseInput(SaveAppointmentDraftRequest, body))),
    saveDraft: async (id: string, body: SaveAppointmentDraftRequest): Promise<AppointmentDraft> =>
      request(AppointmentDraft, draft(id), put(parseInput(SaveAppointmentDraftRequest, body))),
    deleteDraft: async (id: string): Promise<OkResponse> =>
      request(OkResponse, draft(id), { method: 'DELETE' }),

    /** The Staff Availability panel for one member and date. */
    staffDay: async (query: StaffDayQuery): Promise<StaffDay> =>
      request(StaffDay, `/business/availability/day${toQuery(parseInput(StaffDayQuery, query))}`),
    checkConflicts: async (body: ConflictCheckRequest): Promise<ConflictResult> =>
      request(
        ConflictResult,
        `${APPOINTMENTS}/conflicts`,
        post(parseInput(ConflictCheckRequest, body)),
      ),
    /** Edit My Availability (own; Owner and Admin anyone's). */
    rules: async (userId: string): Promise<AvailabilityRules> =>
      request(AvailabilityRules, `/business/availability/${parseInput(MemberId, userId)}/rules`),
    setRules: async (
      userId: string,
      body: SetAvailabilityRulesRequest,
    ): Promise<AvailabilityRules> =>
      request(
        AvailabilityRules,
        `/business/availability/${parseInput(MemberId, userId)}/rules`,
        put(parseInput(SetAvailabilityRulesRequest, body)),
      ),

    /** Manage Appointment Types: the configuration beyond api.appointmentTypes' fields. */
    typeConfig: async (typeId: string): Promise<AppointmentTypeConfig> =>
      request(
        AppointmentTypeConfig,
        `/business/appointment-types/${parseInput(AppointmentTypeId, typeId)}/config`,
      ),
    setTypeConfig: async (
      typeId: string,
      body: SetAppointmentTypeConfigRequest,
    ): Promise<AppointmentTypeConfig> =>
      request(
        AppointmentTypeConfig,
        `/business/appointment-types/${parseInput(AppointmentTypeId, typeId)}/config`,
        put(parseInput(SetAppointmentTypeConfigRequest, body)),
      ),

    noticeSettings: async (): Promise<AppointmentNoticeSettings> =>
      request(AppointmentNoticeSettings, `${APPOINTMENTS}/settings`),
    setNoticeSettings: async (
      body: SetAppointmentNoticeSettingsRequest,
    ): Promise<AppointmentNoticeSettings> =>
      request(
        AppointmentNoticeSettings,
        `${APPOINTMENTS}/settings`,
        put(parseInput(SetAppointmentNoticeSettingsRequest, body)),
      ),
  };
}
export type SchedulingClient = ReturnType<typeof createSchedulingClient>;
