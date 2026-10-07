'use client';

import type { ReactNode } from 'react';
import { Button } from './button';

export function Brand({ inverted = false }: { inverted?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span aria-hidden="true" className="rounded-control bg-accent px-3 py-2 font-bold text-white">
        F
      </span>
      <span className={`text-xl font-bold ${inverted ? 'text-white' : 'text-heading'}`}>
        Firmivra
      </span>
    </div>
  );
}
export interface NavItem {
  href: string;
  label: string;
  icon?: ReactNode;
}
export function Sidebar({
  items,
  active,
  footer,
  onNavigate,
}: {
  items: NavItem[];
  active: string;
  footer?: ReactNode;
  onNavigate?: () => void;
}) {
  return (
    <aside className="ui-sidebar flex h-full flex-col bg-navigation text-white">
      <div className="p-6">
        <Brand inverted />
        <p className="mt-2 text-xs uppercase tracking-eyebrow">Workspace</p>
      </div>
      <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1 px-3">
        {items.map((item) => (
          <a
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active === item.href ? 'page' : undefined}
            className={`flex min-h-11 items-center gap-3 rounded-control px-3 py-2 text-sm hover:bg-navigation-hover ${active === item.href ? 'ui-nav-active' : ''}`}
          >
            <span aria-hidden="true" className="w-5 text-center">
              {item.icon ?? '◇'}
            </span>
            {item.label}
          </a>
        ))}
      </nav>
      {footer ? <div className="border-t border-navigation-hover p-4">{footer}</div> : null}
    </aside>
  );
}
export function Header({
  title,
  user,
  actions,
  onMenu,
  titleTestId,
}: {
  title: string;
  user: string;
  actions?: ReactNode;
  onMenu?: () => void;
  titleTestId?: string;
}) {
  return (
    <header className="ui-header flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {onMenu ? (
          <Button
            variant="secondary"
            className="lg:hidden"
            onClick={onMenu}
            aria-label="Open navigation"
          >
            ☰
          </Button>
        ) : null}
        <p data-testid={titleTestId} className="truncate font-semibold text-heading">
          {title}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {actions}
        <span className="hidden text-sm text-muted sm:inline">{user}</span>
        <span
          aria-hidden="true"
          className="flex h-9 w-9 items-center justify-center rounded-pill bg-folder-surface font-semibold text-heading"
        >
          {user.slice(0, 1)}
        </span>
      </div>
    </header>
  );
}
