import type { AutomationEvent } from '@firmivra/types';

// AU-F04 (Octavia's Oct 28 review): the trigger step's sentence, kept apart from the builder so
// it is tested on its own.

const UNIT_MS = { MINUTE: 60_000, HOUR: 3_600_000, DAY: 86_400_000 } as const;
const UNIT_WORD = { MINUTE: 'minute', HOUR: 'hour', DAY: 'day' } as const;

/**
 * AU-F04: the trigger in a sentence, with an example from now in the firm's time zone ("Runs 3
 * days after the due date. For example, if the due date is Nov 6, 2:00 PM, it runs Nov 9, 2:00
 * PM."). Nothing is run to show it.
 */
export function triggerSentence(
  ev: Pick<AutomationEvent, 'anchor' | 'example'>,
  f: { timing: string; offsetValue: string; offsetUnit: 'MINUTE' | 'HOUR' | 'DAY' },
  timezone: string,
  now = new Date(),
): string {
  if (f.timing === 'IMMEDIATE') return `Runs as soon as ${ev.anchor}. ${ev.example}.`;
  if (f.timing === 'SCHEDULED') return 'Runs on the schedule you set.';
  const n = Number(f.offsetValue);
  if (f.offsetValue === '' || !Number.isInteger(n) || n < 0) {
    return 'Enter how long before or after to see an example.';
  }
  const at = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  });
  const when = at.format(now);
  const run = at.format(
    new Date(now.getTime() + (f.timing === 'BEFORE' ? -1 : 1) * n * UNIT_MS[f.offsetUnit]),
  );
  // "the due date is Nov 6", "it happens Nov 6".
  const subject = /^the [a-z -]+(date|time)$/.test(ev.anchor) ? `${ev.anchor} is` : ev.anchor;
  const rule =
    n === 0
      ? `Runs at the moment ${ev.anchor.replace(/^the /, 'of the ')}.`
      : `Runs ${n} ${UNIT_WORD[f.offsetUnit]}${n === 1 ? '' : 's'} ${f.timing === 'BEFORE' ? 'before' : 'after'} ${ev.anchor}.`;
  return `${rule} For example, if ${subject} ${when}, it runs ${run}.`;
}
