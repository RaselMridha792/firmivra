'use client';

import {
  intakeConditionHolds,
  type IntakeField,
  type IntakeGroupField,
  type IntakeScalarField,
} from '@firmivra/types';
import { Button } from '@firmivra/ui';
import { ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, type ReactNode } from 'react';
import { SectionPanel } from '../../_blocks/form-blocks';
import { ScalarInput } from '../../_blocks/intake-fields';
import { FieldInput, type StepProps } from '../../_blocks/intake-step';
import { emptyRow, type ScreenRow, type ScreenScalar } from '../../_blocks/intake-values';
import styles from './annual-tax.module.css';
import { AnnualArtwork } from './annual-artwork';

function presentation<T extends IntakeField>(field: T): T {
  const key = field.key.toLowerCase();
  const placeholder = key.endsWith('firstname')
    ? 'First'
    : key.endsWith('middlename')
      ? 'Middle (if any)'
      : key.endsWith('lastname')
        ? 'Last'
        : key.endsWith('city')
          ? 'City'
          : key.endsWith('state')
            ? 'State'
            : key.endsWith('zip')
              ? 'ZIP Code'
              : key === 'legalstructureother'
                ? 'Please specify'
                : field.type === 'email'
                  ? 'you@example.com'
                  : field.type === 'phone'
                    ? '(     )        -'
                    : field.type === 'select'
                      ? 'Select relationship'
                      : undefined;
  return placeholder ? { ...field, placeholder } : field;
}
export function AnnualPersonalStep(props: StepProps) {
  const { step, values, shown, onChange, fill } = props;
  const section = (key: string) => step.sections.find((s) => s.key === key)!;
  const types = values['returnTypes'];
  // Older drafts can have several choices; Both preserves their personal/business coverage.
  useEffect(() => {
    if (Array.isArray(types) && types.length > 1) onChange('returnTypes', ['BOTH']);
  }, [types, onChange]);
  const cells = (key: string) => (
    <div data-section={key} className={styles.cells}>
      {section(key)
        .fields.filter((f) => f.type !== 'info')
        .map((field) => (
          <div key={field.key} data-cell={field.key}>
            {field.key === 'returnTypes' && (
              <h3 className={styles.returnTitle}>
                <AnnualArtwork region="returns" />
                Type of Tax Return(s) You Need <small>(Select one)</small> <span>*</span>
              </h3>
            )}
            {field.key === 'returnTypes' && field.type === 'checkboxes' ? (
              <ScalarInput
                field={{
                  ...field,
                  type: 'radio',
                  label: field.label.replace('(Select all that apply)', '(Select one)'),
                }}
                name={field.key}
                fill={fill}
                error={props.errors[field.key]}
                value={
                  Array.isArray(types)
                    ? types.length > 1
                      ? 'BOTH'
                      : typeof types[0] === 'string'
                        ? types[0]
                        : null
                    : null
                }
                onChange={(value) =>
                  onChange(field.key, typeof value === 'string' && value ? [value] : [])
                }
              />
            ) : (
              <FieldInput
                {...props}
                field={presentation(
                  key === 'spouse' && !shown.has(field.key) ? { ...field, required: false } : field,
                )}
              />
            )}
          </div>
        ))}
    </div>
  );
  const spouse = !values['filingStatus'] || shown.has('spouseFirstName');
  const business = !Array.isArray(types) || !types.length || shown.has('businesses');
  const group = (key: string) =>
    step.sections
      .flatMap((s) => s.fields)
      .find((f): f is IntakeGroupField => f.key === key && f.type === 'group')!;
  const panel = (key: string, number: number, icon: ReactNode) => (
    <SectionPanel
      number={number}
      title={fill(section(key).title)}
      subtitle={section(key).subtitle ? fill(section(key).subtitle!) : undefined}
      icon={icon}
    >
      {cells(key)}
    </SectionPanel>
  );
  return (
    <div className={styles.personal} data-annual-personal>
      <div className={styles.panels}>
        {panel('personal', 1, <AnnualArtwork region="personal" />)}
        <SectionPanel
          number={2}
          title="Filing Details & Dependents"
          subtitle="Tell us about your filing status, spouse, and dependents."
          icon={<AnnualArtwork region="filing" />}
        >
          {spouse && (
            <>
              <h3 className={styles.subheading}>
                <AnnualArtwork region="spouse" /> Spouse Information <small>(if applicable)</small>
              </h3>
              {cells('spouse')}
            </>
          )}
          <div className={styles.dependentsTitle}>
            <h3 className={styles.subheading}>
              <AnnualArtwork region="dependents" /> Dependents
            </h3>
            <FieldInput {...props} field={section('dependents').fields[0]!} />
          </div>
          {values['hasDependents'] !== false && (
            <AnnualGroup
              {...props}
              field={group('dependents')}
              activate={() => onChange('hasDependents', true)}
            />
          )}
        </SectionPanel>
        {panel('deductions', 3, <AnnualArtwork region="deductions" />)}
        {panel('income', 4, <AnnualArtwork region="income" />)}
        {business && (
          <SectionPanel
            number={5}
            title="Business Information"
            subtitle="(if applicable)"
            icon={<AnnualArtwork region="business" />}
            iconPosition="start"
            className={styles.business}
          >
            <AnnualGroup {...props} field={group('businesses')} activate={() => undefined} />
          </SectionPanel>
        )}
      </div>
      <div className={styles.comments}>
        <AnnualArtwork region="comments" />
        <div>
          <h3>Comments / Additional Information</h3>
          <p>If there is anything else you would like us to know, please provide details here.</p>
        </div>
        <div>{cells('comments')}</div>
      </div>
      <div className={styles.important}>
        {section('comments')
          .fields.filter((f) => f.type === 'info')
          .map((f) => (
            <FieldInput key={f.key} {...props} field={f} />
          ))}
      </div>
    </div>
  );
}
function AnnualGroup(props: StepProps & { field: IntakeGroupField; activate: () => void }) {
  const { field, values, onChange, errors, fill, activate } = props;
  const previewId = useId();
  const rows = (values[field.key] ?? []) as ScreenRow[];
  // A blank preview mirrors the mockup without assuming a dependent or business in saved data.
  const displayed = rows.length ? rows : [{ ...emptyRow(field.fields), id: previewId }];
  const setRows = (next: ScreenRow[]) => {
    activate();
    onChange(field.key, next);
  };
  function cells(fields: IntakeScalarField[], row: ScreenRow, index: number) {
    return (
      <div className={styles.cells} data-section={field.key}>
        {fields
          .filter(
            (f) =>
              intakeConditionHolds(f.showIf, row) ||
              (f.key === 'legalStructureOther' && !row['legalStructure']),
          )
          .map((f) => (
            <div key={f.key} data-cell={f.key}>
              <ScalarInput
                field={presentation(f)}
                value={row[f.key] ?? null}
                fill={fill}
                name={`${field.key}-${row.id}-${f.key}`}
                error={errors[`${field.key}.${index}.${f.key}`]}
                onChange={(value: ScreenScalar) =>
                  setRows(displayed.map((r, i) => (i === index ? { ...r, [f.key]: value } : r)))
                }
              />
            </div>
          ))}
      </div>
    );
  }
  return (
    <div data-group={field.key} data-rows={rows.length} className={styles.group}>
      {displayed.map((row, index) => (
        <details key={row.id} open data-testid={`${field.key}-${index + 1}`}>
          <summary>
            <ChevronDown aria-hidden />
            {fill(field.itemLabel)} {index + 1}
            <Button
              variant="ghost"
              aria-label={`Remove ${fill(field.itemLabel).toLowerCase()} ${index + 1}`}
              onClick={(event) => {
                event.preventDefault();
                onChange(
                  field.key,
                  rows.filter((_, i) => i !== index),
                );
                if (field.key === 'dependents' && rows.length <= 1)
                  onChange('hasDependents', false);
              }}
            >
              <Trash2 aria-hidden />
            </Button>
          </summary>
          {field.key === 'businesses' ? (
            <div className={styles.businessColumns}>
              {cells(
                field.fields.filter((f) =>
                  ['legalStructure', 'legalStructureOther'].includes(f.key),
                ),
                row,
                index,
              )}
              {cells(
                field.fields.filter((f) =>
                  ['legalName', 'ein', 'street', 'city', 'state', 'zip'].includes(f.key),
                ),
                row,
                index,
              )}
              {cells(
                field.fields.filter((f) => ['sells', 'productsOrServices'].includes(f.key)),
                row,
                index,
              )}
            </div>
          ) : (
            cells(field.fields, row, index)
          )}
        </details>
      ))}
      {errors[field.key] && (
        <p role="alert" className="text-danger">
          {errors[field.key]}
        </p>
      )}
      {rows.length < field.maxItems && (
        <Button variant="outline" onClick={() => setRows([...displayed, emptyRow(field.fields)])}>
          <Plus aria-hidden />
          {fill(field.addLabel)}
        </Button>
      )}
    </div>
  );
}
