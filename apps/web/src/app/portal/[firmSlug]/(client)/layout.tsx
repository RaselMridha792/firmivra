'use client';

import { ApiRequestError, type BusinessSummary } from '@firmivra/types';
import {
  CalendarDays,
  ChartColumn,
  CloudUpload,
  FileText,
  House,
  MessageSquare,
  Receipt,
  UserRound,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { AppShell } from '../../../../components/app-shell/app-shell';
import type { NavSections } from '../../../../components/app-shell/types';
import { SignedIn, useMe } from '../../../../components/signed-in';
import { api } from '../../../../lib/api';

const YEAR = new Date().getFullYear();

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
    <SignedIn site="portal" signInPath={`/${firmSlug}/sign-in`}>
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
    me.clientAccounts.find((c) => c.business.slug === slug)?.status === 'PENDING_APPROVAL';

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

  const firstName = me.user.name.split(' ')[0] ?? me.user.name;
  return (
    <AppShell
      subtitle={firm.name}
      sections={sections(slug)}
      roleLabel="Client"
      greeting={`Welcome back, ${firstName}!`}
      footer={
        <footer className="flex flex-wrap gap-4 bg-brand-900 px-6 py-3 text-xs text-white">
          <span>
            © {YEAR} <span data-testid="firm-name">{firm.name}</span>
          </span>
          <span className="ml-auto">Privacy Policy</span>
          <span>Terms of Service</span>
          <span>Contact Us</span>
        </footer>
      }
    >
      {children}
    </AppShell>
  );
}
