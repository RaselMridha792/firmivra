'use client';

import { ActionMenu, Button, Callout, Checkbox, Input, Modal, Textarea } from '@firmivra/ui';
import {
  ArrowSquareOut,
  DotsThreeVertical,
  FileText,
  PencilSimple,
  Plugs,
  Power,
  Prohibit,
  Trash,
  Warning,
  type Icon,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  adminIntegrations,
  CATALOG_STATUS_LABELS,
  type PlatformIntegration,
} from './integrations-contract';
import { integrationErrorMessage, Loaded } from './integration-states';
import { LinkButton, logsHref, platformHref, setupHref } from './integrations-shell';

/**
 * A platform integration's row actions (docx §3 Overflow menu), shared by the dashboard and the
 * platform list: Manage (or Continue Setup for a draft) and a menu with View Logs, Test
 * Connection, Disable or Enable, and Remove. Lifecycle actions confirm first and show their impact;
 * removing a critical service needs its name typed (docx §5, §12). Results go to `onNotice`.
 */

export interface Notice {
  tone: 'success' | 'error';
  text: string;
}
type Lifecycle = 'disable' | 'enable' | 'remove';

const RUNNING = ['ACTIVE', 'INACTIVE', 'NEEDS_ATTENTION', 'ERROR'];

export function PlatformActions({
  integration,
  canLifecycle = true,
  onNotice,
}: {
  integration: PlatformIntegration;
  /** Disable, enable and remove are Super Admin only; without the right they are not offered. */
  canLifecycle?: boolean;
  onNotice: (notice: Notice) => void;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Lifecycle | null>(null);
  const test = useApiMutation((id: string) => adminIntegrations.testPlatform(id), {
    invalidate: ['admin-integrations'],
  });
  const { id, name, status } = integration;
  const draft = status === 'DRAFT';

  function runTest() {
    test.mutate(id, {
      onSuccess: (result) =>
        onNotice({ tone: result.ok ? 'success' : 'error', text: `${name}: ${result.message}` }),
      onError: (error) => onNotice({ tone: 'error', text: integrationErrorMessage(error) }),
    });
  }

  const items: { label: string; icon: Icon; onSelect: () => void; danger?: boolean }[] = [
    draft
      ? {
          label: 'Continue Setup',
          icon: PencilSimple,
          onSelect: () => router.push(setupHref(integration)),
        }
      : {
          label: 'Open Integration',
          icon: ArrowSquareOut,
          onSelect: () => router.push(platformHref(id)),
        },
    { label: 'View Logs', icon: FileText, onSelect: () => router.push(logsHref(id)) },
  ];
  if (integration.supportsTest && !draft && status !== 'REMOVED')
    items.push({
      label: test.isPending ? 'Testing…' : 'Test Connection',
      icon: Plugs,
      onSelect: runTest,
    });
  if (canLifecycle && RUNNING.includes(status))
    items.push({ label: 'Disable', icon: Prohibit, onSelect: () => setDialog('disable') });
  if (canLifecycle && status === 'DISABLED')
    items.push({ label: 'Enable', icon: Power, onSelect: () => setDialog('enable') });
  if (canLifecycle && status !== 'REMOVED')
    items.push({ label: 'Remove', icon: Trash, danger: true, onSelect: () => setDialog('remove') });

  return (
    <>
      <LinkButton href={draft ? setupHref(integration) : platformHref(id)} size="sm">
        {draft ? 'Continue' : 'Manage'}
        <span className="sr-only"> {name}</span>
      </LinkButton>
      <ActionMenu
        label={`More actions for ${name}`}
        trigger={<DotsThreeVertical aria-hidden weight="bold" className="size-4" />}
        sections={[{ items }]}
      />
      {dialog ? (
        <LifecycleDialog
          integration={integration}
          kind={dialog}
          onClose={() => setDialog(null)}
          onDone={(text) => {
            setDialog(null);
            onNotice({ tone: 'success', text });
          }}
        />
      ) : null}
    </>
  );
}

const COPY: Record<Lifecycle, { title: string; button: string; text: string }> = {
  disable: {
    title: 'Disable',
    button: 'Disable Integration',
    text: 'Firmivra stops its scheduled jobs and new calls. The configuration is kept, and nothing restarts until someone enables it again.',
  },
  enable: {
    title: 'Enable',
    button: 'Enable Integration',
    text: 'Firmivra resumes its scheduled jobs and calls. Test the connection after enabling it.',
  },
  remove: {
    title: 'Remove',
    button: 'Remove Integration',
    text: 'This permanently removes the connection and revokes its credentials. The record is kept as Removed for the audit trail. This cannot be undone.',
  },
};

/** The confirmation for disable, enable or remove, with what depends on the integration. */
export function LifecycleDialog({
  integration,
  kind,
  onClose,
  onDone,
}: {
  integration: PlatformIntegration;
  kind: Lifecycle;
  onClose: () => void;
  /** The success message for the page's toast. */
  onDone: (text: string) => void;
}) {
  const [reason, setReason] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [typed, setTyped] = useState('');
  const detail = useApiQuery(['admin-integrations', 'platform', integration.id], () =>
    adminIntegrations.getPlatform(integration.id),
  );
  const change = useApiMutation(
    () =>
      kind === 'disable'
        ? adminIntegrations.disablePlatform(integration.id, { reason: reason.trim() || undefined })
        : kind === 'enable'
          ? adminIntegrations.enablePlatform(integration.id)
          : adminIntegrations.removePlatform(integration.id, { confirmation: typed.trim() }),
    { invalidate: ['admin-integrations'] },
  );
  const copy = COPY[kind];
  const typedOk = !integration.critical || typed.trim() === integration.name;
  const ready = kind !== 'remove' || (understood && typedOk);

  return (
    <Modal
      open
      title={`${copy.title} ${integration.name}?`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready || change.isPending}
            onClick={() =>
              change.mutate(undefined, {
                onSuccess: () =>
                  onDone(
                    kind === 'disable'
                      ? `${integration.name} was disabled.`
                      : kind === 'enable'
                        ? `${integration.name} was enabled. Test the connection to confirm it works.`
                        : `${integration.name} was removed and its credentials revoked.`,
                  ),
              })
            }
          >
            {change.isPending ? 'Saving…' : copy.button}
          </Button>
        </>
      }
    >
      <div className="flex max-w-lg flex-col gap-4">
        <p className="text-sm text-text">{copy.text}</p>
        {kind !== 'enable' ? (
          <Loaded query={detail} rows={1}>
            {(data) =>
              data.dependents.catalog.length || data.dependents.webhooks.length ? (
                <Callout
                  size="compact"
                  surface="warning"
                  icon={Warning}
                  tone="amber"
                  title="Customer-facing features depend on it"
                >
                  <ul className="list-disc pl-5">
                    {data.dependents.catalog.map((entry) => (
                      <li key={entry.id}>
                        Catalog: {entry.name} ({CATALOG_STATUS_LABELS[entry.status]})
                      </li>
                    ))}
                    {data.dependents.webhooks.map((hook) => (
                      <li key={hook.id} className="wrap-anywhere">
                        Webhook: {hook.url}
                      </li>
                    ))}
                  </ul>
                </Callout>
              ) : (
                <p className="text-sm text-muted">No catalog entries or webhooks depend on it.</p>
              )
            }
          </Loaded>
        ) : null}
        {kind === 'disable' ? (
          <Textarea
            label="Reason (optional)"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        ) : null}
        {kind === 'remove' ? (
          <>
            <Checkbox
              label="I understand that this cannot be undone."
              checked={understood}
              onChange={(event) => setUnderstood(event.target.checked)}
            />
            {integration.critical ? (
              <Input
                label={`${integration.name} is critical infrastructure. Type its name to confirm.`}
                value={typed}
                autoComplete="off"
                onChange={(event) => setTyped(event.target.value)}
              />
            ) : null}
          </>
        ) : null}
        {change.isError ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(change.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
