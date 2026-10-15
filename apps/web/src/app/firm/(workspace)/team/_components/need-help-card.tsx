import { ArrowSquareOut, Info } from '@phosphor-icons/react/ssr';
import Link from 'next/link';

/**
 * Need Help? at the foot of the right column. There is no Staff Management guide page yet, so
 * View Guide opens the Staff Management overview (the PR lists this).
 */
export function NeedHelpCard() {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-divider bg-folder-surface p-4">
      <div className="flex items-start gap-3">
        <Info aria-hidden weight="fill" className="size-8 shrink-0 text-action" />
        <div>
          <h2 className="font-semibold text-heading">Need Help?</h2>
          <p className="text-sm text-link">
            Check out our Staff Management Guide or contact support.
          </p>
        </div>
      </div>
      <Link
        href="/team"
        className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-action bg-surface text-sm font-semibold text-action hover:bg-folder-surface"
      >
        <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
        View Guide
      </Link>
    </section>
  );
}
