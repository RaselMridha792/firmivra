'use client';
import { CreateDocumentRequestRequest, DOCUMENT_ERRORS } from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';

export function RequestDocumentForm({
  clientId,
  onClose,
}: {
  clientId: string;
  onClose: () => void;
}) {
  const services = useApiQuery(['document-request-services', clientId], () =>
    api.engagements.listForClient(clientId, { status: 'ACTIVE' }),
  );
  const categories = useApiQuery(['document-categories'], () => api.documents.categories());
  const form = useForm<CreateDocumentRequestRequest>({
    resolver: zodResolver(CreateDocumentRequestRequest),
    defaultValues: { serviceId: '', title: '', instructions: '', dueOn: '', categoryId: null },
  });
  const create = useApiMutation(
    (body: CreateDocumentRequestRequest) => api.documents.createRequest(clientId, body),
    { invalidate: ['document-requests', clientId] },
  );
  return (
    <Modal open title="Request a document" onClose={onClose}>
      <PageState
        query={services}
        empty="No active service. Open a service before requesting a document."
      >
        {(items) => (
          <PageState query={categories}>
            {(groups) => (
              <form
                className="space-y-4"
                data-testid="request-document-form"
                onSubmit={form.handleSubmit((body) => create.mutate(body, { onSuccess: onClose }))}
              >
                <Select
                  label="Service"
                  data-testid="request-service"
                  options={[
                    { value: '', label: 'Choose a service' },
                    ...items.map((item) => ({ value: item.id, label: item.title })),
                  ]}
                  error={form.formState.errors.serviceId?.message}
                  {...form.register('serviceId')}
                />
                <Input
                  label="Document title"
                  data-testid="request-title"
                  error={form.formState.errors.title?.message}
                  {...form.register('title')}
                />
                <Input
                  label="Instructions (optional)"
                  data-testid="request-instructions"
                  error={form.formState.errors.instructions?.message}
                  {...form.register('instructions')}
                />
                <Select
                  label="Category (optional)"
                  data-testid="request-category"
                  options={[
                    { value: '', label: 'No category' },
                    ...groups
                      .filter((group) => !group.archivedAt)
                      .map((group) => ({ value: group.id, label: group.name })),
                  ]}
                  error={form.formState.errors.categoryId?.message}
                  {...form.register('categoryId', { setValueAs: (value: string) => value || null })}
                />
                <Input
                  label="Due date (optional)"
                  type="date"
                  data-testid="request-due-date"
                  error={form.formState.errors.dueOn?.message}
                  {...form.register('dueOn')}
                />
                {create.error ? (
                  <p
                    role="alert"
                    className="text-sm text-danger"
                    data-testid="request-create-error"
                  >
                    {errorMessage(create.error, DOCUMENT_ERRORS)}
                  </p>
                ) : null}
                <Button
                  type="submit"
                  className="w-full"
                  disabled={create.isPending}
                  data-testid="request-submit"
                >
                  {create.isPending ? 'Requesting…' : 'Request document'}
                </Button>
              </form>
            )}
          </PageState>
        )}
      </PageState>
    </Modal>
  );
}
