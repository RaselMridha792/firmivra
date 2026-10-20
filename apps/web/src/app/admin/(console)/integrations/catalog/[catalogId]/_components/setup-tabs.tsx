'use client';

import { Badge, Button, Callout, Checkbox, IconButton, Input, Toggle } from '@firmivra/ui';
import { Plus, ShieldWarning, Trash } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CATALOG_AUTH_TYPES,
  CATEGORY_LABELS,
  ENVIRONMENT_LABELS,
  STATUS_LABELS,
  type Page,
  type PlatformIntegration,
} from '../../../_components/integrations-contract';
import { ServiceLogo } from '../../../_components/integration-badges';
import { CATALOG_AUTH_LABELS, OutlineButton } from '../../_components/catalog-parts';
import {
  DEPRECATION_MAX,
  DISPLAY_LABEL_MAX,
  HELP_TEXT_MAX,
  INSTRUCTIONS_MAX,
  listOf,
  type SetupFieldDraft,
} from './catalog-draft';
import { controlClass, EditCard, Field, helpId } from './edit-parts';
import type { TabProps } from './general-tab';

/**
 * Customer Setup, Display & Branding and Advanced (docx §7): how firms connect (instructions,
 * required fields, help, the test on connect; never Super Admin secrets), how the entry looks in
 * the firms' catalog (label, badges, help link, order, with a live card preview), and the
 * technical controls (feature flag, beta, deprecation, version, rollout, regions, the platform
 * integration it relies on).
 */

/** aria props for a control with a help or error line under it. */
const described = (id: string, error: string | undefined) => ({
  'aria-invalid': error ? true : undefined,
  'aria-describedby': helpId(id),
});

export function SetupTab({ draft, set, errorFor, locked }: TabProps) {
  const [nextRow, setNextRow] = useState(1);
  const updateField = (uid: string, patch: Partial<SetupFieldDraft>) =>
    set({
      requiredFields: draft.requiredFields.map((field) =>
        field.uid === uid ? { ...field, ...patch } : field,
      ),
    });
  const instructionsError = errorFor('edit-instructions');
  const helpError = errorFor('edit-help-text');
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <EditCard
        testId="customer-setup"
        title="Customer Setup"
        subtitle="The connection experience firms see when they add this integration."
      >
        <Callout size="compact" surface="warning" icon={ShieldWarning} tone="amber">
          Firms read these instructions. Never include Firmivra keys, secrets or internal links.
        </Callout>
        <div className="max-w-md">
          <Field id="edit-auth" label="How Firms Connect">
            <select
              id="edit-auth"
              className={controlClass()}
              value={draft.authType}
              disabled={locked}
              onChange={(event) =>
                set({
                  authType:
                    CATALOG_AUTH_TYPES.find((type) => type === event.target.value) ??
                    draft.authType,
                })
              }
            >
              {CATALOG_AUTH_TYPES.map((type) => (
                <option key={type} value={type}>
                  {CATALOG_AUTH_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field
          id="edit-instructions"
          label="Setup Instructions"
          error={instructionsError}
          counter={`${draft.instructions.length}/${INSTRUCTIONS_MAX}`}
        >
          <textarea
            id="edit-instructions"
            rows={5}
            maxLength={INSTRUCTIONS_MAX}
            className={controlClass(instructionsError)}
            value={draft.instructions}
            disabled={locked}
            {...described('edit-instructions', instructionsError)}
            onChange={(event) => set({ instructions: event.target.value })}
          />
        </Field>
        <Field
          id="edit-help-text"
          label="Help Text"
          error={helpError}
          counter={`${draft.helpText.length}/${HELP_TEXT_MAX}`}
        >
          <textarea
            id="edit-help-text"
            rows={2}
            maxLength={HELP_TEXT_MAX}
            className={controlClass(helpError)}
            value={draft.helpText}
            disabled={locked}
            {...described('edit-help-text', helpError)}
            onChange={(event) => set({ helpText: event.target.value })}
          />
        </Field>
        <Checkbox
          label="Test the connection when a firm connects"
          checked={draft.testOnConnect}
          disabled={locked}
          onChange={(event) => set({ testOnConnect: event.target.checked })}
        />
      </EditCard>

      <EditCard
        testId="required-fields"
        title="Required Fields"
        subtitle="What a firm enters when it connects. Secret fields stay hidden as they type."
        action={
          <OutlineButton
            disabled={locked}
            onClick={() => {
              set({
                requiredFields: [
                  ...draft.requiredFields,
                  {
                    uid: `new-${nextRow}`,
                    key: '',
                    label: '',
                    secret: false,
                    required: true,
                    help: '',
                  },
                ],
              });
              setNextRow(nextRow + 1);
            }}
          >
            <Plus aria-hidden weight="bold" className="size-4" />
            Add Field
          </OutlineButton>
        }
      >
        {draft.requiredFields.length ? (
          <ul className="flex flex-col gap-4">
            {draft.requiredFields.map((field, position) => {
              const keyError = errorFor(`edit-field-${field.uid}-key`);
              return (
                <li
                  key={field.uid}
                  aria-label={`Field ${position + 1}`}
                  className="grid gap-3 rounded-lg border border-divider p-4 lg:grid-cols-12 lg:items-start"
                >
                  <div className="lg:col-span-3">
                    <Input
                      id={`edit-field-${field.uid}-key`}
                      label="Key"
                      value={field.key}
                      maxLength={40}
                      disabled={locked}
                      error={keyError}
                      onChange={(event) => updateField(field.uid, { key: event.target.value })}
                    />
                  </div>
                  <div className="lg:col-span-3">
                    <Input
                      label="Label"
                      value={field.label}
                      maxLength={60}
                      disabled={locked}
                      onChange={(event) => updateField(field.uid, { label: event.target.value })}
                    />
                  </div>
                  <div className="lg:col-span-4">
                    <Input
                      label="Help (optional)"
                      value={field.help}
                      maxLength={120}
                      disabled={locked}
                      onChange={(event) => updateField(field.uid, { help: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 lg:col-span-2 lg:flex-col lg:items-start">
                    <Checkbox
                      label="Secret"
                      checked={field.secret}
                      disabled={locked}
                      onChange={(event) => updateField(field.uid, { secret: event.target.checked })}
                    />
                    <Checkbox
                      label="Required"
                      checked={field.required}
                      disabled={locked}
                      onChange={(event) =>
                        updateField(field.uid, { required: event.target.checked })
                      }
                    />
                    <IconButton
                      icon={Trash}
                      tone="danger"
                      label={`Remove field ${field.label || position + 1}`}
                      disabled={locked}
                      onClick={() =>
                        set({
                          requiredFields: draft.requiredFields.filter(
                            (item) => item.uid !== field.uid,
                          ),
                        })
                      }
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            No fields: firms sign in with the provider or need nothing extra.
          </p>
        )}
      </EditCard>
    </div>
  );
}

const CONNECT_LABELS = {
  ENABLED: 'Connect',
  COMING_SOON: 'Coming Soon',
  DISABLED: 'Not available',
} as const;

export function DisplayTab({ draft, set, errorFor, locked }: TabProps) {
  const labelError = errorFor('edit-display-label');
  const badgesError = errorFor('edit-badges');
  const helpError = errorFor('edit-help-url');
  const orderError = errorFor('edit-order');
  const badges = listOf(draft.badges);
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <EditCard
        testId="display-branding"
        title="Display & Branding"
        subtitle="How the entry looks in the firms' catalog. The logo, category and descriptions are on the General tab."
      >
        <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
          <Field
            id="edit-display-label"
            label="Display Label"
            error={labelError}
            hint="A shorter name for the catalog card. The integration name shows when it is empty."
            counter={`${draft.displayLabel.length}/${DISPLAY_LABEL_MAX}`}
          >
            <input
              id="edit-display-label"
              maxLength={DISPLAY_LABEL_MAX}
              className={controlClass(labelError)}
              value={draft.displayLabel}
              disabled={locked}
              {...described('edit-display-label', labelError)}
              onChange={(event) => set({ displayLabel: event.target.value })}
            />
          </Field>
          <Field
            id="edit-badges"
            label="Badges"
            error={badgesError}
            hint="Up to 5, separated by commas, such as Popular, New."
          >
            <input
              id="edit-badges"
              className={controlClass(badgesError)}
              value={draft.badges}
              disabled={locked}
              {...described('edit-badges', badgesError)}
              onChange={(event) => set({ badges: event.target.value })}
            />
          </Field>
          <Field
            id="edit-help-url"
            label="Help / Documentation URL"
            error={helpError}
            hint="The setup guide firms open from the catalog."
          >
            <input
              id="edit-help-url"
              type="url"
              inputMode="url"
              placeholder="https://"
              className={controlClass(helpError)}
              value={draft.helpUrl}
              disabled={locked}
              {...described('edit-help-url', helpError)}
              onChange={(event) => set({ helpUrl: event.target.value })}
            />
          </Field>
          <Field
            id="edit-order"
            label="Catalog Order"
            error={orderError}
            hint="Lower numbers show first."
          >
            <input
              id="edit-order"
              type="number"
              inputMode="numeric"
              min={0}
              className={controlClass(orderError)}
              value={draft.sortOrder}
              disabled={locked}
              {...described('edit-order', orderError)}
              onChange={(event) => set({ sortOrder: event.target.value })}
            />
          </Field>
        </div>
      </EditCard>
      <EditCard
        testId="card-preview"
        title="Catalog Card Preview"
        subtitle="With the changes on this page, before they are saved."
      >
        <article className="flex max-w-md flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-card">
          <div className="flex items-start gap-3">
            <ServiceLogo category={draft.category} />
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="text-lg font-bold text-heading">
                {draft.displayLabel.trim() || draft.name.trim() || 'Untitled integration'}
              </h3>
              <p className="text-xs text-muted">{CATEGORY_LABELS[draft.category]}</p>
            </div>
          </div>
          {badges.length || draft.beta ? (
            <ul aria-label="Badges" className="flex flex-wrap gap-1.5">
              {badges.map((badge) => (
                <li key={badge}>
                  <Badge tone="info">{badge}</Badge>
                </li>
              ))}
              {draft.beta && !badges.includes('Beta') ? (
                <li>
                  <Badge tone="purple">Beta</Badge>
                </li>
              ) : null}
            </ul>
          ) : null}
          <p className="text-sm text-text">{draft.shortDescription}</p>
          <div>
            <Button disabled={draft.status !== 'ENABLED'} tabIndex={-1} title="Preview only">
              {CONNECT_LABELS[draft.status]}
              <span className="sr-only"> (preview only)</span>
            </Button>
          </div>
        </article>
      </EditCard>
    </div>
  );
}

export function AdvancedTab({
  draft,
  set,
  errorFor,
  locked,
  platform,
}: TabProps & { platform: UseQueryResult<Page<PlatformIntegration>> }) {
  const flagError = errorFor('edit-flag');
  const deprecationError = errorFor('edit-deprecation');
  const versionError = errorFor('edit-min-version');
  const rolloutError = errorFor('edit-rollout');
  const regionsError = errorFor('edit-regions');
  const services = (platform.data?.items ?? []).filter(
    (item) => item.status !== 'REMOVED' || item.id === draft.platformIntegrationId,
  );
  return (
    <EditCard
      testId="advanced"
      title="Advanced"
      subtitle="Technical and rollout controls. They change how the catalog behaves for firms."
    >
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        <Field
          id="edit-flag"
          label="Feature Flag"
          error={flagError}
          hint="Firms see the entry only while this flag is on."
        >
          <input
            id="edit-flag"
            maxLength={60}
            spellCheck={false}
            className={controlClass(flagError)}
            value={draft.featureFlag}
            disabled={locked}
            {...described('edit-flag', flagError)}
            onChange={(event) => set({ featureFlag: event.target.value })}
          />
        </Field>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span id="edit-beta-label" className="text-sm font-medium text-heading">
            Beta Label
          </span>
          <span className="flex min-h-11 items-center gap-3 text-sm text-text">
            <Toggle
              label="Beta label"
              aria-describedby="edit-beta-label"
              checked={draft.beta}
              disabled={locked}
              onChange={(on) => set({ beta: on })}
            />
            Shows a Beta badge in the catalog.
          </span>
        </div>
        <div className="sm:col-span-2">
          <Field
            id="edit-deprecation"
            label="Deprecation Notice"
            error={deprecationError}
            counter={`${draft.deprecationNotice.length}/${DEPRECATION_MAX}`}
          >
            <textarea
              id="edit-deprecation"
              rows={2}
              maxLength={DEPRECATION_MAX}
              className={controlClass(deprecationError)}
              value={draft.deprecationNotice}
              disabled={locked}
              {...described('edit-deprecation', deprecationError)}
              onChange={(event) => set({ deprecationNotice: event.target.value })}
            />
          </Field>
        </div>
        <Field
          id="edit-min-version"
          label="Minimum App Version"
          error={versionError}
          hint="As 1.2 or 1.2.3. Empty: every version."
        >
          <input
            id="edit-min-version"
            spellCheck={false}
            className={controlClass(versionError)}
            value={draft.minAppVersion}
            disabled={locked}
            {...described('edit-min-version', versionError)}
            onChange={(event) => set({ minAppVersion: event.target.value })}
          />
        </Field>
        <Field
          id="edit-rollout"
          label="Rollout Percentage"
          error={rolloutError}
          hint="The share of eligible firms that see it, from 0 to 100."
        >
          <input
            id="edit-rollout"
            type="number"
            inputMode="numeric"
            min={0}
            max={100}
            className={controlClass(rolloutError)}
            value={draft.rolloutPercent}
            disabled={locked}
            {...described('edit-rollout', rolloutError)}
            onChange={(event) => set({ rolloutPercent: event.target.value })}
          />
        </Field>
        <Field
          id="edit-regions"
          label="Regions"
          error={regionsError}
          hint="Two-letter state codes, separated by commas. Empty: everywhere."
        >
          <input
            id="edit-regions"
            spellCheck={false}
            className={controlClass(regionsError)}
            value={draft.regions}
            disabled={locked}
            {...described('edit-regions', regionsError)}
            onChange={(event) => set({ regions: event.target.value })}
          />
        </Field>
        <Field
          id="edit-platform"
          label="Relies on Platform Integration"
          hint="The Firmivra service behind it. Its health never decides catalog availability."
        >
          <select
            id="edit-platform"
            className={controlClass()}
            value={draft.platformIntegrationId}
            disabled={locked || !platform.data}
            aria-describedby={helpId('edit-platform')}
            onChange={(event) => set({ platformIntegrationId: event.target.value })}
          >
            <option value="">
              {platform.isError
                ? 'Platform integrations could not load'
                : 'None: firms connect their own accounts'}
            </option>
            {services.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} ({ENVIRONMENT_LABELS[item.environment]}, {STATUS_LABELS[item.status]})
              </option>
            ))}
          </select>
        </Field>
      </div>
    </EditCard>
  );
}
