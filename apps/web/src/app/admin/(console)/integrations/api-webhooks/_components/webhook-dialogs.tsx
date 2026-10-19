'use client';

import { Button, Checkbox, Input, Modal, Radio, Select, Textarea } from '@firmivra/ui';
import { useId, useState, type FormEvent } from 'react';
import { useApiMutation } from '../../../../../../lib/query';
import {
  adminIntegrations,
  WEBHOOK_DIRECTIONS,
  WEBHOOK_EVENTS,
  type CreateWebhookBody,
  type WebhookDirection,
  type WebhookEndpoint,
  type WebhookStatus,
  type WebhookWithSecret,
} from '../../_components/integrations-contract';
import { formatDate } from '../../_components/integration-format';
import { integrationErrorMessage } from '../../_components/integration-states';
import { DIRECTION_LABELS, SecretOnceDialog } from './api-webhooks-parts';

/**
 * The webhook endpoint dialogs (docx §8): Add or Edit (https URL, events, retry policy, status;
 * an inbound endpoint may name the platform integration whose provider calls it), the signing
 * secret shown once, Rotate Signing Secret, and Disable or Enable.
 */

const DESCRIPTION_MAX = 200;
const EVENT_NAME = /^[A-Za-z0-9_.:-]{1,100}$/;
const RETRIES = Array.from({ length: 11 }, (_, n) => String(n));

/** An https address without a user name, or the reason it is not one. */
function urlProblem(value: string): string | null {
  const text = value.trim();
  if (!text) return 'Enter the endpoint URL.';
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return 'The URL must start with https://.';
    if (url.username || url.password) return 'The URL cannot contain a user name or password.';
    return null;
  } catch {
    return 'Enter the full address, starting with https://.';
  }
}

/** The provider's event names, one per line or separated by commas. */
const parseEvents = (text: string) => [
  ...new Set(
    text
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ),
];

type HookField = 'url' | 'description' | 'events';

export function WebhookFormDialog({
  endpoint,
  onClose,
  onSaved,
}: {
  /** Left out to add a new endpoint. */
  endpoint?: WebhookEndpoint;
  onClose: () => void;
  onSaved: (result: WebhookWithSecret) => void;
}) {
  const id = useId();
  const [direction, setDirection] = useState<WebhookDirection>(endpoint?.direction ?? 'OUTBOUND');
  const [url, setUrl] = useState(endpoint?.url ?? '');
  const [description, setDescription] = useState(endpoint?.description ?? '');
  const [events, setEvents] = useState<string[]>(
    endpoint?.direction === 'OUTBOUND' ? endpoint.events : [],
  );
  const [inboundEvents, setInboundEvents] = useState(
    endpoint?.direction === 'INBOUND' ? endpoint.events.join('\n') : '',
  );
  const [maxRetries, setMaxRetries] = useState(String(endpoint?.maxRetries ?? 5));
  const [status, setStatus] = useState<WebhookStatus>(endpoint?.status ?? 'ACTIVE');
  const [errors, setErrors] = useState<Partial<Record<HookField, string>>>({});
  const save = useApiMutation(
    (body: CreateWebhookBody) =>
      endpoint
        ? adminIntegrations.updateWebhook(endpoint.id, {
            url: body.url,
            description: body.description,
            events: body.events,
            maxRetries: body.maxRetries,
            status,
          })
        : adminIntegrations.createWebhook(body),
    { invalidate: ['admin-integrations'] },
  );

  function toggleEvent(event: string, on: boolean) {
    setEvents((current) =>
      on
        ? WEBHOOK_EVENTS.filter((item) => item === event || current.includes(item))
        : current.filter((item) => item !== event),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const list = direction === 'OUTBOUND' ? events : parseEvents(inboundEvents);
    const found: Partial<Record<HookField, string>> = {};
    const badUrl = urlProblem(url);
    if (badUrl) found.url = badUrl;
    if (description.trim().length > DESCRIPTION_MAX)
      found.description = `Keep the description to ${DESCRIPTION_MAX} characters.`;
    if (!list.length) found.events = 'Choose at least one event.';
    else if (list.some((item) => !EVENT_NAME.test(item)))
      found.events = 'Use event names such as invoice.paid, without spaces.';
    setErrors(found);
    const first = (['url', 'description', 'events'] as const).find((key) => found[key]);
    if (first) {
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    save.mutate(
      {
        direction,
        url: url.trim(),
        description: description.trim() || null,
        events: list,
        maxRetries: Number(maxRetries),
      },
      { onSuccess: onSaved },
    );
  }

  return (
    <Modal
      open
      title={endpoint ? 'Edit Webhook' : 'Add Webhook'}
      subtitle={
        endpoint ? endpoint.url : 'A signing secret is created with the endpoint and shown once.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : endpoint ? 'Save Changes' : 'Add Webhook'}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} className="flex max-w-xl flex-col gap-5">
        {endpoint ? null : (
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-text">Direction</legend>
            <div className="flex flex-wrap gap-x-6">
              {WEBHOOK_DIRECTIONS.map((value) => (
                <Radio
                  key={value}
                  name={`${id}-direction`}
                  label={
                    value === 'OUTBOUND'
                      ? `${DIRECTION_LABELS[value]}: Firmivra sends events`
                      : `${DIRECTION_LABELS[value]}: a provider calls Firmivra`
                  }
                  checked={direction === value}
                  onChange={() => setDirection(value)}
                />
              ))}
            </div>
          </fieldset>
        )}
        <Input
          id={`${id}-url`}
          type="url"
          label="Endpoint URL"
          required
          autoComplete="off"
          placeholder="https://hooks.example.test/firmivra"
          value={url}
          error={errors.url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Input
          id={`${id}-description`}
          label="Description (optional)"
          maxLength={DESCRIPTION_MAX}
          value={description}
          error={errors.description}
          onChange={(event) => setDescription(event.target.value)}
        />
        {direction === 'OUTBOUND' ? (
          <fieldset
            aria-describedby={errors.events ? `${id}-events-error` : undefined}
            className="flex flex-col gap-1"
          >
            <legend className="text-sm font-medium text-text">Events</legend>
            <div className="grid gap-x-6 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((value, index) => (
                <Checkbox
                  key={value}
                  id={index === 0 ? `${id}-events` : undefined}
                  label={value}
                  className="font-mono"
                  checked={events.includes(value)}
                  onChange={(change) => toggleEvent(value, change.target.checked)}
                />
              ))}
            </div>
            {errors.events ? (
              <p id={`${id}-events-error`} className="text-xs text-danger">
                {errors.events}
              </p>
            ) : null}
          </fieldset>
        ) : (
          <>
            <Textarea
              id={`${id}-events`}
              label="Events (one per line)"
              rows={3}
              placeholder={'invoice.paid\ninvoice.payment_failed'}
              value={inboundEvents}
              error={errors.events}
              onChange={(event) => setInboundEvents(event.target.value)}
            />
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Retries after a failed delivery"
            value={maxRetries}
            onChange={(event) => setMaxRetries(event.target.value)}
            options={RETRIES.map((value) => ({
              value,
              label: value === '0' ? 'No retries' : `Up to ${value}`,
            }))}
          />
          {endpoint ? (
            <Select
              label="Status"
              value={status}
              onChange={(event) =>
                setStatus(event.target.value === 'DISABLED' ? 'DISABLED' : 'ACTIVE')
              }
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'DISABLED', label: 'Disabled' },
              ]}
            />
          ) : null}
        </div>
        {endpoint ? (
          <p className="text-sm text-muted">
            Signing secret{' '}
            <code className="font-mono text-heading">
              {endpoint.signingSecretHint ?? 'not set'}
            </code>
            {endpoint.secretRotatedAt
              ? `, last rotated ${formatDate(endpoint.secretRotatedAt)}`
              : ''}
            . Rotate it from the endpoint&apos;s menu.
          </p>
        ) : null}
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(save.error)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

/** The signing secret, once: after Add or Rotate. */
export function SigningSecretDialog({
  result,
  rotated,
  onClose,
}: {
  result: WebhookWithSecret & { signingSecret: string };
  rotated: boolean;
  onClose: () => void;
}) {
  return (
    <SecretOnceDialog
      title={rotated ? 'Copy the new signing secret' : 'Copy the signing secret'}
      subtitle={result.endpoint.url}
      label="Signing secret"
      secret={result.signingSecret}
      onClose={onClose}
    >
      {result.endpoint.direction === 'OUTBOUND'
        ? 'The receiver checks every delivery’s signature with it. Firmivra keeps only a reference to it.'
        : 'Set it in the provider’s webhook settings so Firmivra can verify each call. Firmivra keeps only a reference to it.'}
      {rotated ? ' The previous secret no longer verifies.' : ''}
    </SecretOnceDialog>
  );
}

/** Rotate the signing secret (Super Admin only). */
export function RotateSecretDialog({
  endpoint,
  onClose,
  onRotated,
}: {
  endpoint: WebhookEndpoint;
  onClose: () => void;
  onRotated: (result: WebhookWithSecret) => void;
}) {
  const rotate = useApiMutation(
    () => adminIntegrations.updateWebhook(endpoint.id, { rotateSecret: true }),
    { invalidate: ['admin-integrations'] },
  );
  return (
    <Modal
      open
      title="Rotate signing secret?"
      subtitle={endpoint.url}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={rotate.isPending}
            onClick={() => rotate.mutate(undefined, { onSuccess: onRotated })}
          >
            {rotate.isPending ? 'Rotating…' : 'Rotate Secret'}
          </Button>
        </>
      }
    >
      <div className="flex max-w-lg flex-col gap-4">
        <p className="text-sm text-text">
          A new secret replaces{' '}
          <code className="font-mono">{endpoint.signingSecretHint ?? 'the current one'}</code> at
          once. Signatures made with the old secret stop verifying, so update the{' '}
          {endpoint.direction === 'OUTBOUND' ? 'receiver' : 'provider'} right after.
        </p>
        {rotate.isError ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(rotate.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

/** Disable (deliveries stop, the settings stay) or enable an endpoint. */
export function WebhookStatusDialog({
  endpoint,
  onClose,
  onDone,
}: {
  endpoint: WebhookEndpoint;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const disabling = endpoint.status === 'ACTIVE';
  const change = useApiMutation(
    () =>
      adminIntegrations.updateWebhook(endpoint.id, {
        status: disabling ? 'DISABLED' : 'ACTIVE',
      }),
    { invalidate: ['admin-integrations'] },
  );
  return (
    <Modal
      open
      title={disabling ? 'Disable webhook?' : 'Enable webhook?'}
      subtitle={endpoint.url}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={change.isPending}
            onClick={() =>
              change.mutate(undefined, {
                onSuccess: () =>
                  onDone(
                    disabling
                      ? `The webhook to ${endpoint.url} was disabled.`
                      : `The webhook to ${endpoint.url} was enabled.`,
                  ),
              })
            }
          >
            {change.isPending ? 'Saving…' : disabling ? 'Disable Webhook' : 'Enable Webhook'}
          </Button>
        </>
      }
    >
      <div className="flex max-w-lg flex-col gap-4">
        <p className="text-sm text-text">
          {disabling
            ? 'Firmivra stops sending or accepting its events. The URL, events and signing secret are kept, and nothing restarts until someone enables it.'
            : 'Firmivra sends or accepts its events again. Events from while it was disabled are not sent again by themselves.'}
        </p>
        {change.isError ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(change.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
