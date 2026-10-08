'use client';

import * as Icons from 'lucide-react';
import { useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { Repeater, SectionPanel } from '../../_blocks/form-blocks';
import {
  AddressFields,
  ChoiceField,
  MaskedField,
  NameFields,
  SelectField,
  TextAreaField,
  TextField,
} from './annual-fields';
import {
  businessStructures,
  deductionQuestions,
  dependentFlags,
  filingStatuses,
  hasBusiness,
  hasSpouse,
  incomeQuestions,
  legalStatuses,
  relationships,
  returnTypes,
} from './annual-data';
import { emptyBusiness, emptyDependent, type AnnualValues } from './annual-schema';
import styles from './annual-tax.module.css';

export function PersonalStep({ taxYear, today }: { taxYear: number; today: string }) {
  const { control, setValue, clearErrors, getFieldState, formState } =
    useFormContext<AnnualValues>();
  const values = useWatch({ control });
  const dependents = useFieldArray({ control, name: 'dependents' });
  const businesses = useFieldArray({ control, name: 'businesses' });
  const business = hasBusiness(values.returnTypes ?? []);
  const spouse = hasSpouse(values.filingStatus ?? '');
  const hasDependents = values.hasDependents === 'Yes';
  return (
    <div className="grid gap-2 lg:grid-cols-2">
      <SectionPanel
        number={1}
        title="Personal & Filing Information"
        subtitle="Tell us about yourself."
        icon={<Icons.UserRound className="size-8" />}
        className={styles.panel}
      >
        <div className="space-y-2">
          <NameFields prefix="personal" />
          <div className="grid grid-cols-2 gap-2">
            <TextField name="personal.dob" label="Date of Birth *" type="date" max={today} />
            <TextField
              name="personal.phone"
              label="Phone Number *"
              type="tel"
              placeholder="(   )   -"
            />
          </div>
          <TextField
            name="personal.email"
            label="Email Address *"
            type="email"
            placeholder="you@example.com"
          />
          <MaskedField name="personal.ssn" label="Social Security Number (SSN) *" />
          <AddressFields prefix="personal.address" label="Physical Address *" />
          <ChoiceField
            name="filingStatus"
            label="Filing Status *"
            options={filingStatuses}
            onChange={(next) => {
              const status = String(next);
              setValue('filingStatus', status, {
                shouldDirty: true,
                shouldValidate: formState.isSubmitted,
              });
              if (!hasSpouse(status)) clearErrors('spouse');
            }}
          />
          <ChoiceField
            name="claimedDependent"
            label="Are you claimed as a dependent on someone else’s return? *"
            options={['Yes', 'No']}
          />
          <div className="rounded-control bg-accent-soft p-2">
            <ChoiceField
              name="returnTypes"
              label="Type of Tax Return(s) You Need (Select one) *"
              options={returnTypes}
              onChange={(next) => {
                setValue('returnTypes', [String(next)], {
                  shouldDirty: true,
                  shouldValidate: formState.isSubmitted,
                });
                if (!hasBusiness([String(next)])) clearErrors('businesses');
              }}
            />
          </div>
          <ChoiceField
            name="legalStatus"
            label="Your Legal Status in the U.S. *"
            options={legalStatuses}
          />
          <ChoiceField
            name="military"
            label="Did you serve in the U.S. Armed Forces? *"
            options={['Yes', 'No']}
          />
        </div>
      </SectionPanel>

      <SectionPanel
        number={2}
        title="Filing Details & Dependents"
        subtitle="Tell us about your filing status, spouse, and dependents."
        icon={<Icons.UsersRound className="size-8" />}
        className={styles.panel}
      >
        <div className="space-y-2">
          <h3 className="flex items-center gap-2 font-display text-base font-bold text-heading">
            <Icons.UsersRound aria-hidden="true" className="size-6 text-accent" />
            Spouse Information{' '}
            <span className="font-sans text-xs font-normal">(if applicable)</span>
          </h3>
          <fieldset
            disabled={!spouse}
            aria-label="Spouse information"
            className="space-y-2 disabled:opacity-60"
          >
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <NameFields prefix="spouse" label="Spouse Full Legal Name" />
              </div>
              <MaskedField name="spouse.ssn" label="Spouse SSN" disabled={!spouse} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <TextField name="spouse.dob" label="Spouse Date of Birth" type="date" max={today} />
              <TextField
                name="spouse.occupation"
                label="Spouse Occupation"
                placeholder="Occupation or job title"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <TextField
                name="spouse.employer"
                label="Spouse Employer"
                placeholder="Employer name"
              />
              <TextField name="spouse.phone" label="Spouse Phone Number" type="tel" />
            </div>
            <TextField
              name="spouse.email"
              label="Spouse Email Address"
              type="email"
              placeholder="you@example.com"
            />
            <AddressFields prefix="spouse.address" label="Spouse Address (if different)" />
          </fieldset>
          <h3 className="flex items-center gap-2 font-display text-lg font-bold text-heading">
            <Icons.UsersRound aria-hidden="true" className="size-6 text-accent" />
            Dependents
          </h3>
          <ChoiceField
            name="hasDependents"
            label="Do you have any dependents? *"
            options={['Yes', 'No']}
            onChange={(value) => {
              setValue('hasDependents', String(value), {
                shouldDirty: true,
                shouldValidate: formState.isSubmitted,
              });
              if (value === 'No') clearErrors('dependents');
              if (value === 'Yes' && !dependents.fields.length) dependents.append(emptyDependent());
            }}
          />
          {values.hasDependents !== 'No' && (
            <Repeater
              title="Dependent"
              ids={dependents.fields.map((field) => field.id)}
              onAdd={() => dependents.append(emptyDependent())}
              onRemove={dependents.remove}
              disabled={!hasDependents}
              error={getFieldState('dependents', formState).error?.message}
            >
              {(index) => (
                <fieldset disabled={!hasDependents} className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <NameFields prefix={`dependents.${index}`} label="Full Name *" />
                    </div>
                    <TextField
                      name={`dependents.${index}.dob`}
                      label="Date of Birth *"
                      type="date"
                      max={today}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <SelectField
                      name={`dependents.${index}.relationship`}
                      label="Relationship to you *"
                      options={relationships}
                    />
                    <MaskedField
                      name={`dependents.${index}.ssn`}
                      label="Dependent SSN (if applicable)"
                      disabled={!hasDependents}
                    />
                  </div>
                  <ChoiceField
                    name={`dependents.${index}.flags`}
                    label="Dependent details"
                    options={dependentFlags}
                    multiple
                  />
                </fieldset>
              )}
            </Repeater>
          )}
        </div>
      </SectionPanel>

      <SectionPanel
        number={3}
        title="Deductions & Credits"
        subtitle="Let us know which deductions or credits may apply to you."
        icon={<Icons.FileText className="size-8" />}
        className={styles.panel}
      >
        <div className="space-y-1">
          {deductionQuestions.map((question, index) => (
            <ChoiceField key={question} name={`deductions.${index}`} label={question} yesNo />
          ))}
        </div>
      </SectionPanel>
      <SectionPanel
        number={4}
        title="Income"
        subtitle={`Tell us more about the types of income you received in ${taxYear}.`}
        icon={<Icons.ChartNoAxesCombined className="size-8" />}
        className={styles.panel}
      >
        <div className="space-y-1">
          {incomeQuestions.map((question, index) => (
            <ChoiceField key={question} name={`income.${index}`} label={question} yesNo />
          ))}
          <TextField
            name="incomeDescription"
            label="If yes, please describe"
            placeholder="Type details here..."
          />
        </div>
      </SectionPanel>

      <SectionPanel
        number={5}
        title="Business Information (if applicable)"
        icon={<Icons.Building2 className="size-8" />}
        className={`lg:col-span-2 ${styles.panel}`}
      >
        <Repeater
          title="Business"
          ids={businesses.fields.map((field) => field.id)}
          onAdd={() => businesses.append(emptyBusiness())}
          onRemove={businesses.remove}
          disabled={!business}
          error={getFieldState('businesses', formState).error?.message}
        >
          {(index) => (
            <fieldset disabled={!business} className="grid gap-3 lg:grid-cols-3">
              <div className="space-y-2">
                <ChoiceField
                  name={`businesses.${index}.structure`}
                  label="Business Legal Structure"
                  options={businessStructures}
                />
                {values.businesses?.[index]?.structure === 'Other' && (
                  <TextField
                    name={`businesses.${index}.otherStructure`}
                    label="Other structure *"
                    placeholder="Please specify"
                  />
                )}
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <TextField
                    name={`businesses.${index}.name`}
                    label="Business Legal Name *"
                    placeholder="Your business name"
                  />
                  <MaskedField
                    name={`businesses.${index}.ein`}
                    label="Business EIN *"
                    kind="EIN"
                    disabled={!business}
                  />
                </div>
                <AddressFields prefix={`businesses.${index}.address`} label="Business Address *" />
              </div>
              <div className="space-y-2">
                <ChoiceField
                  name={`businesses.${index}.activity`}
                  label="Is your business primarily selling? *"
                  options={['Goods (Products)', 'Services']}
                />
                <TextAreaField
                  name={`businesses.${index}.products`}
                  label="What kind of products or services do you sell? *"
                  placeholder="Please describe your products or services..."
                />
              </div>
            </fieldset>
          )}
        </Repeater>
      </SectionPanel>
      <div className="grid items-center gap-2 rounded-control border border-folder-border bg-accent-soft p-2 lg:col-span-2 sm:grid-cols-2">
        <div className="flex gap-2">
          <Icons.MessageSquare aria-hidden="true" className="size-7 shrink-0 text-accent" />
          <p className="text-xs">
            <strong className="font-display text-base text-heading">
              Comments / Additional Information
            </strong>
            <br />
            If there is anything else you would like us to know, please provide details here.
          </p>
        </div>
        <TextAreaField
          name="comments"
          label="Comments / Additional Information"
          hideLabel
          placeholder="Type your comments here..."
        />
      </div>
    </div>
  );
}
