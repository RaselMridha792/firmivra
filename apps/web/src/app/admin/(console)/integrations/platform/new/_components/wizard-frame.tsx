'use client';

import { Button, Callout, Card, Modal, Stepper } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FloppyDisk,
  Info,
  Lightbulb,
  type Icon,
} from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useApiQuery } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  CATEGORIES,
  CATEGORY_LABELS,
  SETUP_STEPS,
  type PlatformIntegration,
  type PlatformIntegrationDetail,
  type ProviderTemplate,
  type SetupStep,
} from '../../../_components/integrations-contract';
import {
  CATEGORY_ICONS,
  CategoryPill,
  EnvironmentBadge,
  IntegrationStatusBadge,
  ServiceLogo,
} from '../../../_components/integration-badges';
import { formatDateTime } from '../../../_components/integration-format';
import { loadError, QuietLine, SkeletonLines } from '../../../_components/integration-states';
import {
  IntegrationsHeader,
  LinkButton,
  platformHref,
  setupHref,
} from '../../../_components/integrations-shell';

/**
 * The Add Platform Integration wizard's frame (firmivra-integration-setup-dashboard.jpg; docx §4):
 * breadcrumbs, title and "Back to Integrations"; the four-step rail on the left (a numbered bar on
 * a phone); the step's card with its buttons (Back, Save Draft, Continue; Cancel under the rail as
 * the design shows it); and the side cards (About, the categories or this draft, Tip). One route
 * per step; the draft is created on step 1 and carried by `?draft=<id>`. Leaving with unsaved
 * changes asks first (docx §4 Cancel).
 */

export const WIZARD_STEPS = [
  {
    id: 'SERVICE',
    title: 'General Information',
    hint: 'Basic details about the integration',
  },
  {
    id: 'CONNECTION',
    title: 'Connection Details',
    hint: 'API keys, credentials and endpoints',
  },
  {
    id: 'SETTINGS',
    title: 'Settings & Access',
    hint: 'Environment, configuration and permissions',
  },
  { id: 'REVIEW', title: 'Review & Save', hint: 'Confirm details and activate' },
] as const satisfies readonly { id: SetupStep; title: string; hint: string }[];

export const stepIndex = (step: SetupStep) => SETUP_STEPS.indexOf(step);
/** The later of two steps: a draft remembers the furthest step it reached. */
export const furthest = (a: SetupStep, b: SetupStep): SetupStep =>
  stepIndex(a) >= stepIndex(b) ? a : b;
/** A step's route, with the draft in `?draft=` (step 1 without a draft starts a new one). */
export const stepHref = (draftId: string | null, step: SetupStep) =>
  draftId ? setupHref({ id: draftId, setupStep: step }) : '/integrations/platform/new';
/** The platform list, told what the wizard saved (it shows a notice). */
export const savedHref = (id: string, outcome: 'draft' | 'activated') =>
  `/integrations/platform?saved=${encodeURIComponent(id)}&outcome=${outcome}`;
export const CANCEL_HREF = '/integrations';

/** The draft a step works on (the same cache entry the manage page and the dialogs use). */
export function useDraft(draftId: string | null) {
  return useApiQuery(['admin-integrations', 'platform', draftId ?? 'none'], () =>
    draftId ? adminIntegrations.getPlatform(draftId) : Promise.resolve(null),
  );
}
export function useProviders() {
  return useApiQuery(['admin-integrations', 'providers'], () => adminIntegrations.providers());
}
export function useAccess() {
  return useApiQuery(['admin-integrations', 'access'], () => adminIntegrations.access());
}
/** A provider's template: its own, or the generic one for a custom service. */
export function templateOf(
  templates: ProviderTemplate[] | undefined,
  provider: string,
): ProviderTemplate | null {
  if (!templates) return null;
  return (
    templates.find((item) => item.key === provider) ??
    templates.find((item) => item.key === 'custom') ??
    null
  );
}

/**
 * Asks before leaving with unsaved changes: in-app links (the sidebar, breadcrumbs, the rail)
 * and Back or Cancel open a dialog; closing or reloading the tab asks through the browser.
 */
function useLeaveGuard(dirty: boolean) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const leavingRef = useRef(false);

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!leavingRef.current) event.preventDefault();
    };
    const click = (event: MouseEvent) => {
      if (leavingRef.current || event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null;
      if (!(link instanceof HTMLAnchorElement) || link.target === '_blank' || link.download) return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search)
        return;
      event.preventDefault();
      event.stopPropagation();
      setPending(`${url.pathname}${url.search}`);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', click, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', click, true);
    };
  }, [dirty]);

  const go = (href: string) => {
    leavingRef.current = true;
    setPending(null);
    router.push(href);
  };
  const leave = (href: string) => (dirty ? setPending(href) : go(href));
  const dialog = pending ? (
    <Modal
      open
      title="Leave without saving?"
      onClose={() => setPending(null)}
      footer={
        <>
          <Button variant="secondary" onClick={() => setPending(null)}>
            Keep Editing
          </Button>
          <Button onClick={() => go(pending)}>Leave Without Saving</Button>
        </>
      }
    >
      <p className="max-w-lg text-sm text-text">
        What you changed on this step is not saved yet. Anything saved on earlier steps stays in the
        draft. Use Save Draft to keep this step&apos;s changes.
      </p>
    </Modal>
  ) : null;
  return { leave, dialog };
}

/** The design's vertical step list: the current step tinted, finished steps checked. */
function WizardRail({ step, draft }: { step: SetupStep; draft: PlatformIntegration | null }) {
  const current = stepIndex(step);
  const reached = Math.max(current, draft ? stepIndex(draft.setupStep) : 0);
  return (
    <nav aria-label="Setup steps">
      <ol className="flex flex-col gap-2">
        {WIZARD_STEPS.map((item, index) => {
          const on = index === current;
          const done = index < current;
          const body = (
            <>
              <span
                aria-hidden
                className={`relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full text-base font-semibold ${
                  on || done
                    ? 'bg-action text-on-action'
                    : 'border-2 border-border bg-surface text-heading'
                }`}
              >
                {done ? <Check weight="bold" className="size-4" /> : index + 1}
              </span>
              <span className="flex min-w-0 flex-col pt-1">
                <span className={`text-sm font-semibold ${on ? 'text-action' : 'text-heading'}`}>
                  {item.title}
                  {done ? <span className="sr-only">, completed</span> : null}
                </span>
                <span className="text-xs text-text">{item.hint}</span>
              </span>
            </>
          );
          const look = `flex gap-3 rounded-lg border px-4 py-3 ${
            on ? 'border-folder-border bg-info-soft' : 'border-transparent'
          }`;
          return (
            <li key={item.id} className="relative">
              {index < WIZARD_STEPS.length - 1 ? (
                <span
                  aria-hidden
                  className={`absolute top-12 -bottom-5 left-8.5 w-0.5 ${done ? 'bg-action' : 'bg-border'}`}
                />
              ) : null}
              {draft && !on && index <= reached ? (
                <Link
                  href={stepHref(draft.id, item.id)}
                  className={`${look} hover:bg-canvas focus-visible:outline-2 focus-visible:outline-focus`}
                >
                  {body}
                </Link>
              ) : (
                <div aria-current={on ? 'step' : undefined} className={look}>
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const ABOUT: Record<SetupStep, { title: string; text: string; tip: string }> = {
  SERVICE: {
    title: 'About Platform Integrations',
    text: 'Platform integrations are third-party services used by Firmivra to provide core functionality across the entire system. Examples include payment processors, email providers, SMS services, storage, AI tools, and data providers.',
    tip: 'Have your API credentials, documentation, and access details ready before continuing to the next step.',
  },
  CONNECTION: {
    title: 'About Credentials',
    text: 'Secrets are encrypted and write-only. After you save them, Firmivra shows only a masked hint, never the full value. Live and test credentials never mix.',
    tip: 'Test the connection before you continue, so activating it on the last step takes one click.',
  },
  SETTINGS: {
    title: 'About Settings & Access',
    text: 'Start with least privilege: only the scopes and features Firmivra needs. What firms can see and connect is managed separately, in the Customer Integration Catalog.',
    tip: "You can change these settings later on the integration's page. Every change is added to the audit log.",
  },
  REVIEW: {
    title: 'About Activation',
    text: 'Activation needs a passing connection test, or your confirmation when the provider has no test endpoint. Until then the integration stays a draft and nothing runs.',
    tip: 'Not ready yet? Save it as a draft and continue from Platform Integrations at any time.',
  },
};

/** "Common Integration Categories" (step 1): every category with its mark. */
function CategoriesCard() {
  return (
    <Card data-testid="wizard-categories" className="min-w-0">
      <h2 className="mb-4 text-lg font-bold text-heading">Common Integration Categories</h2>
      <ul className="flex flex-col gap-3">
        {CATEGORIES.map((category) => {
          const Glyph = CATEGORY_ICONS[category];
          return (
            <li key={category} className="flex items-center gap-3 text-sm text-heading">
              <Glyph aria-hidden weight="fill" className="size-5 shrink-0 text-heading" />
              {CATEGORY_LABELS[category]}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

/** "This Integration" (steps 2 to 4): the draft being set up, in each state. */
function DraftCard({ draft, state }: { draft: PlatformIntegration | null; state: DraftState }) {
  return (
    <Card data-testid="wizard-draft" className="min-w-0">
      <h2 className="mb-4 text-lg font-bold text-heading">This Integration</h2>
      {draft ? (
        <div className="flex flex-col gap-3">
          <span className="flex items-center gap-3">
            <ServiceLogo category={draft.category} />
            <span className="min-w-0">
              <span className="block font-semibold text-heading wrap-break-word">{draft.name}</span>
              <span className="block text-xs text-muted">{draft.reference}</span>
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <CategoryPill category={draft.category} />
            <EnvironmentBadge environment={draft.environment} />
            <IntegrationStatusBadge status={draft.status} />
          </span>
          <p className="text-xs text-muted">
            Last saved <time dateTime={draft.updatedAt}>{formatDateTime(draft.updatedAt)}</time>
            {draft.updatedBy ? ` by ${draft.updatedBy}` : ''}
          </p>
        </div>
      ) : state === 'loading' ? (
        <SkeletonLines rows={3} label="Loading the draft" />
      ) : state === 'error' ? (
        <QuietLine>Could not load this right now. Try again in a moment.</QuietLine>
      ) : (
        <QuietLine>Nothing saved yet. The draft is created on General Information.</QuietLine>
      )}
    </Card>
  );
}

type DraftState = 'ready' | 'loading' | 'error' | 'none';

export interface WizardFrameProps {
  step: SetupStep;
  /** The draft being set up: null for a new one, or while it loads. */
  draft: PlatformIntegration | null;
  /** How the side card shows a missing draft. */
  draftState?: DraftState;
  /** The line under the step's title. */
  subtitle: string;
  children: ReactNode;
  /** Unsaved changes on this step: leaving asks first. */
  dirty?: boolean;
  /** False while the step's data loads or could not load: its buttons stay, disabled. */
  ready?: boolean;
  /** A save is running. */
  busy?: boolean;
  onContinue?: () => void;
  continueLabel?: string;
  continueIcon?: Icon;
  /** False keeps Continue disabled (activation without a complete connection). */
  canContinue?: boolean;
  onSaveDraft?: () => void;
  saveDraftLabel?: string;
  /** The last save's error, above the buttons. */
  alert?: ReactNode;
  /** A dialog the step opens (environment change, activation). */
  dialog?: ReactNode;
}

export function WizardFrame({
  step,
  draft,
  draftState = draft ? 'ready' : 'none',
  subtitle,
  children,
  dirty = false,
  ready = true,
  busy = false,
  onContinue,
  continueLabel = 'Continue',
  continueIcon: ContinueGlyph = ArrowRight,
  canContinue = true,
  onSaveDraft,
  saveDraftLabel = 'Save Draft',
  alert,
  dialog,
}: WizardFrameProps) {
  const guard = useLeaveGuard(dirty);
  const index = stepIndex(step);
  const meta = WIZARD_STEPS[index] ?? WIZARD_STEPS[0];
  const previous = index > 0 ? SETUP_STEPS[index - 1] : undefined;
  const about = ABOUT[step];
  const cancel = () => guard.leave(CANCEL_HREF);
  const blocked = !ready || busy;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <IntegrationsHeader
        title="Add Platform Integration"
        subtitle="Connect a new third-party service to power the Firmivra platform. Fill in the details below and configure the settings."
        crumbs={[
          { label: 'Integrations', href: '/integrations' },
          { label: 'Add Platform Integration' },
        ]}
        actions={
          <LinkButton href={CANCEL_HREF}>
            <ArrowLeft aria-hidden weight="bold" className="size-5" />
            Back to Integrations
          </LinkButton>
        }
      />

      <div className="lg:hidden" data-testid="wizard-progress">
        <Stepper
          variant="wizard"
          label="Setup steps"
          current={step}
          steps={WIZARD_STEPS.map((item) => ({ id: item.id, label: item.title }))}
        />
      </div>

      <div className="flex min-w-0 flex-col gap-4 lg:flex-row">
        <div className="hidden lg:flex lg:w-60 lg:shrink-0 lg:flex-col lg:justify-between lg:gap-6">
          <WizardRail step={step} draft={draft} />
          <div className="hidden min-[1440px]:block">
            <Button variant="secondary" onClick={cancel} className="px-7">
              Cancel
            </Button>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-4 min-[1440px]:flex-row">
          <Card data-testid="wizard-step" className="flex min-w-0 flex-1 flex-col">
            <form
              noValidate
              aria-labelledby="wizard-step-title"
              className="flex min-w-0 flex-1 flex-col gap-6"
              onSubmit={(event) => {
                event.preventDefault();
                if (!blocked && canContinue) onContinue?.();
              }}
            >
              <header>
                <h2 id="wizard-step-title" className="text-2xl font-bold text-heading">
                  {index + 1}. {meta.title}
                </h2>
                <p className="mt-1 text-base text-text">{subtitle}</p>
              </header>

              {children}

              {alert}

              <footer className="mt-auto flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="flex flex-wrap gap-3">
                  <Button variant="secondary" onClick={cancel} className="min-[1440px]:hidden">
                    Cancel
                  </Button>
                  {previous ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => guard.leave(stepHref(draft?.id ?? null, previous))}
                    >
                      <ArrowLeft aria-hidden weight="bold" className="size-4" />
                      Back
                    </Button>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-3">
                  {onSaveDraft ? (
                    <Button variant="secondary" disabled={blocked} onClick={onSaveDraft}>
                      <FloppyDisk aria-hidden weight="fill" className="size-4" />
                      {saveDraftLabel}
                    </Button>
                  ) : null}
                  <Button type="submit" disabled={blocked || !canContinue} className="px-7">
                    {busy ? 'Saving…' : continueLabel}
                    <ContinueGlyph aria-hidden weight="bold" className="size-4" />
                  </Button>
                </div>
              </footer>
            </form>
          </Card>

          <aside
            aria-label="About this step"
            className="grid min-w-0 content-start gap-4 xl:grid-cols-3 min-[1440px]:w-76 min-[1440px]:shrink-0 min-[1440px]:grid-cols-1"
          >
            <Callout icon={Info} surface="info" title={about.title}>
              {about.text}
            </Callout>
            {step === 'SERVICE' ? (
              <CategoriesCard />
            ) : (
              <DraftCard draft={draft} state={draftState} />
            )}
            <Callout icon={Lightbulb} surface="success" tone="green" title="Tip">
              {about.tip}
            </Callout>
          </aside>
        </div>
      </div>

      {guard.dialog}
      {dialog}
    </div>
  );
}

/**
 * Steps 2 to 4 need a saved draft. Until it is there, the step keeps its whole frame with a quiet
 * line in its card and its buttons disabled: no `?draft=`, loading, not found or unreachable, or
 * an integration that is no longer a draft (it is managed on its own page).
 */
export function DraftGate({
  step,
  draftId,
  query,
  subtitle,
  continueLabel,
  continueIcon,
  saveDraftLabel,
  children,
}: {
  step: SetupStep;
  draftId: string | null;
  query: UseQueryResult<PlatformIntegrationDetail | null>;
  subtitle: string;
  continueLabel?: string;
  continueIcon?: Icon;
  saveDraftLabel?: string;
  children: (draft: PlatformIntegrationDetail) => ReactNode;
}) {
  const data = query.data;
  if (draftId && data && data.status === 'DRAFT') return <>{children(data)}</>;

  const frame = (content: ReactNode, state: DraftState, shown: PlatformIntegration | null) => (
    <WizardFrame
      step={step}
      draft={shown}
      draftState={state}
      subtitle={subtitle}
      ready={false}
      continueLabel={continueLabel}
      continueIcon={continueIcon}
      onSaveDraft={() => undefined}
      saveDraftLabel={saveDraftLabel}
    >
      {content}
    </WizardFrame>
  );

  if (!draftId)
    return frame(
      <div className="flex flex-col items-start gap-1" data-testid="wizard-no-draft">
        <QuietLine>
          There is no draft to continue. A platform integration starts with its general information,
          which saves the draft.
        </QuietLine>
        <LinkButton href={stepHref(null, 'SERVICE')} variant="primary">
          Start with General Information
        </LinkButton>
      </div>,
      'none',
      null,
    );
  if (query.isPending)
    return frame(<SkeletonLines rows={6} label="Loading the draft" />, 'loading', null);
  if (query.isError) return frame(<QuietLine>{loadError(query.error)}</QuietLine>, 'error', null);
  if (!data) return frame(<QuietLine>{loadError(null)}</QuietLine>, 'error', null);
  return frame(<NotADraft integration={data} />, 'ready', data);
}

/** `?draft=` names an integration that was activated or removed since. */
export function NotADraft({ integration }: { integration: PlatformIntegration }) {
  const removed = integration.status === 'REMOVED';
  return (
    <div className="flex flex-col items-start gap-1" data-testid="wizard-not-draft">
      <QuietLine>
        {removed
          ? `${integration.name} was removed, so its setup cannot continue.`
          : `${integration.name} is already set up. Manage it from its own page.`}
      </QuietLine>
      {removed ? (
        <LinkButton href="/integrations/platform">Open Platform Integrations</LinkButton>
      ) : (
        <LinkButton href={platformHref(integration.id)} variant="primary">
          Open {integration.name}
        </LinkButton>
      )}
    </div>
  );
}
