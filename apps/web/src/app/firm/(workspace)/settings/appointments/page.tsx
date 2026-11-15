import type { Metadata } from 'next';
import { AppointmentSettingsScreen } from './_components/appointment-settings-screen';

export const metadata: Metadata = { title: 'Appointment Settings' };

/** Settings > Appointment Settings (Appointments Review 2, A2): rooms and equipment. */
export default function AppointmentSettingsPage() {
  return <AppointmentSettingsScreen />;
}
