import { ArrowLeft, ShieldCheck } from '@phosphor-icons/react/ssr';
import Link from 'next/link';

/**
 * Back to Staff Management, the shield tile, the title and the blue subtitle, as Create Staff's
 * header draws them (PageHeader's subtitle is grey).
 */
export function RolesHeader() {
  return (
    <header className="flex flex-col gap-1">
      <Link
        href="/team"
        className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" />
        Back to Staff Management
      </Link>
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action"
        >
          <ShieldCheck weight="fill" className="size-9" />
        </span>
        <div className="min-w-0">
          <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
            Roles &amp; Permissions
          </h1>
          <p className="text-link">
            Choose a role to see and change what it can do in each module.
          </p>
        </div>
      </div>
    </header>
  );
}
