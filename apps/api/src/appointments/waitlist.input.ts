import {
  JoinWaitlistRequest,
  SaveWaitlistSettingsRequest,
  WaitlistEntryId,
  WaitlistQuery,
} from '@firmivra/types';
import { idParam } from './appointments.input.js';

// R55, Appointments A3: the waitlist routes' inputs (contract in
// packages/types/src/appointments/waitlist.ts). Ids lower-cased, as the other appointment routes.

export const SaveWaitlistSettingsBody = SaveWaitlistSettingsRequest;
export const WaitlistListQuery = WaitlistQuery;
export const JoinWaitlistBody = JoinWaitlistRequest.transform((b) => ({
  appointmentId: b.appointmentId.toLowerCase(),
}));
export const WaitlistEntryParam = idParam(WaitlistEntryId);
