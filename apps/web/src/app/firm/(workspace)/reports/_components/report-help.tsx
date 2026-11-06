'use client';

import { HelpTip } from '@firmivra/ui';

// RP-F22 (Octavia's Reports review, Oct 28): one Help icon per functional area, with its text in
// this one file. Each says what the area is for, what it uses and what it does, in plain words.

const HELP = {
  metrics: {
    topic: 'Report cards',
    text: 'Each card counts one thing in the chosen range, on your firm’s calendar. Its line under it says what it counts; open it to see the report behind the number.',
  },
  categories: {
    topic: 'Report categories',
    text: 'Reports grouped by area: Financial, Clients, Tax and more. A card shows a short summary; View Report opens the full report on the same range.',
  },
  dates: {
    topic: 'Date range and comparison',
    text: 'Ranges end on today in your firm’s time zone and move to the new day at its midnight. Custom Range takes two dates, the start first. Comparison sets this range beside the one before it or the same one last year.',
  },
  filters: {
    topic: 'Filters',
    text: 'Each filter compares a field in a way its type allows. Money is typed in dollars. A filter that does not fit says why under its box and is not used until it is fixed. Clear All removes your added filters, not the report’s own.',
  },
  fields: {
    topic: 'Fields, grouping and sorting',
    text: 'Choose the columns and their order (drag them, or use the arrows). Group By totals rows that share a value; Sort sets the order. Changing the data source asks first, as it resets these.',
  },
  charts: {
    topic: 'Charts',
    text: 'The chart draws the same rows as the table and the cards. Chart type and data labels change how it looks, not what it counts. A saved report opens with its own chart settings.',
  },
  table: {
    topic: 'The table',
    text: 'Search narrows the table, the cards, the chart and the export together. Columns hides or shows columns for you; a column with a lock always stays. Sort by clicking a heading.',
  },
  export: {
    topic: 'Export and print',
    text: 'CSV is raw values for analysis, Excel has headings and formats, PDF is the report as you see it. Each has the screen’s range, filters and search. Print prints this page. Exports need the Export permission.',
  },
  library: {
    topic: 'Saved reports and sharing',
    text: 'Save Changes keeps the same report for everyone it is shared with; Save As makes a copy that is yours. Only its owner, an Owner or an Admin changes or archives a report. Archived ones can be restored.',
  },
  schedules: {
    topic: 'Scheduled reports',
    text: 'A schedule makes the report on its days at its time, in your firm’s time zone, and sends it only to members of your firm. Pause stops it without deleting it.',
  },
  insights: {
    topic: 'Insights',
    text: 'Short notes from the numbers on screen, only when there is something to compare. They point to the report behind them; they are not advice.',
  },
  errors: {
    topic: 'When a report cannot run',
    text: 'The message says what stopped it, and the last results stay on screen. Edit or clear the filter it names; nothing you saved is changed.',
  },
} as const;

export type ReportHelpArea = keyof typeof HELP;

/** The Help icon of one Reports area. */
export function ReportHelp({ area }: { area: ReportHelpArea }) {
  const h = HELP[area];
  return <HelpTip topic={h.topic}>{h.text}</HelpTip>;
}
