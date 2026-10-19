'use client';

import type { AdvisoryPlanDetail } from '@firmivra/types';
import { Button, Modal, Stepper } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  FilePlus,
  Lightbulb,
  Quotes,
  Rocket,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { api } from '../../../../../lib/api';
import { ErrorLine } from './ba-dialogs';
import { BASE, BA_KEY, card, errorText, outlined, primary } from './ba-shared';

export type WizardStep = 1 | 2 | 3 | 4 | 5;
export const STEPS: readonly { label: string; hint: string; path: string }[] = [
  { label: 'Business Profile', hint: 'Basic business information', path: '' },
  {
    label: 'Financial & Business Assessment',
    hint: 'Review financials and current position',
    path: '/assessment',
  },
  { label: 'Goals & Strategy', hint: 'Define goals and growth strategy', path: '/goals' },
  { label: 'Action Plan', hint: 'Set milestones and action steps', path: '/action-plan' },
  { label: 'Review & Save', hint: 'Finalize and generate plan', path: '/review' },
];
export const stepHref = (planId: string, n: number) =>
  `${BASE}/plans/${planId}/edit${STEPS[n - 1]!.path}`;

// ---------- The frame every step shares ----------

export interface FrameProps {
  step: WizardStep;
  /** Missing while a new plan has not been saved. */
  planId?: string;
  saving: boolean;
  dirty: boolean;
  error?: string | undefined;
  /** Shown with a SAVE_CONFLICT: reload the plan and lose this step's edits. */
  onReload?: (() => void) | undefined;
  /** Saves the step; resolves false when it could not. */
  onSaveDraft: () => Promise<boolean>;
  onNext: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  children: ReactNode;
}

export function WizardFrame({
  step,
  planId,
  saving,
  dirty,
  error,
  onReload,
  onSaveDraft,
  onNext,
  nextLabel,
  nextDisabled,
  children,
}: FrameProps) {
  const router = useRouter();
  const [leaving, setLeaving] = useState<string>();
  const go = (href: string) => (dirty ? setLeaving(href) : router.push(href));
  const next = STEPS[step];
  const back = step > 1 && planId ? stepHref(planId, step - 1) : `${BASE}/plans`;
  const finalLabel = nextLabel ?? (next ? `Next: ${next.label}` : 'Finalize Plan');

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="plan-wizard">
      <button
        type="button"
        onClick={() => go(BASE)}
        className="flex items-center gap-2 self-start text-sm font-medium text-link hover:underline"
      >
        <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back to Business Advisory &amp;
        Development
      </button>
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span
            aria-hidden
            className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-action text-on-action sm:size-20"
          >
            <FilePlus weight="fill" className="size-10" />
          </span>
          <div className="min-w-0">
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              {planId ? 'Edit Business Plan' : 'Create Business Plan'}
            </h1>
            <p className="text-base text-link sm:text-lg">
              Build a customized plan to help your client grow, become more profitable, and achieve
              long-term success.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className={`${outlined} min-w-36`}
            disabled={saving}
            onClick={() => void onSaveDraft()}
          >
            Save as Draft
          </button>
          <button
            type="button"
            className={`${primary} min-w-32`}
            disabled={saving || nextDisabled}
            onClick={onNext}
          >
            {next ? 'Next' : 'Finalize'} <ArrowRight aria-hidden weight="bold" className="size-4" />
          </button>
        </div>
      </header>

      <Stepper
        variant="wizard"
        label="Business plan steps"
        current={String(step)}
        steps={STEPS.map((s, i) => ({ id: String(i + 1), label: s.label }))}
      />

      {error ? (
        <div className="flex flex-wrap items-center gap-3">
          <ErrorLine text={error} />
          {onReload ? (
            <Button variant="secondary" onClick={onReload}>
              Reload the plan
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
        <aside className="flex flex-col gap-4" aria-label="Help">
          <section className="rounded-xl bg-success-soft p-4" data-testid="quick-tips">
            <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading">
              <Lightbulb aria-hidden weight="fill" className="size-6 text-success" /> Quick Tips
            </h2>
            <ul className="flex flex-col gap-2 text-sm text-text">
              {[
                ['Be as detailed as possible.', true],
                ['This information helps us create a more accurate and effective plan.', false],
                ['You can save and continue later.', true],
                ['All information is secure and confidential.', false],
              ].map(([text, bold]) => (
                <li key={String(text)} className="flex items-start gap-2">
                  <CheckCircle
                    aria-hidden
                    weight="fill"
                    className="mt-0.5 size-4 shrink-0 text-success"
                  />
                  <span className={bold ? 'font-semibold' : ''}>{text}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl bg-success-soft p-4" data-testid="whats-next">
            <h2 className="mb-2 flex items-center gap-2 font-display text-lg font-bold text-heading">
              <Rocket aria-hidden weight="fill" className="size-6 text-success" /> What&apos;s Next?
            </h2>
            <ol className="flex flex-col gap-3">
              {STEPS.map((s, i) => {
                const n = i + 1;
                const body = (
                  <>
                    <span
                      aria-hidden
                      className={`flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${n === step ? 'border-success bg-success text-on-action' : 'border-muted text-heading'}`}
                    >
                      {n}
                    </span>
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold text-heading">
                        Step {n}: {s.label}
                      </span>
                      <span className="text-xs text-muted">{s.hint}</span>
                    </span>
                  </>
                );
                return (
                  <li key={s.label} aria-current={n === step ? 'step' : undefined}>
                    {planId && n !== step ? (
                      <button
                        type="button"
                        onClick={() => go(stepHref(planId, n))}
                        className="flex w-full items-start gap-3 rounded-lg text-left hover:bg-surface"
                      >
                        {body}
                      </button>
                    ) : (
                      <span className="flex items-start gap-3">{body}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
          <figure className={`${card} flex flex-col items-center gap-2 py-6 text-center`}>
            <Quotes aria-hidden weight="fill" className="size-10 text-info" />
            <blockquote className="font-display text-lg text-heading italic">
              A clear plan today builds a stronger business tomorrow.
            </blockquote>
          </figure>
        </aside>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={`${outlined} min-w-28`} onClick={() => go(back)}>
          {step === 1 ? (
            'Cancel'
          ) : (
            <>
              <ArrowLeft aria-hidden weight="bold" className="size-4" /> Back:{' '}
              {STEPS[step - 2]!.label}
            </>
          )}
        </button>
        <button
          type="button"
          className={`${primary} px-8`}
          disabled={saving || nextDisabled}
          onClick={onNext}
          data-testid="wizard-next"
        >
          {finalLabel} <ArrowRight aria-hidden weight="bold" className="size-4" />
        </button>
      </footer>

      {leaving ? (
        <Modal
          open
          title="Unsaved changes"
          subtitle="This step has changes that are not saved yet."
          onClose={() => setLeaving(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setLeaving(undefined)}>
                Keep Editing
              </Button>
              <Button variant="secondary" onClick={() => router.push(leaving)}>
                Discard
              </Button>
              <Button
                onClick={async () => {
                  if (await onSaveDraft()) router.push(leaving);
                  else setLeaving(undefined);
                }}
              >
                Save Draft
              </Button>
            </>
          }
        >
          <p className="text-sm text-text">
            Save them as a draft before you leave, or discard them.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}

/** A step's save: the update with the plan's etag, and the error to show (with Reload on a conflict). */
export function useStepSave(plan: AdvisoryPlanDetail | undefined) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const save = async (body: Omit<Parameters<typeof api.advisory.updatePlan>[1], 'etag'>) => {
    if (!plan) return false;
    setSaving(true);
    setError(undefined);
    try {
      await api.advisory.updatePlan(plan.id, { etag: plan.etag, ...body });
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      return true;
    } catch (e) {
      setError(errorText(e));
      setConflict(
        e instanceof Error && 'code' in e && (e as { code: string }).code === 'SAVE_CONFLICT',
      );
      return false;
    } finally {
      setSaving(false);
    }
  };
  const reload = conflict
    ? () => {
        setError(undefined);
        setConflict(false);
        void qc.invalidateQueries({ queryKey: [...BA_KEY, 'plan', plan?.id] });
      }
    : undefined;
  return { save, saving, setSaving, error, setError, reload };
}
