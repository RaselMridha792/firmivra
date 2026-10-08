'use client';

import { ApiRequestError, type BusinessSummary } from '@firmivra/types';
import {
  CalendarDays,
  LogOut,
  ChartColumn,
  CloudUpload,
  FileText,
  House,
  MessageSquare,
  Receipt,
  UserRound,
} from 'lucide-react';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { Button, Modal } from '@firmivra/ui';
import Link from 'next/link';
import { Header } from '../../../../components/app-shell/header';
import { isActive } from '../../../../components/app-shell/types';
import { usePortal } from '../layout';
import { PortalFooter } from '../(public)/layout';
import type { NavSections } from '../../../../components/app-shell/types';
import { SignedIn, useMe } from '../../../../components/signed-in';
import { api } from '../../../../lib/api';

// Client menu (docs/junior/PAGE-MAP.md). R6 adds the unread count to Messages.
const sections = (slug: string): NavSections => [
  [
    { label: 'Home', icon: House, href: `/${slug}/home` },
    { label: 'My Documents', icon: CloudUpload, href: `/${slug}/documents` },
    { label: 'Intake Forms', icon: FileText, href: `/${slug}/intake` },
    { label: 'Messages', icon: MessageSquare, href: `/${slug}/messages` },
    { label: 'Appointments', icon: CalendarDays, href: `/${slug}/appointments` },
    { label: 'Invoices & Payments', icon: Receipt, href: `/${slug}/invoices` },
    { label: 'My Services', icon: ChartColumn, href: `/${slug}/services` },
    { label: 'My Profile', icon: UserRound, href: `/${slug}/profile` },
  ],
];

/**
 * Every signed-in portal page: the sign-in check, then the client's firm (GET /portal/{slug}/business;
 * another firm's portal answers NOT_FOUND), then the client shell. Nahid builds the look from
 * docs/mockups/client-portal/My docs tab.png (N01).
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  const { firmSlug } = useParams<{ firmSlug: string }>();
  return (
    <SignedIn site="portal" signInPath={`/${firmSlug}/sign-in`} firmSlug={firmSlug}>
      <ClientArea slug={firmSlug}>{children}</ClientArea>
    </SignedIn>
  );
}

function ClientArea({ slug, children }: { slug: string; children: ReactNode }) {
  const { me } = useMe();
  const router = useRouter();
  const [firm, setFirm] = useState<BusinessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A client still waiting for the firm's approval sees the "account created" page instead.
  const pending =
    me.clientAccounts.find((c) => c.business.slug.toLowerCase() === slug.toLowerCase())?.status ===
    'PENDING_APPROVAL';

  useEffect(() => {
    if (pending) {
      router.replace(`/${slug}/sign-up/done`);
      return;
    }
    let active = true;
    api.portalBusiness(slug).then(
      (b) => active && setFirm(b),
      (e: unknown) => active && setError(e instanceof ApiRequestError ? e.code : 'ERROR'),
    );
    return () => {
      active = false;
    };
  }, [slug, pending, router]);

  if (error) {
    return (
      <div data-testid="firm-error" className="mx-auto max-w-xl p-6 text-sm">
        <p className="font-medium text-text">This portal isn&apos;t available for your account.</p>
        <p className="mt-1 text-muted">({error})</p>
      </div>
    );
  }
  if (!firm) {
    return (
      <div aria-busy="true" className="flex min-h-screen items-center justify-center text-muted">
        Loading…
      </div>
    );
  }

  return <PortalShell sections={sections(slug)}>{children}</PortalShell>;
}

function PortalShell({ children, sections }: { children: ReactNode; sections: NavSections }) {
  const { business } = usePortal();
  const { me, signOut } = useMe();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const menu = (
    <nav aria-label="Main" className="flex h-full flex-col bg-firm-primary p-4 text-on-action">
      <p className="text-xl font-bold">{business.name}</p>
      {sections.flat().map(({ label, icon: Icon, href }) => (
        <Link
          key={label}
          href={href ?? `/${business.slug}/home`}
          onClick={() => setDrawer(false)}
          aria-current={href && isActive(pathname, href) ? 'page' : undefined}
          className={`flex items-center gap-3 rounded-control p-3 text-sm ${href && isActive(pathname, href) ? 'bg-firm-accent' : 'hover:bg-navigation-hover'}`}
        >
          <Icon aria-hidden className="size-6 shrink-0" />
          {label}
        </Link>
      ))}
      <Button
        variant="ghost"
        className="justify-start text-on-action hover:text-firm-primary"
        onClick={() => void signOut()}
      >
        <LogOut aria-hidden className="size-6" />
        Log Out
      </Button>
    </nav>
  );
  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-sidebar md:block">{menu}</aside>
      <div className="flex min-h-screen min-w-0 flex-col md:pl-sidebar [&_header>p]:flex-1 [&_header>p]:text-center [&_header>p]:font-display md:[&_header>p]:text-2xl">
        <Header
          roleLabel="Client"
          onOpenMenu={() => setDrawer(true)}
          greeting={`Welcome back, ${me.user.name.split(' ')[0]}!`}
        />
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        <PortalFooter />
      </div>
      <div className="[&_dialog]:m-0 [&_dialog]:h-screen! [&_dialog]:max-h-screen! [&_dialog]:w-sidebar! [&_dialog]:rounded-none [&_dialog]:p-0 [&_dialog>div]:p-4">
        <Modal open={drawer} title="Portal menu" onClose={() => setDrawer(false)}>
          {menu}
        </Modal>
      </div>
    </div>
  );
}
