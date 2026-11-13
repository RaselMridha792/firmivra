/**
 * Advisory B24 (Octavia's §14, approved Oct 25): the goal suggestions. They are categories to
 * start from, not targets or mandatory goals; "Strengthen marketing and branding" is one combined
 * suggestion.
 */
export const GOAL_TEMPLATES: readonly string[] = [
  'Increase revenue',
  'Improve profit margins',
  'Reduce costs',
  'Improve cash flow',
  'Attract new customers',
  'Increase repeat business',
  'Launch a product or service',
  'Enter a new market or location',
  'Prepare for funding',
  'Hire and develop staff',
  'Improve workflows',
  'Strengthen marketing and branding',
  'Build or improve a website',
  'Complete business setup',
  'Improve budgeting and reporting',
];

/** The suggestions matching `term` (any word, any case). */
export function matchTemplates(term: string): string[] {
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return GOAL_TEMPLATES.filter((t) => words.every((w) => t.toLowerCase().includes(w)));
}
