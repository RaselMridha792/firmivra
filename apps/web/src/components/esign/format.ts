/** A date for tables and summaries ("Oct 9, 2026"); a dash when there is none. */
export const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '–';

/** A date and time for the timeline, with its time zone ("Oct 9, 2026, 3:15 PM EDT"). */
export const dateTime = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });

/** "1 day", "3 days". */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
