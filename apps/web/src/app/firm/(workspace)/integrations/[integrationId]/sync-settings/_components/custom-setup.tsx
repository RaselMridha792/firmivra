'use client';

import type {
  CustomIntegrationAuth,
  CustomIntegrationConfig,
  SaveCustomIntegrationRequest,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input, Select, Toggle } from '@firmivra/ui';
import { Copy, Key, PaperPlaneTilt } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { CardTitle, EmptyLine, formatDate } from '../../_components/manage-integration-shared';
import { integrationError, Notice } from '../../_components/manage-shell';

/**
 * Custom API & Webhooks (the spec's route for systems not in the catalog; the `custom_api`
 * provider): where LVP Pro sends events, how it signs them, which events, and the address outside
 * systems post to. A secret is write-only: it is typed once, sent, and only its last four
 * characters come back; it is never shown or kept in the page.
 */

const AUTH_LABELS: Record<CustomIntegrationAuth, string> = {
  NONE: 'No authentication',
  API_KEY: 'API key header',
  BEARER_TOKEN: 'Bearer token',
  HMAC_SIGNATURE: 'HMAC signature (x-firmivra-signature)',
};
const AUTH_METHODS = Object.keys(AUTH_LABELS) as CustomIntegrationAuth[];
/** "HTTP 200, 184 ms": the facts of a test call. */
const testFacts = (r: { statusCode: number | null; durationMs: number | null }) =>
  [
    r.statusCode ? `HTTP ${r.statusCode}` : null,
    r.durationMs !== null ? `${r.durationMs} ms` : null,
  ]
    .filter(Boolean)
    .join(', ');

export function CustomSetup({
  connectionId,
  canManage,
}: {
  connectionId: string;
  canManage: boolean;
}) {
  const config = useApiQuery(['integrations', 'custom', connectionId], () =>
    api.integrations.custom(connectionId),
  );
  const events = useApiQuery(['integrations', 'custom-events'], () =>
    api.integrations.customEvents(),
  );
  return (
    <Card data-testid="custom-setup" className="p-5!">
      <CardTitle>Custom API & Webhooks</CardTitle>
      {config.data ? (
        <CustomForm
          key={config.data.connectionId}
          config={config.data}
          events={events.data ?? []}
          canManage={canManage}
        />
      ) : (
        <EmptyLine>
          {config.isError
            ? integrationError(config.error)
            : 'The custom connection setup shows when it loads.'}
        </EmptyLine>
      )}
    </Card>
  );
}

interface Fields {
  enabled: boolean;
  name: string;
  documentationUrl: string;
  authMethod: CustomIntegrationAuth;
  endpointUrl: string;
  events: string[];
}
const fieldsOf = (c: CustomIntegrationConfig): Fields => ({
  enabled: c.enabled,
  name: c.name,
  documentationUrl: c.documentationUrl ?? '',
  authMethod: c.authMethod,
  endpointUrl: c.endpointUrl ?? '',
  events: c.events,
});

function CustomForm({
  config,
  events,
  canManage,
}: {
  config: CustomIntegrationConfig;
  events: { key: string; label: string; module: string }[];
  canManage: boolean;
}) {
  const saved = fieldsOf(config);
  const [fields, setFields] = useState(saved);
  const [secret, setSecret] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const save = useApiMutation(
    (body: SaveCustomIntegrationRequest) => api.integrations.saveCustom(config.connectionId, body),
    { invalidate: ['integrations'] },
  );
  const rotate = useApiMutation(
    (value: string) => api.integrations.rotateCustomSecret(config.connectionId, { secret: value }),
    { invalidate: ['integrations'] },
  );
  const test = useApiMutation(() => api.integrations.testCustom(config.connectionId), {
    invalidate: ['integrations'],
  });
  const busy = save.isPending || rotate.isPending || test.isPending;
  const set = (patch: Partial<Fields>) => {
    setProblem(null);
    setFields((current) => ({ ...current, ...patch }));
  };

  const body: Record<string, unknown> = {};
  if (fields.enabled !== saved.enabled) body['enabled'] = fields.enabled;
  if (fields.name.trim() !== saved.name) body['name'] = fields.name.trim();
  if (fields.documentationUrl.trim() !== saved.documentationUrl)
    body['documentationUrl'] = fields.documentationUrl.trim() || null;
  if (fields.authMethod !== saved.authMethod) body['authMethod'] = fields.authMethod;
  if (fields.endpointUrl.trim() !== saved.endpointUrl)
    body['endpointUrl'] = fields.endpointUrl.trim() || null;
  if ([...fields.events].sort().join() !== [...saved.events].sort().join())
    body['events'] = fields.events;
  const changed = Object.keys(body).length > 0;

  function submit() {
    if (!fields.name.trim()) return setProblem('Name the connection.');
    const endpoint = fields.endpointUrl.trim();
    if (endpoint && !/^https:\/\/\S+$/i.test(endpoint))
      return setProblem('The endpoint must be an https address.');
    save.mutate(body as SaveCustomIntegrationRequest);
  }

  function rotateSecret() {
    if (secret.length < 16) return setProblem('A secret has at least 16 characters.');
    const value = secret;
    setSecret('');
    rotate.mutate(value);
  }

  const notice = save.isError
    ? integrationError(save.error)
    : rotate.isError
      ? integrationError(rotate.error)
      : test.isError
        ? integrationError(test.error)
        : problem;

  return (
    <div className="flex flex-col gap-4">
      {notice ? <Notice tone="error">{notice}</Notice> : null}
      {save.isSuccess ? <Notice tone="success">Custom connection saved.</Notice> : null}
      {rotate.isSuccess ? (
        <Notice tone="success">
          Secret saved. It ends in {rotate.data.secretLast4}; it is not shown again.
        </Notice>
      ) : null}
      {test.isSuccess ? (
        <Notice tone={test.data.ok ? 'success' : 'error'}>
          {test.data.message}
          {testFacts(test.data) ? ` (${testFacts(test.data)})` : ''}
        </Notice>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-medium text-heading">Send events</span>
            <Toggle
              label="Send events"
              checked={fields.enabled}
              disabled={!canManage || busy}
              onChange={(enabled) => set({ enabled })}
            />
          </div>
          <Input
            label="Connection name"
            value={fields.name}
            maxLength={100}
            disabled={!canManage || busy}
            onChange={(event) => set({ name: event.target.value })}
          />
          <Input
            label="Endpoint URL (https)"
            type="url"
            placeholder="https://"
            value={fields.endpointUrl}
            maxLength={500}
            disabled={!canManage || busy}
            onChange={(event) => set({ endpointUrl: event.target.value })}
          />
          <Select
            label="Authentication"
            value={fields.authMethod}
            disabled={!canManage || busy}
            onChange={(event) =>
              set({
                authMethod: AUTH_METHODS.find((m) => m === event.target.value) ?? 'NONE',
              })
            }
            options={AUTH_METHODS.map((value) => ({ value, label: AUTH_LABELS[value] }))}
          />
          <Input
            label="Documentation URL (optional)"
            type="url"
            value={fields.documentationUrl}
            maxLength={300}
            disabled={!canManage || busy}
            onChange={(event) => set({ documentationUrl: event.target.value })}
          />
        </div>

        <div className="flex flex-col gap-3">
          <fieldset disabled={!canManage || busy}>
            <legend className="text-sm font-medium text-heading">Events to send</legend>
            {events.length ? (
              events.map((event) => (
                <Checkbox
                  key={event.key}
                  label={`${event.label} (${event.module})`}
                  checked={fields.events.includes(event.key)}
                  onChange={(change) =>
                    set({
                      events: change.target.checked
                        ? [...fields.events, event.key]
                        : fields.events.filter((key) => key !== event.key),
                    })
                  }
                />
              ))
            ) : (
              <EmptyLine>No events are available yet.</EmptyLine>
            )}
          </fieldset>
          <div className="rounded-control border border-border p-3 text-sm">
            <p className="font-medium text-heading">Inbound address</p>
            <p className="text-xs text-muted">Outside systems post to this address.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-text">
                {config.inboundUrl}
              </code>
              <Button
                variant="secondary"
                onClick={() =>
                  void navigator.clipboard
                    ?.writeText(config.inboundUrl)
                    .then(() => setCopied(true))
                    .catch(() => undefined)
                }
              >
                <Copy aria-hidden weight="fill" className="size-4" />
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-3 rounded-control border border-border p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div className="flex flex-col gap-1">
          <Input
            label="New secret (write-only)"
            type="password"
            autoComplete="new-password"
            value={secret}
            maxLength={500}
            disabled={!canManage || busy || fields.authMethod === 'NONE'}
            onChange={(event) => setSecret(event.target.value)}
          />
          <p className="text-xs text-muted">
            {config.secretLast4
              ? `The current secret ends in ${config.secretLast4}, set ${formatDate(config.secretRotatedAt)}.`
              : 'No secret is set.'}{' '}
            The secret is never shown again after it is saved.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={!canManage || busy || !secret || fields.authMethod === 'NONE'}
          onClick={rotateSecret}
        >
          <Key aria-hidden weight="fill" className="size-4" />
          {config.secretLast4 ? 'Rotate Secret' : 'Set Secret'}
        </Button>
      </div>

      <div className="flex flex-wrap justify-end gap-3">
        <Button
          variant="secondary"
          disabled={busy || !config.endpointUrl}
          onClick={() => test.mutate(undefined)}
        >
          <PaperPlaneTilt aria-hidden weight="fill" className="size-4" />
          {test.isPending ? 'Sending…' : 'Send Test Event'}
        </Button>
        <Button disabled={!canManage || busy || !changed} onClick={submit}>
          {save.isPending ? 'Saving…' : 'Save Custom Connection'}
        </Button>
      </div>
    </div>
  );
}
