'use client';

import { ENTITY_TYPES, type FirmSettings } from '@firmivra/types';
import { Input, Select, Textarea } from '@firmivra/ui';
import { Buildings, ShieldCheck } from '@phosphor-icons/react';
import {
  BrandActionsCard,
  BrandCardFrame,
  BrandColorsCard,
  LivePreviewCard,
  LoginPageCard,
  LogoAssetsCard,
  ThemeColorsCard,
  ThemeOptionsCard,
} from '../../_components/brand-cards';
import { type BrandDraftState, useBrandDraft } from '../../_components/brand-draft';
import { BrandCard, BrandFrame } from '../../_components/brand-frame';
import { LockedDetailsCard } from './locked-details';

/**
 * Business Type choices: a short list of the firm categories the design and guide name; the
 * contract keeps it as free text, so a value saved elsewhere is kept as a choice too.
 */
const BUSINESS_TYPES = [
  'Accounting & Tax Services',
  'Bookkeeping Services',
  'Payroll Services',
  'Financial Advisory',
  'Business Consulting',
];

/** The EIN as far as it is ever shown: its last 4 digits. */
const einShown = (last4: string | null) => (last4 ? `••-•••${last4}` : null);

/**
 * Company Information (her guide B2): the legal name and the EIN are locked; Request Change asks
 * Firmivra. The company's display details below stay editable here (Rasel, Oct 24: the editors
 * stay on Company Profile for now).
 */
function CompanyInformationCard({ state, firm }: { state: BrandDraftState; firm: FirmSettings }) {
  const d = state.draft;
  if (!d) return null;
  const e = state.errors;
  const types =
    BUSINESS_TYPES.includes(d.businessCategory) || !d.businessCategory
      ? BUSINESS_TYPES
      : [d.businessCategory, ...BUSINESS_TYPES];
  const ein = einShown(firm.einLast4);
  return (
    <LockedDetailsCard
      kind="COMPANY"
      icon={Buildings}
      title="Company Information"
      testId="company-information"
      timeZone={firm.timezone}
      rows={[
        { label: 'Legal Company Name', value: firm.business.legalName },
        { label: 'EIN (Tax ID)', value: ein },
      ]}
      current={{ legalName: firm.business.legalName, ein }}
      note={
        <>
          To update your legal company name or EIN, click <strong>Request Change</strong>. Your
          request will be reviewed by the Firmivra Super Admin team.
        </>
      }
    >
      <Input
        label="Company Name *"
        maxLength={120}
        value={d.name}
        error={e.name}
        onChange={(ev) => state.set('name', ev.target.value)}
      />
      <Input
        label="Website"
        type="url"
        placeholder="https://"
        value={d.website}
        error={e.website}
        onChange={(ev) => state.set('website', ev.target.value)}
      />
      <Select
        label="Business Type"
        options={[
          ...(d.businessCategory ? [] : [{ value: '', label: 'Choose…' }]),
          ...types.map((t) => ({ value: t, label: t })),
        ]}
        value={d.businessCategory}
        error={e.businessCategory}
        onChange={(ev) => state.set('businessCategory', ev.target.value)}
      />
      <Select
        label="Entity Type"
        options={[
          ...(d.entityType ? [] : [{ value: '', label: 'Choose…' }]),
          ...Object.entries(ENTITY_TYPES).map(([value, label]) => ({ value, label })),
        ]}
        value={d.entityType}
        error={e.entityType}
        onChange={(ev) => state.set('entityType', ev.target.value)}
      />
      <Input
        label="Tagline / Motto"
        maxLength={80}
        placeholder="Plan | Prepare | Prosper"
        value={d.tagline}
        error={e.tagline}
        onChange={(ev) => state.set('tagline', ev.target.value)}
      />
      <div className="flex flex-col gap-1">
        <Textarea
          label="Short Description"
          rows={3}
          maxLength={250}
          value={d.description}
          error={e.description}
          onChange={(ev) => state.set('description', ev.target.value)}
        />
        <p className="self-end text-xs text-muted">{d.description.length}/250</p>
      </div>
    </LockedDetailsCard>
  );
}

/**
 * Professional Licensing Information (her guide B3): read-only; Request Change asks Firmivra.
 * No licensing details are stored yet (Column request for R1, item 7), so each row says so.
 */
function LicensingCard({ firm }: { firm: FirmSettings }) {
  return (
    <LockedDetailsCard
      kind="LICENSING"
      icon={ShieldCheck}
      title="Professional Licensing Information"
      testId="licensing-information"
      timeZone={firm.timezone}
      rows={['Regulatory Body', 'License Type', 'License Number', 'Expiration Date', 'Status'].map(
        (label) => ({ label, value: null }),
      )}
      current={{}}
      note={
        <>
          To update your professional licensing information, click <strong>Request Change</strong>.
          Your request will be reviewed by the Firmivra Super Admin team.
        </>
      }
    />
  );
}

function ContactInformationCard({ state }: { state: BrandDraftState }) {
  const d = state.draft;
  if (!d) return null;
  const e = state.errors;
  return (
    <BrandCard
      title="Contact Information"
      subtitle="This information is used for system notifications and client communications."
      testId="contact-information"
    >
      <Input
        label="Address"
        placeholder="Street address"
        value={d.addressLine1}
        error={e.addressLine1}
        onChange={(ev) => state.set('addressLine1', ev.target.value)}
      />
      <Input
        label="Address line 2"
        hideLabel
        placeholder="Suite, unit (optional)"
        value={d.addressLine2}
        error={e.addressLine2}
        onChange={(ev) => state.set('addressLine2', ev.target.value)}
      />
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-2">
        <Input
          label="City"
          hideLabel
          placeholder="City"
          value={d.city}
          error={e.city}
          onChange={(ev) => state.set('city', ev.target.value)}
        />
        <Input
          label="State"
          hideLabel
          placeholder="State"
          value={d.state}
          error={e.state}
          onChange={(ev) => state.set('state', ev.target.value)}
        />
        <Input
          label="ZIP code"
          hideLabel
          placeholder="ZIP"
          value={d.postalCode}
          error={e.postalCode}
          onChange={(ev) => state.set('postalCode', ev.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input
          label="Phone Number"
          type="tel"
          placeholder="(000) 000-0000"
          value={d.contactPhone}
          error={e.contactPhone}
          onChange={(ev) => state.set('contactPhone', ev.target.value)}
        />
        <Input
          label="Support Email"
          type="email"
          value={d.contactEmail}
          error={e.contactEmail}
          onChange={(ev) => state.set('contactEmail', ev.target.value)}
        />
      </div>
    </BrandCard>
  );
}

/**
 * Settings > Company Profile & Branding, the Company Profile tab
 * (company-profile-branding-and-white-label.jpg, guide §4, §17): Company and Contact
 * Information, Logo & Brand Assets, Brand Colors, Theme Options, Login Page Customization, the
 * Live Preview of the unsaved values, and Save Changes, Preview Full Platform and Reset to Default
 * Brand Settings. One Save sends what changed to `api.settings` and `api.branding`. Every card
 * keeps its frame while loading or when its call fails.
 */
export function ProfileScreen() {
  const state = useBrandDraft();
  const firm = state.settings.data;
  const branding = state.branding.data;
  const loading = state.settings.isPending || state.branding.isPending;
  const ready = firm && branding;
  const frame = (title: string) => <BrandCardFrame key={title} title={title} loading={loading} />;
  return (
    <BrandFrame tab="profile">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1700px]:grid-cols-[1fr_1.25fr_1fr]">
        <div className="flex min-w-0 flex-col gap-4">
          {ready ? (
            <CompanyInformationCard state={state} firm={firm} />
          ) : (
            frame('Company Information')
          )}
          {ready ? <LicensingCard firm={firm} /> : frame('Professional Licensing Information')}
          {ready ? <ContactInformationCard state={state} /> : frame('Contact Information')}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {ready ? (
            <LogoAssetsCard firm={firm} branding={branding} />
          ) : (
            frame('Logo & Brand Assets')
          )}
          {ready ? <BrandColorsCard state={state} /> : frame('Brand Colors')}
          {ready ? <ThemeColorsCard state={state} /> : frame('Theme Colors')}
          {ready ? <ThemeOptionsCard state={state} /> : frame('Theme Options')}
          {ready ? (
            <LoginPageCard state={state} firm={firm} branding={branding} />
          ) : (
            frame('Login Page Customization (Optional)')
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-2 lg:grid lg:grid-cols-[2fr_1fr] min-[1700px]:col-span-1 min-[1700px]:flex">
          {ready ? (
            <LivePreviewCard state={state} firm={firm} branding={branding} />
          ) : (
            frame('Live Preview')
          )}
          {ready ? (
            <BrandActionsCard state={state} firm={firm} branding={branding} />
          ) : (
            frame('Actions')
          )}
        </div>
      </div>
    </BrandFrame>
  );
}
