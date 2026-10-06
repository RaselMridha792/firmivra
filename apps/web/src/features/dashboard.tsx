'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Card, EmptyState } from '@firmivra/ui';
import { useWorkspace } from '../components/workspace-context';
import { PlatformDashboard } from './platform-dashboard';

export function Dashboard({ routeHome = false }: { routeHome?: boolean }) {
  const { site, me, business, role, preview } = useWorkspace();
  const router = useRouter();
  const owner = role === 'OWNER' || role === 'ADMIN';
  useEffect(() => {
    if (routeHome && site === 'firm')
      router.replace(
        `${business?.status === 'PENDING_SETUP' && owner ? '/setup' : owner ? '/admin/dashboard' : '/dashboard'}${preview ? '?preview=1' : ''}`,
      );
  }, [routeHome, site, business?.status, owner, preview, router]);
  const cards =
    site === 'admin'
      ? [
          { title: 'Pending applications', href: '/applications' },
          { title: 'Active firms', href: '/firms' },
          { title: 'Platform users', href: '/future/team' },
          { title: 'Monthly revenue', href: '/future/billing' },
        ]
      : [
          { title: 'Clients', href: '/clients' },
          { title: 'Pending sign-ups', href: '/sign-ups' },
          { title: 'Appointments today', href: '/calendar' },
          { title: 'Unpaid invoices', href: '/invoices' },
        ].filter((c) => owner || c.href !== '/sign-ups');
  if (site === 'admin') return <PlatformDashboard />;
  return (
    <>
      <div>
        <h1 className="text-3xl font-bold text-heading">
          Welcome back, {me.user.name.split(' ')[0]}!
        </h1>
        <p className="mt-2 text-sm text-muted">
          Your firm’s work, clients and next steps in one place.
        </p>
      </div>
      {business?.status === 'PENDING_SETUP' && owner ? (
        <Alert title="Finish setting up your workspace">
          <a href="/setup" className="text-link underline">
            Continue setup
          </a>
        </Alert>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Card key={card.href}>
            <p className="text-sm text-muted">{card.title}</p>
            <p className="my-3 text-3xl font-bold text-heading">—</p>
            <a
              href={`${card.href}${preview ? '?preview=1' : ''}`}
              className="text-sm text-link underline"
            >
              View {card.title.toLowerCase()} →
            </a>
          </Card>
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Your next steps" className="xl:col-span-2">
          <EmptyState
            title="Your overview is getting ready"
            description="Your latest records will appear here when they are available."
          />
        </Card>
        <Card title="Quick actions">
          <div className="flex flex-col gap-4 text-sm">
            {[
              { href: '/clients', title: 'View clients' },
              { href: '/documents', title: 'Manage documents' },
              { href: '/calendar', title: 'Open calendar' },
              ...(owner ? [{ href: '/settings', title: 'Workspace settings' }] : []),
            ].map((action) => (
              <a
                key={action.href}
                href={`${action.href}${preview ? '?preview=1' : ''}`}
                className="min-h-11 rounded-control bg-folder-surface p-3 text-link"
              >
                {action.title} →
              </a>
            ))}
          </div>
        </Card>
      </div>
      <Card title="Recent activity">
        <EmptyState
          title="No activity loaded"
          description="Updates from your firm will appear here."
        />
      </Card>
    </>
  );
}
