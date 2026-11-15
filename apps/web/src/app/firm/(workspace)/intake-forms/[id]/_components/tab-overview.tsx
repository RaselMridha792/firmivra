'use client';

import type { IntakeAnswers, IntakeField, IntakeSection } from '@firmivra/types';
import type { TileTone } from '@firmivra/ui';
import {
  Bank,
  CheckCircle,
  ClipboardText,
  CurrencyDollar,
  FileText,
  UserCircle,
  UsersThree,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { GridTable, GroupTable, InfoCard, SectionRows } from './detail-cards';
import { useDetail } from './detail-frame';
import { Quiet, answerText, isPlain } from './detail-shared';
import { Rail } from './detail-rail';

/** How many answers a section's Overview card shows; Responses has every one. */
const ROWS = 6;
/** The columns a repeating group shows on the Overview. */
const GROUP_COLUMNS = 3;

/** The icons of the sections the design draws; any other section gets the form icon. */
const LOOK: Record<string, { icon: Icon; tone: TileTone }> = {
  personal: { icon: UserCircle, tone: 'blue' },
  dependents: { icon: UsersThree, tone: 'purple' },
  income: { icon: CurrencyDollar, tone: 'green' },
  deductions: { icon: FileText, tone: 'amber' },
  bank: { icon: Bank, tone: 'purple' },
};
const TONES: TileTone[] = ['blue', 'purple', 'green', 'amber'];

const answered = (field: IntakeField, answers: IntakeAnswers): boolean => {
  const value = answers[field.key];
  if (field.type === 'group') return Array.isArray(value) && value.length > 0;
  if (field.type === 'grid')
    return Object.values((value ?? {}) as Record<string, Record<string, unknown> | null>).some(
      (row) => row && Object.keys(row).length > 0,
    );
  return isPlain(field) && answerText(field, value) !== '';
};

/** One section of the form's own version, with what the client answered in it. */
function SectionCard({
  section,
  answers,
  index,
}: {
  section: IntakeSection;
  answers: IntakeAnswers;
  index: number;
}) {
  const look = LOOK[section.key] ?? { icon: ClipboardText, tone: TONES[index % TONES.length]! };
  const plain = section.fields.filter((f) => isPlain(f) && answered(f, answers));
  const tables = section.fields.filter(
    (f) => (f.type === 'group' || f.type === 'grid') && answered(f, answers),
  );
  return (
    <InfoCard
      icon={look.icon}
      tone={look.tone}
      title={section.title}
      testId={`card-${section.key}`}
    >
      <div className="flex flex-col gap-3">
        {plain.length > 0 ? (
          <SectionRows
            short
            section={section}
            answers={answers}
            only={plain.slice(0, ROWS).map((f) => f.key)}
          />
        ) : null}
        {plain.length > ROWS ? (
          <p className="text-sm text-text" data-testid={`card-${section.key}-more`}>
            {plain.length - ROWS} more {plain.length - ROWS === 1 ? 'answer' : 'answers'} on the
            Responses tab.
          </p>
        ) : null}
        {tables.map((f) =>
          f.type === 'group' ? (
            <GroupTable
              key={f.key}
              field={f}
              answers={answers}
              columns={f.fields
                .filter((c) => c.key !== 'middleName' && c.key !== 'lastName')
                .slice(0, GROUP_COLUMNS)
                .map((c) => c.key)}
            />
          ) : f.type === 'grid' ? (
            <GridTable key={f.key} field={f} answers={answers} />
          ) : null,
        )}
      </div>
    </InfoCard>
  );
}

/**
 * The Overview tab (Intake Forms Review Two 18d): a card for each section of the version this form
 * was sent with that has answers, the sections not answered yet in one card, whether it is ready
 * for review, and the right column. A different form shows its own sections.
 */
export function OverviewTab() {
  const { id, record, responses } = useDetail();
  const answers: IntakeAnswers = responses?.answers ?? {};
  const sections: IntakeSection[] = (responses?.definition.steps ?? [])
    .flatMap((s) => s.sections)
    .filter((s) => s.fields.some((f) => isPlain(f) || f.type === 'group' || f.type === 'grid'));
  const withAnswers = sections.filter((s) => s.fields.some((f) => answered(f, answers)));
  const waiting = sections.filter((s) => !withAnswers.includes(s));
  const ready = record?.progress.readyForReview || record?.status === 'COMPLETED';

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 @5xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-4 @6xl:grid-cols-2">
        {!responses ? (
          <InfoCard icon={ClipboardText} title="Answers" edit={false} testId="card-answers">
            <Quiet>The answers are not available right now.</Quiet>
          </InfoCard>
        ) : null}
        {withAnswers.map((section, i) => (
          <SectionCard key={section.key} section={section} answers={answers} index={i} />
        ))}
        {waiting.length > 0 ? (
          <InfoCard
            icon={ClipboardText}
            tone="grey"
            title="Not Answered Yet"
            edit={false}
            testId="card-unanswered"
          >
            <ul className="flex flex-wrap gap-2 text-sm">
              {waiting.map((s) => (
                <li key={s.key} className="rounded-md bg-canvas px-2 py-1 text-text">
                  {s.title}
                </li>
              ))}
            </ul>
          </InfoCard>
        ) : null}
        <section
          data-testid="card-ready"
          className="flex items-start gap-3 rounded-xl bg-info-soft p-4"
        >
          <CheckCircle
            aria-hidden
            weight="fill"
            className={`size-8 shrink-0 ${ready ? 'text-success' : 'text-info'}`}
          />
          <div className="flex flex-col gap-1">
            <p className="text-base font-bold text-heading">
              {ready ? 'Form is complete and ready for review' : 'Waiting for the client'}
            </p>
            <p className="text-sm text-text">
              {ready
                ? 'All required information has been submitted by the client.'
                : record
                  ? 'The form is not submitted yet. It can be reviewed once the client sends it.'
                  : 'The status of this form is not available right now.'}
            </p>
            {responses ? (
              <Link href={`/intake-forms/${id}/responses`} className="text-sm text-link">
                See every answer on the Responses tab
              </Link>
            ) : null}
          </div>
        </section>
      </div>
      <Rail />
    </div>
  );
}
