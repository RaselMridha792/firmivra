'use client';
import { DOCUMENT_ERRORS, RejectDocumentRequestRequest } from '@firmivra/types';
import { Button, Input, Modal } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../lib/query';

export function MarkMissingForm({
  clientId,
  requestId,
  onClose,
}: {
  clientId: string;
  requestId: string;
  onClose: () => void;
}) {
  const form = useForm<RejectDocumentRequestRequest>({
    resolver: zodResolver(RejectDocumentRequestRequest),
    defaultValues: { reason: '' },
  });
  const reject = useApiMutation(
    (body: RejectDocumentRequestRequest) => api.documents.rejectRequest(requestId, body),
    { invalidate: ['document-requests', clientId] },
  );
  return (
    <Modal open title="Mark missing" onClose={onClose}>
      <form
        className="space-y-4"
        data-testid="mark-missing-form"
        onSubmit={form.handleSubmit((body) => reject.mutate(body, { onSuccess: onClose }))}
      >
        <Input
          label="Tell the client what is missing"
          data-testid="missing-reason"
          error={form.formState.errors.reason?.message}
          {...form.register('reason')}
        />
        {reject.error ? (
          <p role="alert" className="text-sm text-danger" data-testid="request-reject-error">
            {errorMessage(reject.error, DOCUMENT_ERRORS)}
          </p>
        ) : null}
        <Button
          type="submit"
          className="w-full"
          disabled={reject.isPending}
          data-testid="missing-submit"
        >
          {reject.isPending ? 'Saving…' : 'Mark missing'}
        </Button>
      </form>
    </Modal>
  );
}
