import type { Metadata } from 'next';
import { safeOrigin } from '../../../../../lib/origin';
import { ScheduleForm } from '../_components/schedule-form';
import { isCalendarDate } from '../_components/time';

export const metadata: Metadata = { title: 'Schedule appointment' };

type Param = string | string[] | undefined;
const id = (v: Param) => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

/**
 * `?date=2026-09-20&time=08:00`: the empty hour picked on the calendar. A service workspace's
 * Schedule Appointment (SH6) adds `clientId` and `engagementId`: the form opens on that client and
 * the engagement's service, and Cancel returns to `from` without creating anything. Tax Planning's
 * Schedule a Planning Consultation (C02) sends `serviceId` alone: its service is chosen and the
 * client is picked in the form. A plan's Schedule Client Discussion (C12) adds `taxPlanId`: the
 * appointment is that plan's discussion. Review 2 (Save as Draft): `?draft=` reopens one of the
 * member's saved drafts; scheduling it deletes the draft.
 */
export default async function CalendarNewPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: Param;
    time?: Param;
    clientId?: Param;
    engagementId?: Param;
    serviceId?: Param;
    taxPlanId?: Param;
    draft?: Param;
    from?: Param;
  }>;
}) {
  const { date, time, clientId, engagementId, serviceId, taxPlanId, draft, from } =
    await searchParams;
  const at =
    typeof date === 'string' &&
    isCalendarDate(date) &&
    typeof time === 'string' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(time)
      ? { date, time }
      : undefined;
  return (
    <ScheduleForm
      at={at}
      prefill={{
        clientId: id(clientId),
        engagementId: id(engagementId),
        serviceId: id(serviceId),
      }}
      cancelHref={safeOrigin(from) ?? undefined}
      taxPlanId={id(taxPlanId)}
      draftId={id(draft)}
    />
  );
}
