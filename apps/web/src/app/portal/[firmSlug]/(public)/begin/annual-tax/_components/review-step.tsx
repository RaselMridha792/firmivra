'use client';

import { Button, Checkbox, Radio, Table, type Column } from '@firmivra/ui';
import { Pencil, WalletCards } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useFormContext, useWatch } from 'react-hook-form';
import { ReviewCard, ReviewRows, SectionPanel } from '../../_blocks/form-blocks';
import { QuarterlyGrid } from '../../_blocks/quarterly-grid';
import { TextField } from './annual-fields';
import {
  deductionQuestions,
  documentCategories,
  expenseRows,
  financialSections,
  hasBusiness,
  hasSpouse,
  identitySlots,
  incomeQuestions,
  maskLastFour,
  paymentOptions,
  type DocumentId,
} from './annual-data';
import type { AnnualValues } from './annual-schema';
import styles from './annual-tax.module.css';

const fullName = (person: { first: string; middle: string; last: string }) =>
  [person.first, person.middle, person.last].filter(Boolean).join(' ');
const address = (value: AnnualValues['personal']['address']) =>
  [value.street, value.city, value.state, value.zip].filter(Boolean).join(', ');
const date = (value: string) =>
  value ? `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}` : 'Not provided';
type DocumentRow = { id: string; category: string; name: string; date: string };
const documentColumns: Column<DocumentRow>[] = [
  { id: 'category', label: 'Document Name', cell: (row) => row.category },
  { id: 'name', label: 'File Name / Status', cell: (row) => row.name },
  { id: 'date', label: 'Date Selected', cell: (row) => row.date },
];
function DocumentTable({
  data,
  ids,
  caption,
}: {
  data: AnnualValues;
  ids: DocumentId[];
  caption: string;
}) {
  const slots = [...identitySlots, ...documentCategories];
  const rows: DocumentRow[] = ids.flatMap((id) => {
    const slot = data.documents[id],
      category = slots.find((item) => item.id === id)?.title ?? id;
    return slot.unavailable
      ? [{ id, category, name: `Unavailable: ${slot.reason}`, date: '—' }]
      : slot.files.map(({ id: fileId, file, selectedAt }) => ({
          id: fileId,
          category,
          name: file.name,
          date: date(selectedAt),
        }));
  });
  return (
    <div className="min-w-0 [&_table]:text-xs [&_td]:p-1 [&_td]:break-words [&_th]:p-1">
      <Table
        rows={rows}
        columns={documentColumns}
        rowKey={(row) => row.id}
        caption={caption}
        emptyTitle="No documents selected"
        emptyText="No files or unavailable-document explanations for this category."
        pageSize={100}
      />
    </div>
  );
}

// Only the supplied mockup excerpt is available; do not invent the remaining clauses.
const agreementExcerpt =
  'This Tax Preparation Service Agreement (“Agreement”) is made between you (“Client”) and your tax preparation firm. By signing this agreement, you acknowledge that you have read, understand, and agree to the terms and conditions below.';
export function ReviewStep({
  taxYear,
  today,
  onEdit,
}: {
  taxYear: number;
  today: string;
  onEdit: (step: number) => void;
}) {
  const form = useFormContext<AnnualValues>();
  const { fields: businessFields } = useFieldArray({ control: form.control, name: 'businesses' });
  useWatch({ control: form.control });
  const data = form.getValues();
  const business = hasBusiness(data.returnTypes);
  const [agreementRead, setAgreementRead] = useState(data.agreed);
  const refundEligible =
    !business && data.income[0] === 'Yes' && !data.income.slice(1).includes('Yes');
  const dependentColumns: Column<AnnualValues['dependents'][number]>[] = [
    { id: 'name', label: 'Name', cell: fullName },
    { id: 'dob', label: 'Date of Birth', cell: (row) => date(row.dob) },
    { id: 'relationship', label: 'Relationship', cell: (row) => row.relationship },
    {
      id: 'details',
      label: 'Other Details',
      cell: (row) =>
        `${row.flags.join(', ') || 'None'}${row.ssn ? `; SSN: ${maskLastFour(row.ssn)}` : ''}`,
    },
  ];
  return (
    <div data-testid="annual-review" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control border border-folder-border p-3">
        <div>
          <h2 className="font-display text-2xl font-bold text-heading">Review Your Information</h2>
          <p className="text-xs">
            Please review all the information below to ensure everything is correct before signing
            and submitting.
          </p>
        </div>
        <Button variant="outline" onClick={() => onEdit(1)}>
          <Pencil aria-hidden="true" className="size-4" />
          Edit Information
        </Button>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        <ReviewCard title="Personal Information" onEdit={() => onEdit(1)}>
          <ReviewRows
            rows={[
              ['Full Name', fullName(data.personal)],
              ['Date of Birth', date(data.personal.dob)],
              ['Email Address', data.personal.email],
              ['Phone Number', data.personal.phone],
              [
                'Social Security Number',
                <span key="ssn" data-testid="review-ssn">
                  {maskLastFour(data.personal.ssn)}
                </span>,
              ],
              ['Physical Address', address(data.personal.address)],
            ]}
          />
        </ReviewCard>
        <ReviewCard title="Spouse Information" onEdit={() => onEdit(1)}>
          {hasSpouse(data.filingStatus) ? (
            <ReviewRows
              rows={[
                ['Spouse Full Name', fullName(data.spouse)],
                ['Date of Birth', date(data.spouse.dob)],
                ['Social Security Number', maskLastFour(data.spouse.ssn)],
                ['Occupation', data.spouse.occupation],
                ['Employer', data.spouse.employer],
                ['Phone Number', data.spouse.phone],
                ['Email Address', data.spouse.email],
                ['Address', address(data.spouse.address) || 'Same as primary address'],
              ]}
            />
          ) : (
            <p className="text-xs text-muted">Not applicable</p>
          )}
        </ReviewCard>
        <ReviewCard title="Dependents Information" onEdit={() => onEdit(1)}>
          <div className="[&_table]:text-xs [&_td]:p-1 [&_th]:p-1">
            <Table
              rows={data.hasDependents === 'Yes' ? data.dependents : []}
              columns={dependentColumns}
              rowKey={(_row) => `dependent-${data.dependents.indexOf(_row)}`}
              caption="Dependents information"
              emptyTitle="No dependents"
              emptyText="You indicated that you do not have dependents."
              pageSize={100}
            />
          </div>
        </ReviewCard>
        <ReviewCard title="Filing Information" onEdit={() => onEdit(1)}>
          <ReviewRows
            rows={[
              ['Tax Year', taxYear],
              ['Filing Status', data.filingStatus],
              ['Claimed as a Dependent', data.claimedDependent],
              ['U.S. Armed Forces', data.military],
              ['Legal Status in U.S.', data.legalStatus],
              ['Type of Tax Return', data.returnTypes.join(', ')],
              ['Additional Information', data.comments],
              ['Other Income', data.incomeDescription],
            ]}
          />
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold text-heading">
              Income & deductions answers
            </summary>
            <ReviewRows
              rows={[
                ...incomeQuestions.map((label, index): [string, string] => [
                  label,
                  data.income[index] ?? 'No',
                ]),
                ...deductionQuestions.map((label, index): [string, string] => [
                  label,
                  data.deductions[index] ?? 'No',
                ]),
              ]}
            />
          </details>
        </ReviewCard>
        <ReviewCard title="Income Documents" onEdit={() => onEdit(3)}>
          <DocumentTable data={data} ids={['incomeDocuments']} caption="Income documents" />
          <details className="mt-2">
            <summary className="cursor-pointer text-xs font-semibold">Identity documents</summary>
            <DocumentTable
              data={data}
              ids={identitySlots.map((slot) => slot.id)}
              caption="Identity documents"
            />
          </details>
        </ReviewCard>
        <ReviewCard title="Deductions & Credits Documents" onEdit={() => onEdit(3)}>
          <DocumentTable
            data={data}
            ids={['deductionsDocuments']}
            caption="Deductions and credits documents"
          />
        </ReviewCard>
        {business && (
          <ReviewCard
            title="Business Information"
            onEdit={() => onEdit(1)}
            className="lg:col-span-2"
          >
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-2">
                {data.businesses.map((value, index) => (
                  <div key={businessFields[index]?.id ?? value.ein}>
                    {data.businesses.length > 1 && (
                      <h4 className="mb-1 font-semibold">Business {index + 1}</h4>
                    )}
                    <ReviewRows
                      rows={[
                        [
                          'Business Legal Structure',
                          value.structure === 'Other' ? value.otherStructure : value.structure,
                        ],
                        ['Business Legal Name', value.name],
                        ['Business EIN', maskLastFour(value.ein, 'EIN')],
                        ['Business Address', address(value.address)],
                        ['Primary Business Activity', value.activity],
                        ['Products/Services', value.products],
                      ]}
                    />
                  </div>
                ))}
              </div>
              <DocumentTable
                data={data}
                ids={['businessDocuments', 'formationDocuments']}
                caption="Business documents"
              />
            </div>
            <details className="mt-3">
              <summary className="cursor-pointer font-semibold text-heading">
                Business Income & Expenses
              </summary>
              <Button
                variant="outline"
                onClick={() => onEdit(2)}
                aria-label="Edit Business Income & Expenses"
                className="my-2 min-h-7! text-xs!"
              >
                <Pencil aria-hidden="true" className="size-3" />
                Edit Business Income & Expenses
              </Button>
              <div className="space-y-3">
                {financialSections.map(({ key, title, rows }) => (
                  <QuarterlyGrid key={key} title={title} labels={rows} rows={data[key]} readOnly />
                ))}
                <QuarterlyGrid
                  title="Business Expenses"
                  labels={expenseRows}
                  rows={data.expenses}
                  readOnly
                  annualOnly
                />
              </div>
            </details>
          </ReviewCard>
        )}
      </div>
      <SectionPanel
        title="How would you like to pay for your service?"
        icon={<WalletCards className="size-8" />}
        className={styles.panel}
      >
        <Controller
          control={form.control}
          name="payment"
          render={({ field, fieldState }) => (
            <>
              <fieldset aria-label="Payment preference" className="grid gap-3 lg:grid-cols-3">
                {paymentOptions.map(({ value, label, detail }) => (
                  <div key={value}>
                    <Radio
                      label={label}
                      name="payment"
                      value={value}
                      checked={field.value === value}
                      disabled={value === 'refund' && !refundEligible}
                      onChange={() => field.onChange(value)}
                      className="items-start! text-xs!"
                    />
                    <p className="pl-7 text-xs text-firm-primary">{detail}</p>
                  </div>
                ))}
              </fieldset>
              {fieldState.error && (
                <p className="text-xs text-danger">{fieldState.error.message}</p>
              )}
            </>
          )}
        />
      </SectionPanel>
      <SectionPanel
        title="Service Agreement"
        subtitle="Please read the service agreement excerpt below. Scroll through the entire available text to continue."
        className={styles.panel}
      >
        <div
          aria-label="Service agreement excerpt"
          role="region"
          tabIndex={0}
          ref={(element) => {
            if (element && element.scrollHeight <= element.clientHeight) setAgreementRead(true);
          }}
          onScroll={(event) => {
            const element = event.currentTarget;
            if (element.scrollTop + element.clientHeight >= element.scrollHeight - 2)
              setAgreementRead(true);
          }}
          className="max-h-28 overflow-y-auto rounded-control border border-folder-border bg-surface p-2 text-xs leading-relaxed text-firm-primary"
        >
          <h3 className="font-display font-bold text-heading">
            TAX PREPARATION SERVICE AGREEMENT — EXCERPT
          </h3>
          <p>{agreementExcerpt}</p>
          <h4 className="mt-2 font-semibold">1. Services</h4>
          <p>
            We agree to prepare your federal and state income tax returns based on the information
            you provide. Our services include tax preparation and related consulting services.
          </p>
        </div>
        <Controller
          control={form.control}
          name="agreed"
          render={({ field, fieldState }) => (
            <>
              <Checkbox
                label="I have read and understand the Service Agreement excerpt shown above. I agree to the terms and conditions shown."
                checked={field.value}
                disabled={!agreementRead}
                onChange={field.onChange}
                className="text-xs!"
              />
              {!agreementRead && (
                <p className="text-xs text-muted">Read to the end to enable this checkbox.</p>
              )}
              {fieldState.error && (
                <p className="text-xs text-danger">{fieldState.error.message}</p>
              )}
            </>
          )}
        />
        <div className="grid items-end gap-2 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <TextField
                  name="signature"
                  label="Signature (typed full name) *"
                  placeholder="Type your full name here"
                  autoComplete="off"
                />
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  form.setValue('signature', '', { shouldDirty: true, shouldValidate: true })
                }
                className="min-h-7!"
              >
                Clear
              </Button>
            </div>
          </div>
          <TextField name="signatureDate" label="Date *" type="date" max={today} />
        </div>
      </SectionPanel>
    </div>
  );
}
