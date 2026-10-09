import type { ElementType, ReactNode } from 'react';

/** Widths from the tokens: --container-public (public pages), --container-content (signed in). */
const widths = { public: 'max-w-public', content: 'max-w-content' } as const;
export type PageWidth = keyof typeof widths;

export interface PageContainerProps {
  width?: PageWidth;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
}

/** A page's content, centred at one width with the same side padding on every page. */
export function PageContainer({
  width = 'public',
  as: Tag = 'div',
  className = '',
  children,
}: PageContainerProps) {
  return (
    <Tag className={`mx-auto w-full ${widths[width]} px-4 sm:px-6 lg:px-8 ${className}`}>
      {children}
    </Tag>
  );
}

/** A full-width band (its background goes in className) whose content lines up with PageContainer. */
export function PageSection({
  width,
  as: Tag = 'section',
  className = '',
  children,
}: PageContainerProps) {
  return (
    <Tag className={`w-full ${className}`}>
      <PageContainer width={width}>{children}</PageContainer>
    </Tag>
  );
}
