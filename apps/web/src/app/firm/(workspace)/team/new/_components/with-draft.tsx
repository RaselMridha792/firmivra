'use client';

import type { StaffDraftData } from '@firmivra/types';
import { Button, Skeleton } from '@firmivra/ui';
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { WizardHeader } from './wizard-header';
import { STAFF_ERRORS, type WizardStep, draftData } from './wizard-parts';

export interface DraftState {
  /** The draft to keep saving into, or null for a new one. */
  draftId: string | null;
  /** The form so far, from the draft. */
  base: StaffDraftData;
  /** Why the draft could not be read, shown as a quiet note; the form starts empty. */
  notice?: string;
}

/** Reads `?draft=` for a step (steps 2 to 4); without one, the step starts a new draft. */
export function WithDraft({
  draftId,
  step,
  children,
}: {
  draftId?: string;
  step: WizardStep;
  children: (state: DraftState) => ReactNode;
}) {
  if (!draftId) return children({ draftId: null, base: {} });
  return (
    <LoadDraft draftId={draftId} step={step}>
      {children}
    </LoadDraft>
  );
}

function LoadDraft({
  draftId,
  step,
  children,
}: {
  draftId: string;
  step: WizardStep;
  children: (state: DraftState) => ReactNode;
}) {
  const draft = useApiQuery(['staff', 'drafts', draftId], () => api.staff.draft(draftId));
  if (draft.isPending) {
    return (
      <div className="flex flex-col gap-6">
        <WizardHeader step={step} />
        <Skeleton className="h-96" />
      </div>
    );
  }
  return children({
    draftId: draft.data ? draftId : null,
    base: draft.data ? draftData(draft.data.data) : {},
    notice: draft.isError ? errorMessage(draft.error, STAFF_ERRORS) : undefined,
  });
}

/** Save as Draft for one step: creates the draft the first time, then keeps saving into it. */
export function useDraftSaver(start: string | null, step: 1 | 2 | 3 | 4) {
  const [draftId, setDraftId] = useState(start);
  const [saved, setSaved] = useState(false);
  const mutation = useApiMutation(
    (data: StaffDraftData) =>
      draftId
        ? api.staff.saveDraft(draftId, { step, data })
        : api.staff.createDraft({ step, data }),
    { invalidate: ['staff', 'drafts'] },
  );
  return {
    draftId,
    saved,
    pending: mutation.isPending,
    error: mutation.error,
    /** Call when the form changes: the "Draft saved" note goes away. */
    touched: () => setSaved(false),
    save: (data: StaffDraftData, then?: (id: string) => void) =>
      mutation.mutate(data, {
        onSuccess: (d) => {
          setDraftId(d.id);
          setSaved(true);
          then?.(d.id);
        },
      }),
  };
}

/** The bottom bar of steps 2 to 4: Back, Save as Draft and Next, as the designs draw it. */
export function StepActions({
  nextLabel,
  pending,
  saved,
  error,
  onBack,
  onSave,
  onNext,
}: {
  nextLabel: string;
  pending: boolean;
  saved: boolean;
  error: unknown;
  onBack: () => void;
  onSave: () => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(error, STAFF_ERRORS)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" disabled={pending} onClick={onBack}>
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          Back
        </Button>
        {saved ? (
          <span role="status" className="text-sm text-success" data-testid="draft-saved">
            Draft saved
          </span>
        ) : null}
        <div className="ml-auto flex flex-wrap gap-3">
          <Button variant="secondary" disabled={pending} onClick={onSave}>
            Save as Draft
          </Button>
          <Button disabled={pending} onClick={onNext}>
            {nextLabel}
            <ArrowRight aria-hidden weight="bold" className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
