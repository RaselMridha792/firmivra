import type { IntegrationProvider } from '@firmivra/types';

// I-UA05 (Integrations Review Two): how close a provider is to Connect, and who acts next, as the
// API derives them from what each adapter supports today (catalog.ts `readinessOf`). Without them
// (an older answer) the screens keep their "not available yet" wording.

type Readiness = Pick<IntegrationProvider, 'comingSoon' | 'readiness' | 'nextStep'>;

export const READINESS_LABELS: Record<NonNullable<IntegrationProvider['readiness']>, string> = {
  READY: 'Ready to connect',
  SUPPORTED_NOT_ENABLED: 'Supported, not turned on yet',
  SETUP_PENDING: 'Developer setup pending',
  UNAVAILABLE: 'Not offered yet',
};

const WHO: Record<NonNullable<IntegrationProvider['nextStep']>['who'], string> = {
  FIRMIVRA: 'Firmivra',
  FIRM: 'Your firm',
  PROVIDER: 'The provider',
};

/** The badge of a provider that cannot be connected yet. */
export function notYetLabel(p: Readiness): string {
  return p.readiness && p.readiness !== 'READY'
    ? READINESS_LABELS[p.readiness]
    : 'Not available yet';
}

/** Who acts next and what they do first, as one line; the old wording without it. */
export function nextStepLine(p: Readiness): string {
  return p.nextStep
    ? `Next: ${WHO[p.nextStep.who]}. ${p.nextStep.what}`
    : 'Not available to connect yet.';
}

/** The details' readiness rows: how close it is to Connect, and who acts next. */
export function ReadinessFacts({ provider }: { provider: Readiness }) {
  if (!provider.readiness || !provider.nextStep) return null;
  return (
    <dl data-testid="readiness-facts" className="grid gap-1 rounded-control bg-subtle p-3 text-sm">
      <div className="flex flex-wrap gap-1">
        <dt className="font-semibold text-heading">Readiness:</dt>
        <dd className="text-text">{READINESS_LABELS[provider.readiness]}</dd>
      </div>
      <div className="flex flex-wrap gap-1">
        <dt className="font-semibold text-heading">Who acts next:</dt>
        <dd className="text-text">
          {WHO[provider.nextStep.who]}. {provider.nextStep.what}
        </dd>
      </div>
    </dl>
  );
}
