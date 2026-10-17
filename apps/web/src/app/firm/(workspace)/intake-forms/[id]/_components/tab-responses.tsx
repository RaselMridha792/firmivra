'use client';

import { ClipboardText } from '@phosphor-icons/react';
import { GridTable, GroupTable, InfoCard, SectionRows } from './detail-cards';
import { useDetail } from './detail-frame';
import { Quiet } from './detail-shared';

/** Responses tab: every step and section of the form with the client's answers. */
export function ResponsesTab() {
  const { responses } = useDetail();
  const steps = responses?.definition.steps ?? [];
  if (!responses) {
    return (
      <InfoCard icon={ClipboardText} title="Responses" edit={false} testId="responses">
        <Quiet>The answers are not available right now.</Quiet>
      </InfoCard>
    );
  }
  const answers = responses.answers;
  const none = Object.keys(answers).length === 0;
  return (
    <div className="flex flex-col gap-6" data-testid="responses">
      {none ? <Quiet>The client has not answered anything yet.</Quiet> : null}
      {steps.map((step) => (
        <div key={step.key} className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-bold text-heading">{step.title}</h2>
          <div className="grid items-start gap-4 lg:grid-cols-2">
            {step.sections
              .filter((s) => s.fields.some((f) => f.type !== 'info' && f.type !== 'upload'))
              .map((section) => (
                <InfoCard
                  key={section.key}
                  icon={ClipboardText}
                  title={section.title}
                  testId={`section-${section.key}`}
                >
                  <div className="flex flex-col gap-3">
                    <SectionRows section={section} answers={answers} />
                    {section.fields.map((f) =>
                      f.type === 'group' ? (
                        <GroupTable key={f.key} field={f} answers={answers} />
                      ) : f.type === 'grid' ? (
                        <GridTable key={f.key} field={f} answers={answers} />
                      ) : null,
                    )}
                  </div>
                </InfoCard>
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
