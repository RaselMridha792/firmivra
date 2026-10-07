import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { portalMe } from '../clients/client.js';
import { OkResponse } from '../schemas.js';
import {
  Appointment,
  AppointmentDetail,
  AppointmentId,
  AppointmentList,
  AppointmentsQuery,
  AppointmentType,
  AppointmentTypeId,
  AppointmentTypeList,
  AppointmentTypesQuery,
  Availability,
  BlockedTime,
  BlockedTimeId,
  BlockedTimeList,
  BlockedTimesQuery,
  BookableTypeList,
  BookAppointmentRequest,
  BookMyAppointmentRequest,
  CancelAppointmentRequest,
  CancelMyAppointmentRequest,
  CreateAppointmentTypeRequest,
  CreateBlockedTimeRequest,
  MemberAvailability,
  MemberId,
  MyAppointment,
  MyAppointmentList,
  MyAppointmentsQuery,
  MySlotList,
  MySlotsQuery,
  RescheduleAppointmentRequest,
  RescheduleMyAppointmentRequest,
  SetWorkingHoursRequest,
  SlotList,
  SlotsQuery,
  UpdateAppointmentTypeRequest,
} from './schemas.js';

const TYPES = '/business/appointment-types';
const APPOINTMENTS = '/business/appointments';
const type = (id: string) => `${TYPES}/${parseInput(AppointmentTypeId, id)}`;
const appointment = (id: string) => `${APPOINTMENTS}/${parseInput(AppointmentId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.appointmentTypes`: the kinds of appointment the firm offers. Everyone at the firm reads;
 * Owner and Admin change them (403 FORBIDDEN for Staff). Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent.
 */
export function createAppointmentTypesClient(request: ApiRequest) {
  return {
    list: async (query: AppointmentTypesQuery = {}): Promise<AppointmentTypeList['items']> => {
      const q = parseInput(AppointmentTypesQuery, query);
      return (await request(AppointmentTypeList, `${TYPES}${toQuery(q)}`)).items;
    },
    create: async (body: CreateAppointmentTypeRequest): Promise<AppointmentType> =>
      request(AppointmentType, TYPES, post(parseInput(CreateAppointmentTypeRequest, body))),
    update: async (id: string, body: UpdateAppointmentTypeRequest): Promise<AppointmentType> =>
      request(AppointmentType, type(id), {
        method: 'PATCH',
        body: parseInput(UpdateAppointmentTypeRequest, body),
      }),
    archive: async (id: string): Promise<AppointmentType> =>
      request(AppointmentType, `${type(id)}/archive`, post()),
    restore: async (id: string): Promise<AppointmentType> =>
      request(AppointmentType, `${type(id)}/restore`, post()),
  };
}
export type AppointmentTypesClient = ReturnType<typeof createAppointmentTypesClient>;

/**
 * `api.availability`: working hours and blocked time. Owner and Admin manage anyone's and
 * whole-firm blocks; Staff manage their own (403 FORBIDDEN otherwise).
 */
export function createAvailabilityClient(request: ApiRequest) {
  return {
    /** Every active member's regular week, in the firm's timezone. */
    get: async (): Promise<Availability> => request(Availability, '/business/availability'),
    /** Replaces one member's week. */
    setWorkingHours: async (
      userId: string,
      body: SetWorkingHoursRequest,
    ): Promise<MemberAvailability> =>
      request(
        MemberAvailability,
        `/business/availability/${parseInput(MemberId, userId)}/working-hours`,
        { method: 'PUT', body: parseInput(SetWorkingHoursRequest, body) },
      ),
    blockedTimes: async (query: BlockedTimesQuery): Promise<BlockedTimeList['items']> => {
      const q = parseInput(BlockedTimesQuery, query);
      return (await request(BlockedTimeList, `/business/blocked-times${toQuery(q)}`)).items;
    },
    block: async (body: CreateBlockedTimeRequest): Promise<BlockedTime> =>
      request(
        BlockedTime,
        '/business/blocked-times',
        post(parseInput(CreateBlockedTimeRequest, body)),
      ),
    unblock: async (id: string): Promise<OkResponse> =>
      request(OkResponse, `/business/blocked-times/${parseInput(BlockedTimeId, id)}`, {
        method: 'DELETE',
      }),
  };
}
export type AvailabilityClient = ReturnType<typeof createAvailabilityClient>;

/**
 * `api.appointments`: the firm's calendar. Everyone at the firm reads and books; a time someone
 * just took is 409 SLOT_TAKEN (show "someone else just took this time" and reload the slots).
 */
export function createAppointmentsClient(request: ApiRequest) {
  return {
    list: async (query: AppointmentsQuery): Promise<AppointmentList['items']> => {
      const q = parseInput(AppointmentsQuery, query);
      return (await request(AppointmentList, `${APPOINTMENTS}${toQuery(q)}`)).items;
    },
    /** One appointment with its history (book, reschedules, cancel...). */
    get: async (id: string): Promise<AppointmentDetail> =>
      request(AppointmentDetail, appointment(id)),
    slots: async (query: SlotsQuery): Promise<SlotList> => {
      const q = parseInput(SlotsQuery, query);
      return request(SlotList, `${APPOINTMENTS}/slots${toQuery(q)}`);
    },
    book: async (body: BookAppointmentRequest): Promise<Appointment> =>
      request(Appointment, APPOINTMENTS, post(parseInput(BookAppointmentRequest, body))),
    reschedule: async (id: string, body: RescheduleAppointmentRequest): Promise<Appointment> =>
      request(
        Appointment,
        `${appointment(id)}/reschedule`,
        post(parseInput(RescheduleAppointmentRequest, body)),
      ),
    cancel: async (id: string, body: CancelAppointmentRequest = {}): Promise<Appointment> =>
      request(
        Appointment,
        `${appointment(id)}/cancel`,
        post(parseInput(CancelAppointmentRequest, body)),
      ),
    complete: async (id: string): Promise<Appointment> =>
      request(Appointment, `${appointment(id)}/complete`, post()),
    noShow: async (id: string): Promise<Appointment> =>
      request(Appointment, `${appointment(id)}/no-show`, post()),
  };
}
export type AppointmentsClient = ReturnType<typeof createAppointmentsClient>;

/**
 * `api.myAppointments(slug)`: the signed-in client's appointments at this firm (portal). After a
 * type's cutoff, reschedule and cancel are 409 CHANGE_WINDOW_CLOSED: ask the client to contact
 * the firm.
 */
export function createMyAppointmentsClient(request: ApiRequest, firmSlug: string) {
  const base = () => `${portalMe(firmSlug)}/appointments`;
  const mine = (id: string) => `${base()}/${parseInput(AppointmentId, id)}`;
  return {
    list: async (query: MyAppointmentsQuery = {}): Promise<MyAppointmentList['items']> => {
      const q = parseInput(MyAppointmentsQuery, query);
      return (await request(MyAppointmentList, `${base()}${toQuery(q)}`)).items;
    },
    /** The types this client can book. */
    types: async (): Promise<BookableTypeList['items']> =>
      (await request(BookableTypeList, `${base()}/types`)).items,
    slots: async (query: MySlotsQuery): Promise<MySlotList> => {
      const q = parseInput(MySlotsQuery, query);
      return request(MySlotList, `${base()}/slots${toQuery(q)}`);
    },
    book: async (body: BookMyAppointmentRequest): Promise<MyAppointment> =>
      request(MyAppointment, base(), post(parseInput(BookMyAppointmentRequest, body))),
    reschedule: async (id: string, body: RescheduleMyAppointmentRequest): Promise<MyAppointment> =>
      request(
        MyAppointment,
        `${mine(id)}/reschedule`,
        post(parseInput(RescheduleMyAppointmentRequest, body)),
      ),
    cancel: async (id: string, body: CancelMyAppointmentRequest = {}): Promise<MyAppointment> =>
      request(
        MyAppointment,
        `${mine(id)}/cancel`,
        post(parseInput(CancelMyAppointmentRequest, body)),
      ),
  };
}
export type MyAppointmentsClient = ReturnType<typeof createMyAppointmentsClient>;
