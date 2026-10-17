import type { Metadata } from 'next';
import { ProfileFrame } from '../_components/profile-frame';
import { AppointmentsTab } from '../_components/tab-appointments';

export const metadata: Metadata = { title: 'Lead: Appointments' };

export default function LeadsIdAppointmentsPage() {
  return (
    <ProfileFrame tab="appointments">
      <AppointmentsTab />
    </ProfileFrame>
  );
}
