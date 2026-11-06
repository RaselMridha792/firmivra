'use client';

import { HelpTip } from '@firmivra/ui';

// CD-F17 (Octavia's Compliance & Deadlines review, Oct 28): one Help icon per functional area, its
// text in this one file: what the area is for, what it needs, and what its actions do. Opening an
// icon never saves or sends anything.

const HELP = {
  overview: {
    topic: 'Compliance overview',
    text: 'Deadlines that are still to do, by their effective due date (the extended date when an extension was filed). The cards count the same deadlines; open one to see the list behind it.',
  },
  filters: {
    topic: 'Filters',
    text: 'Narrow the list by date range, type, client, status, assignee or agency. The view and filters stay in the address, so Back returns to this exact list.',
  },
  form: {
    topic: 'A deadline',
    text: 'The due date is the statutory date unless you change it, and a change needs a reason. Create Task makes one task for the deadline (asking again opens the same one). Reminders go only to the people and channels you choose.',
  },
  recurrence: {
    topic: 'Recurring deadlines',
    text: 'A recurring definition makes each deadline from its schedule. The summary shows the schedule in words; it claims none until the schedule is complete. Changes apply to deadlines made after you save.',
  },
  import: {
    topic: 'Importing a calendar',
    text: 'Enter the authority’s dates as a draft calendar. Preview shows what would change; Import as Draft saves it unpublished, so no deadline is made until it is verified and published in the library.',
  },
  library: {
    topic: 'Calendar library',
    text: 'Calendars your firm uses. A draft is verified, then published; publishing makes its dates available to recurring deadlines. An unknown date stays “Needs Verification” and is never guessed.',
  },
  applicability: {
    topic: 'Applicability rules',
    text: 'A rule says which clients a deadline applies to. Check shows the clients it would match; Generate makes their deadlines, once each. Dismissing a suggestion needs a reason.',
  },
  manage: {
    topic: 'Managing recurring deadlines',
    text: 'Edit, pause, resume or end a recurring definition. Pausing stops new deadlines without changing the ones already made.',
  },
  logs: {
    topic: 'Logs',
    text: 'What generating, importing and overriding did, with the result of each. Manual changes to a deadline are in the firm’s Audit Log.',
  },
  settings: {
    topic: 'Compliance settings',
    text: 'When a deadline counts as Due Soon or At Risk, when a calendar counts as stale, and when work is escalated. They change how deadlines are flagged, not their dates.',
  },
} as const;

export type ComplianceHelpArea = keyof typeof HELP;

/** The Help icon of one Compliance area. */
export function ComplianceHelp({ area }: { area: ComplianceHelpArea }) {
  const h = HELP[area];
  return <HelpTip topic={h.topic}>{h.text}</HelpTip>;
}
