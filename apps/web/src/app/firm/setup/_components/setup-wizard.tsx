'use client';

import type { FirmSettings, FirmSetup } from '@firmivra/types';
import { Card, Stepper } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { PageState } from '../../../../components/page-state';
import { api } from '../../../../lib/api';
import { useApiQuery } from '../../../../lib/query';
import { BrandingStep } from './branding-step';
import { BusinessStep } from './business-step';
import { FinishStep } from './finish-step';
import { PortalStep } from './portal-step';
import { FIRM_SETTINGS, SETUP_PROGRESS, STEPS, type WizardStep } from './shared';
import { TeamStep } from './team-step';

/** /setup: the firm's first sign-in. Owner and Admin only; Staff get the no-permission state. */
export function SetupWizard() {
  const setup = useApiQuery(SETUP_PROGRESS, () => api.settings.getSetup());
  const settings = useApiQuery(FIRM_SETTINGS, () => api.settings.get());

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 data-testid="page-title" className="font-serif text-3xl font-bold text-heading">
          Set up your firm
        </h1>
        <p className="mt-1 text-sm text-muted">
          Five short steps. Save a draft at any time and come back later.
        </p>
      </div>
      <PageState query={setup}>
        {(progress) =>
          progress.completedAt ? (
            <SetupDone />
          ) : (
            <PageState query={settings}>
              {(firm) => <Steps progress={progress} firm={firm} />}
            </PageState>
          )
        }
      </PageState>
    </div>
  );
}

function Steps({ progress, firm }: { progress: FirmSetup; firm: FirmSettings }) {
  // Resume at the first step not done yet (Finish once all four are).
  const [index, setIndex] = useState(() =>
    STEPS.findIndex((step) => !progress.completedSteps.some((done) => done === step.id)),
  );
  const step = STEPS[index]?.id ?? 'finish';
  const go = (to: number) => () => setIndex(to);
  const props = { firm, onBack: index > 0 ? go(index - 1) : undefined, onNext: go(index + 1) };
  const edit = (id: WizardStep) => setIndex(STEPS.findIndex((item) => item.id === id));

  return (
    <>
      <Stepper steps={STEPS} current={step} />
      {step === 'branding' ? <BrandingStep {...props} /> : null}
      {step === 'businessDetails' ? <BusinessStep {...props} /> : null}
      {step === 'team' ? <TeamStep {...props} /> : null}
      {step === 'clientPortal' ? <PortalStep {...props} /> : null}
      {step === 'finish' ? (
        <FinishStep progress={progress} onBack={go(index - 1)} onEdit={edit} />
      ) : null}
    </>
  );
}

/** Setup is done: the wizard does not show again; Settings changes these details later. */
function SetupDone() {
  return (
    <Card data-testid="setup-done" className="flex flex-col items-start gap-3">
      <p className="font-medium text-text">Your firm is set up.</p>
      <p className="text-sm text-muted">You can change these details any time in Settings.</p>
      <Link
        href="/"
        className="inline-flex min-h-11 items-center rounded-control bg-action px-4 text-sm font-medium text-on-action hover:bg-action-hover"
      >
        Go to your dashboard
      </Link>
    </Card>
  );
}
