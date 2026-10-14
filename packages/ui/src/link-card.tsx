import { ArrowRight, type Icon } from '@phosphor-icons/react';
import type { MouseEventHandler, ReactNode } from 'react';
import { textTones, tileTones, type TileTone } from './tones';

const surfaces = {
  /** Staff Management's tiles: near-white with a hairline border. */
  plain: 'border border-border bg-subtle',
  /** Settings' blue Quick Settings cards. */
  blue: 'bg-info-soft',
  /** Settings' amber Quick Settings cards. */
  amber: 'bg-amber-surface',
};
export type LinkCardSurface = keyof typeof surfaces;

export interface LinkCardProps {
  icon: Icon;
  title: string;
  description?: ReactNode;
  /** The square tile behind the icon. */
  tone?: TileTone;
  /** The icon's own colour when it differs from the tile's (Settings' navy brush on amber). */
  iconTone?: TileTone;
  surface?: LinkCardSurface;
  /**
   * A text link under the description ("Manage Companies →", Settings). Without it the card shows
   * the round arrow button on the right (Staff Management).
   */
  actionLabel?: string;
  href?: string;
  onClick?: MouseEventHandler<HTMLElement>;
}

/**
 * A navigation tile: icon tile, title, one or two lines of description, and an arrow. The whole
 * card is the link (`href`) or button (`onClick`).
 */
export function LinkCard({
  icon: Glyph,
  title,
  description,
  tone = 'blue',
  iconTone,
  surface = 'plain',
  actionLabel,
  href,
  onClick,
}: LinkCardProps) {
  const body = (
    <>
      <span
        className={`flex size-16 shrink-0 items-center justify-center rounded-xl ${tileTones[tone]}`}
      >
        <Glyph
          aria-hidden
          weight="fill"
          className={`size-9 ${iconTone ? textTones[iconTone] : ''}`}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-lg font-bold text-heading">{title}</span>
        {description ? <span className="text-sm text-muted">{description}</span> : null}
        {actionLabel ? (
          <span className="mt-1 inline-flex items-center gap-2 text-sm font-semibold text-link">
            {actionLabel}
            <ArrowRight aria-hidden weight="bold" className="size-4" />
          </span>
        ) : null}
      </span>
      {actionLabel ? null : (
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface text-link shadow-md"
        >
          <ArrowRight weight="bold" className="size-5" />
        </span>
      )}
    </>
  );
  const className = `flex w-full items-center gap-4 rounded-lg p-4 text-left transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-focus ${surfaces[surface]}`;
  if (href) {
    return (
      <a href={href} onClick={onClick} className={className}>
        {body}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}
