import { Skeleton } from '@firmivra/ui';
import type { ReactNode } from 'react';

/** The line a card shows when its call failed: dev has no API yet for these modules. */
export const NOT_LOADED = 'Could not load this right now. It fills in once the data is available.';

/**
 * A card's frame with one quiet line, for no data yet, a failed call or loading
 * (docs/design-match.md rule 2: one error panel never replaces a page).
 */
export function QuietCard({
  title,
  line,
  loading = false,
  testId,
  children,
}: {
  title: string;
  line: string;
  loading?: boolean;
  testId?: string;
  /** Extra frame under the line, for example disabled buttons. */
  children?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      aria-busy={loading || undefined}
      data-testid={testId}
      className="flex flex-col gap-3 rounded-xl border border-divider bg-surface p-4 shadow-sm"
    >
      <h2 className="text-base font-bold text-heading">{title}</h2>
      {loading ? (
        <Skeleton className="h-4 w-2/3" />
      ) : (
        <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{line}</p>
      )}
      {children}
    </section>
  );
}
