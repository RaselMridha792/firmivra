'use client';

import type {
  IntegrationConnectionDetail,
  IntegrationOptionField,
  IntegrationSyncDirection,
  IntegrationSyncMode,
  UpdateIntegrationSettingsRequest,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input, Radio, Select, Toggle } from '@firmivra/ui';
import { Database } from '@phosphor-icons/react';
import { useState } from 'react';
import { api } from '../../../../../../../lib/api';
import { useApiMutation } from '../../../../../../../lib/query';
import {
  CardTitle,
  EmptyLine,
  entityIcons,
  formatDirection,
  formatFrequency,
} from '../../_components/manage-integration-shared';
import { integrationError, ManageShell, Notice } from '../../_components/manage-shell';
import { CustomSetup } from './custom-setup';

/**
 * Sync Settings (the spec's Manage tabs: frequency, direction and the objects to sync, plus the
 * provider's own options). The choices come from the provider's definition, never from the
 * screen; a direction that an enabled object cannot use is offered but disabled. Saving sends
 * only the fields that changed (PATCH .../settings). A `custom_api` connection also shows its
 * Custom API & Webhooks setup.
 */

type OptionValue = boolean | string | string[];
interface Draft {
  syncMode: IntegrationSyncMode;
  syncEveryMinutes: number | null;
  direction: IntegrationSyncDirection;
  entities: string[];
  options: Record<string, OptionValue>;
}

const draftOf = (detail: IntegrationConnectionDetail): Draft => ({
  syncMode: detail.syncMode,
  syncEveryMinutes: detail.syncEveryMinutes,
  direction: detail.direction,
  entities: detail.entities,
  options: detail.options,
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (values: string[]) => [...values].sort();

/** The fields of the draft that differ from what is saved. */
function changesOf(saved: Draft, draft: Draft): UpdateIntegrationSettingsRequest | null {
  const body: Record<string, unknown> = {};
  if (draft.syncMode !== saved.syncMode) body['syncMode'] = draft.syncMode;
  const every = draft.syncMode === 'AUTO' ? draft.syncEveryMinutes : null;
  if (every !== saved.syncEveryMinutes) body['syncEveryMinutes'] = every;
  if (draft.direction !== saved.direction) body['direction'] = draft.direction;
  if (!same(sorted(draft.entities), sorted(saved.entities))) body['entities'] = draft.entities;
  if (!same(draft.options, saved.options)) body['options'] = draft.options;
  return Object.keys(body).length ? (body as UpdateIntegrationSettingsRequest) : null;
}

export function SyncSettingsTab({ integrationId }: { integrationId: string }) {
  return (
    <ManageShell integrationId={integrationId} current="/sync-settings" testId="sync-settings-tab">
      {(detail) => (detail ? <SettingsForm key={detail.id} detail={detail} /> : <SettingsFrames />)}
    </ManageShell>
  );
}

/** The cards with quiet lines while the connection is loading or cannot be read. */
function SettingsFrames() {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card data-testid="sync-schedule" className="p-5!">
        <CardTitle>Sync Schedule</CardTitle>
        <EmptyLine>The schedule shows when the integration loads.</EmptyLine>
      </Card>
      <Card data-testid="sync-objects" className="p-5!">
        <CardTitle>Data to Sync</CardTitle>
        <EmptyLine>The objects this provider can sync show here.</EmptyLine>
      </Card>
      <Card data-testid="provider-options" className="p-5!">
        <CardTitle>Provider Options</CardTitle>
        <EmptyLine>The provider&apos;s own options show here.</EmptyLine>
      </Card>
    </div>
  );
}

function SettingsForm({ detail }: { detail: IntegrationConnectionDetail }) {
  const saved = draftOf(detail);
  const [draft, setDraft] = useState<Draft>(saved);
  const [problem, setProblem] = useState<string | null>(null);
  const save = useApiMutation(
    (body: UpdateIntegrationSettingsRequest) => api.integrations.updateSettings(detail.id, body),
    { invalidate: ['integrations'] },
  );
  const { provider } = detail;
  const canEdit = detail.canManage && !save.isPending;
  const set = (patch: Partial<Draft>) => {
    setProblem(null);
    save.reset();
    setDraft((current) => ({ ...current, ...patch }));
  };
  const enabled = provider.entities.filter((e) => draft.entities.includes(e.key));
  /** A direction every enabled object supports (and the provider). */
  const supported = (direction: IntegrationSyncDirection) =>
    provider.directions.includes(direction) &&
    enabled.every((e) => e.directions.includes(direction));
  const changes = changesOf(saved, draft);

  function submit() {
    if (!changes) return;
    if (!supported(draft.direction)) {
      setProblem(`${formatDirection(draft.direction)} is not supported by every selected object.`);
      return;
    }
    if (draft.syncMode === 'AUTO' && !draft.syncEveryMinutes) {
      setProblem('Choose how often to sync automatically.');
      return;
    }
    save.mutate(changes);
  }

  return (
    <div className="flex flex-col gap-4">
      {save.isError ? <Notice tone="error">{integrationError(save.error)}</Notice> : null}
      {save.isSuccess ? <Notice tone="success">Sync settings saved.</Notice> : null}
      {problem ? <Notice tone="error">{problem}</Notice> : null}
      {!detail.canManage ? (
        <Notice tone="error">You can view these settings; changing them needs edit access.</Notice>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card data-testid="sync-schedule" className="p-5!">
          <CardTitle>Sync Schedule</CardTitle>
          <fieldset className="flex flex-col gap-1" disabled={!canEdit}>
            <legend className="text-sm font-medium text-heading">Sync mode</legend>
            <Radio
              name="sync-mode"
              label="Automatic: sync on a schedule"
              checked={draft.syncMode === 'AUTO'}
              disabled={!provider.frequencies.length}
              onChange={() =>
                set({
                  syncMode: 'AUTO',
                  syncEveryMinutes: draft.syncEveryMinutes ?? provider.frequencies[0] ?? null,
                })
              }
            />
            <Radio
              name="sync-mode"
              label="Manual: only when someone selects Sync Now"
              checked={draft.syncMode === 'MANUAL'}
              onChange={() => set({ syncMode: 'MANUAL' })}
            />
          </fieldset>
          <div className="mt-3 flex flex-col gap-3">
            <Select
              label="Sync frequency"
              value={draft.syncMode === 'AUTO' ? String(draft.syncEveryMinutes ?? '') : ''}
              disabled={!canEdit || draft.syncMode !== 'AUTO'}
              onChange={(event) => set({ syncEveryMinutes: Number(event.target.value) || null })}
              options={[
                ...(draft.syncMode === 'AUTO' ? [] : [{ value: '', label: 'Manual' }]),
                ...provider.frequencies.map((minutes) => ({
                  value: String(minutes),
                  label: formatFrequency(minutes),
                })),
              ]}
            />
            <Select
              label="Sync direction"
              value={draft.direction}
              disabled={!canEdit}
              onChange={(event) =>
                set({
                  direction:
                    provider.directions.find((d) => d === event.target.value) ?? draft.direction,
                })
              }
              options={provider.directions.map((direction) => ({
                value: direction,
                label: supported(direction)
                  ? formatDirection(direction)
                  : `${formatDirection(direction)} (not for every selected object)`,
              }))}
            />
            {!provider.frequencies.length ? (
              <EmptyLine>This provider syncs only when someone selects Sync Now.</EmptyLine>
            ) : null}
          </div>
        </Card>

        <Card data-testid="sync-objects" className="p-5!">
          <CardTitle>Data to Sync</CardTitle>
          {provider.entities.length ? (
            <ul className="flex flex-col divide-y divide-divider border-y border-divider">
              {provider.entities.map((entity) => {
                const Glyph = entityIcons[entity.key] ?? Database;
                return (
                  // The Overview's Sync Data row: box, icon, name, what it holds.
                  <li
                    key={entity.key}
                    className="grid grid-cols-[1.25rem_1.25rem_minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-2 py-1.5"
                  >
                    <Checkbox
                      label={entity.label}
                      checked={draft.entities.includes(entity.key)}
                      disabled={!canEdit}
                      className="min-h-0! [&>span]:sr-only"
                      onChange={(event) =>
                        set({
                          entities: event.target.checked
                            ? [...draft.entities, entity.key]
                            : draft.entities.filter((key) => key !== entity.key),
                        })
                      }
                    />
                    <Glyph aria-hidden weight="fill" className="size-5 text-heading" />
                    <span aria-hidden className="text-sm leading-tight text-heading">
                      {entity.label}
                    </span>
                    <span className="text-xs leading-tight text-text">{entity.description}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyLine>This provider has no objects to choose.</EmptyLine>
          )}
        </Card>

        <Card data-testid="provider-options" className="p-5!">
          <CardTitle>Provider Options</CardTitle>
          {provider.options.length ? (
            <div className="flex flex-col gap-4">
              {provider.options.map((option) => (
                <OptionControl
                  key={option.key}
                  option={option}
                  value={draft.options[option.key] ?? option.defaultValue ?? null}
                  disabled={!canEdit}
                  onChange={(value) => set({ options: { ...draft.options, [option.key]: value } })}
                />
              ))}
            </div>
          ) : (
            <EmptyLine>This provider has no options of its own.</EmptyLine>
          )}
        </Card>
      </div>

      {provider.provider === 'custom_api' ? (
        <CustomSetup connectionId={detail.id} canManage={detail.canManage} />
      ) : null}

      <div className="flex flex-wrap justify-end gap-3">
        <Button
          variant="secondary"
          disabled={!changes || save.isPending}
          onClick={() => {
            setProblem(null);
            save.reset();
            setDraft(saved);
          }}
        >
          Reset
        </Button>
        <Button disabled={!canEdit || !changes} onClick={submit}>
          {save.isPending ? 'Saving…' : 'Save Sync Settings'}
        </Button>
      </div>
    </div>
  );
}

function OptionControl({
  option,
  value,
  disabled,
  onChange,
}: {
  option: IntegrationOptionField;
  value: OptionValue | null;
  disabled: boolean;
  onChange: (value: OptionValue) => void;
}) {
  const help = option.help ? <p className="text-xs text-muted">{option.help}</p> : null;
  if (option.type === 'TOGGLE')
    return (
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-heading">{option.label}</p>
          {help}
        </div>
        <Toggle
          label={option.label}
          checked={value === true}
          disabled={disabled}
          onChange={onChange}
        />
      </div>
    );
  if (option.type === 'SELECT')
    return (
      <div className="flex flex-col gap-1">
        <Select
          label={option.label}
          value={typeof value === 'string' ? value : ''}
          disabled={disabled || !option.choices.length}
          onChange={(event) => onChange(event.target.value)}
          options={[{ value: '', label: 'Not set' }, ...option.choices]}
        />
        {help}
      </div>
    );
  if (option.type === 'MULTI_SELECT') {
    const values = Array.isArray(value) ? value : [];
    return (
      <fieldset className="flex flex-col" disabled={disabled}>
        <legend className="text-sm font-medium text-heading">{option.label}</legend>
        {help}
        {option.choices.length ? (
          option.choices.map((choice) => (
            <Checkbox
              key={choice.value}
              label={choice.label}
              checked={values.includes(choice.value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...values, choice.value]
                    : values.filter((item) => item !== choice.value),
                )
              }
            />
          ))
        ) : (
          <EmptyLine>The provider has no choices for this yet.</EmptyLine>
        )}
      </fieldset>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <Input
        label={option.label}
        value={typeof value === 'string' ? value : ''}
        maxLength={500}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
      {help}
    </div>
  );
}
