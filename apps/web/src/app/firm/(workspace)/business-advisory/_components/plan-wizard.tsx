'use client';

import { type AdvisoryPlanDetail, US_STATES } from '@firmivra/types';
import { Avatar, Input, Select, Textarea } from '@firmivra/ui';
import { Buildings, FileText, Info, MapPin, Phone, UsersThree } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import {
  BASE,
  BA_KEY,
  BUSINESS_STAGES,
  PLAN_TYPES,
  SectionHead,
  card,
  errorText,
  quiet,
} from './ba-shared';
import { type WizardStep, WizardFrame, stepHref, useStepSave } from './plan-frame';
import { AssessmentStep, ActionStep, ReviewStep, StrategyStep } from './plan-steps';

/** Free text in the API; the lists the form offers (a stored value outside them is kept). */
const ENTITY_TYPES = [
  'Sole Proprietorship',
  'LLC',
  'S Corporation',
  'C Corporation',
  'Partnership',
  'Professional Corporation',
  'Nonprofit',
  'Other',
];
const INDUSTRIES = [
  'Construction',
  'Retail',
  'Professional Services',
  'Healthcare',
  'Food & Beverage',
  'Transportation',
  'Beauty & Wellness',
  'Automotive',
  'Real Estate',
  'Technology',
  'Manufacturing',
  'Hospitality',
  'Other',
];
const options = (list: string[], current: string, empty = 'Select…') => [
  { value: '', label: empty },
  ...[...list, ...(current && !list.includes(current) ? [current] : [])].map((v) => ({
    value: v,
    label: v,
  })),
];

// ---------- The entry point the pages render ----------

/** Create / Edit Business Plan (design 2): five steps on one plan. `planId` is missing until it is saved. */
export function PlanWizard({ planId, step }: { planId?: string; step: WizardStep }) {
  if (!planId) return <ProfileStep />;
  return <EditPlan planId={planId} step={step} />;
}

/** The sections of each step, drawn as empty frames while the plan loads or cannot be loaded. */
const SECTIONS: Record<WizardStep, string[]> = {
  1: [
    'Client Selection',
    'Plan Details',
    'Business Information',
    'Business Address',
    'Contact Information',
    'Business Structure & Team',
    'Additional Information',
  ],
  2: ['Financial Snapshot', 'Funding', 'Sales / Market', 'Operations', 'Strengths & Challenges'],
  3: ['Strategy', 'Focus Areas', 'Goals', 'Recommendations'],
  4: ['Milestones', 'Tasks', 'Service Workstreams', 'Resources & Documents'],
  5: [
    'Before you finalize',
    'Business Profile',
    'Financial & Business Assessment',
    'Goals & Strategy',
    'Action Plan',
    'Versions & Delivery',
  ],
};

function UnavailableStep({
  planId,
  step,
  failed,
}: {
  planId: string;
  step: WizardStep;
  failed: boolean;
}) {
  return (
    <WizardFrame
      step={step}
      planId={planId}
      // Nothing to save until the plan loads.
      saving
      dirty={false}
      error={
        failed
          ? 'This business plan is not available right now. We could not load it. Try again in a moment.'
          : undefined
      }
      onSaveDraft={() => Promise.resolve(false)}
      onNext={() => undefined}
      nextDisabled
    >
      <div className="grid gap-4 lg:grid-cols-2" data-testid={failed ? 'ba-error' : 'plan-loading'}>
        {SECTIONS[step].map((title) => (
          <section key={title} className={card} aria-label={title}>
            <SectionHead icon={FileText} title={title} />
            <p className={quiet}>{failed ? 'Not available right now.' : 'Loading…'}</p>
          </section>
        ))}
      </div>
    </WizardFrame>
  );
}

function EditPlan({ planId, step }: { planId: string; step: WizardStep }) {
  const q = useApiQuery([...BA_KEY, 'plan', planId], () => api.advisory.plan(planId));
  if (!q.data) return <UnavailableStep planId={planId} step={step} failed={q.isError} />;
  const plan = q.data;
  // Each step remounts on a newer etag, so a reload after a save conflict starts from the saved plan.
  if (step === 1) return <ProfileStep key={plan.etag} plan={plan} />;
  if (step === 2) return <AssessmentStep key={plan.etag} plan={plan} />;
  if (step === 3) return <StrategyStep key={plan.etag} plan={plan} />;
  if (step === 4) return <ActionStep key={plan.etag} plan={plan} />;
  return <ReviewStep plan={plan} />;
}

// ---------- Step 1: Business Profile ----------

interface ProfileForm {
  name: string;
  targetYear: string;
  planType: string;
  businessName: string;
  entityType: string;
  industry: string;
  years: string;
  stage: string;
  products: string;
  line1: string;
  city: string;
  state: string;
  postalCode: string;
  contactName: string;
  phone: string;
  email: string;
  website: string;
  employees: string;
  hiring: string;
  team: string;
  referral: string;
  notes: string;
}

const formOf = (plan?: AdvisoryPlanDetail): ProfileForm => {
  const p = plan?.profile ?? {};
  return {
    name: plan?.name ?? '',
    targetYear: String(plan?.targetYear ?? new Date().getFullYear()),
    planType: plan?.planType ?? '',
    businessName: p.businessName ?? '',
    entityType: p.entityType ?? '',
    industry: p.industry ?? '',
    years: p.yearsInBusiness == null ? '' : String(p.yearsInBusiness),
    stage: p.businessStage ?? '',
    products: p.productsServices ?? '',
    line1: p.address?.line1 ?? '',
    city: p.address?.city ?? '',
    state: p.address?.state ?? '',
    postalCode: p.address?.postalCode ?? '',
    contactName: p.primaryContact?.name ?? '',
    phone: p.primaryContact?.phone ?? '',
    email: p.primaryContact?.email ?? '',
    website: p.website ?? '',
    employees: p.employeeCount == null ? '' : String(p.employeeCount),
    hiring: p.hiringPlans ?? '',
    team: (p.keyTeamMembers ?? []).map((m) => m.name).join(', '),
    referral: p.referralSource ?? '',
    notes: p.notes ?? '',
  };
};

const orNull = (v: string) => v.trim() || null;
const intOrNull = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v))));
const profileOf = (f: ProfileForm) => ({
  businessName: orNull(f.businessName),
  entityType: orNull(f.entityType),
  industry: orNull(f.industry),
  yearsInBusiness: intOrNull(f.years),
  businessStage: orNull(f.stage),
  productsServices: orNull(f.products),
  address: {
    line1: orNull(f.line1),
    city: orNull(f.city),
    state: orNull(f.state),
    postalCode: orNull(f.postalCode),
  },
  primaryContact: { name: orNull(f.contactName), email: orNull(f.email), phone: orNull(f.phone) },
  website: f.website.trim()
    ? /^https?:\/\//i.test(f.website.trim())
      ? f.website.trim()
      : `https://${f.website.trim()}`
    : null,
  employeeCount: intOrNull(f.employees),
  hiringPlans: orNull(f.hiring),
  keyTeamMembers: f.team
    .split(/[,\n]/)
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((name) => ({ name })),
  referralSource: orNull(f.referral),
  notes: orNull(f.notes),
});

/** "How did you hear about us?": free text in the API (max 100); these are the answers offered. */
const REFERRAL_SOURCES = [
  'Existing Client',
  'Referral',
  'Website',
  'Search Engine',
  'Social Media',
  'Event or Workshop',
  'Advertising',
  'Other',
];

function ProfileStep({ plan }: { plan?: AdvisoryPlanDetail }) {
  const router = useRouter();
  const params = useSearchParams();
  const qc = useQueryClient();
  const { save, saving, setSaving, error, setError, reload } = useStepSave(plan);
  const [clientId, setClientId] = useState(
    plan?.advisoryClientId ?? params.get('advisoryClientId') ?? '',
  );
  const [form, setForm] = useState<ProfileForm>(() => formOf(plan));
  const [initial] = useState(() => JSON.stringify(formOf(plan)));
  const [tried, setTried] = useState(false);
  const [year] = useState(() => new Date().getFullYear());
  const clients = useApiQuery([...BA_KEY, 'pick-clients'], () =>
    api.advisory.clients({ pageSize: 100 }),
  );
  const detail = useApiQuery([...BA_KEY, 'client', clientId], () =>
    clientId ? api.advisory.client(clientId) : Promise.resolve(null),
  );
  const set = (k: keyof ProfileForm) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== initial || (!plan && clientId !== '');

  // A new plan starts from what the client's record already says; nothing typed is overwritten.
  const d = detail.data;
  const [filledFor, setFilledFor] = useState<string>();
  if (!plan && d && filledFor !== d.id) {
    setFilledFor(d.id);
    const fill: Partial<ProfileForm> = {
      businessName: d.businessName ?? '',
      entityType: d.businessProfile.entityType ?? '',
      industry: d.industry ?? '',
      years:
        d.businessProfile.yearsInBusiness == null ? '' : String(d.businessProfile.yearsInBusiness),
      stage: d.businessStage ?? '',
      line1: d.businessProfile.address?.line1 ?? '',
      city: d.businessProfile.address?.city ?? '',
      state: d.businessProfile.address?.state ?? '',
      postalCode: d.businessProfile.address?.postalCode ?? '',
      contactName: d.client.name,
      phone: d.client.phone ?? '',
      email: d.client.email ?? '',
      website: d.businessProfile.website ?? '',
    };
    setForm((f) => {
      const next = { ...f };
      for (const [k, v] of Object.entries(fill) as [keyof ProfileForm, string][])
        if (!next[k]) next[k] = v;
      return next;
    });
  }

  const required: (keyof ProfileForm)[] = [
    'name',
    'targetYear',
    'businessName',
    'entityType',
    'industry',
    'years',
  ];
  const missing = (k: keyof ProfileForm) => tried && !form[k].trim();
  const err = (k: keyof ProfileForm) => (missing(k) ? 'Required to continue' : undefined);

  const persist = async (toStep: number): Promise<string | undefined> => {
    if (plan) {
      const ok = await save({
        name: form.name.trim(),
        targetYear: Number(form.targetYear),
        planType: orNull(form.planType),
        step: Math.max(plan.step, toStep),
        profile: profileOf(form),
      });
      return ok ? plan.id : undefined;
    }
    if (!clientId || !form.name.trim()) {
      setTried(true);
      setError('Choose the client and name the plan to save it.');
      return undefined;
    }
    setSaving(true);
    setError(undefined);
    try {
      const created = await api.advisory.createPlan({
        advisoryClientId: clientId,
        name: form.name.trim(),
        targetYear: Number(form.targetYear),
        ...(form.planType ? { planType: form.planType } : {}),
        profile: profileOf(form),
      });
      if (toStep > 1) {
        await api.advisory.updatePlan(created.id, { etag: created.etag, step: toStep });
      }
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      return created.id;
    } catch (e) {
      setError(errorText(e));
      return undefined;
    } finally {
      setSaving(false);
    }
  };

  const states = Object.entries(US_STATES).map(([value, label]) => ({ value, label }));
  return (
    <WizardFrame
      step={1}
      {...(plan ? { planId: plan.id } : {})}
      saving={saving}
      dirty={dirty}
      error={error}
      onReload={reload}
      onSaveDraft={async () => {
        const id = await persist(1);
        if (id && !plan) router.replace(stepHref(id, 1));
        return Boolean(id);
      }}
      onNext={() => {
        setTried(true);
        if (!clientId || required.some((k) => !form[k].trim())) {
          setError('Fill in the required fields to continue, or save as a draft.');
          return;
        }
        void persist(2).then((id) => id && router.push(stepHref(id, 2)));
      }}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Client selection" data-testid="step-client">
          <SectionHead
            icon={UsersThree}
            title="Client Selection"
            subtitle="Select the client for this business plan."
          />
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            {plan ? (
              <Input label="Client" value={plan.client.name} readOnly />
            ) : (
              <Select
                label="Client"
                required
                value={clientId}
                {...(tried && !clientId ? { error: 'Required' } : {})}
                onChange={(e) => setClientId(e.target.value)}
                options={[
                  {
                    value: '',
                    label: clients.isError
                      ? 'Advisory clients could not be loaded'
                      : clients.data && !clients.data.items.length
                        ? 'No advisory clients'
                        : 'Choose a client…',
                  },
                  ...(clients.data?.items ?? []).map((c) => ({
                    value: c.id,
                    label: c.client.name,
                  })),
                ]}
              />
            )}
            {d ? (
              <div
                className="flex items-center gap-3 rounded-lg border border-divider p-3"
                data-testid="client-card"
              >
                <Avatar name={d.client.name} size="lg" />
                <span className="flex min-w-0 flex-col text-sm">
                  <span className="font-semibold text-heading">{d.client.name}</span>
                  <span className="text-link">{d.businessName ?? '—'}</span>
                  <span className="truncate text-link">{d.client.email ?? 'No email'}</span>
                  <span className="text-link">{d.client.phone ?? 'No phone'}</span>
                </span>
              </div>
            ) : (
              <p className={`${quiet} text-left`}>
                {!plan && clients.data && !clients.data.items.length ? (
                  <Link href={`${BASE}/clients`} className="font-medium text-link hover:underline">
                    Add an advisory client first
                  </Link>
                ) : (
                  <>The client&apos;s details show here.</>
                )}
              </p>
            )}
          </div>
        </section>
        <section className={card} aria-label="Plan details" data-testid="step-plan">
          <SectionHead
            icon={FileText}
            title="Plan Details"
            subtitle="Enter basic details for this business plan."
          />
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.1fr)]">
            <Input
              label="Plan Name"
              required
              maxLength={200}
              value={form.name}
              onChange={(e) => set('name')(e.target.value)}
              {...(err('name') ? { error: err('name')! } : {})}
            />
            <Select
              label="Target Year"
              required
              value={form.targetYear}
              onChange={(e) => set('targetYear')(e.target.value)}
              options={[year - 1, year, year + 1, year + 2, year + 3].map((y) => ({
                value: String(y),
                label: String(y),
              }))}
            />
            <Select
              label="Plan Type"
              value={form.planType}
              onChange={(e) => set('planType')(e.target.value)}
              options={options(PLAN_TYPES, form.planType, 'Not set')}
            />
          </div>
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className={card} aria-label="Business information" data-testid="step-business">
          <SectionHead
            icon={Buildings}
            title="Business Information"
            subtitle="Provide the core information about the business."
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label="Business Name"
              required
              maxLength={200}
              value={form.businessName}
              onChange={(e) => set('businessName')(e.target.value)}
              {...(err('businessName') ? { error: err('businessName')! } : {})}
            />
            <Input
              label="EIN"
              value={d?.businessProfile.einMasked ?? (plan || clientId ? 'Not on file' : '')}
              readOnly
              title="Kept masked on the client's record"
            />
            <Select
              label="Entity Type"
              required
              value={form.entityType}
              onChange={(e) => set('entityType')(e.target.value)}
              options={options(ENTITY_TYPES, form.entityType)}
              {...(err('entityType') ? { error: err('entityType')! } : {})}
            />
            <Select
              label="Industry"
              required
              value={form.industry}
              onChange={(e) => set('industry')(e.target.value)}
              options={options(INDUSTRIES, form.industry)}
              {...(err('industry') ? { error: err('industry')! } : {})}
            />
            <Input
              label="Years in Business"
              required
              inputMode="numeric"
              value={form.years}
              onChange={(e) => set('years')(e.target.value)}
              {...(err('years') ? { error: err('years')! } : {})}
            />
            <Select
              label="Business Stage"
              value={form.stage}
              onChange={(e) => set('stage')(e.target.value)}
              options={options(BUSINESS_STAGES, form.stage, 'Not set')}
            />
          </div>
          <div className="mt-3">
            <Textarea
              label="Products/Services"
              rows={4}
              maxLength={2000}
              value={form.products}
              onChange={(e) => set('products')(e.target.value)}
            />
          </div>
        </section>
        <div className="flex flex-col gap-4">
          <section className={card} aria-label="Business address" data-testid="step-address">
            <SectionHead icon={MapPin} title="Business Address" />
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
              <div className="sm:col-span-3">
                <Input
                  label="Street Address"
                  maxLength={200}
                  value={form.line1}
                  onChange={(e) => set('line1')(e.target.value)}
                />
              </div>
              <Input
                label="City"
                maxLength={100}
                value={form.city}
                onChange={(e) => set('city')(e.target.value)}
              />
              <Select
                label="State"
                value={form.state}
                onChange={(e) => set('state')(e.target.value)}
                options={[{ value: '', label: '—' }, ...states]}
              />
              <Input
                label="ZIP Code"
                maxLength={20}
                value={form.postalCode}
                onChange={(e) => set('postalCode')(e.target.value)}
              />
            </div>
          </section>
          <section className={card} aria-label="Contact information" data-testid="step-contact">
            <SectionHead icon={Phone} title="Contact Information" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Primary Contact Name"
                maxLength={200}
                value={form.contactName}
                onChange={(e) => set('contactName')(e.target.value)}
              />
              <Input
                label="Phone Number"
                maxLength={40}
                value={form.phone}
                onChange={(e) => set('phone')(e.target.value)}
              />
              <Input
                label="Email Address"
                type="email"
                maxLength={254}
                value={form.email}
                onChange={(e) => set('email')(e.target.value)}
              />
              <Input
                label="Website (optional)"
                maxLength={300}
                value={form.website}
                onChange={(e) => set('website')(e.target.value)}
              />
            </div>
          </section>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card} aria-label="Business structure and team" data-testid="step-team">
          <SectionHead
            icon={UsersThree}
            title="Business Structure & Team"
            subtitle="Tell us about the business structure and team."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Number of Employees"
              inputMode="numeric"
              value={form.employees}
              onChange={(e) => set('employees')(e.target.value)}
            />
            <Select
              label="Plans to Hire in Next 12 Months?"
              value={form.hiring}
              onChange={(e) => set('hiring')(e.target.value)}
              options={options(['Yes', 'No', 'Not sure'], form.hiring, 'Not set')}
            />
            <div className="sm:col-span-2">
              <Input
                label="Key Team Members (optional)"
                maxLength={2000}
                value={form.team}
                onChange={(e) => set('team')(e.target.value)}
                placeholder="Names, separated by commas"
              />
            </div>
          </div>
        </section>
        <section className={card} aria-label="Additional information" data-testid="step-additional">
          <SectionHead
            icon={Info}
            title="Additional Information"
            subtitle="Provide any other relevant information."
          />
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
            <Select
              label="How did you hear about us?"
              value={form.referral}
              onChange={(e) => set('referral')(e.target.value)}
              options={options(REFERRAL_SOURCES, form.referral, 'Not set')}
            />
            <Textarea
              label="Notes (optional)"
              rows={3}
              maxLength={2000}
              value={form.notes}
              onChange={(e) => set('notes')(e.target.value)}
            />
          </div>
        </section>
      </div>
    </WizardFrame>
  );
}
