'use client';

import { useState, type CSSProperties } from 'react';
import { Alert, Button, Card, Checkbox, Input, Select, Textarea, tokens } from '@firmivra/ui';
import { OwnerOnly, useWorkspace } from '../components/workspace-context';
import { ContactFields, DataNotice, PageHeading, UnavailableAction } from './screen-kit';

const steps = [
  'Firm Branding',
  'Business Details',
  'Team & Access',
  'Client Portal',
  'Finish Setup',
];
export function Settings({ wizard = false }: { wizard?: boolean }) {
  const { business, preview } = useWorkspace();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState({
    displayName: business?.name ?? '',
    primary: tokens.palettes.lvp.navy as string,
    secondary: tokens.palettes.lvp.gold as string,
    email: '',
    phone: '',
    website: '',
    entity: 'LLC',
    description: '',
    welcome: 'Welcome to your secure client portal.',
    terms: '',
    privacy: '',
  });
  const [features, setFeatures] = useState(['Documents', 'Messages', 'Appointments', 'Invoices']);
  const [statuses, setStatuses] = useState('Awaiting documents\nUnder review\nCompleted');
  const update = (key: keyof typeof draft, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
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
          <Input label="Approved legal name" value={business?.name ?? ''} readOnly />
          <Input
            label="Portal display name"
            value={draft.displayName}
            onChange={(e) => update('displayName', e.target.value)}
            maxLength={200}
          />
          <Input
            label="Logo"
            type="file"
            accept="image/png,image/jpeg,image/svg+xml"
            hint="Choose a file for review. Uploading is currently unavailable."
          />
          <Input
            label="Primary colour (HEX)"
            value={draft.primary}
            onChange={(e) => update('primary', e.target.value)}
            error={validPrimary ? undefined : 'Use a six-digit HEX colour, for example #001B44'}
          />
          <Input
            label="Secondary colour (HEX)"
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
          <h2 className="font-display text-2xl font-bold text-heading">
            {draft.displayName || 'Your firm'}
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
        <Input label="Address" autoComplete="street-address" />
        <Input label="City" autoComplete="address-level2" />
        <Input label="State / region" autoComplete="address-level1" />
        <Input label="Postal code" autoComplete="postal-code" />
        <Input label="Team size" type="number" min={1} />
      </div>
      <div className="mt-4">
        <Textarea
          label="Business description"
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
          <Textarea
            label="Privacy Policy"
            value={draft.privacy}
            onChange={(e) => update('privacy', e.target.value)}
            maxLength={50000}
          />
          <Input label="Privacy document" type="file" accept=".pdf,.docx" />
          <p className="text-xs text-muted">Selected files have not been uploaded.</p>
        </div>
      </Card>
      <Card title="Tax statuses">
        <Textarea
          label="Tax statuses (one per line)"
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
        <Alert title="Setup has not been saved">
          Complete Setup will become available when workspace settings can be saved.
        </Alert>
      </div>
    </Card>
  );
  return (
    <OwnerOnly>
      <PageHeading
        title={wizard ? 'Set up your firm' : 'Workspace settings'}
        description="Configure your firm profile, team access and client portal."
      />
      <DataNotice />
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
          <Button variant="secondary" disabled>
            {wizard ? 'Save draft' : 'Save changes'}
          </Button>
          {wizard && step < 4 ? (
            <Button
              disabled={!preview || !validPrimary || !validSecondary}
              onClick={() => setStep((n) => n + 1)}
            >
              Preview next step
            </Button>
          ) : wizard ? (
            <Button disabled>Complete setup</Button>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted">
        Unsaved edits stay on this page only and are discarded when you leave.
      </p>
    </OwnerOnly>
  );
}
