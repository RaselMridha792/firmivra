export * from './meeting.js';
export * from './schemas.js';
export {
  createAppointmentsClient,
  createAppointmentTypesClient,
  createAvailabilityClient,
  createMyAppointmentsClient,
  type AppointmentsClient,
  type AppointmentTypesClient,
  type AvailabilityClient,
  type MyAppointmentsClient,
} from './client.js';
export * from './scheduling.js';
export { createSchedulingClient, type SchedulingClient } from './scheduling-client.js';
