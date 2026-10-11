'use client';
import { CancelInvoiceRequest, INVOICE_ERRORS, type InvoiceListItem } from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';

export function InvoiceCancelForm({
  invoice,
  onClose,
}: {
  invoice: InvoiceListItem;
  onClose: () => void;
}) {
  const form = useForm<CancelInvoiceRequest>({
    resolver: zodResolver(CancelInvoiceRequest),
    defaultValues: { reason: '' },
  });
  const cancel = useApiMutation(
    (body: CancelInvoiceRequest) => api.invoices.cancel(invoice.id, body),
    { invalidate: ['invoices'] },
  );
  return (
    <Modal open title={`Cancel ${invoice.number}`} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={form.handleSubmit((body) => cancel.mutate(body, { onSuccess: onClose }))}
      >
        <Input
          label="Cancellation reason"
          maxLength={500}
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
        {cancel.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(cancel.error, INVOICE_ERRORS)}
          </p>
        ) : null}
        <Button type="submit" disabled={cancel.isPending}>
          Confirm cancellation
        </Button>
      </form>
    </Modal>
  );
}
