'use client';

import { CalendarCheck } from '@phosphor-icons/react';
import { RequireRole } from '../../../../../../components/require-role';
import { SettingsHeader } from '../../_components/settings-parts';
import { EquipmentCard } from './equipment-card';
import { RoomsCard } from './rooms-card';

/**
 * Settings > Appointment Settings (Appointments Review 2): Owner and Admin only (the API answers
 * Staff 403). Each card is its own component that reads and changes its own data, so a card is
 * one import and one line below (A2: Rooms and Equipment; A3's Waitlist joins the same way).
 */
export function AppointmentSettingsScreen() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={CalendarCheck}
        title="Appointment Settings"
        subtitle="The rooms and equipment your team books with appointments."
      />
      <RequireRole
        roles={['OWNER', 'ADMIN']}
        fallback={
          <p className="text-sm text-muted" data-testid="appointment-settings-managers">
            Only owners and admins can change appointment settings.
          </p>
        }
      >
        <div className="grid min-w-0 grid-cols-1 items-start gap-6 2xl:grid-cols-2">
          <RoomsCard />
          <EquipmentCard />
        </div>
      </RequireRole>
    </div>
  );
}
