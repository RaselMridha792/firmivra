'use client';

import type { LocationRow } from '@firmivra/types';
import { ActionMenu } from '@firmivra/ui';
import {
  CalendarCheck,
  CheckCircle,
  DotsThree,
  Eye,
  PencilSimple,
  Star,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import {
  ActivateLocationDialog,
  DeactivateLocationDialog,
  ManageStaffDialog,
  ScheduleDialog,
  SetPrimaryDialog,
} from './location-dialogs';
import { LOCATIONS } from './location-parts';
import { LocationProfileDialog, useLocation } from './location-profile';

// A location's actions, the same on Settings > Locations and the Overview's Location Management
// (Overview guide 24: View Profile, Edit Location, Manage Staff, Set as Primary,
// Activate/Deactivate; no Delete). Deactivating and schedules are the Super Administrator's.

export type LocationOpen = {
  kind: 'profile' | 'staff' | 'deactivate' | 'activate' | 'primary' | 'schedule';
  id: string;
} | null;

/** The row's three-dot menu. */
export function LocationRowMenu({
  row,
  superAdmin,
  onOpen,
}: {
  row: LocationRow;
  superAdmin: boolean;
  onOpen: (open: NonNullable<LocationOpen>) => void;
}) {
  const router = useRouter();
  const open = (kind: NonNullable<LocationOpen>['kind']) => () => onOpen({ kind, id: row.id });
  return (
    <ActionMenu
      label={`More actions for ${row.name}`}
      trigger={<DotsThree aria-hidden weight="bold" className="size-5" />}
      sections={[
        {
          items: [
            { label: 'View Location Profile', icon: Eye, onSelect: open('profile') },
            {
              label: 'Edit Location',
              icon: PencilSimple,
              onSelect: () => router.push(`/settings/locations/${row.id}/edit`),
            },
            { label: 'Manage Staff', icon: UsersThree, onSelect: open('staff') },
            ...(!row.isMain && row.status === 'ACTIVE'
              ? [{ label: 'Set as Primary', icon: Star, onSelect: open('primary') }]
              : []),
            ...(row.pendingAction && superAdmin
              ? [{ label: 'Edit Schedule', icon: CalendarCheck, onSelect: open('schedule') }]
              : []),
            ...(row.status === 'INACTIVE'
              ? [{ label: 'Activate', icon: CheckCircle, onSelect: open('activate') }]
              : []),
            ...(row.status === 'ACTIVE' && !row.isMain && superAdmin
              ? [
                  {
                    label: 'Deactivate',
                    icon: WarningCircle,
                    danger: true,
                    onSelect: open('deactivate'),
                  },
                ]
              : []),
          ],
        },
      ]}
    />
  );
}

/** The dialog the row, the menu or the details card opened, on that location's profile. */
export function LocationOpened({
  open,
  superAdmin,
  onClose,
  onDone,
}: {
  open: NonNullable<LocationOpen>;
  superAdmin: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [kind, setKind] = useState(open.kind);
  const q = useLocation(open.id);
  const options = useApiQuery([...LOCATIONS, 'options'], () => api.locations.options());
  const members = options.data?.members ?? [];
  if (kind === 'profile') {
    return (
      <LocationProfileDialog
        locationId={open.id}
        onClose={onClose}
        onManageStaff={() => setKind('staff')}
      />
    );
  }
  const l = q.data;
  if (!l) return null;
  if (kind === 'staff')
    return <ManageStaffDialog location={l} members={members} onClose={onClose} onDone={onDone} />;
  if (kind === 'primary')
    return <SetPrimaryDialog location={l} onClose={onClose} onDone={onDone} />;
  if (kind === 'activate')
    return <ActivateLocationDialog location={l} onClose={onClose} onDone={onDone} />;
  if (kind === 'deactivate' && superAdmin) {
    return <DeactivateLocationDialog location={l} onClose={onClose} onDone={onDone} />;
  }
  if (kind === 'schedule' && l.pendingAction) {
    return (
      <ScheduleDialog
        action={l.pendingAction}
        zone={l.effectiveTimeZone}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }
  return null;
}
