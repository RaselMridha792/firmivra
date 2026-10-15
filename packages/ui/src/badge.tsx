import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

const tones = {
  info: 'bg-info-soft text-info',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  neutral: 'bg-disabled text-muted',
  /** Business, Manager. */
  purple: 'bg-purple-soft text-purple',
};
export function Badge({
  children,
  tone = 'neutral',
  dot,
  icon: Glyph,
  className = '',
}: {
  children: ReactNode;
  tone?: keyof typeof tones;
  className?: string;
  /** A coloured dot before the text, as in the Status column. */
  dot?: boolean;
  /** A solid icon before the text (Accepted, Rejected). */
  icon?: Icon;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-pill px-3 py-1 text-xs font-semibold ${tones[tone]} ${className}`}
    >
      {dot ? <span aria-hidden className="size-2 rounded-full bg-current" /> : null}
      {Glyph ? <Glyph aria-hidden weight="fill" className="size-3.5" /> : null}
      {children}
    </span>
  );
}
