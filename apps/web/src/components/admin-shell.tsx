'use client';

import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Alert, Icon, Modal, type IconName } from '@firmivra/ui';
import { useWorkspace } from './workspace-context';

const navigation: { label: string; href: string; icon: IconName; soon?: boolean }[] = [
  { label: 'Dashboard', href: '/', icon: 'home' },
  { label: 'Firm Applications', href: '/applications', icon: 'file' },
  { label: 'Firms', href: '/firms', icon: 'firm' },
  { label: 'Sales', href: '/future/sales', icon: 'sales', soon: true },
  { label: 'Leads / CRM', href: '/future/leads-crm', icon: 'message', soon: true },
  { label: 'Team', href: '/future/team', icon: 'users', soon: true },
  { label: 'Subscriptions', href: '/future/subscriptions', icon: 'card', soon: true },
  { label: 'Billing', href: '/future/billing', icon: 'wallet', soon: true },
  { label: 'Support', href: '/future/support', icon: 'headset', soon: true },
  { label: 'Reports & Analytics', href: '/future/reports', icon: 'chart', soon: true },
  { label: 'Notifications', href: '/notifications', icon: 'bell', soon: true },
  { label: 'Audit & Security', href: '/future/audit', icon: 'shield', soon: true },
  { label: 'System Settings', href: '/future/settings', icon: 'settings', soon: true },
];
export function AdminShell({
  children,
  onLogout,
  error,
}: {
  children: ReactNode;
  onLogout: () => void;
  error: string;
}) {
  const { me, preview } = useWorkspace();
  const pathname = usePathname();
  const path = pathname.replace(/^\/admin(?=\/|$)/, '') || '/';
  const horizontal = /^\/(applications|firms)\/.+/.test(path);
  const [mobileMenu, setMobileMenu] = useState(false);
  const name = preview ? 'Olivia Holder' : me.user.name;
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');
  const href = (value: string) => `${value}${preview ? '?preview=1' : ''}`;
  const active = (item: (typeof navigation)[number]) =>
    item.href === '/' ? path === '/' : path.startsWith(item.href);
  const brand = (top = false) => (
    <a href={href('/')} aria-label="Firmivra dashboard">
      <Image
        src={top ? '/brand/firmivra-wordmark-topbar.png' : '/brand/firmivra-wordmark-dark.png'}
        alt="Firmivra Super Admin Portal"
        width={top ? 177 : 233}
        height={top ? 60 : 80}
        unoptimized
      />
    </a>
  );
  const profile = (
    <>
      <span className="ref-avatar">{initials}</span>
      <span className="ref-user-name">
        <strong>{name}</strong>
        <small>Owner / Super Admin</small>
      </span>
      <Icon name="down" />
    </>
  );
  return (
    <div
      className={`ref-admin ${horizontal ? 'ref-admin-horizontal' : ''} ${path === '/' ? 'ref-admin-dashboard-layout' : ''}`}
      data-theme="firmivra"
      data-preview={preview ? 'synthetic' : undefined}
    >
      <a href="#workspace-content" className="sr-only focus:not-sr-only">
        Skip to content
      </a>
      {!horizontal ? (
        <aside className="ref-admin-sidebar">
          <div className="ref-sidebar-brand">{brand()}</div>
          <nav aria-label="Super Admin navigation">
            {navigation.map((item, i) => (
              <a
                key={item.href}
                href={href(item.href)}
                className={`${active(item) ? 'is-active' : ''} ${i === 3 ? 'after-rule' : ''}`}
                aria-current={active(item) ? 'page' : undefined}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {item.soon ? (
                  <small>Soon</small>
                ) : item.href === '/applications' && preview ? (
                  <small className="ref-count">1</small>
                ) : null}
              </a>
            ))}
          </nav>
          <div className="ref-sidebar-account">
            <div className="ref-user">{profile}</div>
            <button onClick={onLogout}>
              <Icon name="logout" />
              Logout
            </button>
          </div>
        </aside>
      ) : null}
      <Modal open={mobileMenu} title="Super Admin navigation" onClose={() => setMobileMenu(false)}>
        <nav aria-label="Mobile Super Admin navigation" className="grid gap-3">
          {navigation.map((item) => (
            <a
              key={item.href}
              href={href(item.href)}
              aria-current={active(item) ? 'page' : undefined}
            >
              {item.label}
              {item.soon ? ' · Soon' : ''}
            </a>
          ))}
          <button onClick={onLogout}>Logout</button>
        </nav>
      </Modal>
      <div className="ref-admin-body">
        <header className="ref-admin-header">
          {horizontal ? (
            <>
              <div className="ref-topbar-brand">{brand(true)}</div>
              <nav className="ref-admin-topnav" aria-label="Super Admin navigation">
                {navigation.slice(0, 5).map((item) => (
                  <a
                    key={item.href}
                    href={href(item.href)}
                    className={active(item) ? 'is-active' : ''}
                  >
                    <Icon name={item.icon} />
                    {item.label}
                    {item.soon ? <small>Soon</small> : null}
                  </a>
                ))}
                <details>
                  <summary>
                    More <Icon name="down" />
                  </summary>
                  <div>
                    {navigation.slice(5).map((item) => (
                      <a key={item.href} href={href(item.href)}>
                        {item.label}
                        <small>Soon</small>
                      </a>
                    ))}
                    <button onClick={onLogout}>Logout</button>
                  </div>
                </details>
              </nav>
            </>
          ) : (
            <form className="ref-header-search" action="/applications">
              <Icon name="search" />
              <input
                name="q"
                aria-label="Search firms, applications, users"
                placeholder="Search firms, applications, users..."
              />
              {preview ? <input type="hidden" name="preview" value="1" /> : null}
            </form>
          )}
          <button
            className="ref-mobile-toggle"
            aria-label={mobileMenu ? 'Close navigation' : 'Open navigation'}
            onClick={() => setMobileMenu(!mobileMenu)}
          >
            <Icon name="menu" />
          </button>
          <a className="ref-admin-bell" aria-label="Notifications" href={href('/notifications')}>
            <Icon name="bell" />
            <i />
          </a>
          <details className="ref-profile-menu">
            <summary className="ref-user">{profile}</summary>
            <div>
              <button onClick={onLogout}>
                <Icon name="logout" /> Logout
              </button>
            </div>
          </details>
        </header>
        <span className="sr-only" data-testid="me-email">
          {me.user.email}
        </span>
        <main id="workspace-content" className="ref-admin-main">
          {error ? <Alert title={error} tone="danger" /> : null}
          {children}
        </main>
      </div>
    </div>
  );
}
