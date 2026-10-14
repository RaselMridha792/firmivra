import type { Icon } from '@phosphor-icons/react';
import type { ButtonHTMLAttributes } from 'react';

const tones = {
  neutral: 'text-heading',
  action: 'text-action',
  danger: 'text-danger',
  accent: 'text-accent',
} as const;

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: Icon;
  /** The accessible name; there is no visible text. */
  label: string;
  tone?: keyof typeof tones;
  /** `bold` for the three-dot menu, whose filled dots blur together. */
  weight?: 'fill' | 'bold';
}

/** The square outlined icon buttons of a table row (message, email, document, more). */
export function IconButton({
  icon: Glyph,
  label,
  tone = 'neutral',
  weight = 'fill',
  className = '',
  type = 'button',
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex size-8 items-center justify-center rounded-lg border border-divider bg-surface hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50 ${tones[tone]} ${className}`}
      {...props}
    >
      <Glyph aria-hidden weight={weight} className="size-4" />
    </button>
  );
}
