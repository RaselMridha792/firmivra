'use client';

import { PageState } from '../../../../../../components/page-state';
import { useFirm } from '../../../../../../components/firm-context';
import { useMe } from '../../../../../../components/signed-in';
import { api } from '../../../../../../lib/api';
import { useApiQuery } from '../../../../../../lib/query';
import { AVAILABILITY } from '../../../calendar/_components/shared';
import { BlockedTimes } from './blocked-times';
import { WorkingHours } from './working-hours';

/**
 * Settings > Availability: everyone's regular hours and time away, in the firm's time zone.
 * Everyone reads; Owner and Admin change anyone's, Staff their own (the API checks again).
 */
export function AvailabilityScreen() {
  const { role } = useFirm();
  const { me } = useMe();
  const availability = useApiQuery(AVAILABILITY, () => api.availability.get());
  const manager = role === 'OWNER' || role === 'ADMIN';

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
          Availability
        </h1>
        <p className="text-sm text-muted">
          Working hours and blocked time decide which times clients and staff can book.
        </p>
      </div>
      <PageState query={availability}>
        {({ timezone, members }) => (
          <>
            <p className="text-sm text-muted">Times are in {timezone}.</p>
            {members.map((member) => (
              <WorkingHours
                key={member.member.userId}
                member={member}
                editable={manager || member.member.userId === me.user.id}
              />
            ))}
            <BlockedTimes members={members} timeZone={timezone} me={me.user.id} manager={manager} />
          </>
        )}
      </PageState>
    </div>
  );
}
