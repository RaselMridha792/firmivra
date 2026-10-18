'use client';

import {
  ApiRequestError,
  type BusinessSummary,
  FIRM_ROLE_LABELS,
  type MembershipRole,
} from '@firmivra/types';
import { Button } from '@firmivra/ui';
import {
  Briefcase,
  CalendarDots,
  ChartLineUp,
  ChartPieSlice,
  CheckSquare,
  CurrencyDollar,
  ChatCircleDots,
  ClipboardText,
  Files,
  FileText,
  GearSix,
  House,
  type Icon,
  PuzzlePiece,
  Receipt,
  ShieldCheck,
  Signature,
  Tag,
  Target,
  UserGear,
  UserPlus,
  Users,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { AppShell } from '../../../components/app-shell/app-shell';
import {
  FirmBell,
  FirmFooter,
  FirmSearch,
  HelpLink,
  NewMenu,
} from '../../../components/app-shell/firm-controls';
import type { NavItem } from '../../../components/app-shell/types';
import { FirmContext } from '../../../components/firm-context';
import { SignedIn, useMe } from '../../../components/signed-in';
import { api } from '../../../lib/api';
import { COMPANY } from '../../../lib/company';
import { portalAuth } from '../../../lib/auth';
import { findModule, moduleHref } from '../../../lib/firm-modules';
import { useApiQuery } from '../../../lib/query';
import { claimCache } from '../../../lib/session';

// The firm's menu (docs/junior/PAGE-MAP.md; Fahad owns this list, F03). Items marked `managers`
// show only to Owner and Admin; the API still checks every request.
/** The design's solid icons: Phosphor's fill weight. */
const solid =
  (Glyph: Icon): NavItem['icon'] =>
  (props) => <Glyph weight="fill" {...props} />;

const link = (label: string, glyph: Icon, href: string, managers?: true) => ({
  label,
  icon: solid(glyph),
  href,
  ...(managers && { managers }),
});
// A module that is not built opens the shared module page (src/lib/firm-modules.ts).
const mod = (slug: string): NavItem & { managers?: true } => {
  const m = findModule(slug);
  if (!m) throw new Error(`Unknown module: ${slug}`);
  return link(m.label, m.icon, moduleHref(slug));
};

/** Octavia's order (docs/mockups/firm-workspace/dashboard); the four extras keep their place. */
const items: (NavItem & { managers?: true })[] = [
  link('Dashboard', House, '/'),
  link('Clients', Users, '/clients'),
  link('Sign-ups', UserPlus, '/sign-ups', true),
  link('Leads', Target, '/leads'),
  link('Appointments', CalendarDots, '/calendar'),
  link('Intake Forms', FileText, '/intake-forms'),
  link('Documents', Files, '/documents'),
  mod('client-portal'),
  mod('tax-returns'),
  mod('bookkeeping'),
  link('Payroll', CurrencyDollar, '/payroll'),
  link('Tax Planning & Strategy', ChartPieSlice, '/tax-planning'),
  link('Business Advisory & Development', Briefcase, '/business-advisory'),
  link('Invoices & Payments', Receipt, '/invoices'),
  link('Messages', ChatCircleDots, '/messages'),
  mod('communications'),
  link('Tasks', CheckSquare, '/tasks'),
  mod('automations'),
  link('Compliance & Deadlines', ShieldCheck, '/compliance'),
  link('Reports', ChartLineUp, '/reports'),
  mod('templates'),
  link('Services & Pricing', Tag, '/services-pricing'),
  link('Workspaces', Briefcase, '/workspaces'),
  link('Firm Sign', Signature, '/firm-sign'),
  link('Audit log', ClipboardText, '/audit-log', true),
  link('Staff Management', UserGear, '/team', true),
  link('Integrations', PuzzlePiece, '/integrations'),
  link('Settings', GearSix, '/settings', true),
];

/** The "+ New" menu: where each new thing is created (all of them are pages that exist). */
const newLinks = [
  { label: 'New client', href: '/clients' },
  { label: 'New appointment', href: '/calendar' },
  { label: 'New invoice', href: '/invoices', managers: true },
  { label: 'New message', href: '/messages' },
];

/** What a signed-in person sees when the firm can't be opened (GET /business). */
const FIRM_ERRORS: Record<string, string> = {
  BUSINESS_INACTIVE: 'This firm is not active right now. Contact Firmivra support.',
  BUSINESS_REQUIRED:
    "Your account belongs to more than one firm, and choosing a firm isn't available yet.",
  NOT_FOUND: "Your account isn't a member of a firm on this site.",
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
  const queryClient = useQueryClient();
  const [firm, setFirm] = useState<BusinessSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.currentBusiness().then(
      (b) => {
        if (!active) return;
        // Another firm than last time on this tab starts with an empty data cache.
        claimCache(queryClient, 'firm', b.id);
        setFirm(b);
      },
      (e: unknown) => {
        if (!active) return;
        const code = e instanceof ApiRequestError ? e.code : 'ERROR';
        // A firm still in Pending Setup finishes the setup wizard first; a lost session signs in.
        if (code === 'BUSINESS_SETUP_REQUIRED') router.replace('/setup');
        else if (e instanceof ApiRequestError && e.status === 401) router.replace('/sign-in');
        // An in-person signing locked this session: only the kiosk's own pages open (R13).
        else if (code === 'KIOSK_LOCKED') router.replace('/firm-sign/in-person');
        else setError(code);
      },
    );
    return () => {
      active = false;
    };
  }, [router, queryClient]);
  // After a settings save: the header shows the new name without a reload. A failed reload keeps
  // the name on screen; the next page load shows the new one.
  const refresh = useCallback(async () => {
    const b = await api.currentBusiness().catch(() => null);
    setFirm((current) => (b && current?.id === b.id ? b : current));
  }, []);

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
    <FirmShell firm={firm} role={role} manager={manager}>
      {/* Pages read the firm and the role with useFirm() (and <RequireRole>). */}
      <FirmContext value={{ firm, role, refresh }}>{children}</FirmContext>
    </FirmShell>
  );
}

/** The sidebar and header with the firm's own logo, motto and unread count. */
function FirmShell({
  firm,
  role,
  manager,
  children,
}: {
  firm: BusinessSummary;
  role: MembershipRole | undefined;
  manager: boolean;
  children: ReactNode;
}) {
  // The portal's public info is the one place every role can read the firm's logo and motto.
  const info = useApiQuery(['firm', firm.id, 'branding'], () => portalAuth(firm.slug).info());
  const unread = useApiQuery(['messages', 'unread-count'], () => api.messages.unreadCount());
  const branding = info.data?.branding;
  const badge = unread.data?.total;
  return (
    <AppShell
      subtitle="Firm workspace"
      sections={[
        items
          .filter((i) => manager || !i.managers)
          .map((i) => (i.href === '/messages' && badge ? { ...i, badge } : i)),
      ]}
      roleLabel={role ? FIRM_ROLE_LABELS[role] : 'Staff'}
      brand={{
        name: firm.name,
        logoUrl: branding?.logoUrl ?? null,
        slogan: branding?.sidebarSlogan ?? null,
        motto: branding?.sidebarMotto ?? null,
      }}
      headerStart={<FirmSearch />}
      headerActions={
        <>
          <NewMenu links={newLinks.filter((l) => manager || !('managers' in l))} />
          <HelpLink email={COMPANY.supportEmail} />
        </>
      }
      bell={<FirmBell />}
      footer={
        <FirmFooter
          name={firm.name}
          logoUrl={branding?.logoLightUrl ?? null}
          supportEmail={COMPANY.supportEmail}
        />
      }
    >
      {children}
    </AppShell>
  );
}
