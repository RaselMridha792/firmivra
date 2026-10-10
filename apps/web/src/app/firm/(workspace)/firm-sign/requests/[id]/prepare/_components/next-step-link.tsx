import Link from 'next/link';
import { type StepId, stepHref } from './steps';

/** A step's "Next" link, styled as the primary button (the UI kit has no link button yet). */
export function NextStepLink({ id, step, label }: { id: string; step: StepId; label: string }) {
  return (
    <Link
      href={stepHref(id, step)}
      className="inline-flex min-h-11 items-center justify-center rounded-control bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      {label}
    </Link>
  );
}
