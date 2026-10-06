'use client';

import { ApiRequestError, type BusinessSummary, type MembershipRole } from '@firmivra/types';
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
  const { me } = useMe();
  const [firm, setFirm] = useState<BusinessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.currentBusiness().then(
      (b) => active && setFirm(b),
      (e: unknown) => active && setError(e instanceof ApiRequestError ? e.code : 'ERROR'),
    );
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div data-testid="firm-error" className="mx-auto max-w-xl p-6 text-sm">
        <p className="font-medium text-text">We couldn&apos;t open your firm.</p>
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
