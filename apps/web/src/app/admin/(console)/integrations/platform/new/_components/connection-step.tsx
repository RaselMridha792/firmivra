'use client';

import { Button, Callout } from '@firmivra/ui';
import {
  CheckCircle,
  Copy,
  Key,
  LockSimple,
  Plugs,
  PlugsConnected,
  WarningCircle,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApiMutation } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  AUTH_TYPE_LABELS,
  ENVIRONMENT_LABELS,
  type ConnectionTestResult,
  type ConnectionValue,
  type PlatformIntegration,
  type PlatformIntegrationDetail,
  type SetupStep,
} from '../../../../../../../mocks/admin-integrations';
import { EnvironmentBadge } from '../../../_components/integration-badges';
import { formatDate, formatDateTime } from '../../../_components/integration-format';
import { integrationErrorMessage } from '../../../_components/integration-states';
import { TestResult } from './test-result';
import {
  ErrorSummary,
  focusFirst,
  SecretField,
  TextField,
  UrlField,
  urlProblem,
  type FieldError,
} from './wizard-fields';
import {
  DraftGate,
  furthest,
  savedHref,
  stepHref,
  useAccess,
  useDraft,
  WizardFrame,
} from './wizard-frame';

/**
 * Step 2, Connection Details (no frame; docx §4 step 2 and Test Connection): the provider's own
 * fields (API key, secret, client id, account id, base URL...), the OAuth connection where the
 * provider uses one, the webhook address Firmivra receives on, and a connection test with its
 * result. Secrets are write-only: the box starts empty, the saved value shows only as a masked
 * hint, and an empty box keeps it. Values are checked against the environment's prefixes, so live
 * and test credentials never mix.
 */

const SUBTITLE =
  'Enter how Firmivra connects to this service. Secrets are write-only and shown masked after you save them.';
const fieldId = (key: string) => `wiz-field-${key}`;
type Values = Record<string, string>;

function valuesOf(draft: PlatformIntegration): Values {
  return Object.fromEntries(
    draft.connection.fields.map((field) => [field.key, field.secret ? '' : (field.display ?? '')]),
  );
}

/** The values to save: changed non-secret fields, and every secret typed. */
function pendingOf(draft: PlatformIntegration, values: Values) {
  const plain: Record<string, string> = {};
  const secrets: Record<string, string> = {};
  for (const field of draft.connection.fields) {
    const value = (values[field.key] ?? '').trim();
    if (field.secret) {
      if (value) secrets[field.key] = value;
    } else if (value !== (field.display ?? '')) plain[field.key] = value;
  }
  return { plain, secrets };
}

/**
 * The checks the API makes, field by field (mocks/admin-integrations.ts `putCredentials`).
 * `continue` also needs every required field set; a draft save or a test needs only what was
 * typed to be valid.
 */
function problemsOf(draft: PlatformIntegration, values: Values, all: boolean): FieldError[] {
  const list: FieldError[] = [];
  const environment = draft.environment;
  const other = environment === 'LIVE' ? 'TEST' : 'LIVE';
  for (const field of draft.connection.fields) {
    const id = fieldId(field.key);
    const label = field.label;
    const value = (values[field.key] ?? '').trim();
    if (!value) {
      const kept = field.secret && field.display !== null;
      const cleared = !field.secret && field.display !== null;
      if (field.required && !kept && (all || cleared))
        list.push({ id, message: `Enter the ${label.toLowerCase()}.` });
      continue;
    }
    if (value.length > (field.secret ? 500 : 200)) {
      list.push({ id, message: `${label} is too long.` });
      continue;
    }
    if (field.kind === 'url') {
      const problem = urlProblem(value, label.toLowerCase());
      if (problem) list.push({ id, message: problem });
      continue;
    }
    if (field.prefix) {
      const wanted = field.prefix[environment];
      const unwanted = field.prefix[other];
      if (wanted !== unwanted && value.startsWith(unwanted)) {
        list.push({
          id,
          message: `${label} is a ${environment === 'LIVE' ? 'test' : 'live'} value; this connection is ${ENVIRONMENT_LABELS[environment]}. Live and test credentials never mix.`,
        });
        continue;
      }
      if (!value.startsWith(wanted)) {
        list.push({ id, message: `${label} should start with ${wanted}.` });
        continue;
      }
    }
    if (field.secret && value.length < 8) list.push({ id, message: `${label} looks too short.` });
  }
  return list;
}

/** Saves the step: non-secret fields with the version read, then the secrets (write-only). */
async function saveConnection(
  draft: PlatformIntegration,
  values: Values,
  setupStep?: SetupStep,
): Promise<PlatformIntegrationDetail | PlatformIntegration> {
  const { plain, secrets } = pendingOf(draft, values);
  let saved: PlatformIntegrationDetail | PlatformIntegration = draft;
  const hasPlain = Object.keys(plain).length > 0;
  if (hasPlain || setupStep)
    saved = await adminIntegrations.updatePlatform(draft.id, {
      version: draft.version,
      ...(hasPlain ? { connection: plain } : {}),
      ...(setupStep ? { setupStep } : {}),
    });
  if (Object.keys(secrets).length)
    saved = await adminIntegrations.putCredentials(draft.id, { values: secrets });
  return saved;
}

function hintOf(field: ConnectionValue, draft: PlatformIntegration): string | undefined {
  const parts = [
    field.hint,
    field.prefix && field.kind !== 'url'
      ? `Starts with ${field.prefix[draft.environment]} (${ENVIRONMENT_LABELS[draft.environment]}).`
      : null,
    field.secret && field.display
      ? `Saved: ${field.display}${field.updatedAt ? `, ${formatDate(field.updatedAt)}` : ''}. Leave it empty to keep it.`
      : null,
  ].filter((part): part is string => !!part);
  return parts.length ? parts.join(' ') : undefined;
}

export function ConnectionStep({ draftId }: { draftId: string | null }) {
  const draft = useDraft(draftId);
  return (
    <DraftGate step="CONNECTION" draftId={draftId} query={draft} subtitle={SUBTITLE}>
      {(data) => <ConnectionForm key={data.id} draft={data} />}
    </DraftGate>
  );
}

function ConnectionForm({ draft }: { draft: PlatformIntegrationDetail }) {
  const router = useRouter();
  const access = useAccess();
  const [synced, setSynced] = useState(draft.version);
  const [values, setValues] = useState(() => valuesOf(draft));
  const [attempted, setAttempted] = useState<'all' | 'typed' | null>(null);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const [copied, setCopied] = useState(false);
  // A save bumps the version: the boxes show what is saved now (secrets empty again), and a test
  // result from before no longer applies.
  if (draft.version !== synced) {
    setSynced(draft.version);
    setValues(valuesOf(draft));
    setResult(null);
  }

  const { plain, secrets } = pendingOf(draft, values);
  const dirty = Object.keys(plain).length + Object.keys(secrets).length > 0;
  const canSecrets = access.data?.canManageSecrets ?? false;

  const save = useApiMutation(
    (setupStep: SetupStep | null) => saveConnection(draft, values, setupStep ?? undefined),
    { invalidate: ['admin-integrations'] },
  );
  const test = useApiMutation(
    async (kind: 'test' | 'connect') => {
      if (dirty) await saveConnection(draft, values);
      return kind === 'connect'
        ? adminIntegrations.reconnectPlatform(draft.id)
        : adminIntegrations.testPlatform(draft.id);
    },
    { invalidate: ['admin-integrations'] },
  );

  const problems = attempted ? problemsOf(draft, values, attempted === 'all') : [];
  const errorFor = (id: string) => problems.find((problem) => problem.id === id)?.message;
  const busy = save.isPending || test.isPending;

  /** Checks the step; `all` also needs every required field. */
  function checked(all: boolean) {
    setAttempted(all ? 'all' : 'typed');
    const found = problemsOf(draft, values, all);
    focusFirst(found);
    return found.length === 0;
  }
  function submit(mode: 'continue' | 'draft') {
    if (!checked(mode === 'continue')) return;
    save.mutate(mode === 'continue' ? furthest(draft.setupStep, 'SETTINGS') : null, {
      onSuccess: () =>
        router.push(
          mode === 'continue' ? stepHref(draft.id, 'SETTINGS') : savedHref(draft.id, 'draft'),
        ),
    });
  }
  function runTest(kind: 'test' | 'connect') {
    if (!checked(false)) return;
    test.mutate(kind, { onSuccess: (outcome) => setResult(outcome) });
  }
  async function copyWebhook(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const failed = save.isError ? save.error : test.isError ? test.error : null;
  const oauth = draft.connection.oauth;

  return (
    <WizardFrame
      step="CONNECTION"
      draft={draft}
      subtitle={SUBTITLE}
      dirty={dirty}
      busy={busy}
      onContinue={() => submit('continue')}
      onSaveDraft={() => submit('draft')}
      alert={
        failed ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(failed)}
          </p>
        ) : null
      }
    >
      <ErrorSummary errors={problems} />

      <dl className="grid gap-4 rounded-lg border border-border bg-subtle p-4 text-sm sm:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-muted">Authentication</dt>
          <dd className="flex items-center gap-2 font-semibold text-heading">
            <Key aria-hidden weight="fill" className="size-4 shrink-0 text-muted" />
            {AUTH_TYPE_LABELS[draft.connection.authType]}
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-muted">Environment</dt>
          <dd>
            <EnvironmentBadge environment={draft.environment} />
          </dd>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <dt className="text-muted">Credentials</dt>
          <dd className="flex items-center gap-2 font-semibold text-heading">
            {draft.connection.complete ? (
              <CheckCircle aria-hidden weight="fill" className="size-4 shrink-0 text-success" />
            ) : (
              <WarningCircle aria-hidden weight="fill" className="size-4 shrink-0 text-warning" />
            )}
            {draft.connection.complete ? 'Complete' : 'Incomplete'}
          </dd>
        </div>
      </dl>

      {!canSecrets && access.isSuccess ? (
        <Callout size="compact" surface="warning" icon={LockSimple} tone="amber">
          <span>Only a Super Admin can enter or change credentials.</span>
        </Callout>
      ) : null}

      <section aria-labelledby="wiz-fields-title" className="flex flex-col gap-4">
        <h3 id="wiz-fields-title" className="text-lg font-bold text-heading">
          {draft.name} credentials
        </h3>
        <div className="grid gap-5 sm:grid-cols-2">
          {draft.connection.fields.map((field) => {
            const common = {
              id: fieldId(field.key),
              label: field.label,
              required: field.required,
              hint: hintOf(field, draft),
              error: errorFor(fieldId(field.key)),
              value: values[field.key] ?? '',
              maxLength: field.secret ? 500 : 200,
              onChange: (event: { target: { value: string } }) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value })),
            };
            const placeholder = field.prefix
              ? `${field.prefix[draft.environment]}…`
              : field.placeholder;
            if (field.secret)
              return (
                <SecretField
                  key={field.key}
                  {...common}
                  disabled={!canSecrets}
                  placeholder={field.display ? 'Enter a new value to replace it' : placeholder}
                />
              );
            if (field.kind === 'url')
              return <UrlField key={field.key} {...common} placeholder={field.placeholder} />;
            return (
              <TextField
                key={field.key}
                {...common}
                autoComplete="off"
                spellCheck={false}
                placeholder={placeholder}
              />
            );
          })}
        </div>
      </section>

      {oauth ? (
        <section
          aria-labelledby="wiz-oauth-title"
          data-testid="wizard-oauth"
          className="flex flex-col gap-3 rounded-lg border border-border p-4"
        >
          <h3 id="wiz-oauth-title" className="text-base font-bold text-heading">
            OAuth connection
          </h3>
          <p className="text-sm text-text">
            {oauth.connected
              ? `Connected${oauth.account ? ` as ${oauth.account}` : ''}${oauth.connectedAt ? ` on ${formatDateTime(oauth.connectedAt)}` : ''}.`
              : `Sign in to ${draft.name} to let Firmivra act for the platform account. Nothing is connected yet.`}
          </p>
          <Button
            variant="secondary"
            className="w-fit"
            disabled={busy || !canSecrets}
            onClick={() => runTest('connect')}
          >
            <PlugsConnected aria-hidden weight="fill" className="size-4" />
            {oauth.connected ? 'Reconnect' : `Connect ${draft.name}`}
          </Button>
        </section>
      ) : null}

      {draft.connection.webhookUrl ? (
        <section aria-labelledby="wiz-webhook-title" className="flex flex-col gap-2">
          <h3 id="wiz-webhook-title" className="text-base font-bold text-heading">
            Webhook URL
          </h3>
          <p className="text-sm text-muted">
            Give this address to {draft.name}: Firmivra receives its webhooks here (
            {ENVIRONMENT_LABELS[draft.environment]}).
          </p>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 rounded-control border border-border bg-subtle px-3 py-2 text-sm wrap-anywhere text-heading">
              {draft.connection.webhookUrl}
            </code>
            <Button
              variant="secondary"
              onClick={() => void copyWebhook(draft.connection.webhookUrl ?? '')}
            >
              <Copy aria-hidden weight="fill" className="size-4" />
              {copied ? 'Copied' : 'Copy'}
              <span className="sr-only"> webhook URL</span>
            </Button>
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="wiz-test-title"
        className="flex flex-col gap-3 border-t border-divider pt-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h3 id="wiz-test-title" className="text-lg font-bold text-heading">
              Test Connection
            </h3>
            <p className="text-sm text-muted">
              A safe check with the provider. Nothing is charged or sent.
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={busy || !draft.supportsTest}
            onClick={() => runTest('test')}
          >
            <Plugs aria-hidden weight="fill" className="size-4" />
            {test.isPending ? 'Testing…' : dirty ? 'Save & Test Connection' : 'Test Connection'}
          </Button>
        </div>
        <TestResult
          integration={draft}
          result={result}
          retrying={test.isPending}
          onRetry={() => runTest('test')}
        />
      </section>
    </WizardFrame>
  );
}
