'use client';

import { Button, Callout, Drawer, Input, Select, Textarea } from '@firmivra/ui';
import { Info } from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  adminIntegrations,
  CATEGORIES,
  CATEGORY_LABELS,
  ENVIRONMENT_LABELS,
  NAME_MAX,
  SHORT_DESCRIPTION_MAX,
  type IntegrationCategory,
} from '../../../../../../mocks/admin-integrations';
import { catalogErrorMessage, urlProblem } from './catalog-parts';

/**
 * Add to Catalog (docx §6): a new customer-facing entry, optionally started from a provider
 * definition (docx §15). It starts Disabled, so no firm sees it until it is enabled; saving opens
 * the entry's edit page for access, setup and display.
 */

interface AddForm {
  template: string;
  provider: string;
  name: string;
  category: IntegrationCategory;
  shortDescription: string;
  websiteUrl: string;
  helpUrl: string;
  platformIntegrationId: string;
}
type AddErrors = Partial<Record<keyof AddForm, string>>;
const EMPTY: AddForm = {
  template: '',
  provider: '',
  name: '',
  category: 'OTHER',
  shortDescription: '',
  websiteUrl: '',
  helpUrl: '',
  platformIntegrationId: '',
};
const FIELD_ORDER: (keyof AddForm)[] = [
  'provider',
  'name',
  'shortDescription',
  'websiteUrl',
  'helpUrl',
];
const PROVIDER_KEY = /^[a-z0-9_]{2,40}$/;

function check(form: AddForm): AddErrors {
  const errors: AddErrors = {};
  if (!form.provider.trim()) errors.provider = 'Enter the provider key.';
  else if (!PROVIDER_KEY.test(form.provider.trim()))
    errors.provider = 'Use 2 to 40 lowercase letters, numbers or underscores.';
  if (!form.name.trim()) errors.name = 'Enter the integration name.';
  else if (form.name.trim().length > NAME_MAX)
    errors.name = `Keep the name to ${NAME_MAX} characters.`;
  if (!form.shortDescription.trim()) errors.shortDescription = 'Enter a short description.';
  else if (form.shortDescription.trim().length > SHORT_DESCRIPTION_MAX)
    errors.shortDescription = `Keep it to ${SHORT_DESCRIPTION_MAX} characters.`;
  const website = urlProblem(form.websiteUrl, 'website URL');
  if (website) errors.websiteUrl = website;
  const help = urlProblem(form.helpUrl, 'help URL');
  if (help) errors.helpUrl = help;
  return errors;
}

export function AddCatalogDrawer({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const providers = useApiQuery(['admin-integrations', 'providers'], () =>
    adminIntegrations.providers(),
  );
  const platform = useApiQuery(['admin-integrations', 'platform', 'list', 'catalog-picker'], () =>
    adminIntegrations.listPlatform({ sort: 'name', pageSize: 100 }),
  );
  const [form, setForm] = useState<AddForm>(EMPTY);
  const [errors, setErrors] = useState<AddErrors>({});
  const create = useApiMutation(
    (body: AddForm) =>
      adminIntegrations.createCatalog({
        provider: body.provider.trim(),
        name: body.name.trim(),
        category: body.category,
        shortDescription: body.shortDescription.trim(),
        websiteUrl: body.websiteUrl.trim() || null,
        helpUrl: body.helpUrl.trim() || null,
        platformIntegrationId: body.platformIntegrationId || null,
      }),
    { invalidate: ['admin-integrations'] },
  );
  const set = (patch: Partial<AddForm>) => setForm((current) => ({ ...current, ...patch }));
  const services = (platform.data?.items ?? []).filter((item) => item.status !== 'REMOVED');
  const templates = (providers.data ?? []).filter((item) => item.key !== 'custom');

  function pickTemplate(key: string) {
    const template = templates.find((item) => item.key === key);
    if (!template) {
      set({ template: '' });
      return;
    }
    const linked =
      services.find((item) => item.provider === key && item.environment === 'LIVE') ??
      services.find((item) => item.provider === key);
    setForm({
      template: key,
      provider: key,
      name: template.name,
      category: template.category,
      shortDescription: template.description,
      websiteUrl: template.websiteUrl ?? '',
      helpUrl: template.docsUrl ?? '',
      platformIntegrationId: linked?.id ?? '',
    });
    setErrors({});
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const next = check(form);
    setErrors(next);
    const first = FIELD_ORDER.find((key) => next[key]);
    if (first) {
      requestAnimationFrame(() => document.getElementById(`add-${first}`)?.focus());
      return;
    }
    create.mutate(form, {
      onSuccess: (item) => router.push(`/integrations/catalog/${encodeURIComponent(item.id)}`),
    });
  }

  return (
    <Drawer
      open
      title="Add to Catalog"
      subtitle="A customer-facing entry firms can discover and connect."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-catalog-form" disabled={create.isPending}>
            {create.isPending ? 'Adding…' : 'Add to Catalog'}
          </Button>
        </>
      }
    >
      <form
        id="add-catalog-form"
        noValidate
        onSubmit={submit}
        aria-label="New catalog integration"
        className="flex flex-col gap-4"
      >
        <Callout size="compact" surface="info" icon={Info} tone="blue">
          New entries start Disabled: no firm sees it until you enable it. You set plan access,
          setup and display on the next page.
        </Callout>
        <Select
          label="Start From"
          value={form.template}
          disabled={!providers.data}
          options={[
            { value: '', label: providers.isError ? 'Templates could not load' : 'A blank entry' },
            ...templates.map((item) => ({ value: item.key, label: item.name })),
          ]}
          onChange={(event) => pickTemplate(event.target.value)}
        />
        <div className="flex flex-col gap-1">
          <Input
            id="add-provider"
            label="Provider Key"
            required
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            value={form.provider}
            error={errors.provider}
            onChange={(event) => set({ provider: event.target.value })}
          />
          <p className="text-xs text-muted">
            Matches the provider of the firms&apos; own connections. It never changes after saving.
          </p>
        </div>
        <Input
          id="add-name"
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
        <div className="flex flex-col gap-1">
          <Textarea
            id="add-shortDescription"
            label="Short Description"
            required
            rows={3}
            maxLength={SHORT_DESCRIPTION_MAX}
            value={form.shortDescription}
            error={errors.shortDescription}
            onChange={(event) => set({ shortDescription: event.target.value })}
          />
          <p className="text-right text-xs text-muted tabular-nums">
            {form.shortDescription.length}/{SHORT_DESCRIPTION_MAX}
          </p>
        </div>
        <Input
          id="add-websiteUrl"
          label="Website URL"
          type="url"
          placeholder="https://"
          value={form.websiteUrl}
          error={errors.websiteUrl}
          onChange={(event) => set({ websiteUrl: event.target.value })}
        />
        <Input
          id="add-helpUrl"
          label="Help or Documentation URL"
          type="url"
          placeholder="https://"
          value={form.helpUrl}
          error={errors.helpUrl}
          onChange={(event) => set({ helpUrl: event.target.value })}
        />
        <Select
          label="Relies on Platform Integration"
          value={form.platformIntegrationId}
          disabled={!platform.data}
          options={[
            {
              value: '',
              label: platform.isError
                ? 'Platform integrations could not load'
                : 'None: firms connect their own accounts',
            },
            ...services.map((item) => ({
              value: item.id,
              label: `${item.name} (${ENVIRONMENT_LABELS[item.environment]})`,
            })),
          ]}
          onChange={(event) => set({ platformIntegrationId: event.target.value })}
        />
        {create.isError ? (
          <p role="alert" className="text-sm text-danger">
            {catalogErrorMessage(create.error)}
          </p>
        ) : null}
      </form>
    </Drawer>
  );
}
