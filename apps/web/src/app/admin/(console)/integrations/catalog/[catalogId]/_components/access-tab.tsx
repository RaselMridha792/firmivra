'use client';

import {
  Badge,
  Button,
  Checkbox,
  IconButton,
  Input,
  Radio,
  Select,
  Table,
  type Column,
} from '@firmivra/ui';
import { Trash } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useApiMutation } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  catalogVisibility,
  REQUIRED_ROLE_LABELS,
  REQUIRED_ROLES,
  type CatalogFirmRule,
  type CatalogItem,
  type FirmAccess,
  type FirmOption,
  type PlanAccess,
  type PlanOption,
} from '../../../_components/integrations-contract';
import { formatDateTime } from '../../../_components/integration-format';
import { loadError, QuietLine, SkeletonLines } from '../../../_components/integration-states';
import type { Notice } from '../../../_components/platform-actions';
import { AccessLossDialog, catalogErrorMessage } from '../../_components/catalog-parts';
import { isAccessLoss } from '../../_components/catalog-status';
import type { Draft } from './catalog-draft';
import { controlClass, EditCard, Field, helpId } from './edit-parts';
import type { TabProps } from './general-tab';

/**
 * Access & Permissions (docx §7): all plans or selected plans (names from the plan
 * configuration), the firm role a connection needs, firm-level Allow or Deny overrides with a
 * reason (they save at once, win over the plan, and are audited), and a firm preview that applies
 * the documented order to the choices on the page.
 */

const PLAN_CHOICES: { value: PlanAccess; label: string; hint: string }[] = [
  { value: 'ALL_PLANS', label: 'All plans', hint: 'Every firm can see it, whatever its plan.' },
  { value: 'SELECTED_PLANS', label: 'Selected plans', hint: 'Only firms on the plans you choose.' },
];

type FirmChange =
  | { kind: 'put'; businessId: string; access: FirmAccess; reason: string }
  | { kind: 'delete'; businessId: string };

/** Hidden, visible or connectable for one firm, and why (R0-stage-b8, "Who sees"). */
function explain(
  entry: Pick<Draft, 'status' | 'planAccess' | 'planIds'> & { firmRules: CatalogFirmRule[] },
  firm: FirmOption,
): { tone: 'neutral' | 'purple' | 'success'; label: string; text: string } {
  const visibility = catalogVisibility(entry, { id: firm.id, planId: firm.planId });
  if (entry.status === 'DISABLED')
    return { tone: 'neutral', label: 'Hidden', text: 'The entry is Disabled, so no firm sees it.' };
  const rule = entry.firmRules.find((item) => item.businessId === firm.id);
  if (rule?.access === 'DENY')
    return { tone: 'neutral', label: 'Hidden', text: 'This firm has a Deny override.' };
  let why: string;
  if (rule?.access === 'ALLOW') why = 'This firm has an Allow override, whatever its plan.';
  else if (entry.planAccess === 'ALL_PLANS') why = 'The entry is on all plans.';
  else if (firm.planId !== null && entry.planIds.includes(firm.planId))
    why = `The firm's plan, ${firm.planName}, is selected.`;
  else
    return {
      tone: 'neutral',
      label: 'Hidden',
      text: `The firm's plan, ${firm.planName}, is not selected.`,
    };
  return visibility === 'VISIBLE'
    ? { tone: 'purple', label: 'Visible, not connectable', text: `${why} It shows as Coming Soon.` }
    : { tone: 'success', label: 'Can connect', text: `${why} The firm can connect it.` };
}

export function AccessTab({
  draft,
  set,
  errorFor,
  locked,
  item,
  plans,
  firms,
  dirty,
  onNotice,
  onVersion,
}: TabProps & {
  item: CatalogItem;
  plans: UseQueryResult<PlanOption[]>;
  firms: UseQueryResult<FirmOption[]>;
  dirty: boolean;
  onNotice: (notice: Notice) => void;
  /** An override saved: the entry's new version, so the form saves on top of it. */
  onVersion: (version: number) => void;
}) {
  const [firmId, setFirmId] = useState('');
  const [access, setAccess] = useState<FirmAccess>('ALLOW');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<{ field: 'firm' | 'reason'; text: string } | null>(
    null,
  );
  const [asking, setAsking] = useState<FirmChange | null>(null);
  const [previewFirm, setPreviewFirm] = useState('');
  const change = useApiMutation(
    ({ change: next, confirm }: { change: FirmChange; confirm: boolean }) =>
      next.kind === 'put'
        ? adminIntegrations.putCatalogFirm(item.id, next.businessId, {
            access: next.access,
            reason: next.reason,
            confirmAccessLoss: confirm || undefined,
          })
        : adminIntegrations.deleteCatalogFirm(item.id, next.businessId, {
            confirmAccessLoss: confirm || undefined,
          }),
    { invalidate: ['admin-integrations'] },
  );
  const firmName = (id: string) =>
    item.firmRules.find((rule) => rule.businessId === id)?.firmName ??
    firms.data?.find((firm) => firm.id === id)?.name ??
    'this firm';

  function send(next: FirmChange, confirm: boolean) {
    change.mutate(
      { change: next, confirm },
      {
        onSuccess: (saved) => {
          setAsking(null);
          onVersion(saved.version);
          if (next.kind === 'put') {
            setFirmId('');
            setReason('');
            setAccess('ALLOW');
          }
          onNotice({
            tone: 'success',
            text:
              next.kind === 'put'
                ? `${firmName(next.businessId)}: ${next.access === 'ALLOW' ? 'Allow' : 'Deny'} override saved.`
                : `${firmName(next.businessId)}: override removed. The plan access decides again.`,
          });
        },
        onError: (error) => {
          if (isAccessLoss(error) && !confirm) {
            setAsking(next);
            return;
          }
          setAsking(null);
          onNotice({ tone: 'error', text: catalogErrorMessage(error) });
        },
      },
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!firmId) {
      setFormError({ field: 'firm', text: 'Choose a firm.' });
      requestAnimationFrame(() => document.getElementById('override-firm')?.focus());
      return;
    }
    const text = reason.trim();
    if (!text || text.length > 300) {
      setFormError({
        field: 'reason',
        text: text ? 'Keep the reason to 300 characters.' : 'Enter the reason for this override.',
      });
      requestAnimationFrame(() => document.getElementById('override-reason')?.focus());
      return;
    }
    setFormError(null);
    send({ kind: 'put', businessId: firmId, access, reason: text }, false);
  }

  const ruleColumns: Column<CatalogFirmRule>[] = [
    {
      id: 'firm',
      label: 'Firm',
      cell: (rule) => <span className="font-semibold text-heading">{rule.firmName}</span>,
    },
    { id: 'plan', label: 'Plan', cell: (rule) => rule.planName },
    {
      id: 'access',
      label: 'Access',
      cell: (rule) => (
        <Badge tone={rule.access === 'ALLOW' ? 'success' : 'danger'} dot>
          {rule.access === 'ALLOW' ? 'Allow' : 'Deny'}
        </Badge>
      ),
    },
    {
      id: 'reason',
      label: 'Reason',
      className: 'min-w-40',
      cell: (rule) => rule.reason ?? <span className="text-muted">None given</span>,
    },
    {
      id: 'updated',
      label: 'Updated',
      cell: (rule) => (
        <span className="flex flex-col">
          <time dateTime={rule.updatedAt} className="whitespace-nowrap">
            {formatDateTime(rule.updatedAt)}
          </time>
          <span className="text-xs text-muted">{rule.updatedBy}</span>
        </span>
      ),
    },
  ];

  const previewed = firms.data?.find((firm) => firm.id === previewFirm);
  const result = previewed
    ? explain(
        {
          status: draft.status,
          planAccess: draft.planAccess,
          planIds: draft.planIds,
          firmRules: item.firmRules,
        },
        previewed,
      )
    : null;
  const firmOptions = (firms.data ?? []).map((firm) => ({
    value: firm.id,
    label: `${firm.name} (${firm.planName})`,
  }));

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <EditCard
        testId="access-permissions"
        title="Access & Permissions"
        subtitle="Who can see and connect this integration. A firm's own override wins over its plan."
      >
        <fieldset
          id="edit-plans"
          tabIndex={-1}
          aria-describedby={errorFor('edit-plans') ? helpId('edit-plans') : undefined}
          className="flex min-w-0 flex-col gap-1"
        >
          <legend className="text-sm font-medium text-heading">Plan Access</legend>
          {PLAN_CHOICES.map((choice) => (
            <div key={choice.value} className="flex flex-col">
              <Radio
                name="plan-access"
                label={choice.label}
                value={choice.value}
                checked={draft.planAccess === choice.value}
                disabled={locked}
                aria-describedby={`plan-access-${choice.value}`}
                className="font-semibold text-heading"
                onChange={() => set({ planAccess: choice.value })}
              />
              <p id={`plan-access-${choice.value}`} className="-mt-2 pl-7 text-xs text-muted">
                {choice.hint}
              </p>
            </div>
          ))}
          <div className="mt-2 pl-7">
            {plans.isPending ? (
              <SkeletonLines rows={2} label="Loading plans" />
            ) : plans.isError ? (
              <QuietLine>{loadError(plans.error)}</QuietLine>
            ) : (
              <div className="grid gap-x-4 sm:grid-cols-2 xl:grid-cols-3">
                {plans.data.map((plan) => (
                  <Checkbox
                    key={plan.id}
                    label={plan.name}
                    disabled={locked || draft.planAccess === 'ALL_PLANS'}
                    checked={draft.planAccess === 'ALL_PLANS' || draft.planIds.includes(plan.id)}
                    onChange={(event) =>
                      set({
                        planIds: event.target.checked
                          ? [...new Set([...draft.planIds, plan.id])]
                          : draft.planIds.filter((id) => id !== plan.id),
                      })
                    }
                  />
                ))}
              </div>
            )}
            <p className="text-xs text-muted">
              Plan names come from the subscription configuration.
            </p>
          </div>
          {errorFor('edit-plans') ? (
            <p id={helpId('edit-plans')} className="text-xs text-danger">
              {errorFor('edit-plans')}
            </p>
          ) : null}
        </fieldset>
        <div className="max-w-md">
          <Field
            id="edit-role"
            label="Required Role"
            hint="The firm role a user needs to connect it."
          >
            <select
              id="edit-role"
              className={controlClass()}
              value={draft.requiredRole}
              disabled={locked}
              aria-describedby={helpId('edit-role')}
              onChange={(event) =>
                set({
                  requiredRole:
                    REQUIRED_ROLES.find((role) => role === event.target.value) ??
                    draft.requiredRole,
                })
              }
            >
              {REQUIRED_ROLES.map((role) => (
                <option key={role} value={role}>
                  {REQUIRED_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </EditCard>

      <EditCard
        testId="firm-overrides"
        title="Firm Overrides"
        subtitle="Allow or deny one firm, whatever its plan. Overrides save right away and go to the audit log."
      >
        {item.firmRules.length ? (
          <Table
            caption="Firm overrides"
            rows={item.firmRules}
            columns={ruleColumns}
            rowKey={(rule) => rule.businessId}
            showPagination={false}
            rowActions={(rule) => (
              <IconButton
                icon={Trash}
                label={`Remove the override for ${rule.firmName}`}
                tone="danger"
                disabled={locked || change.isPending}
                onClick={() => send({ kind: 'delete', businessId: rule.businessId }, false)}
              />
            )}
          />
        ) : (
          <QuietLine>No firm overrides: the plan access decides for every firm.</QuietLine>
        )}
        <form
          noValidate
          onSubmit={submit}
          aria-label="Add a firm override"
          className="grid gap-4 rounded-lg border border-divider bg-subtle p-4 lg:grid-cols-2"
        >
          <Select
            id="override-firm"
            label="Firm"
            value={firmId}
            disabled={locked || !firms.data}
            error={formError?.field === 'firm' ? formError.text : undefined}
            options={[
              {
                value: '',
                label: firms.isError
                  ? 'Firms could not load'
                  : firms.isPending
                    ? 'Loading firms…'
                    : 'Choose a firm',
              },
              ...firmOptions,
            ]}
            onChange={(event) => setFirmId(event.target.value)}
          />
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium text-text">Access</legend>
            <div className="flex flex-wrap gap-x-6">
              <Radio
                name="override-access"
                label="Allow"
                checked={access === 'ALLOW'}
                disabled={locked}
                onChange={() => setAccess('ALLOW')}
              />
              <Radio
                name="override-access"
                label="Deny"
                checked={access === 'DENY'}
                disabled={locked}
                onChange={() => setAccess('DENY')}
              />
            </div>
          </fieldset>
          <div className="lg:col-span-2">
            <Input
              id="override-reason"
              label="Reason"
              required
              maxLength={300}
              value={reason}
              disabled={locked}
              placeholder="Why this firm is treated differently"
              error={formError?.field === 'reason' ? formError.text : undefined}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
          <div className="flex justify-end lg:col-span-2">
            <Button type="submit" disabled={locked || change.isPending}>
              {change.isPending ? 'Saving…' : 'Save Override'}
            </Button>
          </div>
        </form>
      </EditCard>

      <EditCard
        testId="firm-preview"
        title="Firm Preview"
        subtitle={`How one firm sees this entry${dirty ? ' with the unsaved choices on this page' : ''}.`}
      >
        <div className="max-w-md">
          <Select
            label="Firm"
            value={previewFirm}
            disabled={!firms.data}
            options={[{ value: '', label: 'Choose a firm to preview' }, ...firmOptions]}
            onChange={(event) => setPreviewFirm(event.target.value)}
          />
        </div>
        {result && previewed ? (
          <div
            data-testid="firm-preview-result"
            aria-live="polite"
            className="flex flex-col gap-2 text-sm"
          >
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-heading">{previewed.name}</span>
              <Badge tone={result.tone}>{result.label}</Badge>
            </p>
            <p className="text-text">{result.text}</p>
          </div>
        ) : (
          <QuietLine>
            Choose a firm to see whether it can see and connect this integration.
          </QuietLine>
        )}
      </EditCard>

      {asking ? (
        <AccessLossDialog
          name={item.name}
          firms={null}
          change="this override is saved"
          busy={change.isPending}
          onCancel={() => setAsking(null)}
          onConfirm={() => send(asking, true)}
        />
      ) : null}
    </div>
  );
}
