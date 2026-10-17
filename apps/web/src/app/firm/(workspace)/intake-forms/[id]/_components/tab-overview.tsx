'use client';

import type { IntakeAnswers, IntakeField, IntakeGroupField, IntakeSection } from '@firmivra/types';
import {
  Bank,
  CheckCircle,
  CurrencyDollar,
  FileText,
  Info,
  UserCircle,
  UsersThree,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { GroupTable, InfoCard, Rows, SectionRows } from './detail-cards';
import { useDetail } from './detail-frame';
import { Quiet, answerText } from './detail-shared';
import { Rail } from './detail-rail';

/** The Overview tab: the cards of the submission and the right column. */
export function OverviewTab() {
  const { record, responses } = useDetail();
  const sections: IntakeSection[] = responses?.definition.steps.flatMap((s) => s.sections) ?? [];
  const answers: IntakeAnswers = responses?.answers ?? {};
  const section = (key: string) => sections.find((s) => s.key === key);
  const fields: IntakeField[] = sections.flatMap((s) => s.fields);
  const val = (key: string) => {
    const f = fields.find((x) => x.key === key);
    return f ? answerText(f, answers[key]) : '';
  };
  const cityLine = [val('city'), [val('state'), val('zip')].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const address = [val('street'), cityLine].filter(Boolean).join('\n');
  const empty = (text: string): ReactNode => <Quiet>{text}</Quiet>;
  const personal = section('personal');
  const dependents = section('dependents');
  const deductions = section('deductions');
  const income = section('income');
  const group = dependents?.fields.find((f): f is IntakeGroupField => f.type === 'group');
  const count = Array.isArray(answers['dependents']) ? answers['dependents'].length : 0;
  const ready = record?.progress.readyForReview || record?.status === 'COMPLETED';

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <InfoCard icon={UserCircle} title="Personal Information" testId="card-personal">
          {personal ? (
            <Rows
              rows={[
                [
                  'Full Name',
                  [val('firstName'), val('middleName'), val('lastName')].filter(Boolean).join(' '),
                ],
                ['Filing Status', val('filingStatus')],
                ['Date of Birth', val('dateOfBirth')],
                ['SSN', val('ssn')],
                ['Phone', val('phone')],
                ['Address', address],
              ]}
            />
          ) : (
            empty('Personal information is not available right now.')
          )}
        </InfoCard>
        <InfoCard icon={UsersThree} tone="purple" title="Dependents" testId="card-dependents">
          {group ? (
            <div className="flex flex-col gap-3">
              <GroupTable
                field={group}
                answers={answers}
                columns={['firstName', 'relationship', 'dateOfBirth']}
              />
              <p className="flex items-center gap-2 rounded-lg bg-info-soft p-3 text-sm text-text">
                <Info aria-hidden weight="fill" className="size-5 shrink-0 text-info" />
                {count === 1
                  ? '1 dependent claimed on this return.'
                  : `${count} dependents claimed on this return.`}
              </p>
            </div>
          ) : (
            empty('Dependents are not available right now.')
          )}
        </InfoCard>
        <InfoCard icon={CurrencyDollar} tone="green" title="Income" testId="card-income">
          {income ? (
            <div className="flex flex-col gap-3">
              <SectionRows
                short
                section={income}
                answers={answers}
                only={income.fields.filter((f) => f.type === 'yesNo').map((f) => f.key)}
              />
              {val('incomeDetails') ? (
                <p className="rounded-lg bg-canvas p-3 text-sm text-text">{val('incomeDetails')}</p>
              ) : null}
            </div>
          ) : (
            empty('Income answers are not available right now.')
          )}
        </InfoCard>
        <InfoCard
          icon={FileText}
          tone="amber"
          title="Deductions & Credits"
          testId="card-deductions"
        >
          {deductions ? (
            <SectionRows short section={deductions} answers={answers} />
          ) : (
            empty('Deductions are not available right now.')
          )}
        </InfoCard>
        <InfoCard icon={Bank} tone="purple" title="Bank / Refund Information" testId="card-bank">
          {empty('This form does not ask for bank or refund details.')}
        </InfoCard>
        <section
          data-testid="card-ready"
          className="flex items-start gap-3 rounded-xl bg-info-soft p-4"
        >
          <CheckCircle
            aria-hidden
            weight="fill"
            className={`size-8 shrink-0 ${ready ? 'text-success' : 'text-info'}`}
          />
          <div>
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
          </div>
        </section>
      </div>
      <Rail />
    </div>
  );
}
