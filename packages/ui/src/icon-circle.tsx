import type { ComponentType } from 'react';
import { portalTints, type PortalTint } from './tones';

/** Sizes at 1440 px from Intake form tab.png: the icon fills about 60% of the circle, in a bold stroke. */
const sizes = {
  sm: 'size-10 [&>svg]:size-6',
  md: 'size-12 [&>svg]:size-7',
  lg: 'size-18 [&>svg]:size-10',
} as const;

export interface IconCircleProps {
  /** Any icon component (lucide or Phosphor) that takes a class. */
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean }>;
  /** The circle's colour; the icon takes the firm's text colour. */
  tint?: PortalTint;
  size?: keyof typeof sizes;
  className?: string;
}

/** R61: an icon in a coloured circle, as the client portal designs draw them. Decorative. */
export function IconCircle({
  icon: Glyph,
  tint = 'folder',
  size = 'md',
  className,
}: IconCircleProps) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full text-firm-text [&>svg]:stroke-[2.25] ${portalTints[tint]} ${sizes[size]} ${className ?? ''}`}
    >
      <Glyph aria-hidden />
    </span>
  );
}
