'use client';

import { LogOut } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMe } from '../signed-in';
import { initials, isActive, type NavSections } from './types';

/** Navy sidebar: logo, menu groups, the signed-in user and Log out. */
export function Sidebar({
  subtitle,
  sections,
  roleLabel,
  onNavigate,
}: {
  subtitle: string;
  sections: NavSections;
  roleLabel: string;
  /** Closes the mobile drawer after a click. */
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { me, signOut } = useMe();

  return (
    <nav aria-label="Main" className="flex h-full w-72 flex-col bg-brand-900 text-white">
      <div className="px-6 py-6">
        <p className="text-2xl font-bold">Firmivra</p>
        <p className="text-xs tracking-widest text-brand-100 uppercase">{subtitle}</p>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3">
        {sections.map((items, i) => (
          <ul
            key={items[0]?.label ?? 'group'}
            className={`flex flex-col gap-1 ${i > 0 ? 'border-t border-brand-700 pt-2' : ''}`}
          >
            {items.map((item) => {
              const Icon = item.icon;
              const body = (
                <>
                  <Icon aria-hidden className="size-5 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  {item.soon ? (
                    <span className="rounded-control bg-brand-700 px-2 py-0.5 text-xs">Soon</span>
                  ) : null}
                  {item.badge ? (
                    <span className="rounded-control bg-accent-500 px-2 py-0.5 text-xs font-semibold">
                      {item.badge}
                    </span>
                  ) : null}
                </>
              );
              const row = 'flex items-center gap-3 rounded-control px-3 py-2 text-sm';
              if (!item.href) {
                return (
                  <li key={item.label} aria-disabled="true" className={`${row} text-brand-100`}>
                    {body}
                  </li>
                );
              }
              const active = isActive(pathname, item.href);
              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={`${row} ${active ? 'bg-brand-600 font-semibold' : 'hover:bg-brand-700'}`}
                  >
                    {body}
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </div>

      <div className="flex flex-col gap-2 border-t border-brand-700 px-3 py-4">
        <div className="flex items-center gap-3 px-3">
          <span className="flex size-10 items-center justify-center rounded-full bg-brand-700 text-sm font-semibold">
            {initials(me.user.name)}
          </span>
          <span className="flex flex-col text-sm">
            <span className="font-semibold">{me.user.name}</span>
            <span className="text-brand-100">{roleLabel}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="flex items-center gap-3 rounded-control px-3 py-2 text-sm hover:bg-brand-700"
        >
          <LogOut aria-hidden className="size-5" />
          Log out
        </button>
      </div>
    </nav>
  );
}
