'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Header,
  Modal,
  Sidebar,
  NotificationBell,
  Select,
  Skeleton,
  EmptyState,
  type NavItem,
} from '@firmivra/ui';
import { AUTH_MODE, adminAuth, staffAuth, signOut } from '../lib/auth';
import { useWorkspace } from './workspace-context';
import { AdminShell } from './admin-shell';

const firmNav: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '⌂' },
  { href: '/clients', label: 'Clients' },
  { href: '/leads', label: 'Leads' },
  { href: '/documents', label: 'Documents' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/services', label: 'Services' },
  { href: '/messages', label: 'Messages' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/team', label: 'Team' },
  { href: '/sign-ups', label: 'Pending sign-ups' },
  { href: '/settings', label: 'Settings' },
];
const adminNav: NavItem[] = [
  { href: '/', label: 'Dashboard', icon: '⌂' },
  { href: '/applications', label: 'Firm Applications' },
  { href: '/firms', label: 'Firms' },
  ...[
    'Sales',
    'Leads / CRM',
    'Team',
    'Subscriptions',
    'Billing',
    'Support',
    'Reports',
    'Audit',
    'Settings',
  ].map((label) => ({ href: `/future/${label.toLowerCase().replace(/[^a-z]+/g, '-')}`, label })),
];
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const workspace = useWorkspace();
  const path = usePathname();
  const router = useRouter();
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewState, setPreviewState] = useState('ready');
  const owner = workspace.role === 'OWNER' || workspace.role === 'ADMIN';
  const items = (
    workspace.site === 'admin'
      ? adminNav
      : firmNav.filter(
          (item) => owner || !['/team', '/settings', '/sign-ups', '/invoices'].includes(item.href),
        )
  ).map((item) => ({
    ...item,
    href: `${item.href === '/dashboard' && owner ? '/admin/dashboard' : item.href}${workspace.preview ? '?preview=1' : ''}`,
  }));
  async function leave() {
    setBusy(true);
    setError('');
    try {
      if (AUTH_MODE === 'local') await signOut();
      else await (workspace.site === 'admin' ? adminAuth : staffAuth).signOut();
      window.sessionStorage.removeItem('fv-business-id');
      router.replace('/sign-in');
      router.refresh();
    } catch {
      setError('We could not sign you out. Please try again.');
      setBusy(false);
    }
  }
  const sidebar = (
    <Sidebar
      items={items}
      active={`${path}${workspace.preview ? '?preview=1' : ''}`}
      footer={
        <div className="space-y-3">
          <p className="text-xs">{workspace.role.replace('_', ' ')}</p>
          <p data-testid="me-email" className="break-all text-xs">
            {workspace.me.user.email}
          </p>
          <Button
            variant="secondary"
            loading={busy}
            onClick={() => void leave()}
            className="w-full"
          >
            Sign out
          </Button>
        </div>
      }
    />
  );
  if (workspace.site === 'admin')
    return (
      <AdminShell onLogout={() => void leave()} error={error}>
        {children}
      </AdminShell>
    );
  return (
    <div className="flex min-h-screen" data-theme="firmivra">
      <a
        href="#workspace-content"
        className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-surface focus:p-4"
      >
        Skip to content
      </a>
      <div className="fixed inset-y-0 hidden lg:block">{sidebar}</div>
      <div className="flex min-w-0 flex-1 flex-col lg:pl-sidebar">
        <Header
          title={workspace.business?.name ?? 'Firm workspace'}
          user={workspace.me.user.name}
          onMenu={() => setMenu(true)}
          actions={
            <NotificationBell
              items={workspace.notifications}
              onRead={workspace.preview ? workspace.readNotification : undefined}
              error={workspace.preview ? undefined : 'Notifications are not available right now.'}
              centerHref={`/notifications${workspace.preview ? '?preview=1' : ''}`}
            />
          }
        />
        <main
          id="workspace-content"
          className="ui-content w-full self-center space-y-6 p-4 md:p-6 lg:p-8"
        >
          {error ? <Alert title={error} tone="danger" /> : null}
          {AUTH_MODE === 'local' ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-control border border-border bg-folder-surface p-3 text-sm">
              <p>
                {workspace.preview
                  ? 'Preview only — synthetic examples. Changes are not saved.'
                  : 'Local development workspace'}
              </p>
              <a
                href={`${path}${workspace.preview ? '' : '?preview=1'}`}
                className="text-link underline"
              >
                {workspace.preview ? 'Exit sample preview' : 'Preview sample screens'}
              </a>
            </div>
          ) : null}
          {workspace.business ? (
            <p data-testid="firm-name" className="sr-only">
              {workspace.business.name} ({workspace.business.slug})
            </p>
          ) : null}
          {workspace.preview ? (
            <Select
              label="Preview screen state"
              value={previewState}
              onChange={(e) => setPreviewState(e.target.value)}
              options={[
                { value: 'ready', label: 'Sample records' },
                { value: 'loading', label: 'Loading' },
                { value: 'empty', label: 'Empty' },
                { value: 'error', label: 'Error' },
                { value: 'denied', label: 'No permission' },
              ]}
            />
          ) : null}
          {!workspace.preview || previewState === 'ready' ? (
            children
          ) : previewState === 'loading' ? (
            <div role="status" aria-label="Loading screen" className="space-y-6">
              <Skeleton className="h-12" />
              <Skeleton className="h-48" />
            </div>
          ) : previewState === 'error' ? (
            <Alert title="We could not load this page" tone="danger">
              <Button variant="secondary" onClick={() => setPreviewState('ready')}>
                Try again
              </Button>
            </Alert>
          ) : (
            <EmptyState
              title={previewState === 'denied' ? 'Permission required' : 'No records yet'}
              description={
                previewState === 'denied'
                  ? 'Ask your firm owner for access.'
                  : 'Records will appear here when available.'
              }
            />
          )}
        </main>
        <footer className="mt-auto border-t border-border bg-surface px-6 py-4 text-xs text-muted">
          Firmivra · Secure firm and client workspaces
        </footer>
      </div>
      <Modal open={menu} title="Navigation" onClose={() => setMenu(false)}>
        {menu ? <div className="flex justify-center">{sidebar}</div> : null}
      </Modal>
    </div>
  );
}
