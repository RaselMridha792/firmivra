// Octavia's Review 2 cross-service requirement (Bookkeeping and Payroll, F13): pausing the service
// and pausing billing are separate choices in one place. Either or both can change, each shows its
// state and effective date, the effects are spelled out before confirming, and one-time billing
// is called out as having nothing to pause. This is the dialog's logic, kept apart from React.

export type Scope = 'service' | 'billing' | 'both';

export interface BillingState {
  /** False for a service billed once. */
  recurring: boolean;
  /** Future billing is stopped (paused). */
  stopped: boolean;
  nextBillingOn: string | null;
  stopsOn: string | null;
}

export interface ServiceBillingState {
  /** "Bookkeeping", "Payroll". */
  service: string;
  servicePaused: boolean;
  /** Null while the engagement loads, or when it could not be loaded. */
  billing: BillingState | null;
  /** Owner and Admin change billing (the API checks too). */
  canChangeBilling: boolean;
}

export type Step =
  | { kind: 'pause-service'; reason: string }
  | { kind: 'resume-service' }
  | { kind: 'stop-billing'; on: string }
  | { kind: 'resume-billing' };

export const dayText = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** Why billing cannot change here, or null when it can. */
export function billingBlocked(s: ServiceBillingState): string | null {
  if (!s.billing) return 'Billing could not be loaded. Try again in a moment.';
  if (!s.billing.recurring)
    return 'This service is billed once, so there is no future billing to pause or resume.';
  if (!s.canChangeBilling) return 'Only an Owner or Admin can pause or resume billing.';
  return null;
}

/** The service's and billing's current state, in words. */
export function stateText(s: ServiceBillingState): { service: string; billing: string } {
  const b = s.billing;
  return {
    service: s.servicePaused ? 'On hold' : 'Active',
    billing: !b
      ? 'Not available'
      : !b.recurring
        ? 'Billed once (no future billing)'
        : b.stopped
          ? b.stopsOn
            ? `Paused from ${dayText(b.stopsOn)}`
            : 'Paused'
          : b.nextBillingOn
            ? `Active · next billing date ${dayText(b.nextBillingOn)}`
            : 'Active',
  };
}

/**
 * What applying `scope` would do: the steps in order, a sentence for each, and the problem that
 * stops it (shown instead of applying). `stopsOn` is the chosen date billing pauses from.
 */
export function planOf(
  s: ServiceBillingState,
  scope: Scope,
  input: { reason: string; stopsOn: string; today: string; serviceNote?: string },
): { steps: Step[]; effects: string[]; problem: string | null } {
  const steps: Step[] = [];
  const effects: string[] = [];
  const both = scope === 'both';
  const touchService = scope !== 'billing';
  const touchBilling = scope !== 'service';
  if (touchBilling) {
    const blocked = billingBlocked(s);
    if (blocked) return { steps: [], effects: [], problem: blocked };
  }
  if (touchService) {
    const keep = both ? '' : ' Billing is not changed.';
    const note = input.serviceNote ? ` ${input.serviceNote}` : '';
    if (s.servicePaused) {
      steps.push({ kind: 'resume-service' });
      effects.push(
        `${s.service} resumes today (${dayText(input.today)}): its work and reminders start again.${note}${keep}`,
      );
    } else {
      const reason = input.reason.trim();
      if (!reason)
        return { steps: [], effects: [], problem: 'Enter the reason for pausing the service.' };
      steps.push({ kind: 'pause-service', reason });
      effects.push(
        `${s.service} goes on hold today (${dayText(input.today)}): its work and reminders stop.${note}${keep}`,
      );
    }
  }
  if (touchBilling) {
    const b = s.billing!;
    const keep = both ? '' : ' The service is not changed.';
    if (b.stopped) {
      steps.push({ kind: 'resume-billing' });
      effects.push(
        `Billing resumes today: invoices follow the schedule again${
          b.nextBillingOn ? ` (next billing date ${dayText(b.nextBillingOn)})` : ''
        }.${keep}`,
      );
    } else {
      if (!input.stopsOn)
        return { steps: [], effects: [], problem: 'Choose the date billing pauses from.' };
      if (input.stopsOn < input.today)
        return { steps: [], effects: [], problem: 'Billing cannot pause from a past date.' };
      steps.push({ kind: 'stop-billing', on: input.stopsOn });
      effects.push(
        `Billing pauses from ${dayText(input.stopsOn)}: no ${s.service.toLowerCase()} invoices after it. Invoices already made are not changed, and nothing is charged or refunded.${keep}`,
      );
    }
  }
  return { steps, effects, problem: null };
}
