import { describe, expect, it } from 'vitest';
import { billingBlocked, planOf, stateText, type ServiceBillingState } from './service-billing';

// Review 2 (cross-service, Payroll F13): service and billing pause separately or together, with
// their states, dates and effects; one-time billing has nothing to pause.

const today = '2026-11-14';
const base: ServiceBillingState = {
  service: 'Bookkeeping',
  servicePaused: false,
  billing: { recurring: true, stopped: false, nextBillingOn: '2026-12-01', stopsOn: null },
  canChangeBilling: true,
};
const input = { reason: 'Client on leave', stopsOn: '2026-12-01', today };

describe('planOf', () => {
  it('pauses only the service, and says billing is not changed', () => {
    const p = planOf(base, 'service', input);
    expect(p.problem).toBeNull();
    expect(p.steps).toEqual([{ kind: 'pause-service', reason: 'Client on leave' }]);
    expect(p.effects[0]).toMatch(
      /^Bookkeeping goes on hold today \(Nov 14, 2026\).*Billing is not changed\.$/,
    );
  });

  it('pauses only billing from the chosen date, and says the service is not changed', () => {
    const p = planOf(base, 'billing', input);
    expect(p.steps).toEqual([{ kind: 'stop-billing', on: '2026-12-01' }]);
    expect(p.effects[0]).toMatch(/^Billing pauses from Dec 1, 2026.*The service is not changed\.$/);
  });

  it('changes both, service first, without the "not changed" notes', () => {
    const p = planOf(base, 'both', input);
    expect(p.steps.map((s) => s.kind)).toEqual(['pause-service', 'stop-billing']);
    expect(p.effects.join(' ')).not.toMatch(/not changed\./);
  });

  it('resumes what is paused', () => {
    const paused: ServiceBillingState = {
      ...base,
      servicePaused: true,
      billing: { ...base.billing!, stopped: true, stopsOn: '2026-11-20' },
    };
    const p = planOf(paused, 'both', { ...input, reason: '' });
    expect(p.steps).toEqual([{ kind: 'resume-service' }, { kind: 'resume-billing' }]);
  });

  it('needs a reason to pause the service, and a date not in the past to pause billing', () => {
    expect(planOf(base, 'service', { ...input, reason: ' ' }).problem).toBe(
      'Enter the reason for pausing the service.',
    );
    expect(planOf(base, 'billing', { ...input, stopsOn: '' }).problem).toBe(
      'Choose the date billing pauses from.',
    );
    expect(planOf(base, 'billing', { ...input, stopsOn: '2026-11-01' }).problem).toBe(
      'Billing cannot pause from a past date.',
    );
  });

  it('adds the service note (Payroll: the provider is not paused)', () => {
    const p = planOf({ ...base, service: 'Payroll' }, 'service', {
      ...input,
      serviceNote: 'Payroll at the provider is not paused.',
    });
    expect(p.effects[0]).toContain('Payroll at the provider is not paused.');
  });
});

describe('billing that cannot change', () => {
  it('a one-time service has no future billing to pause', () => {
    const once = { ...base, billing: { ...base.billing!, recurring: false } };
    expect(billingBlocked(once)).toMatch(/billed once/);
    expect(planOf(once, 'billing', input).problem).toMatch(/billed once/);
    expect(planOf(once, 'service', input).problem).toBeNull();
    expect(stateText(once).billing).toBe('Billed once (no future billing)');
  });

  it('only an Owner or Admin changes billing; unknown billing is not guessed', () => {
    expect(billingBlocked({ ...base, canChangeBilling: false })).toMatch(/Owner or Admin/);
    expect(billingBlocked({ ...base, billing: null })).toMatch(/could not be loaded/);
  });
});

describe('stateText', () => {
  it('names each state with its date', () => {
    expect(stateText(base)).toEqual({
      service: 'Active',
      billing: 'Active · next billing date Dec 1, 2026',
    });
    expect(
      stateText({
        ...base,
        servicePaused: true,
        billing: { ...base.billing!, stopped: true, stopsOn: '2026-11-20' },
      }),
    ).toEqual({ service: 'On hold', billing: 'Paused from Nov 20, 2026' });
  });
});
