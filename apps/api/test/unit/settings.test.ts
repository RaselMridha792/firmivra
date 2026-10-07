import { describe, expect, it } from 'vitest';
import { stepsOf } from '../../src/settings/settings.service.js';

describe('stepsOf (setup_progress)', () => {
  it('returns the done steps in wizard order', () => {
    expect(stepsOf({ team: true, branding: true })).toEqual(['branding', 'team']);
    expect(
      stepsOf({ clientPortal: true, businessDetails: true, team: true, branding: true }),
    ).toEqual(['branding', 'businessDetails', 'team', 'clientPortal']);
  });

  it('ignores anything that is not a known step set to true', () => {
    expect(stepsOf({})).toEqual([]);
    expect(stepsOf({ profile: true, finish: true, team: 'yes', branding: false })).toEqual([]);
    for (const odd of [null, undefined, 'branding', ['branding'], 42]) {
      expect(stepsOf(odd)).toEqual([]);
    }
  });
});
