'use client';

import {
  ConnectIntegrationRequest,
  IntegrationProviderKey,
  type IntegrationProviderDetail,
  type IntegrationSettings,
} from '@firmivra/types';
import { Badge, Button, Callout, Card, Checkbox, Input, PageHeader, Select } from '@firmivra/ui';
import {
  ArrowRight,
  ArrowSquareOut,
  CheckCircle,
  EnvelopeSimple,
  CalendarBlank,
  Users,
  Cloud,
  LockKey,
  Plugs,
  ShieldCheck,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { PageState } from '../../../../../../../components/page-state';
import { useFirm } from '../../../../../../../components/firm-context';
import { useMe } from '../../../../../../../components/signed-in';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { SetupOption } from './setup-option';
import {
  defaultSettings,
  directionLabels,
  steps,
  useSetupDraft,
  type WizardStep,
} from './setup-shared';

export function ConnectScreen({ providerKey, step }: { providerKey: string; step: WizardStep }) {
  const valid = IntegrationProviderKey.safeParse(providerKey);
  if (!valid.success)
    return (
      <Card title="Integration unavailable">
        <p className="text-sm text-muted">
          Choose a provider from the{' '}
          <Link href="/integrations/marketplace" className="text-link">
            marketplace
          </Link>
          .
        </p>
      </Card>
    );
  return <SetupQuery providerKey={valid.data} step={step} />;
}
const entityIcons = {
  email: EnvelopeSimple,
  calendar: CalendarBlank,
  contacts: Users,
  files: Cloud,
};
function EntityIcon({ entity }: { entity: string }) {
  const Icon = entityIcons[entity as keyof typeof entityIcons] ?? Plugs;
  return <Icon weight="fill" aria-hidden className="size-5 shrink-0 text-action" />;
}
function SetupQuery({ providerKey, step }: { providerKey: string; step: WizardStep }) {
  const query = useApiQuery(['integration-setup', providerKey], () =>
    api.integrations.provider(providerKey),
  );
  return (
    <div className="flex flex-col gap-4">
      {query.isPending || query.isError ? <PageState query={query}>{() => null}</PageState> : null}
      <SetupForm
        key={providerKey}
        providerKey={providerKey}
        step={step}
        detail={query.data}
        available={query.isSuccess}
        onRefresh={() => void query.refetch()}
      />
    </div>
  );
}
function SetupForm({
  providerKey,
  step,
  detail,
  available,
  onRefresh,
}: {
  providerKey: string;
  step: WizardStep;
  detail: IntegrationProviderDetail | undefined;
  available: boolean;
  onRefresh: () => void;
}) {
  const { me } = useMe();
  const { firm } = useFirm();
  const router = useRouter();
  const params = useSearchParams();
  const [draft, setDraft] = useSetupDraft(
    `integration-setup:${firm.id}:${me.user.id}:${providerKey}`,
  );
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [localError, setLocalError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const provider = detail?.provider;
  const settings = provider ? { ...defaultSettings(provider), ...draft.settings } : {};
  const environment = draft.environment ?? provider?.environments[0] ?? 'LIVE';
  const selected = settings.entities ?? [];
  const connection = detail?.connections.find(
    (item) => item.environment === environment && item.status === 'CONNECTED',
  );
  const duplicate =
    !!detail?.connections.some(
      (item) => item.environment === environment && item.status !== 'DISCONNECTED',
    ) && !provider?.multipleConnections;
  const connect = useApiMutation(
    (body: ConnectIntegrationRequest) => api.integrations.connect(providerKey, body),
    { invalidate: ['integration-setup', providerKey] },
  );
  const test = useApiMutation((id: string) => api.integrations.test(id));
  const busy = connect.isPending || leaving;
  const editable = available && !!detail?.canManage && !provider?.comingSoon && !busy && !duplicate;
  const blocked = !editable || !provider?.environments.length || !provider?.directions.length;
  const patch = (value: IntegrationSettings) =>
    setDraft({
      ...draft,
      environment,
      settings: { ...settings, ...value },
    });
  const base = `/integrations/${encodeURIComponent(providerKey)}/connect`;
  const directions =
    provider?.directions.filter((direction) =>
      provider.entities
        .filter((entity) => selected.includes(entity.key))
        .every((entity) => entity.directions.includes(direction)),
    ) ?? [];
  const directionValid = !!settings.direction && directions.includes(settings.direction);
  const permissions =
    provider?.permissions.filter(
      (permission) => permission.entity === null || selected.includes(permission.entity),
    ) ?? [];
  const start = async () => {
    setLocalError('');
    const body = ConnectIntegrationRequest.safeParse({
      environment,
      settings,
      testAfterConnect: draft.testAfterConnect ?? true,
      ...(provider?.authMethod === 'API_KEY' ? { credentials } : {}),
    });
    if (!body.success || !directionValid) {
      setLocalError('Choose supported sync settings before connecting.');
      return;
    }
    if (provider?.credentialFields.some((field) => !credentials[field.key]?.trim())) {
      setLocalError('Enter the required provider-issued credentials.');
      return;
    }
    try {
      const result = await connect.mutateAsync(body.data);
      setCredentials({});
      if (result.mode === 'REDIRECT') {
        const target = new URL(result.url, window.location.origin);
        if (
          target.protocol !== 'https:' &&
          !(target.origin === window.location.origin && target.protocol === 'http:')
        ) {
          setLocalError('The authorization address is unavailable. Please try again.');
          return;
        }
        setLeaving(true);
        window.location.assign(target.href);
      } else {
        router.push(`${base}/complete`);
        onRefresh();
      }
    } catch {
      /* The mutation error is shown below; non-secret preferences stay in the draft. */
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <nav aria-label="Breadcrumb" className="flex flex-wrap gap-2 text-sm text-muted">
        <Link href="/integrations" className="text-link">
          Integrations
        </Link>
        <span>/</span>
        <Link href="/integrations/marketplace" className="text-link">
          Add Integration
        </Link>
        <span>/</span>
        <span>{provider?.name ?? 'Integration setup'}</span>
      </nav>
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-control bg-accent-soft text-action">
            <Plugs weight="fill" className="size-8" />
          </span>
          <div className="min-w-0 [&_h1]:font-sans">
            <PageHeader
              title={provider?.name ?? 'Connect Integration'}
              subtitle={provider?.description ?? 'Provider details are unavailable.'}
            />
            <Badge tone={connection ? 'success' : 'neutral'}>
              {connection ? 'Connected' : 'Not Connected'}
            </Badge>
          </div>
        </div>
        {provider?.learnMoreUrl && /^https:\/\//i.test(provider.learnMoreUrl) ? (
          <a
            href={provider.learnMoreUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-control border border-border px-4 py-2 text-sm text-link"
          >
            Learn More <ArrowSquareOut weight="fill" className="size-4" />
          </a>
        ) : null}
      </Card>
      {!detail?.canManage && available ? (
        <Callout icon={ShieldCheck} title="Read-only access" surface="warning">
          Ask your firm's owner for permission to connect integrations.
        </Callout>
      ) : null}
      {provider?.comingSoon ? (
        <Callout icon={ShieldCheck} title="Connection unavailable" surface="warning">
          This provider is not available to connect yet.
        </Callout>
      ) : null}
      {params.get('result') === 'failed' ? (
        <Callout icon={ShieldCheck} title="Authorization did not finish" surface="warning">
          Your preferences are saved in this tab. Review them and try authorization again.
        </Callout>
      ) : null}
      {duplicate ? (
        <Callout
          icon={ShieldCheck}
          title="An existing connection needs to be managed"
          surface="info"
          action={
            <Link
              className="text-link"
              href={`/integrations/${detail?.connections.find((item) => item.environment === environment && item.status !== 'DISCONNECTED')?.id}`}
            >
              Manage connection
            </Link>
          }
        >
          This provider allows one connection per environment. Your existing connection is
          preserved.
        </Callout>
      ) : null}
      <div className="grid min-w-0 gap-4 lg:grid-cols-5">
        <nav aria-label="Connection setup steps" className="lg:col-span-1">
          <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
            {steps.map((item, index) => (
              <li key={item.id}>
                <Link
                  href={`${base}${item.suffix}`}
                  aria-current={step === item.id ? 'step' : undefined}
                  className={`flex gap-3 rounded-control p-3 ${step === item.id ? 'bg-accent-soft' : 'bg-surface'}`}
                >
                  <span
                    className={`flex size-9 shrink-0 items-center justify-center rounded-full font-semibold ${step === item.id ? 'bg-action text-on-action' : 'bg-canvas text-heading'}`}
                  >
                    {index + 1}
                  </span>
                  <span>
                    <span className="block font-semibold text-heading">{item.label}</span>
                    <span className="text-sm text-muted">{item.description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </nav>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <Card data-testid="setup-connect">
            <SectionTitle
              number={1}
              title={`Connect Your ${provider?.name ?? 'Integration'} Account`}
              subtitle="You'll be redirected to your provider to securely authorize access."
            />
            <div className="grid gap-4 xl:grid-cols-5">
              <div className="flex min-w-0 flex-col gap-4 xl:col-span-3">
                {provider?.authMethod === 'API_KEY'
                  ? provider.credentialFields.map((field) => (
                      <Input
                        key={field.key}
                        label={field.label}
                        type="password"
                        autoComplete="off"
                        disabled={!editable}
                        value={credentials[field.key] ?? ''}
                        onChange={(e) =>
                          setCredentials({ ...credentials, [field.key]: e.target.value })
                        }
                      />
                    ))
                  : null}
                <Button disabled={blocked} onClick={() => void start()}>
                  <LockKey weight="fill" className="size-5" />
                  {busy
                    ? 'Connecting…'
                    : provider?.authMethod === 'OAUTH2'
                      ? `Sign in with ${provider.name}`
                      : provider?.authMethod === 'PROVIDER_LINK'
                        ? 'Authorize with provider'
                        : 'Connect integration'}
                </Button>
                <Callout title="Secure Authorization" icon={LockKey} surface="info">
                  Authorization is handled securely by your provider. Your provider password is
                  never collected here.
                </Callout>
              </div>
              <div className="rounded-control bg-folder-surface p-4 xl:col-span-2">
                <h3 className="mb-3 font-semibold text-heading">What this integration includes:</h3>
                <ul className="flex flex-col gap-3">
                  {provider?.entities.map((item) => (
                    <li key={item.key} className="flex gap-2 text-sm text-text">
                      <CheckCircle weight="fill" className="size-5 shrink-0 text-success" />
                      {item.description || item.label}
                    </li>
                  ))}
                  {provider?.options
                    .filter((option) => option.type === 'TOGGLE')
                    .map((option) => (
                      <li key={option.key} className="flex gap-2 text-sm text-text">
                        <CheckCircle weight="fill" className="size-5 shrink-0 text-success" />
                        {option.label}
                      </li>
                    ))}
                </ul>
                {!provider?.entities.length ? (
                  <p className="text-sm text-muted">No supported data has been listed.</p>
                ) : null}
              </div>
            </div>
          </Card>
          <Card data-testid="setup-configure">
            <SectionTitle
              number={2}
              title="Configure Sync Preferences"
              subtitle="Choose what you want to sync and how it should work."
            />
            <div className="grid gap-4 xl:grid-cols-3">
              <div className="rounded-control border border-border p-3">
                <h3 className="mb-2 text-sm font-semibold text-heading">Data to Sync</h3>
                {provider?.entities.map((item) => (
                  <div key={item.key} className="mb-3">
                    <div className="flex items-center gap-2">
                      <EntityIcon entity={item.key} />
                      <Checkbox
                        label={item.label}
                        checked={selected.includes(item.key)}
                        disabled={!editable}
                        onChange={(e) =>
                          patch({
                            entities: e.target.checked
                              ? [...selected, item.key]
                              : selected.filter((key) => key !== item.key),
                          })
                        }
                      />
                    </div>
                    <p className="ml-8 text-xs text-muted">{item.description}</p>
                  </div>
                ))}
                {!provider?.entities.length ? (
                  <p className="text-sm text-muted">No sync objects available.</p>
                ) : null}
              </div>
              <div className="flex flex-col gap-4 rounded-control border border-border p-3">
                <h3 className="text-sm font-semibold text-heading">Sync Settings</h3>
                <Select
                  label="Sync Frequency"
                  disabled={!editable}
                  value={
                    settings.syncMode === 'MANUAL'
                      ? 'manual'
                      : String(settings.syncEveryMinutes ?? '')
                  }
                  options={[
                    { value: 'manual', label: 'Manual only' },
                    ...(provider?.frequencies.map((minutes) => ({
                      value: String(minutes),
                      label:
                        minutes < 60
                          ? `Every ${minutes} minutes`
                          : `Every ${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`,
                    })) ?? []),
                  ]}
                  onChange={(e) =>
                    patch(
                      e.target.value === 'manual'
                        ? { syncMode: 'MANUAL', syncEveryMinutes: null }
                        : { syncMode: 'AUTO', syncEveryMinutes: Number(e.target.value) },
                    )
                  }
                />
                <Select
                  label="Sync Direction"
                  disabled={!editable}
                  value={settings.direction ?? ''}
                  options={[
                    { value: '', label: 'Choose a supported direction' },
                    ...directions.map((value) => ({ value, label: directionLabels[value] })),
                  ]}
                  onChange={(e) => {
                    const value = directions.find((direction) => direction === e.target.value);
                    if (value) patch({ direction: value });
                  }}
                />
                <p className="text-xs text-muted">
                  Supported:{' '}
                  {directions.map((item) => directionLabels[item]).join(', ') ||
                    'No compatible direction'}
                  .
                </p>
                {!directionValid && provider ? (
                  <p role="alert" className="text-sm text-danger">
                    Choose a direction supported by all selected data.
                  </p>
                ) : null}
                {provider?.options
                  .filter((option) => option.type === 'TOGGLE' || option.key === 'defaultCalendar')
                  .map((option) => (
                    <SetupOption
                      key={option.key}
                      option={option}
                      value={settings.options?.[option.key]}
                      disabled={!editable}
                      connected={!!connection}
                      onChange={(value) =>
                        patch({ options: { ...settings.options, [option.key]: value } })
                      }
                    />
                  ))}
              </div>
              <div className="flex flex-col gap-4 rounded-control border border-border p-3">
                <h3 className="text-sm font-semibold text-heading">Account & Folder Options</h3>
                {provider?.options
                  .filter((option) => option.type !== 'TOGGLE' && option.key !== 'defaultCalendar')
                  .map((option) => (
                    <SetupOption
                      key={option.key}
                      option={option}
                      value={settings.options?.[option.key]}
                      disabled={!editable}
                      connected={!!connection}
                      onChange={(value) =>
                        patch({ options: { ...settings.options, [option.key]: value } })
                      }
                    />
                  ))}
                {!provider?.options.length ? (
                  <p className="text-sm text-muted">No additional options available.</p>
                ) : null}
              </div>
            </div>
          </Card>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card data-testid="setup-permissions">
              <SectionTitle
                number={3}
                title="Permissions"
                subtitle="Review the permissions requested for your enabled features."
              />
              <div className="rounded-control bg-folder-surface p-4">
                <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-heading">
                  <ShieldCheck weight="fill" className="size-5" />
                  Required Permissions
                </h3>
                <ul className="flex flex-col gap-2">
                  {permissions.map((item) => (
                    <li key={item.key} className="flex gap-2 text-sm text-text">
                      <CheckCircle weight="fill" className="size-4 shrink-0 text-success" />
                      {item.label}
                      {!item.required ? ' (optional)' : ''}
                    </li>
                  ))}
                </ul>
                {!permissions.length ? (
                  <p className="text-sm text-muted">
                    No permissions requested for the selected data.
                  </p>
                ) : null}
              </div>
            </Card>
            <Card data-testid="setup-complete">
              <SectionTitle
                number={4}
                title="Complete Setup"
                subtitle="After authorization, the server saves your preferences and starts the initial sync."
              />
              <Checkbox
                label="Run a test sync after connection"
                disabled={!editable}
                checked={draft.testAfterConnect ?? true}
                onChange={(e) =>
                  setDraft({ ...draft, settings, environment, testAfterConnect: e.target.checked })
                }
              />
              <p className="mb-4 text-xs text-muted">
                Verify the connection and sync a small sample when enabled.
              </p>
              {connection ? (
                <div className="mb-4 flex flex-col gap-3">
                  <p role="status" className="text-sm text-success">
                    Your account is connected
                    {connection.accountLabel ? `: ${connection.accountLabel}` : '.'}
                  </p>
                  <Button
                    variant="secondary"
                    disabled={!detail?.canManage || test.isPending}
                    onClick={() => test.mutate(connection.id)}
                  >
                    {test.isPending ? 'Testing…' : 'Run connection test'}
                  </Button>
                  {test.isSuccess ? (
                    <p role="status" className="text-sm text-text">
                      Connection test: {test.data.summary}
                    </p>
                  ) : null}
                  <Link className="text-sm text-link" href={`/integrations/${connection.id}`}>
                    Manage Integration →
                  </Link>
                </div>
              ) : (
                <p className="mb-4 text-sm text-muted">Authorize your account to complete setup.</p>
              )}
              {localError || connect.isError || test.isError ? (
                <p role="alert" className="mb-4 text-sm text-danger">
                  {localError ||
                    errorMessage(connect.error ?? test.error, {
                      NOT_SUPPORTED:
                        'These settings are not supported. Review your choices and retry.',
                      CREDENTIALS_REJECTED:
                        'Your provider could not accept those credentials. Check them and retry.',
                      ALREADY_CONNECTED:
                        'This integration is already connected. Refresh and manage the existing connection.',
                      COMING_SOON: 'This provider is not available to connect yet.',
                    })}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/integrations/marketplace"
                  className="rounded-control border border-border px-4 py-3 text-sm text-link"
                >
                  Cancel
                </Link>
                <Button disabled={blocked || !directionValid} onClick={() => void start()}>
                  {busy ? 'Connecting…' : 'Connect & Continue'}
                  <ArrowRight weight="fill" className="size-4" />
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
function SectionTitle({
  number,
  title,
  subtitle,
}: {
  number: number;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mb-4 flex gap-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-action font-semibold text-on-action">
        {number}
      </span>
      <div>
        <h2 className="font-semibold text-heading">{title}</h2>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>
    </div>
  );
}
