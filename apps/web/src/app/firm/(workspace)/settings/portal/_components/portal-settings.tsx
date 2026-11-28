'use client';

import type {
  ClientListItem,
  PortalAnnouncementSettings,
  PortalChannelPolicy,
  PortalSmsPolicy,
  UpdatePortalAnnouncementSettings,
} from '@firmivra/types';
import { Button, Card, Modal, Select, Tabs, Toggle } from '@firmivra/ui';
import { ExternalLink, Megaphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { LeaveGuard } from '../../../../../../components/leave-guard';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { useUnsavedChanges } from '../../../../../../lib/unsaved';
import { ClientPicker } from '../../../documents/upload/_components/client-picker';
import { PortalFields, portalSettingsValues } from '../../../../setup/_components/portal-step';
import { SettingsForm, SettingsScreen } from '../../../../setup/_components/settings-form';
import { PortalContactCard } from './portal-contact';
import { PortalCustomTabs } from './portal-custom-tabs';
import { PortalFeatures } from './portal-features';

type Panel = 'general' | 'registration' | 'announcements' | 'contact' | 'features';

const PANELS: { id: Panel; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'registration', label: 'Registration & Access' },
  { id: 'announcements', label: 'Announcements' },
  { id: 'contact', label: 'Contact Information' },
  { id: 'features', label: 'Features' },
];

/**
 * Settings > Client portal (portal-settings-dashboard.jpg; Client Portal guide 1, CP-1): five
 * panels and View Client Portal. Every panel stays mounted while another shows, so switching
 * panels never drops unsaved work; leaving the page with unsaved changes asks first (CP-7.1).
 */
export function PortalSettings() {
  // A link can open a panel: /settings/portal?panel=features.
  const asked = useSearchParams().get('panel');
  const [panel, setPanel] = useState<Panel>(() =>
    PANELS.some((p) => p.id === asked) ? (asked as Panel) : 'general',
  );
  const [previewing, setPreviewing] = useState(false);
  return (
    <SettingsScreen
      title="Client portal settings"
      intro="Customize what clients see when they open your portal."
    >
      {(firm) => (
        <div className="flex min-w-0 flex-col gap-4">
          <LeaveGuard />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Tabs
                label="Client portal settings"
                variant="underline"
                items={PANELS.map(({ id, label }) => ({ id, label }))}
                value={panel}
                onChange={(id) => setPanel(id as Panel)}
              />
            </div>
            <Button onClick={() => setPreviewing(true)} data-testid="view-client-portal">
              View Client Portal <ExternalLink aria-hidden className="size-4" />
            </Button>
          </div>
          <section hidden={panel !== 'general'} aria-label="General" className="min-w-0">
            <SettingsForm defaults={portalSettingsValues(firm)} cancel>
              {(form) => <PortalFields form={form} firm={firm} buttons />}
            </SettingsForm>
          </section>
          <section
            hidden={panel !== 'registration'}
            aria-label="Registration & Access"
            className="min-w-0"
          >
            <RegistrationPanel />
          </section>
          <section
            hidden={panel !== 'announcements'}
            aria-label="Announcements"
            className="min-w-0"
          >
            <AnnouncementsPanel />
          </section>
          <section
            hidden={panel !== 'contact'}
            aria-label="Contact Information"
            className="min-w-0"
          >
            <PortalContactCard />
          </section>
          <section hidden={panel !== 'features'} aria-label="Features" className="min-w-0">
            <div className="grid min-w-0 gap-4">
              <PortalFeatures />
              <PortalCustomTabs />
            </div>
          </section>
          {previewing ? <PreviewDialog onClose={() => setPreviewing(false)} /> : null}
        </div>
      )}
    </SettingsScreen>
  );
}

/**
 * Registration & Access (guide 2): where each part of registration is set. Sign-ups on or off is
 * under General; how a new account is approved, and the offices clients choose from, live with
 * Client Sign-ups and Locations, so nothing here is a second copy of them.
 */
function RegistrationPanel() {
  const rows: { title: string; does: string; href: string; link: string }[] = [
    {
      title: 'Account activation',
      does: 'Whether new accounts wait for your approval or are approved automatically.',
      href: '/sign-ups',
      link: 'Client Sign-ups',
    },
    {
      title: 'Office at registration',
      does: 'Clients choose an active office, with its full address, when they sign up.',
      href: '/settings/locations',
      link: 'Locations',
    },
  ];
  return (
    <Card className="flex flex-col gap-4" data-testid="portal-registration">
      <div>
        <h2 className="text-lg font-bold text-heading">Registration & Access</h2>
        <p className="text-sm text-muted">
          Whether clients may create their own account is under General.
        </p>
      </div>
      <ul className="flex flex-col divide-y divide-divider">
        {rows.map((row) => (
          <li key={row.title} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div className="min-w-0">
              <p className="font-semibold text-heading">{row.title}</p>
              <p className="text-sm text-muted">{row.does}</p>
            </div>
            <Link href={row.href} className="text-sm font-semibold text-link">
              Go to {row.link}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** CP-3d: the words for each channel policy, as the mockup's labels. */
const EMAIL_POLICIES: { value: PortalChannelPolicy; label: string; shows: string }[] = [
  { value: 'CLIENT_CHOICE', label: "Client's choice", shows: 'Client can turn on or off' },
  { value: 'REQUIRED', label: 'Always sent', shows: 'Always on (required)' },
  { value: 'OFF', label: 'Never sent', shows: 'Off' },
];
const SMS_POLICIES = EMAIL_POLICIES.filter((p) => p.value !== 'REQUIRED');
const shows = (value: PortalChannelPolicy) =>
  EMAIL_POLICIES.find((p) => p.value === value)?.shows ?? '';

/**
 * Announcements (guide 3; client-portal-announcements-dashboard.jpg): settings only. Creating an
 * announcement happens in Communications (CP-3b). The firm turns announcements on or off in the
 * portal (CP-3c), on the client's dashboard (CP-3i), and sets what clients may do with the email
 * and text copies (CP-3d), with a preview of what a client sees (CP-3h).
 */
function AnnouncementsPanel() {
  const query = useApiQuery(ANNOUNCEMENT_QUERY, () => api.portalAnnouncementSettings.get());
  return <PageState query={query}>{(saved) => <AnnouncementsForm saved={saved} />}</PageState>;
}

const ANNOUNCEMENT_QUERY = ['portal-announcement-settings'];

function AnnouncementsForm({ saved }: { saved: PortalAnnouncementSettings }) {
  const [draft, setDraft] = useState(saved);
  const [done, setDone] = useState(false);
  const save = useApiMutation(
    (body: UpdatePortalAnnouncementSettings) => api.portalAnnouncementSettings.update(body),
    { invalidate: ANNOUNCEMENT_QUERY },
  );
  const keys = ['enabled', 'onDashboard', 'emailPolicy', 'smsPolicy'] as const;
  const changed = keys.filter((k) => draft[k] !== saved[k]);
  // CP-7.1: leaving with unsaved changes asks first.
  useUnsavedChanges(changed.length > 0);
  const set = (patch: Partial<PortalAnnouncementSettings>) => {
    setDone(false);
    setDraft({ ...draft, ...patch });
  };
  return (
    <div className="flex flex-col gap-4 xl:flex-row" data-testid="portal-announcements">
      <Card className="flex min-w-0 flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <Megaphone aria-hidden className="mt-1 size-6 shrink-0 text-action" />
            <div>
              <h2 className="text-lg font-bold text-heading">Announcements</h2>
              <p className="text-sm text-muted">
                How announcements work in your client portal and how clients can receive them.
              </p>
            </div>
          </div>
          <Toggle
            label="Enable announcements"
            checked={draft.enabled}
            onChange={(on) => set({ enabled: on })}
          />
        </div>
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="font-semibold text-heading">Client notification settings</h3>
          <p className="rounded-card bg-info-soft p-3 text-sm text-text">
            Personal service and account notifications are always emailed and cannot be turned off
            by clients. Clients can choose texts with their consent.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select
              label="General announcements by email"
              value={draft.emailPolicy}
              disabled={!draft.enabled}
              onChange={(e) => set({ emailPolicy: e.target.value as PortalChannelPolicy })}
              options={EMAIL_POLICIES.map(({ value, label }) => ({ value, label }))}
            />
            <Select
              label="General announcements by text"
              value={draft.smsPolicy}
              disabled={!draft.enabled}
              onChange={(e) => set({ smsPolicy: e.target.value as PortalSmsPolicy })}
              options={SMS_POLICIES.map(({ value, label }) => ({ value, label }))}
            />
          </div>
          <p className="text-xs text-muted">
            Clients always see live announcements in their portal, whatever they choose for email
            and texts.
          </p>
        </section>
        <section className="flex flex-col gap-3 border-t border-border pt-4">
          <h3 className="font-semibold text-heading">Additional settings</h3>
          <Toggle
            label="Show announcements on client dashboard"
            checked={draft.onDashboard}
            disabled={!draft.enabled}
            onChange={(on) => set({ onDashboard: on })}
          />
        </section>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-info bg-info-soft p-4">
          <div className="min-w-0">
            <p className="font-semibold text-heading">Manage announcements in Communications</p>
            <p className="text-sm text-text">
              Create, edit and send announcements from the Communications menu.
            </p>
          </div>
          <Link
            href="/communications/new?channel=ANNOUNCEMENT"
            className="inline-flex min-h-10 items-center gap-2 rounded-control border border-action px-4 text-sm font-semibold text-action hover:bg-accent-soft"
            data-testid="go-to-communications"
          >
            Go to Communications <ExternalLink aria-hidden className="size-4" />
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <Button
            disabled={changed.length === 0 || save.isPending}
            onClick={() =>
              save.mutate(Object.fromEntries(changed.map((k) => [k, draft[k]])), {
                onSuccess: () => setDone(true),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            variant="secondary"
            disabled={changed.length === 0 || save.isPending}
            onClick={() => setDraft(saved)}
          >
            Cancel
          </Button>
          {done && changed.length === 0 ? (
            <p role="status" className="text-sm text-success">
              Changes saved.
            </p>
          ) : null}
          {save.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(save.error)} Your changes are kept; try again.
            </p>
          ) : null}
        </div>
      </Card>
      <AnnouncementsPreview draft={draft} />
    </div>
  );
}

/** CP-3h: what a client sees with these settings: a sample announcement and their choices. */
function AnnouncementsPreview({ draft }: { draft: PortalAnnouncementSettings }) {
  return (
    <aside
      className="flex w-full flex-col gap-3 rounded-card border border-border bg-canvas p-4 xl:w-80"
      aria-label="Announcements preview"
      data-testid="announcements-preview"
    >
      <div>
        <h3 className="font-semibold text-heading">Live Preview</h3>
        <p className="text-xs text-muted">How announcements appear in the client portal.</p>
      </div>
      {draft.enabled ? (
        <div className="flex flex-col gap-1 rounded-card bg-surface p-3">
          <span className="text-xs font-semibold text-action">Announcement</span>
          <p className="font-semibold text-heading">Extended Office Hours</p>
          <p className="text-sm text-text">
            We will be open extended hours during tax season to better serve you.
          </p>
          <p className="text-xs text-muted">
            {draft.onDashboard ? 'Shown on the dashboard.' : 'Not shown on the dashboard.'}
          </p>
        </div>
      ) : (
        <p className="rounded-card bg-surface p-3 text-sm text-muted">
          Announcements are off: clients see none in their portal.
        </p>
      )}
      <dl className="flex flex-col gap-2 text-sm" data-testid="announcements-preview-options">
        <div className="flex justify-between gap-2">
          <dt className="text-text">Account and service email</dt>
          <dd className="text-muted">Always on (required)</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text">Announcement email</dt>
          <dd className="text-muted">{draft.enabled ? shows(draft.emailPolicy) : 'Off'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-text">Announcement texts</dt>
          <dd className="text-muted">{draft.enabled ? shows(draft.smsPolicy) : 'Off'}</dd>
        </div>
      </dl>
    </aside>
  );
}

/**
 * View Client Portal (CP-1): the read-only preview of one client's portal, as it is set now, in
 * the Client Portal module (#1418). The chosen client's own visibility applies.
 */
function PreviewDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [client, setClient] = useState<ClientListItem | null>(null);
  return (
    <Modal
      open
      title="View Client Portal"
      subtitle="See the portal as one client sees it, read-only."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!client}
            onClick={() => client && router.push(`/client-portal/${client.id}/preview`)}
          >
            Open preview
          </Button>
        </>
      }
    >
      <ClientPicker value={client} onChange={setClient} disabled={false} label="Client" />
    </Modal>
  );
}
