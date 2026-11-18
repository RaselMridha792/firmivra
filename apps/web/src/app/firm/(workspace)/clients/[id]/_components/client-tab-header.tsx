'use client';

import { ActionMenu, type ActionMenuItem } from '@firmivra/ui';
import { DotsThreeVertical, type Icon } from '@phosphor-icons/react';
import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { OriginLink, useOriginNavigate } from '../../../../../../components/origin-link';

/** A secondary action in the header's More Actions menu: it runs, or opens a page (with Back). */
export type ClientTabAction = {
  label: string;
  icon?: Icon;
  /** Greys the choice out and says why under its label. */
  disabled?: string;
} & ({ onSelect: () => void; href?: never } | { href: string; onSelect?: never });

/**
 * Clients Review 2 P4-7 (§23): the one heading and action row of every tab in a client's profile.
 * The tab's title (one h2 size on every tab), an optional line under it, the tab's primary action
 * at the row's right end and its secondary actions in the More Actions menu before it. On a phone
 * the actions wrap under the title, still on the right.
 */
export function ClientTabHeader({
  title,
  description,
  primary,
  secondary = [],
}: {
  title: string;
  description?: ReactNode;
  /** The tab's main action: a Button, or a ClientTabLink. */
  primary?: ReactNode;
  secondary?: ClientTabAction[];
}) {
  const navigate = useOriginNavigate();
  const run = (action: ClientTabAction): (() => void) => {
    if (action.href === undefined) return action.onSelect;
    const { href } = action;
    return () => navigate(href);
  };
  const items: ActionMenuItem[] = secondary.map((action) => ({
    label: action.label,
    ...(action.icon ? { icon: action.icon } : {}),
    ...(action.disabled ? { disabled: action.disabled } : {}),
    onSelect: run(action),
  }));
  return (
    <div
      data-testid="client-tab-header"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3"
    >
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="text-xl font-semibold wrap-anywhere text-heading">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {primary || items.length ? (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {items.length ? (
            <ActionMenu
              label="More Actions"
              // The trigger as tall as the primary button beside it.
              className="[&>button]:min-h-11"
              trigger={
                <>
                  <DotsThreeVertical aria-hidden weight="bold" className="size-4" />
                  More Actions
                </>
              }
              sections={[{ items }]}
            />
          ) : null}
          {primary}
        </div>
      ) : null}
    </div>
  );
}

/** The primary button's look, for a primary action that opens a page. */
const PRIMARY_LINK =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * A primary action that opens a page. With `origin` (the default) the page shows Back to this tab
 * (SH1); without it, a plain link.
 */
export function ClientTabLink({
  origin = true,
  className = '',
  ...props
}: ComponentProps<typeof OriginLink> & { origin?: boolean }) {
  const look = `${PRIMARY_LINK} ${className}`;
  return origin ? <OriginLink className={look} {...props} /> : <Link className={look} {...props} />;
}
