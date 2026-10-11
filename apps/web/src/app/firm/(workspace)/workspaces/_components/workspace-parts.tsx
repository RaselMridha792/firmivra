'use client';
import { Button } from '@firmivra/ui';
import { errorMessage } from '../../../../../lib/errors';
import { WORKSPACE_ERRORS } from './workspace-errors';
export function ActionError({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="text-sm text-danger">
      {errorMessage(error, WORKSPACE_ERRORS)}
    </p>
  ) : null;
}
export function Pages({
  cursors,
  next,
  set,
  label,
}: {
  cursors: (string | undefined)[];
  next: string | null;
  set: React.Dispatch<React.SetStateAction<(string | undefined)[]>>;
  label: string;
}) {
  return (
    <nav aria-label={label} className="grid grid-cols-2 gap-3">
      <Button
        variant="secondary"
        disabled={cursors.length === 1}
        onClick={() => set((v) => v.slice(0, -1))}
      >
        Previous
      </Button>
      <Button
        variant="secondary"
        disabled={!next}
        onClick={() => {
          if (next) set((v) => [...v, next]);
        }}
      >
        Next
      </Button>
    </nav>
  );
}
