'use client';

import { useSyncExternalStore } from 'react';

// Octavia's SM10 (Staff Management review of Oct 23): the current date and time at the top right
// of every page, updating, with its time zone named. The signed-in person's own time zone (the
// browser's): the firm's setting is not readable by every member.

const MINUTE = 60_000;
const subscribe = (tick: () => void) => {
  const timer = setInterval(tick, 15_000);
  return () => clearInterval(timer);
};
/** The current minute: the value changes once a minute, so the clock redraws then. */
const minuteNow = () => Math.floor(Date.now() / MINUTE);
/** The server draws no time (no hydration mismatch); the browser fills it in at once. */
const noMinute = () => 0;

export function HeaderClock() {
  const minute = useSyncExternalStore(subscribe, minuteNow, noMinute);
  if (!minute) return null;
  const now = new Date(minute * MINUTE);
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-US', {
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
