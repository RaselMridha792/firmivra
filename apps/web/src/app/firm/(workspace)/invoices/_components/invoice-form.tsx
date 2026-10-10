'use client';
import { CreateInvoiceRequest, INVOICE_ERRORS, invoiceTotals } from '@firmivra/types';
import { Button, Card, Input, Modal } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useFieldArray, useForm, useWatch } from 'react-hook-form';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
const cents = (input: string | number) => {
  const value = String(input);
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return NaN;
  const [whole = '0', fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
};
export function InvoiceForm({ clientId, onClose }: { clientId: string; onClose: () => void }) {
  const form = useForm<CreateInvoiceRequest>({
    resolver: zodResolver(CreateInvoiceRequest),
    defaultValues: {
      clientId,
      dueOn: '',
      lines: [{ description: '', quantity: 1, unitAmountCents: 0 }],
    },
  });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const values = useWatch({ control: form.control, name: 'lines' });
  const total = invoiceTotals({
    lines: (values ?? []).map((line) => ({
      quantity: Number(line.quantity) || 0,
      unitAmountCents: Number(line.unitAmountCents) || 0,
    })),
  }).totalCents;
  const create = useApiMutation((body: CreateInvoiceRequest) => api.invoices.create(body), {
    invalidate: ['invoices'],
  });
  return (
    <Modal open title="New invoice" onClose={onClose}>
      <form
        className="space-y-4"
        data-testid="invoice-form"
        onSubmit={form.handleSubmit((body) => create.mutate(body, { onSuccess: onClose }))}
      >
        <Input
          label="Due date"
          type="date"
          error={form.formState.errors.dueOn?.message}
          {...form.register('dueOn')}
        />
        {lines.fields.map((line, index) => (
          <Card key={line.id} className="space-y-3" data-testid="invoice-line">
            <Input
              label={`Description ${index + 1}`}
              error={form.formState.errors.lines?.[index]?.description?.message}
              {...form.register(`lines.${index}.description`)}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label={`Quantity ${index + 1}`}
                type="number"
                step="0.01"
                error={form.formState.errors.lines?.[index]?.quantity?.message}
                {...form.register(`lines.${index}.quantity`, { valueAsNumber: true })}
              />
              <Input
                label={`Unit price ${index + 1} (USD)`}
                type="text"
                inputMode="decimal"
                error={form.formState.errors.lines?.[index]?.unitAmountCents?.message}
                {...form.register(`lines.${index}.unitAmountCents`, { setValueAs: cents })}
              />
            </div>
            <Button
              variant="secondary"
              disabled={lines.fields.length === 1}
              onClick={() => lines.remove(index)}
              aria-label={`Remove line ${index + 1}`}
            >
              Remove line
            </Button>
          </Card>
        ))}
        <Button
          variant="secondary"
          disabled={lines.fields.length >= 50}
          onClick={() => lines.append({ description: '', quantity: 1, unitAmountCents: 0 })}
        >
          Add line
        </Button>
        <p className="font-semibold text-heading" aria-live="polite" data-testid="invoice-total">
          Total:{' '}
          {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(
            total / 100,
          )}
        </p>
        {form.formState.errors.lines?.root?.message ? (
          <p role="alert" className="text-sm text-danger">
            {form.formState.errors.lines.root.message}
          </p>
        ) : null}
        {create.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(create.error, INVOICE_ERRORS)}
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={create.isPending}
          data-testid="invoice-create"
        >
          {create.isPending ? 'Creating…' : 'Create draft'}
        </Button>
      </form>
    </Modal>
  );
}
