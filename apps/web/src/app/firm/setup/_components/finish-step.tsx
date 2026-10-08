'use client';

import type { FirmSetup } from '@firmivra/types';
import { Badge, Button, Card } from '@firmivra/ui';
import { CircleCheck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { errorMessage } from '../../../../lib/errors';
import { useApiMutation } from '../../../../lib/query';
import { FIRM_SETTINGS, SETUP_ERRORS, STEPS, type WizardStep } from './shared';
import { StepTitle } from './step-form';

/** Step 5: the checklist, a way back to any step, and Complete setup (the firm becomes Active). */
export function FinishStep({
  progress,
  onBack,
  onEdit,
}: {
  progress: FirmSetup;
  onBack: () => void;
  onEdit: (step: WizardStep) => void;
}) {
  const router = useRouter();
  const finish = useApiMutation(() => api.settings.finishSetup(), { invalidate: FIRM_SETTINGS });
  const steps = STEPS.filter((step) => step.id !== 'finish');

  return (
    <Card title={<StepTitle icon={CircleCheck}>Finish</StepTitle>} className="flex flex-col gap-4">
      <ul className="divide-y divide-border rounded-card border border-border">
        {steps.map((step) => {
          const done = progress.completedSteps.some((completed) => completed === step.id);
          return (
            <li
              key={step.id}
              data-testid="finish-item"
              className="flex items-center justify-between gap-3 p-3"
            >
              <span className="flex flex-wrap items-center gap-2 font-medium text-text">
                {step.label}
                <Badge tone={done ? 'success' : 'warning'}>{done ? 'Done' : 'Not done yet'}</Badge>
              </span>
              <Button
                variant="ghost"
                onClick={() => onEdit(step.id)}
                aria-label={`Edit ${step.label}`}
              >
                Edit
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
        <Button variant="secondary" onClick={onBack} disabled={finish.isPending}>
          Back
        </Button>
        <Button
          disabled={finish.isPending}
          onClick={() => finish.mutate(undefined, { onSuccess: () => router.replace('/') })}
        >
          {finish.isPending ? 'Finishing…' : 'Complete setup'}
        </Button>
      </div>
      {finish.error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(finish.error, SETUP_ERRORS)}
        </p>
      ) : null}
    </Card>
  );
}
