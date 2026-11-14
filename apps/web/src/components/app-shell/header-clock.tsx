'use client';

import { useSyncExternalStore } from 'react';

// Octavia's SM10 (Staff Management review of Oct 23): the current date and time at the top right
// of every page, updating, with its time zone named. Dashboard Review 2 (U2): in the firm
// workspace, the firm's time zone (Settings > Preferences), the one its dates and "today" follow;
// on the Super Admin console, which belongs to no firm, the person's own (the browser's).

const MINUTE = 60_000;
const subscribe = (tick: () => void) => {
  const timer = setInterval(tick, 15_000);
  return () => clearInterval(timer);
};
/** The current minute: the value changes once a minute, so the clock redraws then. */
const minuteNow = () => Math.floor(Date.now() / MINUTE);
/** The server draws no time (no hydration mismatch); the browser fills it in at once. */
const noMinute = () => 0;

export function HeaderClock({ timeZone }: { timeZone?: string } = {}) {
  const minute = useSyncExternalStore(subscribe, minuteNow, noMinute);
  if (!minute) return null;
  const now = new Date(minute * MINUTE);
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(now);
  return (
    <p
      data-testid="header-clock"
      title={`Time zone: ${zone}`}
      className="hidden flex-col items-end px-2 text-xs leading-tight lg:flex"
    >
      <time dateTime={now.toISOString()} className="font-semibold whitespace-nowrap text-heading">
        {date}
      </time>
      <span className="whitespace-nowrap text-muted">
        {time} <span className="sr-only">({zone})</span>
      </span>
    </p>
  );
}
