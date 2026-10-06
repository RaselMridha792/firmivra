/**
 * A page that hasn't been built yet. Each placeholder page is only this component: the owner
 * replaces it with the screen from the mockup (docs/junior/PAGE-MAP.md).
 */
export function PagePlaceholder({
  title,
  ticket,
  owner,
  mockup,
}: {
  title: string;
  ticket: string;
  owner: string;
  /** Path under docs/mockups/, or undefined when the page has none. */
  mockup?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <h1 data-testid="page-title" className="text-2xl font-semibold text-text">
        {title}
      </h1>
      <div className="rounded-card border-2 border-dashed border-border bg-surface p-6 text-sm">
        <p className="font-medium text-text">
          Built in {ticket} by {owner}
        </p>
        <p className="mt-1 text-muted">
          {mockup ? `Mockup: docs/mockups/${mockup}` : 'No mockup: follow the Super Admin style.'}
        </p>
      </div>
    </div>
  );
}
