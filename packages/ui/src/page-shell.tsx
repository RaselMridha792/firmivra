import type { ComponentPropsWithoutRef } from 'react';

export function PageShell({ children, ...props }: ComponentPropsWithoutRef<'main'>) {
  return <main {...props}>{children}</main>;
}
