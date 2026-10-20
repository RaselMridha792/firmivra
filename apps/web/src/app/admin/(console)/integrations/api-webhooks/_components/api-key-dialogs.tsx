'use client';

import { Button, Callout, Checkbox, Input, Modal, Radio, Textarea } from '@firmivra/ui';
import { Warning } from '@phosphor-icons/react';
import { useId, useState, type FormEvent } from 'react';
import { useApiMutation } from '../../../../../../lib/query';
import {
  adminIntegrations,
  API_SCOPE_LABELS,
  API_SCOPES,
  ENVIRONMENT_LABELS,
  ENVIRONMENTS,
  SYSTEM_RATE_LIMIT_PER_MINUTE,
  type ApiKey,
  type ApiScope,
  type CreateApiKeyBody,
  type IntegrationEnvironment,
  type IssuedApiKey,
} from '../../_components/integrations-contract';
import { formatNumber } from '../../_components/integration-format';
import { integrationErrorMessage } from '../../_components/integration-states';
import { keyText, SecretOnceDialog } from './api-webhooks-parts';

/**
 * The API key dialogs (docx §8, Super Admin only): Create (name, environment, scopes, rate limit,
 * expiry; least privilege: no scope is preselected), the key shown once, Rotate (a new key with the
 * same settings, the old one revoked) and Revoke with a reason. The mock records each in the audit.
 */

const NAME_MAX = 60;
const REASON_MAX = 300;

const pad = (value: number) => String(value).padStart(2, '0');
/** `YYYY-MM-DD` on the viewer's calendar, `days` from today. */
function localDay(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

type KeyField = 'name' | 'scopes' | 'rateLimit' | 'expires';

export function CreateKeyDialog({
  onClose,
  onIssued,
}: {
  onClose: () => void;
  onIssued: (issued: IssuedApiKey) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [environment, setEnvironment] = useState<IntegrationEnvironment>('TEST');
  const [scopes, setScopes] = useState<ApiScope[]>([]);
  const [rateLimit, setRateLimit] = useState('');
  const [expires, setExpires] = useState('');
  const [errors, setErrors] = useState<Partial<Record<KeyField, string>>>({});
  // The earliest expiry: tomorrow, on the viewer's calendar.
  const [tomorrow] = useState(() => localDay(1));
  const create = useApiMutation((body: CreateApiKeyBody) => adminIntegrations.createApiKey(body), {
    invalidate: ['admin-integrations'],
  });

  function toggleScope(scope: ApiScope, on: boolean) {
    setScopes((current) =>
      on
        ? API_SCOPES.filter((item) => item === scope || current.includes(item))
        : current.filter((item) => item !== scope),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const found: Partial<Record<KeyField, string>> = {};
    const label = name.trim();
    if (!label) found.name = 'Enter a name for the key.';
    else if (label.length > NAME_MAX) found.name = `Keep the name to ${NAME_MAX} characters.`;
    if (!scopes.length) found.scopes = 'Choose at least one scope.';
    const limit = rateLimit.trim() === '' ? null : Number(rateLimit);
    if (
      limit !== null &&
      (!Number.isInteger(limit) || limit < 1 || limit > SYSTEM_RATE_LIMIT_PER_MINUTE)
    )
      found.rateLimit = `Enter a whole number from 1 to ${formatNumber(SYSTEM_RATE_LIMIT_PER_MINUTE)}, or leave it empty.`;
    if (expires && expires < tomorrow) found.expires = 'Choose a date after today.';
    setErrors(found);
    const first = (['name', 'scopes', 'rateLimit', 'expires'] as const).find((key) => found[key]);
    if (first) {
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    create.mutate(
      {
        name: label,
        environment,
        scopes,
        rateLimitPerMinute: limit,
        // The end of the chosen day on the viewer's calendar.
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      },
      { onSuccess: onIssued },
    );
  }

  return (
    <Modal
      open
      title="Create API Key"
      subtitle="The full key is shown once, right after you create it."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-form`} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create Key'}
          </Button>
        </>
      }
    >
      <form id={`${id}-form`} noValidate onSubmit={submit} className="flex max-w-xl flex-col gap-5">
        <Input
          id={`${id}-name`}
          label="Key name"
          required
          maxLength={NAME_MAX}
          autoComplete="off"
          placeholder="e.g. Sample Partner Portal"
          value={name}
          error={errors.name}
          onChange={(event) => setName(event.target.value)}
        />
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium text-text">Environment</legend>
          <div className="flex flex-wrap gap-x-6">
            {ENVIRONMENTS.map((value) => (
              <Radio
                key={value}
                name={`${id}-environment`}
                label={`${ENVIRONMENT_LABELS[value]} (fv_${value.toLowerCase()}_…)`}
                checked={environment === value}
                onChange={() => setEnvironment(value)}
              />
            ))}
          </div>
          {environment === 'LIVE' ? (
            <Callout size="compact" surface="warning" tone="amber" icon={Warning}>
              A live key reaches production data. Give it only the scopes it needs.
            </Callout>
          ) : null}
        </fieldset>
        <fieldset
          aria-describedby={errors.scopes ? `${id}-scopes-error` : undefined}
          className="flex flex-col gap-1"
        >
          <legend className="text-sm font-medium text-text">Scopes</legend>
          <p className="text-xs text-muted">Least privilege: choose only what the caller needs.</p>
          <div className="grid gap-x-6 sm:grid-cols-2">
            {API_SCOPES.map((scope, index) => (
              <Checkbox
                key={scope}
                id={index === 0 ? `${id}-scopes` : undefined}
                label={`${API_SCOPE_LABELS[scope]} (${scope})`}
                checked={scopes.includes(scope)}
                onChange={(event) => toggleScope(scope, event.target.checked)}
              />
            ))}
          </div>
          {errors.scopes ? (
            <p id={`${id}-scopes-error`} className="text-xs text-danger">
              {errors.scopes}
            </p>
          ) : null}
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            id={`${id}-rateLimit`}
            label="Rate limit (requests per minute)"
            inputMode="numeric"
            placeholder={`System limit: ${formatNumber(SYSTEM_RATE_LIMIT_PER_MINUTE)}`}
            value={rateLimit}
            error={errors.rateLimit}
            onChange={(event) => setRateLimit(event.target.value)}
          />
          <Input
            id={`${id}-expires`}
            type="date"
            label="Expires on (optional)"
            min={tomorrow}
            value={expires}
            error={errors.expires}
            onChange={(event) => setExpires(event.target.value)}
          />
        </div>
        {create.isError ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(create.error)}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}

/** The new key, once: after Create or Rotate. */
export function IssuedKeyDialog({
  issued,
  rotated,
  onClose,
}: {
  issued: IssuedApiKey;
  /** The key it replaced (Rotate). */
  rotated?: ApiKey;
  onClose: () => void;
}) {
  return (
    <SecretOnceDialog
      title={rotated ? 'Copy your rotated API key' : 'Copy your new API key'}
      subtitle={`${issued.key.name} · ${ENVIRONMENT_LABELS[issued.key.environment]} · ${keyText(issued.key)}`}
      label="API key"
      secret={issued.secret}
      onClose={onClose}
    >
      {rotated
        ? `Firmivra keeps only a hash of it. The old key ${keyText(rotated)} no longer works: update every system that used it.`
        : 'Firmivra keeps only a hash of it, so it cannot be shown again. If it is lost, rotate the key.'}
    </SecretOnceDialog>
  );
}

/** Rotate: a new key with the same name, scopes, environment, limit and expiry; the old is revoked. */
export function RotateKeyDialog({
  apiKey,
  onClose,
  onIssued,
}: {
  apiKey: ApiKey;
  onClose: () => void;
  onIssued: (issued: IssuedApiKey) => void;
}) {
  const rotate = useApiMutation(() => adminIntegrations.rotateApiKey(apiKey.id), {
    invalidate: ['admin-integrations'],
  });
  return (
    <Modal
      open
      title={`Rotate ${apiKey.name}?`}
      subtitle={keyText(apiKey)}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={rotate.isPending}
            onClick={() => rotate.mutate(undefined, { onSuccess: onIssued })}
          >
            {rotate.isPending ? 'Rotating…' : 'Rotate Key'}
          </Button>
        </>
      }
    >
      <div className="flex max-w-lg flex-col gap-4">
        <p className="text-sm text-text">
          Firmivra issues a new key with the same scopes, environment, rate limit and expiry, and
          revokes {keyText(apiKey)} at once. Calls with the old key fail from then on, so have the
          new key ready to put in place.
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

/** Revoke, with the reason the audit entry keeps. */
export function RevokeKeyDialog({
  apiKey,
  onClose,
  onDone,
}: {
  apiKey: ApiKey;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const [reason, setReason] = useState('');
  const revoke = useApiMutation(
    () => adminIntegrations.revokeApiKey(apiKey.id, { reason: reason.trim() }),
    { invalidate: ['admin-integrations'] },
  );
  const ready = reason.trim().length > 0;
  return (
    <Modal
      open
      title={`Revoke ${apiKey.name}?`}
      subtitle={keyText(apiKey)}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready || revoke.isPending}
            onClick={() =>
              revoke.mutate(undefined, {
                onSuccess: () => onDone(`${apiKey.name} (${keyText(apiKey)}) was revoked.`),
              })
            }
          >
            {revoke.isPending ? 'Revoking…' : 'Revoke Key'}
          </Button>
        </>
      }
    >
      <div className="flex max-w-lg flex-col gap-4">
        <p className="text-sm text-text">
          Calls with this key fail at once. A revoked key cannot be turned back on; issue a new one
          if it is needed again.
        </p>
        <Textarea
          label="Reason"
          required
          rows={2}
          maxLength={REASON_MAX}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {revoke.isError ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(revoke.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
