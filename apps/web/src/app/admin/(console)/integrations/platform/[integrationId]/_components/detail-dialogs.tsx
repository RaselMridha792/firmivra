'use client';

import { ApiRequestError } from '@firmivra/types';
import {
  Badge,
  Button,
  Callout,
  Checkbox,
  Drawer,
  Input,
  Modal,
  Select,
  Textarea,
} from '@firmivra/ui';
import { LockKey, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  CATEGORIES,
  CATEGORY_LABELS,
  DESCRIPTION_MAX,
  ENVIRONMENT_LABELS,
  NAME_MAX,
  SHORT_DESCRIPTION_MAX,
  type ConnectionValue,
  type IntegrationCategory,
  type PlatformIntegrationDetail,
} from '../../../_components/integrations-contract';
import {
  EnvironmentBadge,
  LogSeverityBadge,
  OutcomeBadge,
} from '../../../_components/integration-badges';
import { formatDateTime } from '../../../_components/integration-format';
import {
  integrationErrorMessage,
  Loaded,
  QuietLine,
} from '../../../_components/integration-states';
import { logsHref } from '../../../_components/integrations-shell';
import { CopyButton, DetailRows } from './detail-parts';

/**
 * The manage page's dialogs (docx §5 and §12): update credentials (Super Admin only, write-only
 * values), edit the non-secret connection fields, edit the integration's details, switch the
 * environment (it clears the saved credentials), and the log record drawer for drill-downs.
 */

/** "Enter … as a full address": the URL rule the API applies (https only). */
export function urlProblem(value: string, label: string): string | null {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:') return `The ${label} must start with https://.`;
    if (url.username || url.password) return `The ${label} cannot contain a user name.`;
    return null;
  } catch {
    return `Enter the ${label} as a full address (https://…).`;
  }
}

const isConflict = (error: unknown) =>
  error instanceof ApiRequestError && error.code === 'CONFLICT';

/** Focus the first field with an error, by its id. */
function focusFirst(ids: string[]) {
  const first = ids[0];
  if (first) requestAnimationFrame(() => document.getElementById(first)?.focus());
}

/** The failed save's message, with Reload when someone else saved first. */
function SaveError({ error, onReload }: { error: unknown; onReload: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
      <span>{integrationErrorMessage(error)}</span>
      {isConflict(error) ? (
        <Button variant="secondary" onClick={onReload}>
          Reload
        </Button>
      ) : null}
    </div>
  );
}

// ---------- Update credentials (Super Admin only) ----------

/** Checks a new secret the way the API does, so a mistake shows next to its field. */
function secretProblem(
  field: ConnectionValue,
  value: string,
  environment: PlatformIntegrationDetail['environment'],
): string | null {
  const text = value.trim();
  if (!text) return null;
  if (text.length > 500) return 'This value is too long.';
  if (field.prefix && field.kind !== 'url') {
    const wanted = field.prefix[environment];
    const other = field.prefix[environment === 'LIVE' ? 'TEST' : 'LIVE'];
    if (wanted !== other && text.startsWith(other))
      return `This is a ${environment === 'LIVE' ? 'test' : 'live'} value, and this connection is ${ENVIRONMENT_LABELS[environment]}. Live and test credentials never mix.`;
    if (!text.startsWith(wanted)) return `It should start with ${wanted}.`;
  }
  if (text.length < 8) return 'This value looks too short.';
  return null;
}

export function CredentialsDialog({
  integration,
  onClose,
  onDone,
}: {
  integration: PlatformIntegrationDetail;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const secrets = integration.connection.fields.filter((field) => field.secret);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const save = useApiMutation(
    (input: Record<string, string>) =>
      adminIntegrations.putCredentials(integration.id, { values: input }),
    { invalidate: ['admin-integrations'] },
  );
  const idOf = (key: string) => `credential-${key}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    for (const field of secrets) {
      const problem = secretProblem(field, values[field.key] ?? '', integration.environment);
      if (problem) next[field.key] = problem;
    }
    setErrors(next);
    const filled = Object.fromEntries(
      Object.entries(values)
        .map(([key, value]) => [key, value.trim()] as const)
        .filter(([, value]) => value !== ''),
    );
    if (Object.keys(next).length) {
      setFormError(null);
      focusFirst(secrets.filter((field) => next[field.key]).map((field) => idOf(field.key)));
      return;
    }
    if (!Object.keys(filled).length) {
      setFormError('Enter at least one new value. Fields left empty keep their saved value.');
      return;
    }
    setFormError(null);
    save.mutate(filled, {
      onSuccess: () => onDone('Credentials saved. Test the connection to confirm them.'),
    });
  }

  return (
    <Modal
      open
      title="Update Credentials"
      subtitle={`${integration.name} · ${ENVIRONMENT_LABELS[integration.environment]} connection`}
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex max-w-xl flex-col gap-4">
        <Callout size="compact" surface="info" icon={LockKey} tone="blue">
          Values are write-only. After saving, Firmivra shows only a masked hint, never the full
          value. The current connection stays in use until you save.
        </Callout>
        {secrets.length ? (
          secrets.map((field) => (
            <div key={field.key} className="flex flex-col gap-1">
              <Input
                id={idOf(field.key)}
                label={field.label}
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                placeholder={field.prefix ? `${field.prefix[integration.environment]}…` : ''}
                value={values[field.key] ?? ''}
                error={errors[field.key]}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
              <p className="text-xs text-muted">
                {field.display
                  ? `Saved: ${field.display}${field.updatedAt ? ` · updated ${formatDateTime(field.updatedAt)}` : ''}. Leave empty to keep it.`
                  : 'Not set yet.'}
                {field.hint ? ` ${field.hint}` : ''}
              </p>
            </div>
          ))
        ) : (
          <QuietLine>
            {integration.connection.oauth
              ? 'This provider connects with OAuth: use Reconnect to sign in again.'
              : 'This provider has no secret fields.'}
          </QuietLine>
        )}
        {formError ? (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        ) : null}
        {save.isError ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(save.error)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!secrets.length || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save Credentials'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Non-secret connection fields (base URL, account ID, region) ----------

export function ConnectionFieldsDialog({
  integration,
  onClose,
  onDone,
  onReload,
}: {
  integration: PlatformIntegrationDetail;
  onClose: () => void;
  onDone: (text: string) => void;
  onReload: () => void;
}) {
  const plain = integration.connection.fields.filter((field) => !field.secret);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(plain.map((field) => [field.key, field.display ?? ''])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useApiMutation(
    (connection: Record<string, string>) =>
      adminIntegrations.updatePlatform(integration.id, {
        version: integration.version,
        connection,
      }),
    { invalidate: ['admin-integrations'] },
  );
  const idOf = (key: string) => `connection-${key}`;

  function submit(event: FormEvent) {
    event.preventDefault();
    const next: Record<string, string> = {};
    for (const field of plain) {
      const value = (values[field.key] ?? '').trim();
      if (field.required && !value) next[field.key] = `Enter the ${field.label.toLowerCase()}.`;
      else if (field.kind === 'url') {
        const problem = urlProblem(value, field.label.toLowerCase());
        if (problem) next[field.key] = problem;
      } else if (value.length > 200) next[field.key] = 'Keep it to 200 characters.';
    }
    setErrors(next);
    if (Object.keys(next).length) {
      focusFirst(plain.filter((field) => next[field.key]).map((field) => idOf(field.key)));
      return;
    }
    const changed = Object.fromEntries(
      plain
        .map((field) => [field.key, (values[field.key] ?? '').trim()] as const)
        .filter(([key, value]) => value !== (plain.find((f) => f.key === key)?.display ?? '')),
    );
    if (!Object.keys(changed).length) {
      onClose();
      return;
    }
    save.mutate(changed, { onSuccess: () => onDone('Connection settings saved.') });
  }

  return (
    <Modal
      open
      title="Edit Connection Settings"
      subtitle={`${integration.name}: endpoints and account details (not secrets)`}
      onClose={onClose}
    >
      <form noValidate onSubmit={submit} className="flex max-w-xl flex-col gap-4">
        {plain.map((field) => (
          <div key={field.key} className="flex flex-col gap-1">
            <Input
              id={idOf(field.key)}
              label={`${field.label}${field.required ? ' (required)' : ''}`}
              type={field.kind === 'url' ? 'url' : 'text'}
              placeholder={field.placeholder}
              value={values[field.key] ?? ''}
              error={errors[field.key]}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.key]: event.target.value }))
              }
            />
            {field.hint ? <p className="text-xs text-muted">{field.hint}</p> : null}
          </div>
        ))}
        {save.isError ? <SaveError error={save.error} onReload={onReload} /> : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Integration details (name, category, descriptions, links) ----------

interface DetailsForm {
  name: string;
  category: IntegrationCategory;
  description: string;
  longDescription: string;
  websiteUrl: string;
  docsUrl: string;
}
type DetailsErrors = Partial<Record<keyof DetailsForm, string>>;

function checkDetails(form: DetailsForm): DetailsErrors {
  const errors: DetailsErrors = {};
  if (!form.name.trim()) errors.name = 'Enter the integration name.';
  else if (form.name.trim().length > NAME_MAX)
    errors.name = `Keep the name to ${NAME_MAX} characters.`;
  if (!form.description.trim()) errors.description = 'Enter a short description.';
  else if (form.description.trim().length > SHORT_DESCRIPTION_MAX)
    errors.description = `Keep it to ${SHORT_DESCRIPTION_MAX} characters.`;
  if (form.longDescription.trim().length > DESCRIPTION_MAX)
    errors.longDescription = `Keep it to ${DESCRIPTION_MAX} characters.`;
  const website = urlProblem(form.websiteUrl, 'provider website');
  if (website) errors.websiteUrl = website;
  const docs = urlProblem(form.docsUrl, 'documentation URL');
  if (docs) errors.docsUrl = docs;
  return errors;
}

export function EditDetailsDialog({
  integration,
  onClose,
  onDone,
  onReload,
}: {
  integration: PlatformIntegrationDetail;
  onClose: () => void;
  onDone: (text: string) => void;
  onReload: () => void;
}) {
  const [form, setForm] = useState<DetailsForm>({
    name: integration.name,
    category: integration.category,
    description: integration.description,
    longDescription: integration.longDescription ?? '',
    websiteUrl: integration.websiteUrl ?? '',
    docsUrl: integration.docsUrl ?? '',
  });
  const [errors, setErrors] = useState<DetailsErrors>({});
  const save = useApiMutation(
    (body: DetailsForm) =>
      adminIntegrations.updatePlatform(integration.id, {
        version: integration.version,
        name: body.name.trim(),
        category: body.category,
        description: body.description.trim(),
        longDescription: body.longDescription.trim() || null,
        websiteUrl: body.websiteUrl.trim() || null,
        docsUrl: body.docsUrl.trim() || null,
      }),
    { invalidate: ['admin-integrations'] },
  );
  const set = (patch: Partial<DetailsForm>) => setForm((current) => ({ ...current, ...patch }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = checkDetails(form);
    setErrors(next);
    const order: (keyof DetailsForm)[] = [
      'name',
      'description',
      'longDescription',
      'websiteUrl',
      'docsUrl',
    ];
    const invalid = order.filter((key) => next[key]);
    if (invalid.length) {
      focusFirst(invalid.map((key) => `details-${key}`));
      return;
    }
    save.mutate(form, { onSuccess: () => onDone('Integration details saved.') });
  }

  return (
    <Modal open title="Edit Integration Details" subtitle={integration.name} onClose={onClose}>
      <form noValidate onSubmit={submit} className="grid max-w-2xl gap-4 sm:grid-cols-2">
        <Input
          id="details-name"
          label="Integration Name"
          required
          maxLength={NAME_MAX}
          value={form.name}
          error={errors.name}
          onChange={(event) => set({ name: event.target.value })}
        />
        <Select
          label="Category"
          value={form.category}
          options={CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
          onChange={(event) =>
            set({
              category: CATEGORIES.find((value) => value === event.target.value) ?? form.category,
            })
          }
        />
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Textarea
            id="details-description"
            label="Short Description"
            required
            rows={2}
            maxLength={SHORT_DESCRIPTION_MAX}
            value={form.description}
            error={errors.description}
            onChange={(event) => set({ description: event.target.value })}
          />
          <p className="text-right text-xs text-muted tabular-nums">
            {form.description.length}/{SHORT_DESCRIPTION_MAX}
          </p>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <Textarea
            id="details-longDescription"
            label="Detailed Description (optional)"
            rows={3}
            maxLength={DESCRIPTION_MAX}
            value={form.longDescription}
            error={errors.longDescription}
            onChange={(event) => set({ longDescription: event.target.value })}
          />
          <p className="text-right text-xs text-muted tabular-nums">
            {form.longDescription.length}/{DESCRIPTION_MAX}
          </p>
        </div>
        <Input
          id="details-websiteUrl"
          label="Provider Website"
          type="url"
          placeholder="https://"
          value={form.websiteUrl}
          error={errors.websiteUrl}
          onChange={(event) => set({ websiteUrl: event.target.value })}
        />
        <Input
          id="details-docsUrl"
          label="Documentation"
          type="url"
          placeholder="https://"
          value={form.docsUrl}
          error={errors.docsUrl}
          onChange={(event) => set({ docsUrl: event.target.value })}
        />
        {save.isError ? (
          <div className="sm:col-span-2">
            <SaveError error={save.error} onReload={onReload} />
          </div>
        ) : null}
        <div className="flex justify-end gap-3 sm:col-span-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// ---------- Environment switch ----------

export function EnvironmentDialog({
  integration,
  onClose,
  onDone,
  onReload,
}: {
  integration: PlatformIntegrationDetail;
  onClose: () => void;
  onDone: (text: string) => void;
  onReload: () => void;
}) {
  const target = integration.environment === 'LIVE' ? 'TEST' : 'LIVE';
  const configured = integration.connection.fields.some((field) => field.display !== null);
  const [understood, setUnderstood] = useState(!configured);
  const change = useApiMutation(
    () =>
      adminIntegrations.updatePlatform(integration.id, {
        version: integration.version,
        environment: target,
        confirmEnvironmentChange: true,
      }),
    { invalidate: ['admin-integrations'] },
  );
  return (
    <Modal
      open
      title={`Switch to ${ENVIRONMENT_LABELS[target]}?`}
      subtitle={integration.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!understood || change.isPending}
            onClick={() =>
              change.mutate(undefined, {
                onSuccess: () =>
                  onDone(
                    `${integration.name} now uses its ${ENVIRONMENT_LABELS[target]} connection. Enter its credentials, then test the connection.`,
                  ),
              })
            }
          >
            {change.isPending ? 'Switching…' : `Switch to ${ENVIRONMENT_LABELS[target]}`}
          </Button>
        </>
      }
    >
      <div className="flex max-w-lg flex-col gap-4 text-sm text-text">
        <p className="flex flex-wrap items-center gap-2">
          <EnvironmentBadge environment={integration.environment} />
          <span aria-hidden>→</span>
          <EnvironmentBadge environment={target} />
        </p>
        {configured ? (
          <Callout
            size="compact"
            surface="warning"
            icon={Warning}
            tone="amber"
            title="The saved credentials are cleared"
          >
            Live and test credentials never mix, so Firmivra clears the{' '}
            {ENVIRONMENT_LABELS[integration.environment].toLowerCase()} credentials. The integration
            needs attention until you enter the {ENVIRONMENT_LABELS[target].toLowerCase()}{' '}
            credentials and the connection test passes.
          </Callout>
        ) : (
          <p>No credentials are saved yet, so nothing is cleared.</p>
        )}
        {configured ? (
          <Checkbox
            label="I understand that the saved credentials are cleared."
            checked={understood}
            onChange={(event) => setUnderstood(event.target.checked)}
          />
        ) : null}
        {change.isError ? <SaveError error={change.error} onReload={onReload} /> : null}
      </div>
    </Modal>
  );
}

// ---------- Log record drawer (Sync History and Error Logs drill-down) ----------

export function LogDrawer({
  logId,
  integrationId,
  onClose,
}: {
  logId: string;
  integrationId: string;
  onClose: () => void;
}) {
  const record = useApiQuery(['admin-integrations', 'logs', 'record', logId], () =>
    adminIntegrations.getLog(logId),
  );
  return (
    <Drawer
      open
      title="Log Record"
      subtitle={record.data?.log.action}
      onClose={onClose}
      footer={
        <>
          <Link
            href={logsHref(integrationId)}
            className="inline-flex min-h-11 items-center rounded-control px-3 text-sm font-semibold text-link hover:underline"
          >
            Open Integration Logs
          </Link>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <Loaded query={record} rows={6}>
        {({ log, related }) => (
          <div data-testid="log-record" className="flex flex-col gap-5">
            <p className="flex flex-wrap items-center gap-2">
              <LogSeverityBadge severity={log.severity} />
              <OutcomeBadge succeeded={log.succeeded} />
            </p>
            <p className="text-sm text-heading">{log.message}</p>
            <DetailRows
              rows={[
                {
                  label: 'Time',
                  value: <time dateTime={log.at}>{formatDateTime(log.at)}</time>,
                },
                { label: 'Event type', value: <code>{log.eventType}</code> },
                { label: 'Error code', value: log.errorCode ?? 'None' },
                {
                  label: 'Request ID',
                  value: log.requestId ? (
                    <span className="flex items-center gap-2">
                      <code className="wrap-anywhere">{log.requestId}</code>
                      <CopyButton value={log.requestId} label="Copy request ID" />
                    </span>
                  ) : (
                    'None'
                  ),
                },
                {
                  label: 'Correlation ID',
                  value: log.correlationId ? <code>{log.correlationId}</code> : 'None',
                },
                {
                  label: 'Environment',
                  value: log.environment ? ENVIRONMENT_LABELS[log.environment] : 'N/A',
                },
                { label: 'Actor', value: log.actor.name },
                ...(log.endpoint ? [{ label: 'Endpoint', value: log.endpoint }] : []),
              ]}
            />
            <section aria-label="Details" className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-heading">Details</h3>
              {log.details.length ? (
                <ul className="flex flex-col gap-1 text-sm">
                  {log.details.map((row) => (
                    <li key={row.label} className="wrap-anywhere">
                      <span className="text-muted">{row.label}:</span> {row.value}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No further details.</p>
              )}
            </section>
            <section aria-label="Related events" className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-heading">Related events</h3>
              {related.length ? (
                <ul className="flex flex-col gap-2 text-sm">
                  {related.map((item) => (
                    <li key={item.id} className="flex flex-col">
                      <span className="text-heading">{item.message}</span>
                      <time dateTime={item.at} className="text-xs text-muted">
                        {formatDateTime(item.at)}
                      </time>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No other events share its correlation ID.</p>
              )}
            </section>
            {log.resolution ? (
              <p className="text-sm">
                <Badge tone="info">Next step</Badge>{' '}
                <span className="text-text">{log.resolution.label}</span>
              </p>
            ) : null}
          </div>
        )}
      </Loaded>
    </Drawer>
  );
}
