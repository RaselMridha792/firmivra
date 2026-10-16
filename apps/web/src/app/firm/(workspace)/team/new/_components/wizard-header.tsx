import { Stepper } from '@firmivra/ui';
import { ArrowLeft, UserGear, UserPlus } from '@phosphor-icons/react/ssr';
import Link from 'next/link';
import { STEPS, type WizardStep } from './wizard-parts';

/**
 * The top of every Create Staff step (create-staff-*.jpg): Back to Staff Management, the tile,
 * the title with its blue line, Create New / Edit Existing, and the four-step stepper. Edit
 * Existing opens the staff directory, where a member opens Edit Staff (same record, guide §2).
 * Edit Staff (edit-staff-account.jpg) has its own title and line and no Create New / Edit Existing.
 */
export function WizardHeader({
  step,
  mode = 'create',
}: {
  step: WizardStep;
  mode?: 'create' | 'edit';
}) {
  const edit = mode === 'edit';
  return (
    <header className="flex flex-col gap-4">
      <Link
        href="/team"
        className="inline-flex min-h-9 w-fit items-center gap-2 text-sm font-semibold text-link hover:underline"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" />
        Back to Staff Management
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span
            aria-hidden
            className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action"
          >
            {edit ? (
              <UserGear weight="fill" className="size-9" />
            ) : (
              <UserPlus weight="fill" className="size-9" />
            )}
          </span>
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              {edit ? 'Edit Staff Account' : 'Create Staff Account'}
            </h1>
            <p className="text-link">
              {edit
                ? 'Update this staff member’s information, role, permissions, and access.'
                : 'Add a new team member or edit an existing account. Set their role, permissions, and access.'}
            </p>
          </div>
        </div>
        {edit ? null : (
          <nav
            aria-label="Create or edit"
            className="flex rounded-xl border border-divider bg-surface p-1 shadow-sm"
          >
            <span
              aria-current="page"
              className="inline-flex min-h-10 items-center rounded-lg bg-action px-6 text-sm font-semibold text-on-action"
            >
              Create New
            </span>
            <Link
              href="/team"
              className="inline-flex min-h-10 items-center rounded-lg px-6 text-sm font-semibold text-action hover:bg-folder-surface"
            >
              Edit Existing
            </Link>
          </nav>
        )}
      </div>
      <div className="py-1">
        <Stepper
          variant="wizard"
          label={edit ? 'Edit staff sections' : 'Create staff steps'}
          steps={STEPS.map((s) => ({ id: s.id, label: s.label }))}
          current={step}
        />
      </div>
    </header>
  );
}
