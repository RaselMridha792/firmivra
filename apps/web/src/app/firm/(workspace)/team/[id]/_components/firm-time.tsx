'use client';

import { useFirmTimeZone } from '../../../intake-forms/_components/expiry';
import { dateTime } from './staff-parts';

/**
 * SM38 (Staff Management Review 2): a time as Staff Management shows it, in the firm's time zone
 * (the header's), never the viewer's browser zone.
 */
export function FirmDateTime({ iso }: { iso: string }) {
  return <>{dateTime(iso, useFirmTimeZone())}</>;
}

export { useFirmTimeZone };
