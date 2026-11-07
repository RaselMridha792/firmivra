// RP-Y04 and RP-Y12 (Octavia's Reports review, Oct 28): what every Reports figure means, and when
// an insight is said, in one place.
//
// Metric definitions (the defaults until Octavia confirms):
// - Money is in US dollars, kept in cents; a report never converts currencies.
// - Days are the firm's days, in its time zone (Settings > Business; a new firm starts on
//   America/New_York). "Today", "this month" and every range turn at the firm's midnight (RP-F04).
// - Revenue: invoice fields are invoiced (Invoiced Subtotal, Tax, Total, by invoice date, paid or
//   not); payment fields are collected (Amount Collected, Tips Collected, by paid date). Revenue
//   Summary counts collected payments; the dashboard follows the firm's Revenue Basis setting
//   (RP-F21). Tax is left out unless the report's Include Tax is on.
// - A count is the number of rows the caller may see: Staff and the roles scoped like them count
//   only their assigned clients' records.
// - Every run reads live data: a result is never a cached aggregate, so it is never stale.

/** The insights a report or the dashboard may say, each with the threshold that triggers it. */
export const INSIGHT_RULES = {
  /** The report's measure moved by at least this much against the comparison period. */
  change: { key: 'change_vs_comparison', minPercent: 10 },
  /** A comparison was asked for, but its period has none of the measure: no percentage is made up. */
  noBaseline: { key: 'comparison_has_nothing', threshold: 'comparison period is zero' },
  /** Open invoices whose due date is before the firm's today (Owner, Admin, Manage only). */
  overdueInvoices: { key: 'overdue_invoices', threshold: 'due date before today' },
  /** Submitted leads with no first contact after this many days. */
  uncontactedLeads: { key: 'uncontacted_leads', days: 2 },
} as const;
