import { Callout } from '@firmivra/ui';
import { ArrowSquareOut, Info } from '@phosphor-icons/react/ssr';
import Link from 'next/link';

/**
 * Need Help? at the foot of the right column, the kit's Callout. There is no Staff Management
 * guide page yet, so View Guide opens the Staff Management overview (the PR lists this).
 */
export function NeedHelpCard() {
  return (
    <Callout
      icon={Info}
      tone="blue"
      surface="info"
      title="Need Help?"
      action={
        <Link
          href="/team"
          className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-action bg-surface text-sm font-semibold text-action hover:bg-folder-surface"
        >
          <ArrowSquareOut aria-hidden weight="bold" className="size-4" />
          View Guide
        </Link>
      }
    >
      Check out our Staff Management Guide or contact support.
    </Callout>
  );
}
