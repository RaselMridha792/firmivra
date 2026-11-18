'use client';

import type { ClientListItem } from '@firmivra/types';
import { Button, Card, Modal, Tabs } from '@firmivra/ui';
import { ExternalLink, Megaphone } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { LeaveGuard } from '../../../../../../components/leave-guard';
import { ClientPicker } from '../../../documents/upload/_components/client-picker';
import { PortalFields, portalValues } from '../../../../setup/_components/portal-step';
import { SettingsForm, SettingsScreen } from '../../../../setup/_components/settings-form';
import { PortalContactCard } from './portal-contact';
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
        <div className="flex flex-col gap-4">
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
          <section hidden={panel !== 'general'} aria-label="General">
            <SettingsForm defaults={portalValues(firm)} cancel>
              {(form) => <PortalFields form={form} firm={firm} />}
            </SettingsForm>
          </section>
          <section hidden={panel !== 'registration'} aria-label="Registration & Access">
            <RegistrationPanel />
          </section>
          <section hidden={panel !== 'announcements'} aria-label="Announcements">
            <AnnouncementsPanel />
          </section>
          <section hidden={panel !== 'contact'} aria-label="Contact Information">
            <PortalContactCard />
          </section>
          <section hidden={panel !== 'features'} aria-label="Features">
            <PortalFeatures />
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

/**
 * Announcements (guide 3; client-portal-announcements-dashboard.jpg): settings only. Creating an
 * announcement happens in Communications (CP-3b); the firm's switch and channel policy follow.
 */
function AnnouncementsPanel() {
  return (
    <Card className="flex flex-col gap-4" data-testid="portal-announcements">
      <div className="flex items-start gap-3">
        <Megaphone aria-hidden className="mt-1 size-6 shrink-0 text-action" />
        <div>
          <h2 className="text-lg font-bold text-heading">Announcements</h2>
          <p className="text-sm text-muted">
            Clients always see the firm&apos;s live announcements in their portal. Personal service
            and account notifications are always emailed, and clients choose texts with their
            consent.
          </p>
        </div>
      </div>
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
    </Card>
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
