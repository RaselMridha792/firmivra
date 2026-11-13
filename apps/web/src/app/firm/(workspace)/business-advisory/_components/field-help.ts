// Business Advisory helper text, word for word from Octavia's review of Oct 25 (§6 and §7, B14).
// It is shown persistently below each field's label and above its input (`hint` in packages/ui).
// Only fields she approved get one; the rest of the platform is unchanged until she supplies copy.

/** §6 and §7: approved helper text. */
export const FIELD_HELP = {
  currentCustomers: 'Describe who currently buys your products or services.',
  salesTrend: 'Describe whether sales are increasing, decreasing, or steady, and over what period.',
  targetMarket: 'Describe the people or businesses you want to reach.',
  competitors: 'List businesses offering similar products or services to your customers.',
  setsApart: 'Explain why customers choose your business over alternatives.',
  amountNeeded: 'Total funding requested.',
  timing: 'When the funds are needed.',
  purpose: 'What the funds will be used for.',
  readiness: 'How prepared you are to apply for or receive funding.',
  howItOperates:
    'Describe how the business delivers its products or services, including key steps, tools, suppliers, and capacity limits.',
  systems:
    'Describe day-to-day workflow or tool problems that slow the business down, such as manual steps, bottlenecks, or missing systems.',
  staffing:
    'Describe current staffing needs, skill gaps, workload, or hiring challenges affecting the business.',
  efficiency:
    'Describe changes that could save time, reduce costs, improve quality, or help the business serve customers better.',
  strengths: 'What does the business do well, and what advantages does it have?',
  weaknesses: 'What internal limitations or gaps need improvement?',
  opportunities: 'What external trends, markets, or partnerships could help the business grow?',
  threats:
    'What external risks could affect the business, such as competition, rising costs, or supply disruptions?',
  goalDescription: 'Explain what this goal will achieve and how success will be measured.',
} as const;

/**
 * §7, "Recommendation definitions proposed for confirmation": PROPOSED, not approved. Built as
 * asked and flagged in the PR so Octavia can confirm or change the wording.
 */
export const PROPOSED_HELP = {
  recommendation: 'Describe the action you recommend the business take.',
  category:
    'Select the focus area that best fits this recommendation, or enter a suitable category.',
  impactText:
    'Describe the expected benefit of this recommendation, such as improved efficiency, stronger customer demand, or reduced risk.',
  impactAmount:
    'Enter the estimated financial benefit, if known. Specify whether it represents additional revenue or cost savings and the period it covers. Leave blank if it cannot reasonably be estimated.',
  rationale:
    'Explain why this recommendation is appropriate, including the problem or opportunity it addresses.',
  showOnPortal:
    'Make this recommendation available in the client portal only when permitted and approved for client viewing.',
} as const;
