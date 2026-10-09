'use client';

import type { IntakeField, IntakeSection, IntakeStep } from '@firmivra/types';
import { SectionPanel } from './form-blocks';
import { type Fill, InfoNote, ScalarInput } from './intake-fields';
import { GridInput } from './intake-grid';
import { GroupInput } from './intake-group';
import { type UploadActions, UploadInput } from './intake-upload';
import {
  issueKey,
  type ScreenGrid,
  type ScreenRow,
  type ScreenScalar,
  type ScreenUpload,
  type ScreenValue,
  type ScreenValues,
} from './intake-values';

/** A field that takes the panel's whole width. */
function wideField(f: IntakeField): boolean {
  switch (f.type) {
    case 'textarea':
    case 'grid':
    case 'group':
    case 'upload':
    case 'info':
    case 'checkboxes':
      return true;
    case 'radio':
      return f.display === 'cards' || f.options.length > 3;
    case 'state':
      return f.multiple;
    default:
      return false;
  }
}

/** A panel that takes both columns of the step: tables, repeating rows, cards, long lists. */
function wideSection(section: IntakeSection): boolean {
  return (
    section.fields.length > 10 ||
    section.fields.some(
      (f) =>
        f.type === 'grid' ||
        f.type === 'group' ||
        f.type === 'upload' ||
        (f.type === 'radio' && f.display === 'cards') ||
        (f.type === 'checkboxes' && f.options.length > 8),
    )
  );
}

export interface StepProps {
  step: IntakeStep;
  values: ScreenValues;
  /** The fields the answers show (`shownIntakeKeys` over the whole form). */
  shown: ReadonlySet<string>;
  onChange: (key: string, value: ScreenValue) => void;
  errors: Readonly<Record<string, string>>;
  fill: Fill;
  actions: UploadActions;
}

/** One field of a step, by its type. */
export function FieldInput({
  field,
  values,
  onChange,
  errors,
  fill,
  actions,
}: Omit<StepProps, 'step' | 'shown'> & { field: IntakeField }) {
  const value = values[field.key];
  const set = (v: ScreenValue) => onChange(field.key, v);
  switch (field.type) {
    case 'info':
      return <InfoNote label={fill(field.label)} text={fill(field.text)} />;
    case 'grid':
      return (
        <GridInput
          field={field}
          value={(value ?? {}) as ScreenGrid}
          onChange={set}
          errors={errors}
          fill={fill}
        />
      );
    case 'group':
      return (
        <GroupInput
          field={field}
          rows={(value ?? []) as ScreenRow[]}
          onChange={set}
          errors={errors}
          fill={fill}
        />
      );
    case 'upload':
      return (
        <UploadInput
          field={field}
          value={(value ?? { notAvailable: false, reason: '' }) as ScreenUpload}
          onChange={set}
          errors={errors}
          fill={fill}
          actions={actions}
        />
      );
    default:
      return (
        <ScalarInput
          field={field}
          name={field.key}
          value={(value ?? null) as ScreenScalar}
          onChange={set}
          error={errors[issueKey([field.key])]}
          fill={fill}
        />
      );
  }
}

/** A step's numbered panels with the fields the answers show. */
export function StepSections({ step, values, shown, onChange, errors, fill, actions }: StepProps) {
  const sections = step.sections.filter((section) => section.fields.some((f) => shown.has(f.key)));
  return (
    <div className="grid items-start gap-3 lg:grid-cols-2">
      {sections.map((section, index) => (
        <SectionPanel
          key={section.key}
          number={index + 1}
          title={fill(section.title)}
          subtitle={section.subtitle ? fill(section.subtitle) : undefined}
          className={wideSection(section) || sections.length === 1 ? 'lg:col-span-2' : ''}
        >
          <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2" data-section={section.key}>
            {section.fields
              .filter((f) => shown.has(f.key))
              .map((f) => (
                <div key={f.key} className={wideField(f) ? 'min-w-0 sm:col-span-2' : 'min-w-0'}>
                  <FieldInput
                    field={f}
                    values={values}
                    onChange={onChange}
                    errors={errors}
                    fill={fill}
                    actions={actions}
                  />
                </div>
              ))}
          </div>
        </SectionPanel>
      ))}
    </div>
  );
}
