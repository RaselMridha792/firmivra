'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMe } from '../signed-in';
import firmivraLogoWhite from './firmivra-logo-white.png';
import { initials, isActive, type NavSections } from './types';

/** The firm's own look in the firm workspace: its logo on top, its motto at the bottom. */
export interface FirmBrand {
  name: string;
  logoUrl: string | null;
  /** The motto's words, for example ["Plans", "People"]; none when the firm has not set one. */
  motto: readonly string[];
}

/** Navy sidebar: logo, menu groups, the signed-in user and Log out. */
export function Sidebar({
  subtitle,
  sections,
  roleLabel,
  brand,
  onNavigate,
}: {
  /** The firm workspace: firm logo and motto, the blue pill for the open page, no user block. */
  brand?: FirmBrand;
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
      {brand ? (
        <div className="px-6 pb-4 pt-6">
          <span
            data-testid="firm-name"
            className={brand.logoUrl ? 'sr-only' : 'block text-xl font-semibold'}
          >
            {brand.name}
          </span>
          {brand.logoUrl ? (
            <Image
              unoptimized
              src={brand.logoUrl}
              alt=""
              width={176}
              height={56}
              className="block h-14 w-auto max-w-full object-contain object-left"
            />
          ) : null}
        </div>
      ) : (
        <div className="px-6 pb-4 pt-3">
          <Image
            src={firmivraLogoWhite}
            alt="Firmivra"
            priority
            sizes="208px"
            className="block h-auto w-52"
          />
          {/* Under the wordmark, which starts about 58 px into the logo. */}
          <p className="-mt-3 ml-14.5 whitespace-nowrap text-xs tracking-brand uppercase">
            {subtitle}
          </p>
        </div>
      )}

      <div data-testid="sidebar-menu" className="flex flex-1 flex-col gap-2 overflow-y-auto">
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
              const row = `flex items-center gap-2.5 py-3 text-base ${brand ? 'px-3' : 'px-6'}`;
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
                      (brand
                        ? ' mx-3 rounded-control ' +
                          (active ? 'bg-action font-semibold' : 'hover:bg-navigation-hover')
                        : ' mr-3 rounded-r-control border-l-4 ' +
                          (active
                            ? 'border-info bg-navigation-hover font-semibold'
                            : 'border-transparent hover:bg-navigation-hover'))
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

      {brand ? (
        brand.motto.length ? (
          <p
            data-testid="firm-motto"
            className="mx-6 border-t border-platform-navy-raised pb-8 pt-5 font-display text-xl italic"
          >
            {brand.motto.join(' · ')}
          </p>
        ) : null
      ) : (
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
      )}
    </nav>
  );
}
