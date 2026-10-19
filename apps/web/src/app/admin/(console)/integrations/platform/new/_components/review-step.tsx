'use client';

import { Button, Callout } from '@firmivra/ui';
import {
  CheckCircle,
  Info,
  LockSimple,
  PencilSimple,
  Plugs,
  Power,
  WarningCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { useApiMutation } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  AUTH_TYPE_LABELS,
  CATEGORY_LABELS,
  DATA_ACCESS_LABELS,
  FIRM_EXPOSURE_LABELS,
  SYNC_SCHEDULE_LABELS,
  type ConnectionTestResult,
  type PlatformIntegrationDetail,
  type SetupStep,
} from '../../../_components/integrations-contract';
import { EnvironmentBadge } from '../../../_components/integration-badges';
import { formatBytes, formatDate } from '../../../_components/integration-format';
import { integrationErrorMessage } from '../../../_components/integration-states';
import { ActivateDialog } from './activate-dialog';
import { BACKOFF_LABELS } from './settings-step';
import { TestResult } from './test-result';
import {
  DraftGate,
  savedHref,
  stepHref,
  templateOf,
  useAccess,
  useDraft,
  useProviders,
  WIZARD_STEPS,
  WizardFrame,
} from './wizard-frame';

/**
 * Step 4, Review & Save (no frame; docx §4 step 4): a redacted summary of every step with its Edit
 * link, what activation still needs, a connection test, and the two endings: Save as Draft, or
 * Activate (which asks for a passing test, or a confirmation when the provider has none).
 */

const SUBTITLE =
  'Check every detail, then activate the integration or save it as a draft. Secrets stay masked.';

export function ReviewStep({ draftId }: { draftId: string | null }) {
  const draft = useDraft(draftId);
  return (
    <DraftGate
      step="REVIEW"
      draftId={draftId}
      query={draft}
      subtitle={SUBTITLE}
      continueLabel="Activate Integration"
      continueIcon={Power}
      saveDraftLabel="Save as Draft"
    >
      {(data) => <Review key={data.id} draft={data} />}
    </DraftGate>
  );
}

/** One step's summary, with its Edit link. */
function Summary({
  step,
  draftId,
  children,
  after,
}: {
  step: SetupStep;
  draftId: string;
  children: ReactNode;
  /** Below the summary (the connection test). */
  after?: ReactNode;
}) {
  const meta = WIZARD_STEPS.find((item) => item.id === step);
  const title = meta?.title ?? step;
  return (
    <section
      aria-label={title}
      data-testid={`review-${step.toLowerCase()}`}
      className="rounded-lg border border-border"
    >
      <header className="flex items-center justify-between gap-3 rounded-t-lg border-b border-border bg-table-head px-4 py-3">
        <h3 className="text-base font-bold text-heading">{title}</h3>
        <Link
          href={stepHref(draftId, step)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-link hover:underline"
        >
          <PencilSimple aria-hidden weight="fill" className="size-4" />
          Edit<span className="sr-only"> {title}</span>
        </Link>
      </header>
      <dl className="grid gap-x-6 gap-y-4 p-4 sm:grid-cols-2">{children}</dl>
      {after ? <div className="border-t border-divider p-4">{after}</div> : null}
    </section>
  );
}

function Row({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col gap-0.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm wrap-anywhere text-heading">{children}</dd>
    </div>
  );
}
const none = <span className="text-muted">None</span>;

function Review({ draft }: { draft: PlatformIntegrationDetail }) {
  const router = useRouter();
  const providers = useProviders();
  const access = useAccess();
  const [activating, setActivating] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const template = templateOf(providers.data, draft.provider);

  const save = useApiMutation(
    () =>
      adminIntegrations.updatePlatform(draft.id, { version: draft.version, setupStep: 'REVIEW' }),
    { invalidate: ['admin-integrations'] },
  );
  const test = useApiMutation(() => adminIntegrations.testPlatform(draft.id), {
    invalidate: ['admin-integrations'],
  });

  const { connection, settings } = draft;
  const missing = connection.fields.filter((field) => field.required && field.display === null);
  const oauthMissing = !!connection.oauth && !connection.oauth.connected;
  const canActivate = access.data?.canLifecycle ?? false;
  const featureLabel = (key: string) =>
    template?.features.find((feature) => feature.key === key)?.label ?? key;
  const runTest = () => test.mutate(undefined, { onSuccess: (outcome) => setResult(outcome) });

  const readiness = !connection.complete ? (
    <Callout
      surface="warning"
      icon={WarningCircle}
      tone="amber"
      title="Connection details are incomplete"
      action={
        <Link
          href={stepHref(draft.id, 'CONNECTION')}
          className="text-sm font-semibold text-link hover:underline"
        >
          Edit Connection Details
        </Link>
      }
    >
      {[
        missing.length
          ? `Enter the ${missing.map((field) => field.label.toLowerCase()).join(', ')}.`
          : null,
        oauthMissing ? `Connect the ${draft.name} account.` : null,
        'Activation needs every required connection detail.',
      ]
        .filter(Boolean)
        .join(' ')}
    </Callout>
  ) : !draft.supportsTest ? (
    <Callout surface="info" icon={Info} title="No test endpoint">
      {draft.name} can&apos;t be tested by Firmivra. Activating it asks you to confirm that you
      checked the connection yourself.
    </Callout>
  ) : (result ? result.ok : draft.lastCheckOk === true) ? (
    <Callout surface="success" icon={CheckCircle} tone="green" title="Ready to activate">
      The connection test passed. Activate it to start using {draft.name}.
    </Callout>
  ) : (
    <Callout surface="info" icon={Info} title="Test before activating">
      Activation needs a passing connection test. Test it below, or Activate runs it first.
    </Callout>
  );

  return (
    <WizardFrame
      step="REVIEW"
      draft={draft}
      subtitle={SUBTITLE}
      busy={save.isPending}
      continueLabel="Activate Integration"
      continueIcon={Power}
      canContinue={connection.complete && canActivate}
      onContinue={() => setActivating(true)}
      saveDraftLabel="Save as Draft"
      onSaveDraft={() =>
        save.mutate(undefined, { onSuccess: () => router.push(savedHref(draft.id, 'draft')) })
      }
      alert={
        save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(save.error)}
          </p>
        ) : null
      }
      dialog={
        activating ? (
          <ActivateDialog
            integration={draft}
            onClose={() => setActivating(false)}
            onActivated={() => router.push(savedHref(draft.id, 'activated'))}
          />
        ) : null
      }
    >
      <div data-testid="review-readiness" className="flex flex-col gap-3">
        {readiness}
        {access.isSuccess && !canActivate ? (
          <Callout size="compact" surface="warning" icon={LockSimple} tone="amber">
            <span>Only a Super Admin can activate an integration. You can save it as a draft.</span>
          </Callout>
        ) : null}
      </div>

      <Summary step="SERVICE" draftId={draft.id}>
        <Row label="Integration Name">{draft.name}</Row>
        <Row label="Provider">
          {template && template.key !== 'custom' ? template.name : 'Custom service'}
        </Row>
        <Row label="Category">{CATEGORY_LABELS[draft.category]}</Row>
        <Row label="Environment">
          <EnvironmentBadge environment={draft.environment} />
        </Row>
        <Row label="Short Description" wide>
          {draft.description}
        </Row>
        <Row label="Detailed Description" wide>
          {draft.longDescription ?? none}
        </Row>
        <Row label="Logo">
          {draft.logo ? `${draft.logo.fileName} (${formatBytes(draft.logo.sizeBytes)})` : none}
        </Row>
        <Row label="Provider Website">{draft.websiteUrl ?? none}</Row>
        <Row label="Documentation URL">{draft.docsUrl ?? none}</Row>
      </Summary>

      <Summary
        step="CONNECTION"
        draftId={draft.id}
        after={
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-heading">Connection Test</h4>
              {draft.supportsTest ? (
                <Button variant="secondary" disabled={test.isPending} onClick={runTest}>
                  <Plugs aria-hidden weight="fill" className="size-4" />
                  {test.isPending ? 'Testing…' : 'Test Connection'}
                </Button>
              ) : null}
            </div>
            <TestResult
              integration={draft}
              result={result}
              retrying={test.isPending}
              onRetry={runTest}
            />
            {test.isError ? (
              <p role="alert" className="text-sm text-danger">
                {integrationErrorMessage(test.error)}
              </p>
            ) : null}
          </div>
        }
      >
        <Row label="Authentication">{AUTH_TYPE_LABELS[connection.authType]}</Row>
        {connection.fields.map((field) => (
          <Row key={field.key} label={field.label}>
            {field.display ? (
              <span className={field.secret ? 'font-mono' : undefined}>
                {field.display}
                {field.secret && field.updatedAt ? (
                  <span className="font-sans text-xs text-muted">
                    {' '}
                    · saved {formatDate(field.updatedAt)}
                  </span>
                ) : null}
              </span>
            ) : field.required ? (
              <span className="text-danger">Required: not set</span>
            ) : (
              <span className="text-muted">Not set</span>
            )}
          </Row>
        ))}
        {connection.oauth ? (
          <Row label="OAuth Connection">
            {connection.oauth.connected ? (
              `Connected${connection.oauth.account ? ` as ${connection.oauth.account}` : ''}`
            ) : (
              <span className="text-danger">Not connected</span>
            )}
          </Row>
        ) : null}
        {connection.webhookUrl ? (
          <Row label="Webhook URL" wide>
            {connection.webhookUrl}
          </Row>
        ) : null}
      </Summary>

      <Summary step="SETTINGS" draftId={draft.id}>
        <Row label="Permissions" wide>
          {settings.scopes.length ? (
            <span className="font-mono">{settings.scopes.join(', ')}</span>
          ) : (
            none
          )}
        </Row>
        <Row label="Sync Schedule">{SYNC_SCHEDULE_LABELS[settings.syncSchedule]}</Row>
        <Row label="Data Access">{DATA_ACCESS_LABELS[settings.dataAccess]}</Row>
        <Row label="Enabled Features">
          {settings.features.length ? settings.features.map(featureLabel).join(', ') : none}
        </Row>
        <Row label="Retry Behavior">
          {settings.retry.maxRetries} {settings.retry.maxRetries === 1 ? 'retry' : 'retries'},{' '}
          {BACKOFF_LABELS[settings.retry.backoff].toLowerCase()}
        </Row>
        <Row label="Firm Exposure" wide>
          {FIRM_EXPOSURE_LABELS[settings.firmExposure]}
        </Row>
      </Summary>
    </WizardFrame>
  );
}
