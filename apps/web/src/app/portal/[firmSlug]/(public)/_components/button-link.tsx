import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import type { ComponentProps } from 'react';

// A full-width link with an arrow that looks like Button (primary or outline) from @firmivra/ui.
// Local until @firmivra/ui has a link variant of Button.
const variants = {
  primary: 'bg-action text-on-action hover:bg-action-hover',
  outline: 'border border-action bg-surface text-action hover:bg-accent-soft',
};

type Props = ComponentProps<typeof Link> & { variant?: keyof typeof variants };
export function ButtonLink({ variant = 'primary', className = '', children, ...props }: Props) {
  return (
    <Link
      className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-control px-4 py-2 text-sm font-medium transition-colors ${variants[variant]} ${className}`}
      {...props}
    >
      {children} <ArrowRight aria-hidden className="size-5" />
    </Link>
  );
}
