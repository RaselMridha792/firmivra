'use client';

import type {
  MyPortalContact,
  PortalContactSettings,
  PortalContactSwitches,
  PortalOfficeContact,
} from '@firmivra/types';
import { Button, Card, Select, Toggle } from '@firmivra/ui';
import {
  Building2,
  CalendarDays,
  Contact,
  ExternalLink,
  Info,
  Mail,
  MapPin,
  MessageSquare,
  MessageSquareText,
  Phone,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { PortalContactDetails } from '../../../../../../components/portal-contact-card';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { phoneLabel } from '../../../../../../lib/firm-contact';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';

const QUERY = ['portal-contact'];
const KEYS: (keyof PortalContactSwitches)[] = [
  'showCorporateOffice',
  'showLocalOffice',
  'allowPhone',
  'allowSms',
  'allowEmail',
  'allowSecureMessage',
  'allowAppointmentLink',
];

const METHODS: {
  key: keyof PortalContactSwitches;
  title: string;
  does: string;
  icon: LucideIcon;
}[] = [
  {
    key: 'allowPhone',
    title: 'Allow Phone Calls',
    does: 'Show a clickable phone number in the client portal.',
    icon: Phone,
  },
  {
    key: 'allowSms',
    title: 'Allow Text Messages',
    does: 'Show a Text button, only to clients who agreed to texts.',
    icon: MessageSquareText,
  },
  {
    key: 'allowEmail',
    title: 'Allow Email',
    does: 'Show an email link in the client portal.',
    icon: Mail,
  },
  {
    key: 'allowSecureMessage',
    title: 'Allow Secure Messages',
    does: 'Let clients send messages through their portal (recommended). Messages must be on in Portal Features too.',
    icon: MessageSquare,
  },
  {
    key: 'allowAppointmentLink',
    title: 'Allow Appointments',
    does: 'Show a button to book an appointment in the client portal.',
    icon: CalendarDays,
  },
];

/**
 * Settings > Client portal > Contact Information (client-portal-contact-settings-dashboard.jpg;
 * Client Portal guide 4 and 9.4, PRT-3): which offices the portal's contact card shows and how
 * clients may get in touch, with a Live Preview. The details come from Company Profile and
 * Locations, edited there. Owner and Admin; the API checks again and audits each change.
 */
export function PortalContactCard() {
  const query = useApiQuery(QUERY, () => api.portalContact.get());
  return (
    <Card className="flex flex-col gap-4" data-testid="portal-contact">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-control bg-action text-on-action">
          <Contact aria-hidden className="size-5" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-heading">Contact Information</h2>
          <p className="text-sm text-muted">
            Manage the company contact information clients see in their portal and how they can
            communicate with your firm.
          </p>
        </div>
      </div>
      <PageState query={query}>{(saved) => <ContactForm saved={saved} />}</PageState>
    </Card>
  );
}

function Step({
  n,
  title,
  line,
  children,
}: {
  n: number;
  title: string;
  line: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`contact-step-${n}`} className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-action text-sm font-semibold text-on-action">
          {n}
        </span>
        <div>
          <h3 id={`contact-step-${n}`} className="font-semibold text-heading">
            {title}
          </h3>
          <p className="text-sm text-muted">{line}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** An office's details as Company Profile or Locations hold them. */
function OfficeFacts({ office }: { office: PortalOfficeContact }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-control bg-subtle p-3 text-sm text-text">
      <p className="font-semibold text-heading">{office.name}</p>
      {office.addressLines.length ? (
        <p className="flex gap-2">
          <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>
            {office.addressLines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </span>
        </p>
      ) : null}
      {office.phone ? (
        <p className="flex items-center gap-2">
          <Phone aria-hidden className="size-4 shrink-0 text-muted" />
          {phoneLabel(office.phone)}
        </p>
      ) : null}
      {office.email ? (
        <p className="flex min-w-0 items-center gap-2 break-all">
          <Mail aria-hidden className="size-4 shrink-0 text-muted" />
          {office.email}
        </p>
      ) : null}
    </div>
  );
}

const outLink =
  'inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-control border border-action px-3 text-sm font-semibold text-action hover:bg-info-soft';

function ContactForm({ saved }: { saved: PortalContactSettings }) {
  const [switches, setSwitches] = useState(saved.switches);
  const [previewId, setPreviewId] = useState(saved.offices[0]?.id ?? '');
  const [done, setDone] = useState(false);
  const save = useApiMutation(
    (body: Partial<PortalContactSwitches>) => api.portalContact.update(body),
    { invalidate: QUERY },
  );
  const changed = KEYS.filter((k) => switches[k] !== saved.switches[k]);
  const dirty = changed.length > 0;
  // Leaving with unsaved switches asks first (guide 7.1).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const set = (key: keyof PortalContactSwitches, on: boolean) => {
    setDone(false);
    setSwitches({ ...switches, [key]: on });
  };
  const office = saved.offices.find((o) => o.id === previewId) ?? null;
  const preview: MyPortalContact = {
    corporate: switches.showCorporateOffice ? saved.corporate : null,
    local: switches.showLocalOffice ? office : null,
    methods: {
      phone: switches.allowPhone,
      sms: switches.allowSms,
      email: switches.allowEmail,
      secureMessage: switches.allowSecureMessage,
      appointment: switches.allowAppointmentLink,
    },
  };

  return (
    <div className="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <Step
          n={1}
          title="Office Information to Display"
          line="Choose which office contact details clients can see in their portal."
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-card border-2 border-success-soft p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="flex gap-2">
                  <Building2 aria-hidden className="mt-0.5 size-5 shrink-0 text-success" />
                  <span>
                    <span className="block font-semibold text-heading">Corporate Office</span>
                    <span className="block text-sm text-muted">
                      Show your main company contact information.
                    </span>
                  </span>
                </span>
                <Toggle
                  label="Show the corporate office"
                  checked={switches.showCorporateOffice}
                  onChange={(on) => set('showCorporateOffice', on)}
                />
              </div>
              {saved.corporate ? (
                <OfficeFacts office={saved.corporate} />
              ) : (
                <p className="rounded-control bg-subtle p-3 text-sm text-muted">
                  Company Profile has no address, phone or email yet.
                </p>
              )}
              <Link href="/settings/profile" className={outLink}>
                Edit in Company Profile <ExternalLink aria-hidden className="size-4" />
              </Link>
            </div>
            <div className="flex flex-col gap-3 rounded-card border-2 border-accent-soft p-3">
              <div className="flex items-start justify-between gap-3">
                <span className="flex gap-2">
                  <MapPin aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" />
                  <span>
                    <span className="block font-semibold text-heading">
                      Local Office{' '}
                      <span className="text-xs font-normal text-muted">
                        (Client&apos;s Assigned Location)
                      </span>
                    </span>
                    <span className="block text-sm text-muted">
                      Show the office the client chose when they registered.
                    </span>
                  </span>
                </span>
                <Toggle
                  label="Show the client's local office"
                  checked={switches.showLocalOffice}
                  onChange={(on) => set('showLocalOffice', on)}
                />
              </div>
              <p className="flex gap-2 rounded-control bg-info-soft p-2.5 text-xs text-heading">
                <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-info" />
                Each client&apos;s local office is the one they chose at registration. Staff can
                change it on the client&apos;s profile; it is never picked from their city or state.
              </p>
              {saved.offices.length ? (
                <>
                  <Select
                    label="Office for the preview"
                    value={previewId}
                    onChange={(e) => setPreviewId(e.target.value)}
                    options={saved.offices.map((o) => ({ value: o.id ?? '', label: o.name }))}
                  />
                  {office ? <OfficeFacts office={office} /> : null}
                </>
              ) : (
                <p className="rounded-control bg-subtle p-3 text-sm text-muted">
                  No active locations yet.
                </p>
              )}
              <Link href="/settings/locations" className={outLink}>
                Manage Office Locations <ExternalLink aria-hidden className="size-4" />
              </Link>
            </div>
          </div>
        </Step>

        <Step
          n={2}
          title="Client Communication Options"
          line="Choose how clients can contact your firm from their portal."
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="contact-methods">
            {METHODS.map(({ key, title, does, icon: Icon }) => (
              <div key={key} className="flex flex-col gap-2 rounded-card border border-divider p-3">
                <div className="flex items-center justify-between gap-3">
                  <Icon aria-hidden className="size-5 text-action" />
                  <Toggle label={title} checked={switches[key]} onChange={(on) => set(key, on)} />
                </div>
                <p className="text-sm font-semibold text-heading">{title}</p>
                <p className="text-xs text-muted">{does}</p>
              </div>
            ))}
          </div>
        </Step>

        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            disabled={!dirty || save.isPending}
            onClick={() =>
              save.mutate(Object.fromEntries(changed.map((k) => [k, switches[k]])), {
                onSuccess: () => setDone(true),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            variant="secondary"
            disabled={!dirty || save.isPending}
            onClick={() => setSwitches(saved.switches)}
          >
            Discard changes
          </Button>
          {done && !dirty ? (
            <p role="status" className="text-sm text-success">
              Contact information saved.
            </p>
          ) : null}
          {save.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(save.error)} Your changes are kept; try again.
            </p>
          ) : null}
        </div>
      </div>

      <aside
        aria-label="Live Preview"
        className="flex min-w-0 flex-col gap-3 self-start rounded-card bg-subtle p-3"
        data-testid="contact-preview"
      >
        <div>
          <h3 className="font-semibold text-heading">Live Preview</h3>
          <p className="text-xs text-link">
            How the contact information appears in the client portal{dirty ? ' once saved' : ''}.
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-card bg-surface p-4 text-heading shadow-sm">
          <div>
            <p className="font-display text-lg font-bold">Need Help? We&apos;re Here for You</p>
            <p className="text-sm text-muted">Contact our team or your local office.</p>
          </div>
          <PortalContactDetails contact={preview} live={false} tone="light" />
          {preview.methods.secureMessage || preview.methods.appointment ? (
            <div className="flex flex-wrap gap-2">
              {preview.methods.secureMessage ? (
                <span className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-action px-3 text-sm font-semibold text-on-action">
                  <MessageSquare aria-hidden className="size-4" />
                  Send a Message
                </span>
              ) : null}
              {preview.methods.appointment ? (
                <span className="inline-flex min-h-9 items-center gap-1.5 rounded-control border border-action px-3 text-sm font-semibold text-action">
                  <CalendarDays aria-hidden className="size-4" />
                  Book Appointment
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
