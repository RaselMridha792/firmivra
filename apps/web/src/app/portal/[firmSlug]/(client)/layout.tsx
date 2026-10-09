'use client';

import { ApiRequestError, type BusinessSummary } from '@firmivra/types';
import {
  Calculator,
  CalendarDays,
  LogOut,
  ChartColumn,
  PenLine,
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
import Image from 'next/image';
import Link from 'next/link';
import { Header } from '../../../../components/app-shell/header';
import { isActive } from '../../../../components/app-shell/types';
import { usePortal } from '../layout';
import { PortalFooter } from '../(public)/_components/portal-footer';
import { PortalBell } from './_components/portal-bell';
import type { NavSections } from '../../../../components/app-shell/types';
import { SignedIn, useMe } from '../../../../components/signed-in';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';

// Client menu (docs/junior/PAGE-MAP.md). Messages shows the unread firm messages. "Signatures" shows
// when the firm uses Firm Sign, "Tax Calculators" when the firm shares at least one calculator.
const sections = (
  slug: string,
  extra: { signatures: boolean; calculators: boolean; unread: number },
): NavSections => [
  [
    { label: 'Home', icon: House, href: `/${slug}/home` },
    { label: 'My Documents', icon: CloudUpload, href: `/${slug}/documents` },
    { label: 'Intake Forms', icon: FileText, href: `/${slug}/intake` },
    {
      label: 'Messages',
      icon: MessageSquare,
      href: `/${slug}/messages`,
      badge: extra.unread || undefined,
    },
    { label: 'Appointments', icon: CalendarDays, href: `/${slug}/appointments` },
    { label: 'Invoices & Payments', icon: Receipt, href: `/${slug}/invoices` },
    { label: 'My Services', icon: ChartColumn, href: `/${slug}/services` },
    ...(extra.signatures
      ? [{ label: 'Signatures', icon: PenLine, href: `/${slug}/signatures` }]
      : []),
    ...(extra.calculators
      ? [{ label: 'Tax Calculators', icon: Calculator, href: `/${slug}/calculator` }]
      : []),
    { label: 'My Profile', icon: UserRound, href: `/${slug}/profile` },
  ],
];

/**
 * Every signed-in portal page: the sign-in check, then the client's firm (GET /portal/{slug}/business;
 * another firm's portal answers NOT_FOUND), then the client shell. Nahid builds the look from
 * docs/mockups/client-portal/My docs tab.png (N01, R17).
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

  return <PortalShell slug={slug}>{children}</PortalShell>;
}

/**
 * docs/mockups/client-portal/My docs tab.png: a full-width header with the firm's logo, the menu
 * on the left (a drawer below 768 px), and a full-width footer.
 */
function PortalShell({ children, slug }: { children: ReactNode; slug: string }) {
  const { business, branding } = usePortal();
  const { me, signOut } = useMe();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  // A failed check only hides the menu line.
  const signatures = useApiQuery(['my-signatures-status', slug], () =>
    api.mySignatures(slug).status(),
  );
  const calculators = useApiQuery(['my-calculators', slug], () => api.myCalculators(slug).list());
  const unread = useApiQuery(['my-messages', slug, 'unread'], () =>
    api.myMessages(slug).unreadCount(),
  );
  const nav = sections(slug, {
    signatures: signatures.data?.enabled === true,
    calculators: (calculators.data?.length ?? 0) > 0,
    unread: unread.data?.count ?? 0,
  });
  const menu = (inDrawer: boolean) => (
    <nav aria-label="Main" className="flex h-full flex-col bg-firm-primary p-4 text-on-action">
      {inDrawer ? <p className="text-xl font-bold">{business.name}</p> : null}
      {nav.flat().map(({ label, icon: Icon, href, badge }) => (
        <Link
          key={label}
          href={href ?? `/${business.slug}/home`}
          onClick={() => setDrawer(false)}
          aria-current={href && isActive(pathname, href) ? 'page' : undefined}
          className={`flex items-center gap-3 rounded-control p-3 text-sm ${href && isActive(pathname, href) ? 'bg-firm-accent' : 'hover:bg-navigation-hover'}`}
        >
          <Icon aria-hidden className="size-6 shrink-0" />
          <span className="flex-1">{label}</span>
          {badge ? (
            <span className="rounded-full bg-on-action px-2 text-xs font-bold text-firm-primary">
              {badge}
              <span className="sr-only"> unread</span>
            </span>
          ) : null}
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
    <div className="flex min-h-screen flex-col">
      <div className="flex items-stretch border-b border-border bg-surface print:hidden">
        <Link
          href={`/${business.slug}/home`}
          className="hidden w-sidebar shrink-0 items-center gap-3 px-4 text-lg font-bold text-firm-primary md:flex"
        >
          {branding.logoUrl ? (
            <Image unoptimized src={branding.logoUrl} alt={business.name} width={176} height={56} />
          ) : (
            business.name
          )}
        </Link>
        <div className="min-w-0 flex-1 [&_header]:border-b-0 [&_header>p]:flex-1 [&_header>p]:text-center [&_header>p]:font-display md:[&_header>p]:text-2xl">
          <Header
            roleLabel="Client"
            onOpenMenu={() => setDrawer(true)}
            bell={<PortalBell slug={slug} />}
            greeting={`Welcome back, ${me.user.name.split(' ')[0]}!`}
          />
        </div>
      </div>
      <div className="flex flex-1">
        <aside className="hidden w-sidebar shrink-0 bg-firm-primary md:block print:hidden">
          <div className="sticky top-0 h-screen">{menu(false)}</div>
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
      <div className="print:hidden">
        <PortalFooter contact />
      </div>
      <div className="[&_dialog]:m-0 [&_dialog]:h-screen! [&_dialog]:max-h-screen! [&_dialog]:w-sidebar! [&_dialog]:rounded-none [&_dialog]:p-0 [&_dialog>div]:p-4">
        <Modal open={drawer} title="Portal menu" onClose={() => setDrawer(false)}>
          {menu(true)}
        </Modal>
      </div>
    </div>
  );
}
