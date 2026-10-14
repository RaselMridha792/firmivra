import type { ButtonVariant } from '@firmivra/ui';
import Link from 'next/link';
import type { ComponentProps } from 'react';

// A link that looks like Button (packages/ui/src/button.tsx), without nesting a <button> inside
// an <a> (invalid HTML, confusing for keyboard/screen-reader navigation). Same convention as
// apps/web/src/app/portal/[firmSlug]/(public)/_components/button-link.tsx: local until
// @firmivra/ui has a link variant of Button. The class strings are copied from Button exactly, not
// reused from it: Button does not export them.
const VARIANTS: Record<Extract<ButtonVariant, 'primary' | 'secondary' | 'outline'>, string> = {
  primary: 'bg-action text-on-action hover:bg-action-hover',
  secondary: 'border border-border bg-surface text-text hover:bg-canvas',
  outline: 'border border-action bg-surface text-action hover:bg-accent-soft',
};

export function ButtonLink({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ComponentProps<typeof Link> & { variant?: keyof typeof VARIANTS }) {
  return (
    <Link
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {children}
    </Link>
  );
}
