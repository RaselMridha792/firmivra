import { describe, expect, it } from 'vitest';
import { plainForm } from './plain-form';

// Intake Review 2 23-g: with Use this branding on client-facing forms off, only the forms outside
// the portal (a lead's link, a public share link) drop the firm's logo and colours.
describe('plainForm (23-g)', () => {
  const off = { formBranding: false };
  it('is plain on the lead link and the share link while the switch is off', () => {
    expect(plainForm('/lvp/form', 'lvp', off)).toBe(true);
    expect(plainForm('/lvp/form/', 'lvp', off)).toBe(true);
    expect(plainForm('/lvp/start/abc', 'lvp', off)).toBe(true);
  });
  it('keeps the branding everywhere else, and everywhere while the switch is on', () => {
    for (const path of ['/lvp', '/lvp/sign-in', '/lvp/intake', '/lvp/begin/annual-tax'])
      expect(plainForm(path, 'lvp', off)).toBe(false);
    expect(plainForm('/lvp/form', 'lvp', { formBranding: true })).toBe(false);
    expect(plainForm('/lvp/form', 'lvp', {})).toBe(false);
    expect(plainForm('/lvp/form', 'lvp', undefined)).toBe(false);
    expect(plainForm(null, 'lvp', off)).toBe(false);
    // Another firm's path is not this firm's form.
    expect(plainForm('/other/form', 'lvp', off)).toBe(false);
  });
});
