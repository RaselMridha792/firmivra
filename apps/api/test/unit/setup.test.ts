import { describe, it, expect } from 'vitest';
import { requireSetupSteps } from '../../src/settings/settings.service.js';
describe('setup prerequisite validation', () => {
  it('does not allow missing information or client-set completion', () => {
    expect(() => requireSetupSteps(['branding'], { branding: false })).toThrow();
    expect(() => requireSetupSteps(['finish'], { finish: true })).toThrow();
    expect(() => requireSetupSteps(['unknown'], { branding: true })).toThrow();
  });
  it('allows a draft subset and an empty draft', () => {
    expect(() => requireSetupSteps(['branding'], { branding: true, team: false })).not.toThrow();
    expect(() => requireSetupSteps([], {})).not.toThrow();
  });
});
