'use client';

import { ApiRequestError, type BusinessSummary, type MembershipRole } from '@firmivra/types';
import { Button } from '@firmivra/ui';
import {
  Briefcase,
  CalendarDays,
  House,
  MessageSquare,
  Receipt,
  Settings,
  Target,
  UserPlus,
  Users,
  UsersRound,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useState } from 'react';
import { AppShell } from '../../../components/app-shell/app-shell';
import type { NavItem } from '../../../components/app-shell/types';
import { SignedIn, useMe } from '../../../components/signed-in';
import { api } from '../../../lib/api';

// The firm's menu (docs/junior/PAGE-MAP.md; Fahad owns this list, F03). Items marked `managers`
// show only to Owner and Admin; the API still checks every request.
const items: (NavItem & { managers?: true })[] = [
  { label: 'Dashboard', icon: House, href: '/' },
  { label: 'Clients', icon: Users, href: '/clients' },
  { label: 'Sign-ups', icon: UserPlus, href: '/sign-ups', managers: true },
  { label: 'Leads', icon: Target, href: '/leads' },
  { label: 'Messages', icon: MessageSquare, href: '/messages' },
  { label: 'Calendar', icon: CalendarDays, href: '/calendar' },
  { label: 'Invoices', icon: Receipt, href: '/invoices' },
  { label: 'Workspaces', icon: Briefcase, href: '/workspaces' },
  { label: 'Team', icon: UsersRound, href: '/team', managers: true },
  { label: 'Settings', icon: Settings, href: '/settings', managers: true },
];

/** What a signed-in person sees when the firm can't be opened (GET /business). */
const FIRM_ERRORS: Record<string, string> = {
  BUSINESS_INACTIVE: 'This firm is not active right now. Contact Firmivra support.',
  BUSINESS_REQUIRED:
    "Your account belongs to more than one firm, and choosing a firm isn't available yet.",
  NOT_FOUND: "Your account isn't a member of a firm on this site.",
};

const ROLE_LABEL: Record<MembershipRole, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  STAFF: 'Staff',
};

/** Every firm workspace page with the sidebar: the sign-in check, the firm, then the shell. */
export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <SignedIn site="firm" signInPath="/sign-in">
      <FirmArea>{children}</FirmArea>
    </SignedIn>
  );
}

function FirmArea({ children }: { children: ReactNode }) {
  const { me, signOut } = useMe();
  const router = useRouter();
  const [firm, setFirm] = useState<BusinessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.currentBusiness().then(
      (b) => active && setFirm(b),
      (e: unknown) => {
        if (!active) return;
        const code = e instanceof ApiRequestError ? e.code : 'ERROR';
        // A firm still in Pending Setup finishes the setup wizard first; a lost session signs in.
        if (code === 'BUSINESS_SETUP_REQUIRED') router.replace('/setup');
        else if (e instanceof ApiRequestError && e.status === 401) router.replace('/sign-in');
        else setError(code);
      },
    );
    return () => {
      active = false;
    };
  }, [router]);

  if (error) {
    return (
      <div
        data-testid="firm-error"
        className="mx-auto flex max-w-xl flex-col items-start gap-3 p-6"
      >
        <p className="font-medium text-text">
          {FIRM_ERRORS[error] ?? "We couldn't open your firm."}
        </p>
        <p className="text-sm text-muted">({error})</p>
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
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

  const role = me.memberships.find((m) => m.business.id === firm.id && m.status === 'ACTIVE')?.role;
  const manager = role === 'OWNER' || role === 'ADMIN';
  return (
    <AppShell
      subtitle="Firm workspace"
      sections={[items.filter((i) => manager || !i.managers)]}
      roleLabel={role ? ROLE_LABEL[role] : 'Staff'}
      greeting={<span data-testid="firm-name">{firm.name}</span>}
    >
      {children}
    </AppShell>
  );
}
