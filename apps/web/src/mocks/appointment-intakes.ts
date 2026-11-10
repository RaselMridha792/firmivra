/**
 * A9 in mock mode: the intake form sent for an appointment (the API's `intakes.appointment_id`).
 * The intake forms mock records a send that names an appointment; the scheduling mock's record
 * shows it under Related Items. Made on first use; nothing runs on import.
 */
export interface AppointmentIntake {
  id: string;
  name: string;
  completed: boolean;
}

let store: Map<string, AppointmentIntake> | undefined;
export const appointmentIntakes = () => (store ??= new Map());
