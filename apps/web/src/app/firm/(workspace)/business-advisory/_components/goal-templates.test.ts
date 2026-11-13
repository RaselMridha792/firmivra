import { describe, expect, it } from 'vitest';
import { GOAL_TEMPLATES, matchTemplates } from './goal-templates-data';

// Advisory B24: the 15 approved goal suggestions (Octavia's §14), searchable.

describe('goal suggestions', () => {
  it('are the 15 approved ones, once each, marketing and branding combined', () => {
    expect(GOAL_TEMPLATES).toHaveLength(15);
    expect(new Set(GOAL_TEMPLATES).size).toBe(15);
    expect(GOAL_TEMPLATES).toContain('Strengthen marketing and branding');
    expect(GOAL_TEMPLATES.some((t) => /logo/i.test(t))).toBe(false);
  });

  it('match every typed word, in any case; nothing typed shows all', () => {
    expect(matchTemplates('')).toHaveLength(15);
    expect(matchTemplates('CASH')).toEqual(['Improve cash flow']);
    expect(matchTemplates('improve web')).toEqual(['Build or improve a website']);
    expect(matchTemplates('zzz')).toEqual([]);
  });
});
