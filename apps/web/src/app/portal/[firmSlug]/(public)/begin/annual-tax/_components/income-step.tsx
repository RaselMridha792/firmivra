'use client';

import * as Icons from 'lucide-react';
import { useFormContext, useWatch, type FieldPath } from 'react-hook-form';
import { SectionPanel } from '../../_blocks/form-blocks';
import { QuarterlyGrid } from '../../_blocks/quarterly-grid';
import { expenseRows, financialSections } from './annual-data';
import type { AnnualValues } from './annual-schema';
import styles from './annual-tax.module.css';

const icons = {
  income: Icons.ChartNoAxesCombined,
  people: Icons.UsersRound,
  tax: Icons.BadgeDollarSign,
};
export function IncomeStep() {
  const form = useFormContext<AnnualValues>();
  const values = useWatch({ control: form.control });
  const error = (name: FieldPath<AnnualValues>) =>
    form.getFieldState(name, form.formState).error?.message;
  const set = (
    key: 'businessIncome' | 'payroll' | 'taxPayments' | 'expenses',
    index: number,
    field: 'description' | 'annual' | number,
    value: string,
  ) =>
    form.setValue(
      `${key}.${index}.${typeof field === 'number' ? `quarters.${field}` : field}` as FieldPath<AnnualValues>,
      value,
      { shouldDirty: true, shouldValidate: form.formState.isSubmitted },
    );
  return (
    <div className="min-w-0 space-y-2">
      {financialSections.map(({ key, title, subtitle, icon, rows }, index) => {
        const Icon = icons[icon];
        return (
          <SectionPanel
            key={key}
            number={index + 1}
            title={title}
            subtitle={subtitle}
            icon={<Icon className="size-8" />}
            className={styles.panel}
          >
            <QuarterlyGrid
              title={title}
              labels={rows}
              rows={form.getValues(key)}
              firstColumn={
                key === 'payroll' ? 'Description' : key === 'taxPayments' ? 'Tax Type' : undefined
              }
              onChange={(row, field, value) => set(key, row, field, value)}
              errors={(row, quarter) => error(`${key}.${row}.quarters.${quarter ?? 0}`)}
              showTotal={key === 'businessIncome'}
            />
          </SectionPanel>
        );
      })}
      <SectionPanel
        number={4}
        title="Business Expenses"
        subtitle="Enter your total business expenses for the year. Include all ordinary and necessary expenses. You can also select a detailed expense report on the next step."
        icon={<Icons.Calculator className="size-8" />}
        className={styles.panel}
      >
        <div className="grid min-w-0 grid-cols-1 gap-2 lg:grid-cols-2">
          {[0, 12].map((offset) => (
            <QuarterlyGrid
              key={offset}
              title="Business Expenses"
              labels={expenseRows.slice(offset, offset === 0 ? 12 : undefined)}
              rows={form.getValues('expenses').slice(offset, offset === 0 ? 12 : undefined)}
              totalRows={form.getValues('expenses')}
              firstColumn="Expense Category"
              annualOnly
              showTotal={offset === 12}
              onChange={(row, field, value) => set('expenses', offset + row, field, value)}
              errors={(row) => error(`expenses.${offset + row}.annual`)}
            />
          ))}
        </div>
        <span className="sr-only">{values.expenses?.length ?? 0} expense categories</span>
      </SectionPanel>
    </div>
  );
}
