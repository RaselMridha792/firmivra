'use client';

import { Button, FileDropzone, Modal } from '@firmivra/ui';
import { CloudArrowUp, Image as ImageIcon, Trash } from '@phosphor-icons/react';
import type { UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { errorCode } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';
import {
  adminIntegrations,
  CATEGORIES,
  CATEGORY_LABELS,
  DESCRIPTION_MAX,
  ENVIRONMENT_LABELS,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  NAME_MAX,
  SHORT_DESCRIPTION_MAX,
  type IntegrationEnvironment,
  type LogoFile,
  type PlatformIntegration,
  type ProviderTemplate,
  type UpdatePlatformBody,
} from '../../../_components/integrations-contract';
import { formatBytes } from '../../../_components/integration-format';
import { integrationErrorMessage } from '../../../_components/integration-states';
import {
  AreaField,
  ChoiceGroup,
  ErrorSummary,
  focusFirst,
  SelectField,
  TextField,
  UrlField,
  urlProblem,
  type FieldError,
} from './wizard-fields';
import {
  DraftGate,
  furthest,
  savedHref,
  stepHref,
  useDraft,
  useProviders,
  WizardFrame,
} from './wizard-frame';

/**
 * Step 1, General Information (firmivra-integration-setup-dashboard.jpg; docx §4 step 1): name,
 * category and short description (required), detailed description, logo, provider website and
 * documentation URL (optional). Added above them: the provider, which loads its template's
 * connection fields on step 2, and the environment, which the credentials' prefixes depend on.
 * Continue creates the draft (or saves it) and opens Connection Details.
 */

const SUBTITLE = 'Enter the basic details about this integration.';
const ID = {
  provider: 'wiz-provider',
  environment: 'wiz-environment',
  name: 'wiz-name',
  category: 'wiz-category',
  description: 'wiz-description',
  longDescription: 'wiz-long-description',
  logo: 'wiz-logo',
  websiteUrl: 'wiz-website',
  docsUrl: 'wiz-docs',
} as const;

type Mode = 'continue' | 'draft';

interface ServiceValues {
  /** A template key, or '' for a custom provider (named after the integration). */
  provider: string;
  name: string;
  category: string;
  description: string;
  longDescription: string;
  logo: LogoFile | null;
  websiteUrl: string;
  docsUrl: string;
  environment: IntegrationEnvironment;
}

function valuesOf(draft: PlatformIntegration | null): ServiceValues {
  if (!draft)
    return {
      provider: '',
      name: '',
      category: '',
      description: '',
      longDescription: '',
      logo: null,
      websiteUrl: '',
      docsUrl: '',
      // Least privilege (docx §4): Test unless chosen.
      environment: 'TEST',
    };
  return {
    provider: draft.provider,
    name: draft.name,
    category: draft.category,
    description: draft.description,
    longDescription: draft.longDescription ?? '',
    logo: draft.logo,
    websiteUrl: draft.websiteUrl ?? '',
    docsUrl: draft.docsUrl ?? '',
    environment: draft.environment,
  };
}

const categoryOf = (value: string) => CATEGORIES.find((item) => item === value);

/** The step's checks, top to bottom, with the mock's own limits and messages. */
function problemsOf(values: ServiceValues): FieldError[] {
  const list: FieldError[] = [];
  const add = (id: string, message: string) => list.push({ id, message });
  const name = values.name.trim();
  if (!name) add(ID.name, 'Enter the integration name.');
  else if (name.length > NAME_MAX)
    add(ID.name, `Keep the integration name to ${NAME_MAX} characters.`);
  if (!categoryOf(values.category)) add(ID.category, 'Choose a category.');
  const description = values.description.trim();
  if (!description) add(ID.description, 'Enter the short description.');
  else if (description.length > SHORT_DESCRIPTION_MAX)
    add(ID.description, `Keep the short description to ${SHORT_DESCRIPTION_MAX} characters.`);
  if (values.longDescription.trim().length > DESCRIPTION_MAX)
    add(ID.longDescription, `Keep the detailed description to ${DESCRIPTION_MAX} characters.`);
  const website = urlProblem(values.websiteUrl, 'provider website');
  if (website) add(ID.websiteUrl, website);
  const docs = urlProblem(values.docsUrl, 'documentation URL');
  if (docs) add(ID.docsUrl, docs);
  return list;
}

const sameLogo = (a: LogoFile | null, b: LogoFile | null) =>
  a?.fileName === b?.fileName && a?.sizeBytes === b?.sizeBytes && a?.contentType === b?.contentType;

/** What changed against the saved draft (only those fields are sent and audited). */
function changesOf(
  draft: PlatformIntegration,
  values: ServiceValues,
): Omit<UpdatePlatformBody, 'version'> {
  const body: Omit<UpdatePlatformBody, 'version'> = {};
  const name = values.name.trim();
  if (name !== draft.name) body.name = name;
  const category = categoryOf(values.category);
  if (category && category !== draft.category) body.category = category;
  const description = values.description.trim();
  if (description !== draft.description) body.description = description;
  const longDescription = values.longDescription.trim() || null;
  if (longDescription !== draft.longDescription) body.longDescription = longDescription;
  if (!sameLogo(values.logo, draft.logo)) body.logo = values.logo;
  const websiteUrl = values.websiteUrl.trim() || null;
  if (websiteUrl !== draft.websiteUrl) body.websiteUrl = websiteUrl;
  const docsUrl = values.docsUrl.trim() || null;
  if (docsUrl !== draft.docsUrl) body.docsUrl = docsUrl;
  if (values.environment !== draft.environment) body.environment = values.environment;
  return body;
}

/** Replaces a value the previous provider filled in (or an empty one); keeps what was typed. */
const swap = (
  current: string,
  before: string | null | undefined,
  after: string | null | undefined,
) => (current.trim() === '' || current === (before ?? '') ? (after ?? '') : current);

export function ServiceStep({ draftId }: { draftId: string | null }) {
  const draft = useDraft(draftId);
  const providers = useProviders();
  if (!draftId) return <ServiceForm key="new" draft={null} providers={providers} />;
  return (
    <DraftGate step="SERVICE" draftId={draftId} query={draft} subtitle={SUBTITLE}>
      {(data) => <ServiceForm key={data.id} draft={data} providers={providers} />}
    </DraftGate>
  );
}

function ServiceForm({
  draft,
  providers,
}: {
  draft: PlatformIntegration | null;
  providers: UseQueryResult<ProviderTemplate[]>;
}) {
  const router = useRouter();
  const [synced, setSynced] = useState(draft?.version ?? 0);
  const [values, setValues] = useState(() => valuesOf(draft));
  const [attempted, setAttempted] = useState(false);
  const [serverError, setServerError] = useState<FieldError | null>(null);
  const [logoProblem, setLogoProblem] = useState<string | null>(null);
  const [confirmEnvironment, setConfirmEnvironment] = useState<Mode | null>(null);
  // A newer version (a reload after a conflict) replaces the form with what is saved.
  if (draft && draft.version !== synced) {
    setSynced(draft.version);
    setValues(valuesOf(draft));
  }

  const save = useApiMutation(
    async (input: { mode: Mode; confirmEnvironmentChange: boolean }) => {
      const category = categoryOf(values.category) ?? 'OTHER';
      if (!draft)
        return adminIntegrations.createPlatform({
          provider: values.provider || undefined,
          name: values.name.trim(),
          category,
          description: values.description.trim(),
          longDescription: values.longDescription.trim() || null,
          logo: values.logo,
          websiteUrl: values.websiteUrl.trim() || null,
          docsUrl: values.docsUrl.trim() || null,
          environment: values.environment,
        });
      const changes = changesOf(draft, values);
      return adminIntegrations.updatePlatform(draft.id, {
        version: draft.version,
        ...changes,
        ...(changes.environment && input.confirmEnvironmentChange
          ? { confirmEnvironmentChange: true }
          : {}),
        ...(input.mode === 'continue'
          ? { setupStep: furthest(draft.setupStep, 'CONNECTION') }
          : {}),
      });
    },
    { invalidate: ['admin-integrations'] },
  );

  const set = (patch: Partial<ServiceValues>) => setValues((current) => ({ ...current, ...patch }));
  const templates = providers.data;
  const templateFor = (key: string) => templates?.find((item) => item.key === key) ?? null;

  function pickProvider(key: string) {
    const before = templateFor(values.provider);
    const after = templateFor(key);
    setValues((current) => ({
      ...current,
      provider: key,
      name: swap(current.name, before?.name, after?.name),
      category:
        current.category === '' || current.category === before?.category
          ? (after?.category ?? '')
          : current.category,
      description: swap(current.description, before?.description, after?.description),
      websiteUrl: swap(current.websiteUrl, before?.websiteUrl, after?.websiteUrl),
      docsUrl: swap(current.docsUrl, before?.docsUrl, after?.docsUrl),
    }));
  }

  const dirty = draft
    ? Object.keys(changesOf(draft, values)).length > 0
    : JSON.stringify(values) !== JSON.stringify(valuesOf(null));
  const problems = attempted ? problemsOf(values) : [];
  const errors = serverError ? [...problems, serverError] : problems;
  const errorFor = (id: string) => errors.find((error) => error.id === id)?.message;
  const configured =
    !!draft &&
    (draft.connection.fields.some((field) => field.display !== null) ||
      !!draft.connection.oauth?.connected);

  function run(mode: Mode, confirmEnvironmentChange: boolean) {
    setConfirmEnvironment(null);
    save.mutate(
      { mode, confirmEnvironmentChange },
      {
        onSuccess: (saved) => {
          if (mode === 'draft') router.push(savedHref(saved.id, 'draft'));
          // A new draft replaces this entry, so the browser's Back never reopens an empty form.
          else if (draft) router.push(stepHref(saved.id, 'CONNECTION'));
          else router.replace(stepHref(saved.id, 'CONNECTION'));
        },
        onError: (error) => {
          if (errorCode(error) !== 'DUPLICATE_CONNECTION') return;
          const duplicate = {
            id: `${ID.environment}-${values.environment}`,
            message: `This provider already has a ${ENVIRONMENT_LABELS[values.environment]} connection. Choose the other environment, or manage the existing one from Platform Integrations.`,
          };
          setServerError(duplicate);
          focusFirst([duplicate]);
        },
      },
    );
  }

  function submit(mode: Mode) {
    setAttempted(true);
    setServerError(null);
    const found = problemsOf(values);
    if (found.length) {
      focusFirst(found);
      return;
    }
    if (draft && configured && values.environment !== draft.environment) {
      setConfirmEnvironment(mode);
      return;
    }
    run(mode, false);
  }

  const providerOptions = [
    { value: '', label: 'Another provider (custom)' },
    ...(templates ?? [])
      .filter((item) => item.key !== 'custom')
      .map((item) => ({ value: item.key, label: item.name })),
    ...(draft && !templateFor(draft.provider)
      ? [{ value: draft.provider, label: 'Custom service' }]
      : []),
  ];
  const showAlert = save.isError && errorCode(save.error) !== 'DUPLICATE_CONNECTION';

  return (
    <WizardFrame
      step="SERVICE"
      draft={draft}
      subtitle={SUBTITLE}
      dirty={dirty}
      ready={!providers.isError}
      busy={save.isPending}
      continueLabel="Next"
      onContinue={() => submit('continue')}
      onSaveDraft={() => submit('draft')}
      alert={
        showAlert ? (
          <p role="alert" className="text-sm text-danger">
            {integrationErrorMessage(save.error)}
          </p>
        ) : providers.isError ? (
          <p role="alert" className="text-sm text-danger">
            Could not load this right now. Try again in a moment.
          </p>
        ) : null
      }
      dialog={
        confirmEnvironment && draft ? (
          <Modal
            open
            title={`Switch to ${ENVIRONMENT_LABELS[values.environment]}?`}
            onClose={() => setConfirmEnvironment(null)}
            footer={
              <>
                <Button variant="secondary" onClick={() => setConfirmEnvironment(null)}>
                  Keep {ENVIRONMENT_LABELS[draft.environment]}
                </Button>
                <Button onClick={() => run(confirmEnvironment, true)}>
                  Switch and Clear Credentials
                </Button>
              </>
            }
          >
            <p className="max-w-lg text-sm text-text">
              Live and test credentials never mix, so switching clears the credentials saved for{' '}
              {draft.name}. Enter the {ENVIRONMENT_LABELS[values.environment].toLowerCase()}{' '}
              credentials again on Connection Details. The change is added to the audit log.
            </p>
          </Modal>
        ) : null
      }
    >
      <ErrorSummary errors={errors} />

      <div className="grid gap-5 sm:grid-cols-2">
        <SelectField
          id={ID.provider}
          label="Provider"
          value={values.provider}
          disabled={!!draft || providers.isPending}
          onChange={(event) => pickProvider(event.target.value)}
          options={providerOptions}
          hint={
            draft
              ? 'The provider is fixed once the draft is saved.'
              : providers.isError
                ? 'Could not load the providers right now.'
                : 'A known provider fills in its details and connection fields.'
          }
        />
        <ChoiceGroup
          name="environment"
          idPrefix={ID.environment}
          legend="Environment"
          required
          value={values.environment}
          onChange={(environment) => {
            setServerError(null);
            set({ environment });
          }}
          error={errorFor(`${ID.environment}-${values.environment}`)}
          options={[
            { value: 'TEST', label: 'Test (sandbox)' },
            { value: 'LIVE', label: 'Live (production)' },
          ]}
          hint={
            configured
              ? 'Changing it clears the saved credentials: live and test never mix.'
              : 'Live and test credentials never mix. Start with Test unless this is the production connection.'
          }
        />

        <TextField
          id={ID.name}
          label="Integration Name"
          required
          placeholder="e.g., Stripe"
          maxLength={NAME_MAX}
          autoComplete="off"
          value={values.name}
          onChange={(event) => set({ name: event.target.value })}
          error={errorFor(ID.name)}
        />
        <SelectField
          id={ID.category}
          label="Category"
          required
          placeholder="Select category"
          value={values.category}
          onChange={(event) => set({ category: event.target.value })}
          options={CATEGORIES.map((value) => ({ value, label: CATEGORY_LABELS[value] }))}
          error={errorFor(ID.category)}
        />

        <div className="sm:col-span-2">
          <AreaField
            id={ID.description}
            label="Short Description"
            required
            placeholder="Briefly describe what this integration is used for..."
            maxLength={SHORT_DESCRIPTION_MAX}
            value={values.description}
            onChange={(event) => set({ description: event.target.value })}
            error={errorFor(ID.description)}
          />
        </div>
        <div className="sm:col-span-2">
          <AreaField
            id={ID.longDescription}
            label="Detailed Description (Optional)"
            placeholder="Add more details about the integration, features, or use cases."
            maxLength={DESCRIPTION_MAX}
            value={values.longDescription}
            onChange={(event) => set({ longDescription: event.target.value })}
            error={errorFor(ID.longDescription)}
          />
        </div>

        <div id={ID.logo} tabIndex={-1} className="flex flex-col gap-1 outline-none sm:col-span-2">
          <p className="text-sm font-medium text-text">Integration Logo (Optional)</p>
          <FileDropzone
            label="Integration logo"
            icon={CloudArrowUp}
            title="Drag and drop an image here"
            hints={['PNG, JPG or WebP (max 2 MB)']}
            accept={[...LOGO_TYPES]}
            maxBytes={LOGO_MAX_BYTES}
            multiple={false}
            onFiles={(files) => {
              const file = files[0];
              const contentType = LOGO_TYPES.find((type) => type === file?.type);
              if (!file) return;
              if (!contentType) {
                setLogoProblem('Upload the logo as PNG, JPEG or WebP.');
                return;
              }
              setLogoProblem(null);
              set({ logo: { fileName: file.name, contentType, sizeBytes: file.size } });
            }}
            onReject={(rejections) =>
              setLogoProblem(
                rejections[0]?.reason === 'size'
                  ? 'The logo must be 2 MB or smaller.'
                  : 'Upload the logo as PNG, JPEG or WebP.',
              )
            }
          />
          {values.logo ? (
            <div
              data-testid="wizard-logo"
              className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2 text-heading">
                <ImageIcon aria-hidden weight="fill" className="size-5 shrink-0 text-muted" />
                <span className="min-w-0 wrap-anywhere">{values.logo.fileName}</span>
                <span className="shrink-0 text-xs text-muted">
                  {formatBytes(values.logo.sizeBytes)}
                </span>
              </span>
              <Button variant="ghost" onClick={() => set({ logo: null })}>
                <Trash aria-hidden weight="fill" className="size-4" />
                Remove<span className="sr-only"> logo</span>
              </Button>
            </div>
          ) : null}
          {logoProblem ? (
            <p role="alert" className="text-xs text-danger">
              {logoProblem}
            </p>
          ) : null}
        </div>

        <UrlField
          id={ID.websiteUrl}
          label="Provider Website (Optional)"
          placeholder="https://www.example.com"
          maxLength={500}
          value={values.websiteUrl}
          onChange={(event) => set({ websiteUrl: event.target.value })}
          error={errorFor(ID.websiteUrl)}
        />
        <UrlField
          id={ID.docsUrl}
          label="Documentation URL (Optional)"
          placeholder="https://docs.example.com"
          maxLength={500}
          value={values.docsUrl}
          onChange={(event) => set({ docsUrl: event.target.value })}
          error={errorFor(ID.docsUrl)}
        />
      </div>
    </WizardFrame>
  );
}
