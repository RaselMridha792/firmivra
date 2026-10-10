'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMe } from '../signed-in';
import firmivraLockup from './firmivra-lockup.png';
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
      <div className="px-6 pb-8 pt-5">
        <div className="flex items-center gap-0">
          <Image src={firmivraLockup} alt="" priority className="h-19 w-16 object-contain" />
          <span className="font-sans text-4xl font-semibold tracking-tight">Firmivra</span>
        </div>
        <p className="-mt-4 ml-16 whitespace-nowrap text-xs tracking-brand uppercase">{subtitle}</p>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        {sections.map((items, i) => (
          <ul
            key={items[0]?.label ?? 'group'}
            className={`flex flex-col gap-0.5 ${i > 0 ? 'relative mt-2 pt-4 before:absolute before:inset-x-6 before:top-0 before:border-t before:border-platform-navy-raised' : ''}`}
          >
            {items.map((item) => {
              const Icon = item.icon;
              const body = (
                <>
                  <Icon aria-hidden className="size-6 shrink-0" />
                  <span className="min-w-0 flex-1 whitespace-nowrap">{item.label}</span>
                  {item.soon ? (
                    <span className="shrink-0 rounded-pill bg-platform-navy-raised px-2 py-0.5 text-xs text-brand-100">
                      Soon
                    </span>
                  ) : null}
                  {item.badge ? (
                    <span className="min-w-8 shrink-0 rounded-pill bg-brand-500 px-2 py-0.5 text-center text-xs font-semibold">
                      {item.badge}
                    </span>
                  ) : null}
                </>
              );
              const row = 'flex items-center gap-2.5 px-6 py-3 text-base';
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
                    className={
                      row +
                      ' mr-3 rounded-r-control border-l-4 ' +
                      (active
                        ? 'border-info bg-navigation-hover font-semibold'
                        : 'border-transparent hover:bg-navigation-hover')
                    }
                  >
                    {body}
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </div>

      <div className="mx-6 flex flex-col gap-4 border-t border-platform-navy-raised pb-10 pt-5">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-disabled text-sm font-semibold text-brand-900">
            {initials(me.user.name)}
          </span>
          <span className="flex flex-1 flex-col text-sm">
            <span className="font-semibold">{me.user.name}</span>
            <span className="text-brand-100">{roleLabel}</span>
          </span>
          <ChevronDown aria-hidden className="size-4 text-brand-100" />
        </div>
        <button
          type="button"
          onClick={() => void signOut()}
          className="-mx-3 flex items-center gap-4 rounded-control px-3 py-2 text-base hover:bg-navigation-hover"
        >
          <LogOut aria-hidden className="size-6" />
          Logout
        </button>
      </div>
    </nav>
  );
}
