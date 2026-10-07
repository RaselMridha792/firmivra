import { describe, it, expect } from 'vitest';
import { applicationForm } from '../../src/applications/applications.service.js';
describe('application data projection', () => {
  it('drops unapproved fields and executable URLs', () => {
    const form = applicationForm({
      website: 'javascript:alert(1)',
      ssn: 'synthetic-secret',
      city: 'Synthetic',
    });
    expect(form.website).toBeNull();
    expect(form.city).toBe('Synthetic');
    expect(form).not.toHaveProperty('ssn');
    expect(applicationForm(null).country).toBeNull();
  });
});
