'use client';

import { Button, Callout, Checkbox, Modal } from '@firmivra/ui';
import { FileText, Plugs, Power, Warning } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { useApiMutation } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  ENVIRONMENT_LABELS,
  type ConnectionTestResult,
  type PlatformIntegration,
} from '../../../../../../../mocks/admin-integrations';
import { integrationErrorMessage } from '../../../_components/integration-states';
import { logsHref } from '../../../_components/integrations-shell';
import { TestResult } from './test-result';

/**
 * Activate (docx §4 step 4): a draft becomes Active only after a passing connection test. Without
 * one, the dialog asks for it first (and runs it here); a provider with no test endpoint needs
 * the admin's explicit confirmation instead. A failed activation leaves the draft and writes an
 * error log, linked from the message. Success is audited by the API.
 */
export function ActivateDialog({
  integration,
  onClose,
  onActivated,
}: {
  integration: PlatformIntegration;
  onClose: () => void;
  onActivated: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<ConnectionTestResult | null>(null);
  const test = useApiMutation(() => adminIntegrations.testPlatform(integration.id), {
    invalidate: ['admin-integrations'],
  });
  const activate = useApiMutation(
    () =>
      adminIntegrations.activatePlatform(
        integration.id,
        integration.supportsTest ? {} : { confirmWithoutTest: true },
      ),
    { invalidate: ['admin-integrations'] },
  );

  const { name, supportsTest } = integration;
  const environment = ENVIRONMENT_LABELS[integration.environment];
  const passed = result ? result.ok : integration.lastCheckOk === true;
  const needsTest = supportsTest && !passed;
  const busy = test.isPending || activate.isPending;

  const title = needsTest
    ? 'Test the connection first'
    : supportsTest
      ? `Activate ${name}?`
      : 'Activate without a connection test?';

  return (
    <Modal
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          {needsTest ? (
            <Button
              disabled={busy}
              onClick={() => test.mutate(undefined, { onSuccess: (outcome) => setResult(outcome) })}
            >
              <Plugs aria-hidden weight="fill" className="size-4" />
              {test.isPending ? 'Testing…' : 'Test Connection'}
            </Button>
          ) : (
            <Button
              disabled={busy || (!supportsTest && !confirmed)}
              onClick={() => activate.mutate(undefined, { onSuccess: onActivated })}
            >
              <Power aria-hidden weight="fill" className="size-4" />
              {activate.isPending ? 'Activating…' : 'Activate Integration'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex max-w-xl flex-col gap-4" data-testid="activate-dialog">
        {needsTest ? (
          <p className="text-sm text-text">
            Activation needs a passing connection test, and {name} has not passed one with its
            current credentials. Run the test now; you can activate it as soon as it passes.
          </p>
        ) : supportsTest ? (
          <p className="text-sm text-text">
            The connection test passed. Firmivra starts using {name} ({environment}) right away:
            scheduled syncs and calls begin. The activation is added to the audit log.
          </p>
        ) : (
          <>
            <p className="text-sm text-text">
              {name} has no test endpoint, so Firmivra can&apos;t check the connection itself.
              Activate it only after you have checked it in the provider&apos;s console. Firmivra
              records that it was activated without a test.
            </p>
            <Checkbox
              label="I checked the connection and want to activate it."
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
          </>
        )}

        {integration.environment === 'LIVE' && !needsTest ? (
          <Callout
            size="compact"
            surface="warning"
            icon={Warning}
            tone="amber"
            title="Live environment"
          >
            <span>
              It works with production data and real accounts from the moment it is active.
            </span>
          </Callout>
        ) : null}

        {supportsTest && (result || needsTest) ? (
          <TestResult
            integration={integration}
            result={result}
            retrying={test.isPending}
            onRetry={() => test.mutate(undefined, { onSuccess: (outcome) => setResult(outcome) })}
          />
        ) : null}

        {activate.isError ? (
          <div role="alert" className="flex flex-col gap-1 text-sm text-danger">
            <p>{integrationErrorMessage(activate.error)} The integration is still a draft.</p>
            <Link
              href={logsHref(integration.id)}
              className="inline-flex w-fit items-center gap-1.5 font-semibold text-link hover:underline"
            >
              <FileText aria-hidden weight="fill" className="size-4" />
              View Log
            </Link>
          </div>
        ) : test.isError ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(test.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
