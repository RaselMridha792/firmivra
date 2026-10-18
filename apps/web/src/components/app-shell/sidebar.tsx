'use client';

import { ChevronDown, LogOut } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useMe } from '../signed-in';
import firmivraLogoWhite from './firmivra-logo-white.png';
import { initials, isActive, type NavSections } from './types';

/** The firm's own look in the firm workspace: its logo on top, its slogan and motto at the bottom. */
export interface FirmBrand {
  name: string;
  /** The logo for dark backgrounds. */
  logoUrl: string | null;
  /** Gold script under the menu, for example "More Than Taxes. We Build Futures."; none when empty. */
  slogan: string | null;
  /** Small capitals under the slogan, words split by "|"; none when empty. */
  motto: string | null;
}

/** Each sentence of the slogan on its own line, as the design sets it. */
const sentences = (text: string) => text.split(/(?<=[.!?])\s+/);
const words = (text: string) =>
  text
    .split('|')
    .map((w) => w.trim())
    .filter(Boolean);

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
  // When one item's path holds another's (/sales and /sales/pipeline), only the longest match is
  // the current page.
  const current = sections
    .flat()
    .map((item) => item.href)
    .filter((href): href is string => Boolean(href) && isActive(pathname, href ?? ''))
    .reduce<string | undefined>(
      (best, href) => (best && best.length >= href.length ? best : href),
      undefined,
    );
  // The menu's scrollbar is hidden (it looked wrong next to the navy menu), so a soft fade at its
  // bottom edge shows while more items are below.
  const menuRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const update = () => setMoreBelow(menu.scrollTop + menu.clientHeight < menu.scrollHeight - 1);
    update();
    menu.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(menu);
    for (const child of menu.children) observer.observe(child);
    return () => {
      menu.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [sections]);
  return (
    <nav
      aria-label="Main"
      className={`flex h-full flex-col bg-brand-900 text-white ${brand ? 'w-61.5' : 'w-72'}`}
    >
      {brand ? (
        <div className="shrink-0 px-5 pb-5 pt-4">
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
              width={200}
              height={100}
              className="block h-auto max-h-[100px] w-full object-contain object-left"
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

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={menuRef}
          data-testid="sidebar-menu"
          className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${brand ? 'py-1' : ''}`}
        >
          {sections.map((items, i) => (
            <ul
              key={items[0]?.label ?? 'group'}
              className={`flex flex-col ${i > 0 ? 'relative mt-2 pt-4 before:absolute before:inset-x-6 before:top-0 before:border-t before:border-platform-navy-raised' : ''}`}
            >
              {items.map((item) => {
                const Icon = item.icon;
                const body = (
                  <>
                    <Icon
                      aria-hidden
                      className={`shrink-0 ${brand ? 'size-[20px] -my-0.5' : 'size-6'}`}
                    />
                    <span className={`min-w-0 flex-1 ${brand ? '' : 'whitespace-nowrap'}`}>
                      {item.label}
                    </span>
                    {item.soon ? (
                      <span className="shrink-0 rounded-pill bg-platform-navy-raised px-2 py-0.5 text-xs text-brand-100">
                        Soon
                      </span>
                    ) : null}
                    {item.badge ? (
                      <span
                        className={`min-w-8 shrink-0 rounded-pill px-2 py-0.5 text-center text-xs font-semibold ${brand ? 'bg-danger' : 'bg-brand-500'}`}
                      >
                        {item.badge}
                      </span>
                    ) : null}
                  </>
                );
                const row = `flex items-start ${brand ? 'gap-2 px-3.5 py-2.5 text-[15px] leading-[20px] font-bold' : 'gap-2.5 px-6 py-2 text-base'}`;
                if (!item.href) {
                  return (
                    <li
                      key={item.label}
                      aria-disabled="true"
                      className={`${row} text-brand-100 ${brand ? 'my-0.5' : ''}`}
                    >
                      {body}
                    </li>
                  );
                }
                const active = item.href === current;
                return (
                  <li key={item.label} className={brand ? 'my-0.5' : undefined}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={
                        row +
                        (brand
                          ? ' ml-3 mr-3.5 rounded-control ' +
                            (active ? 'bg-nav-active font-semibold' : 'hover:bg-navigation-hover')
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
        {moreBelow ? (
          <div
            aria-hidden
            data-testid="sidebar-menu-fade"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-brand-900 to-transparent"
          />
        ) : null}
      </div>

      {brand ? (
        brand.slogan || brand.motto ? (
          <div className="mx-4 flex shrink-0 flex-col items-center gap-2 border-t border-brand-100/75 pb-4 pt-3">
            {brand.slogan ? (
              <p
                data-testid="firm-slogan"
                className="max-w-38 -rotate-12 text-center font-script text-[32px] leading-[0.82] text-gold-light"
              >
                {sentences(brand.slogan).map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </p>
            ) : null}
            {brand.motto ? (
              <p
                data-testid="firm-motto"
                className="text-center text-[11px] font-semibold uppercase tracking-wide text-brand-100"
              >
                {words(brand.motto).flatMap((word, i) => [
                  i > 0 ? (
                    <span key={`bar-${word}`} aria-hidden className="mx-2 text-gold-light">
                      |
                    </span>
                  ) : null,
                  word,
                ])}
              </p>
            ) : null}
          </div>
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
