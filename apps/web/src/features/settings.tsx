'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  FirmSettings,
  FirmLegalDocument,
  FirmSetup,
  UpdateBusinessSettingsRequest,
  PublishFirmLegalVersionRequest,
  SaveBusinessSetupRequest,
  ApiRequestError,
} from '@firmivra/types';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Input,
  Select,
  Skeleton,
  Textarea,
  tokens,
} from '@firmivra/ui';
import { OwnerOnly, useWorkspace } from '../components/workspace-context';
import { ContactFields, DataNotice, PageHeading, UnavailableAction } from './screen-kit';
import { workspaceError, workspaceRequest } from '../lib/workspace-api';

const steps = [
  'Firm Branding',
  'Business Details',
  'Team & Access',
  'Client Portal',
  'Finish Setup',
];
export function Settings({ wizard = false }: { wizard?: boolean }) {
  return (
    <OwnerOnly>
      <SettingsPanel wizard={wizard} />
    </OwnerOnly>
  );
}
function SettingsPanel({ wizard }: { wizard: boolean }) {
  const { business, preview } = useWorkspace();
  const router = useRouter();
  const businessId = business?.id ?? '';
  const [record, setRecord] = useState<FirmSettings | null>(null);
  const [loadState, setLoadState] = useState(preview ? 'ready' : 'loading');
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState<Set<string>>(() => new Set());
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState({
    displayName: business?.name ?? '',
    portalName: business?.name ?? '',
    primary: tokens.palettes.lvp.navy as string,
    secondary: tokens.palettes.lvp.gold as string,
    email: '',
    phone: '',
    website: '',
    entity: 'LLC',
    description: '',
    address: '',
    city: '',
    region: '',
    postalCode: '',
    teamSize: '',
    country: 'US',
    timezone: 'America/New_York',
    welcome: 'Welcome to your secure client portal.',
    terms: '',
    privacy: '',
  });
  const [features, setFeatures] = useState(['Documents', 'Messages', 'Appointments', 'Invoices']);
  const [statuses, setStatuses] = useState('Awaiting documents\nUnder review\nCompleted');
  const [logoPreview, setLogoPreview] = useState('');
  useEffect(
    () => () => {
      if (logoPreview) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await workspaceRequest(businessId, '/business/settings', FirmSettings, {
          signal: controller.signal,
        });
        const legal = await Promise.allSettled(
          ['TERMS', 'PRIVACY'].map((kind) =>
            workspaceRequest(businessId, `/business/legal/${kind}`, FirmLegalDocument, {
              signal: controller.signal,
            }),
          ),
        );
        if (controller.signal.aborted) return;
        setRecord(response);
        setFeatures(response.enabledModules);
        setDraft((current) => ({
          ...current,
          displayName: response.profile.name,
          portalName: response.portalName ?? '',
          primary: response.brandColor ?? tokens.palettes.lvp.navy,
          email: response.contactEmail ?? '',
          phone: response.contactPhone ?? '',
          website: response.website ?? '',
          address: response.addressLine1 ?? '',
          city: response.city ?? '',
          region: response.state ?? '',
          postalCode: response.postalCode ?? '',
          country: response.country,
          timezone: response.timezone,
          welcome: response.welcomeMessage ?? '',
          terms: legal[0]?.status === 'fulfilled' ? legal[0].value.bodyMarkdown : '',
          privacy: legal[1]?.status === 'fulfilled' ? legal[1].value.bodyMarkdown : '',
        }));
        const failure = legal.find(
          (result) =>
            result.status === 'rejected' &&
            !(result.reason instanceof ApiRequestError && result.reason.status === 404),
        );
        setError(failure?.status === 'rejected' ? workspaceError(failure.reason) : '');
        setDirty(new Set());
        setLoadState('ready');
      } catch (failure) {
        if (!controller.signal.aborted) {
          setError(workspaceError(failure));
          setLoadState('error');
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [businessId, preview, revision]);
  const update = (key: keyof typeof draft, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty((fields) => new Set([...fields, key]));
  };
  async function saveProfile() {
    if (!record || preview) return record;
    const mapping = {
      displayName: 'name',
      portalName: 'portalName',
      primary: 'brandColor',
      email: 'contactEmail',
      phone: 'contactPhone',
      website: 'website',
      address: 'addressLine1',
      city: 'city',
      region: 'state',
      postalCode: 'postalCode',
      country: 'country',
      timezone: 'timezone',
      welcome: 'welcomeMessage',
    } as const;
    const patch: Record<string, unknown> = {};
    for (const [key, field] of Object.entries(mapping)) {
      if (dirty.has(key))
        patch[field] =
          draft[key as keyof typeof draft] ||
          (['name', 'country', 'timezone'].includes(field) ? '' : null);
    }
    if (!Object.keys(patch).length) return record;
    const saved = await workspaceRequest(businessId, '/business/settings', FirmSettings, {
      method: 'PATCH',
      body: UpdateBusinessSettingsRequest.parse(patch),
    });
    setRecord(saved);
    setDirty((fields) => new Set([...fields].filter((key) => !(key in mapping))));
    return saved;
  }
  async function save(advance = false) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const changed = [
        'displayName',
        'portalName',
        'primary',
        'email',
        'phone',
        'website',
        'address',
        'city',
        'region',
        'postalCode',
        'country',
        'timezone',
        'welcome',
      ].some((key) => dirty.has(key));
      const saved = await saveProfile();
      if (wizard && advance && saved) {
        const keys = ['branding', 'businessDetails', 'team', 'clientPortal'] as const;
        const current = keys[step];
        if (current) {
          const setup = await workspaceRequest(businessId, '/business/setup', FirmSetup, {
            method: 'PATCH',
            body: SaveBusinessSetupRequest.parse({
              completedSteps: [
                ...new Set([
                  ...saved.setup.completedSteps.filter((key) => key !== 'finish'),
                  current,
                ]),
              ],
            }),
          });
          setRecord({ ...saved, setup });
          setStep((value) => value + 1);
        }
      }
      setNotice(
        advance
          ? 'Setup step saved.'
          : changed
            ? 'Profile changes saved.'
            : 'No profile changes to save.',
      );
    } catch (failure) {
      setError(workspaceError(failure));
    } finally {
      setBusy(false);
    }
  }
  async function publish(kind: 'TERMS' | 'PRIVACY') {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const document = await workspaceRequest(
        businessId,
        `/business/legal/${kind}`,
        FirmLegalDocument,
        {
          method: 'POST',
          body: PublishFirmLegalVersionRequest.parse({
            bodyMarkdown: kind === 'TERMS' ? draft.terms : draft.privacy,
          }),
        },
      );
      setNotice(
        `${kind === 'TERMS' ? 'Terms' : 'Privacy policy'} version ${document.version} published.`,
      );
      setDirty(
        (fields) =>
          new Set(
            [...fields].filter((field) => field !== (kind === 'TERMS' ? 'terms' : 'privacy')),
          ),
      );
    } catch (failure) {
      setError(workspaceError(failure));
    } finally {
      setBusy(false);
    }
  }
  async function complete() {
    setBusy(true);
    setError('');
    try {
      await saveProfile();
      await workspaceRequest(businessId, '/business/setup/complete', FirmSetup, { method: 'POST' });
      router.push('/admin/dashboard');
      router.refresh();
    } catch (failure) {
      setError(workspaceError(failure));
    } finally {
      setBusy(false);
    }
  }
  const validPrimary = /^#[0-9a-f]{6}$/i.test(draft.primary);
  const validSecondary = /^#[0-9a-f]{6}$/i.test(draft.secondary);
  const previewStyle = {
    '--color-action': validPrimary ? draft.primary : tokens.palettes.lvp.navy,
    '--color-accent': validSecondary ? draft.secondary : tokens.palettes.lvp.gold,
  } as CSSProperties;
  const branding = (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card title="Portal branding">
        <div className="space-y-4">
          <Input
            label="Approved legal name"
            value={record?.profile.legalName ?? business?.name ?? ''}
            readOnly
          />
          <Input
            label="Portal display name"
            value={draft.portalName}
            onChange={(e) => update('portalName', e.target.value)}
            maxLength={120}
          />
          <Input
            label="Logo"
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            hint="Choose a file for review. Uploading is currently unavailable."
            onChange={(event) => {
              const file = event.target.files?.[0];
              setLogoPreview(file ? URL.createObjectURL(file) : '');
            }}
          />
          <Input
            label="Primary colour (HEX)"
            value={draft.primary}
            onChange={(e) => update('primary', e.target.value)}
            error={validPrimary ? undefined : 'Use a six-digit HEX colour, for example #001B44'}
          />
          <Input
            label="Secondary colour (HEX)"
            disabled={!preview}
            value={draft.secondary}
            onChange={(e) => update('secondary', e.target.value)}
            error={validSecondary ? undefined : 'Use a six-digit HEX colour'}
          />
        </div>
      </Card>
      <Card title="Portal preview">
        <div
          data-theme="lvpPortal"
          style={previewStyle}
          className="space-y-4 rounded-card border border-border bg-folder-surface p-6"
        >
          {logoPreview ? (
            <Image
              src={logoPreview}
              alt="Selected firm logo preview"
              width={160}
              height={80}
              className="h-20 w-auto max-w-full object-contain"
              unoptimized
            />
          ) : null}
          <h2 className="font-display text-2xl font-bold text-heading">
            {draft.portalName || draft.displayName || 'Your firm'}
          </h2>
          <p className="text-sm">{draft.welcome}</p>
          <div className="border-l-4 border-accent pl-4">
            <p className="text-sm text-muted">Your documents and information in one place.</p>
          </div>
          <Button disabled>Client portal preview</Button>
        </div>
        <p className="mt-4 text-xs text-muted">
          Preview only. New brand colours require a contrast check before publishing.
        </p>
      </Card>
    </div>
  );
  const details = (
    <Card title="Business details">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Legal firm name" value={business?.name ?? ''} readOnly />
        <Input
          label="DBA / display name"
          value={draft.displayName}
          onChange={(e) => update('displayName', e.target.value)}
        />
        <Select
          label="Entity type"
          disabled={!preview}
          value={draft.entity}
          onChange={(e) => update('entity', e.target.value)}
          options={['LLC', 'Corporation', 'Partnership', 'Sole proprietor', 'Other'].map(
            (value) => ({ value, label: value }),
          )}
        />
        <Input
          label="EIN / Tax ID"
          type="password"
          autoComplete="off"
          placeholder="Protected tax identifier"
          disabled
          hint="Tax identifiers are masked. Editing is not available yet."
        />
        <Input
          label="Email"
          type="email"
          value={draft.email}
          onChange={(e) => update('email', e.target.value)}
        />
        <Input
          label="Phone"
          type="tel"
          value={draft.phone}
          onChange={(e) => update('phone', e.target.value)}
        />
        <Input
          label="Website"
          type="url"
          value={draft.website}
          onChange={(e) => update('website', e.target.value)}
        />
        <Input
          label="Country code"
          value={draft.country}
          maxLength={2}
          onChange={(event) => update('country', event.target.value.toUpperCase())}
        />
        <Input
          label="Timezone"
          value={draft.timezone}
          onChange={(event) => update('timezone', event.target.value)}
        />
        <Input
          label="Address"
          autoComplete="street-address"
          value={draft.address}
          onChange={(event) => update('address', event.target.value)}
        />
        <Input
          label="City"
          autoComplete="address-level2"
          value={draft.city}
          onChange={(event) => update('city', event.target.value)}
        />
        <Input
          label="State / region"
          autoComplete="address-level1"
          value={draft.region}
          onChange={(event) => update('region', event.target.value)}
        />
        <Input
          label="Postal code"
          autoComplete="postal-code"
          value={draft.postalCode}
          onChange={(event) => update('postalCode', event.target.value)}
        />
        <Input
          label="Team size"
          disabled={!preview}
          type="number"
          min={1}
          value={draft.teamSize}
          onChange={(event) => update('teamSize', event.target.value)}
        />
      </div>
      <div className="mt-4">
        <Textarea
          label="Business description"
          disabled={!preview}
          value={draft.description}
          onChange={(e) => update('description', e.target.value)}
          maxLength={4000}
        />
      </div>
    </Card>
  );
  const team = (
    <Card title="Team & access">
      <p className="mb-4 text-sm text-muted">
        Owners manage firm settings; administrators manage the team; staff access permitted client
        work.
      </p>
      <UnavailableAction label="Invite team member">
        <ContactFields includeRole />
      </UnavailableAction>
    </Card>
  );
  const portal = (
    <div className="space-y-6">
      <Card title="Client portal">
        <div className="space-y-4">
          <Textarea
            label="Welcome message"
            value={draft.welcome}
            onChange={(e) => update('welcome', e.target.value)}
            maxLength={1000}
          />
          <fieldset>
            <legend className="text-sm font-semibold">Portal features</legend>
            {['Documents', 'Messages', 'Appointments', 'Invoices', 'Intake forms'].map(
              (feature) => (
                <Checkbox
                  key={feature}
                  label={feature}
                  disabled={!preview}
                  checked={features.includes(feature)}
                  onChange={(e) =>
                    setFeatures((f) =>
                      e.target.checked ? [...f, feature] : f.filter((v) => v !== feature),
                    )
                  }
                />
              ),
            )}
          </fieldset>
        </div>
      </Card>
      <Card title="Terms and Privacy">
        <div className="space-y-4">
          <Textarea
            label="Terms of Service"
            value={draft.terms}
            onChange={(e) => update('terms', e.target.value)}
            maxLength={50000}
          />
          <Input label="Terms document" type="file" accept=".pdf,.docx" />
          <Button
            disabled={preview || busy || !draft.terms.trim()}
            onClick={() => void publish('TERMS')}
          >
            Publish Terms version
          </Button>
          <Textarea
            label="Privacy Policy"
            value={draft.privacy}
            onChange={(e) => update('privacy', e.target.value)}
            maxLength={50000}
          />
          <Input label="Privacy document" type="file" accept=".pdf,.docx" />
          <Button
            disabled={preview || busy || !draft.privacy.trim()}
            onClick={() => void publish('PRIVACY')}
          >
            Publish Privacy version
          </Button>
          <p className="text-xs text-muted">Selected files have not been uploaded.</p>
        </div>
      </Card>
      <Card title="Tax statuses">
        <Textarea
          label="Tax statuses (one per line)"
          disabled={!preview}
          value={statuses}
          onChange={(e) => setStatuses(e.target.value)}
          maxLength={2000}
        />
      </Card>
    </div>
  );
  const finish = (
    <Card title="Setup checklist">
      <ul className="space-y-4">
        {steps.slice(0, 4).map((title, i) => (
          <li key={title} className="flex items-center justify-between gap-4">
            <span>{title}</span>
            <Button variant="link" onClick={() => setStep(i)}>
              Review
            </Button>
          </li>
        ))}
      </ul>
      <div className="mt-6">
        <Alert
          title={
            record?.setup.completedAt ? 'Setup is complete' : 'Complete the setup requirements'
          }
        >
          {preview
            ? 'This local preview cannot complete server setup.'
            : 'The server verifies branding, contact details, an active owner and published Terms and Privacy before completion.'}
        </Alert>
      </div>
    </Card>
  );
  if (loadState === 'loading')
    return (
      <div role="status" aria-label="Loading settings">
        <Skeleton />
        <Skeleton />
      </div>
    );
  if (loadState === 'error')
    return (
      <>
        <PageHeading
          title="Workspace settings"
          description="Configure your firm profile and client portal."
        />
        <Alert title={error} tone="danger">
          <Button
            onClick={() => {
              setLoadState('loading');
              setRevision((value) => value + 1);
            }}
          >
            Retry
          </Button>
        </Alert>
        <EmptyState
          title="Settings could not be loaded"
          description="Your changes cannot be saved until settings load successfully."
        />
      </>
    );
  return (
    <fieldset disabled={busy} className="space-y-6">
      <PageHeading
        title={wizard ? 'Set up your firm' : 'Workspace settings'}
        description="Configure your firm profile, team access and client portal."
      />
      {notice ? <Alert title={notice} tone="success" /> : null}
      {error ? <Alert title={error} tone="danger" /> : null}
      {preview ? <DataNotice /> : null}
      {wizard ? (
        <ol aria-label="Setup progress" className="flex flex-wrap gap-3">
          {steps.map((title, i) => (
            <li
              key={title}
              aria-current={step === i ? 'step' : undefined}
              className={`rounded-control px-4 py-3 text-sm ${step === i ? 'bg-action text-white' : 'bg-folder-surface text-heading'}`}
            >
              {i + 1}. {title}
            </li>
          ))}
        </ol>
      ) : null}
      {wizard ? (
        [branding, details, team, portal, finish][step]
      ) : (
        <>
          {branding}
          {details}
          {portal}
        </>
      )}
      <div className="flex flex-wrap justify-between gap-3">
        {wizard ? (
          <Button variant="secondary" disabled={step === 0} onClick={() => setStep((n) => n - 1)}>
            Back
          </Button>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="secondary"
            disabled={preview || busy || !validPrimary}
            onClick={() => void save()}
          >
            {wizard ? 'Save draft' : 'Save changes'}
          </Button>
          {wizard && step < 4 ? (
            <Button
              disabled={busy || !validPrimary || !validSecondary}
              onClick={() => (preview ? setStep((n) => n + 1) : void save(true))}
            >
              {preview ? 'Preview next step' : 'Save and continue'}
            </Button>
          ) : wizard ? (
            <Button
              disabled={preview || busy || !!record?.setup.completedAt}
              onClick={() => void complete()}
            >
              Complete setup
            </Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted">
        Unsaved edits stay on this page only and are discarded when you leave.
      </p>
    </fieldset>
  );
}
