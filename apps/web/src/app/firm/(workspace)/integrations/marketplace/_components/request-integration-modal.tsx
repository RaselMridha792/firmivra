'use client';

import { CreateIntegrationRequest } from '@firmivra/types';
import { Button, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useFirm } from '../../../../../../components/firm-context';
import { useMe } from '../../../../../../components/signed-in';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { categoryOptions } from './marketplace-shared';

export function RequestIntegrationModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { firm } = useFirm();
  const { me } = useMe();
  const form = useForm<
    CreateIntegrationRequest,
    unknown,
    ReturnType<typeof CreateIntegrationRequest.parse>
  >({
    resolver: zodResolver(CreateIntegrationRequest),
    defaultValues: {
      providerName: '',
      websiteUrl: '',
      category: null,
      connectTo: '',
      businessReason: '',
    },
  });
  const create = useApiMutation(
    (body: CreateIntegrationRequest) => api.integrations.request(body),
    { invalidate: ['integration-requests'] },
  );
  function close() {
    onClose();
    if (create.isSuccess) {
      form.reset();
      create.reset();
    }
  }
  return (
    <Modal
      open={open}
      onClose={close}
      title="Request an integration"
      subtitle="Tell us which tool you need and how it should work with your firm."
    >
      {create.isSuccess ? (
        <div role="status" className="space-y-4">
          <h3 className="text-lg font-semibold text-success">Request submitted</h3>
          <p className="text-sm text-text">
            Your request for {create.data.providerName} has been saved for review.
          </p>
          <p className="text-sm text-muted">
            You can keep working while the team reviews your request.
          </p>
          <Button onClick={close}>Done</Button>
        </div>
      ) : (
        <form
          noValidate
          onSubmit={form.handleSubmit((body) => create.mutate(body))}
          className="space-y-4"
        >
          <div className="rounded-lg bg-info-soft p-3 text-sm">
            <p className="font-semibold text-heading">Requested by</p>
            <p>
              {me.user.name} · {firm.name}
            </p>
          </div>
          <fieldset disabled={create.isPending} className="space-y-4">
            <Input
              label="Provider / software name"
              autoComplete="off"
              maxLength={100}
              required
              error={form.formState.errors.providerName?.message}
              {...form.register('providerName')}
            />
            <Input
              label="Website URL (optional)"
              type="url"
              placeholder="https://example.com"
              maxLength={300}
              error={form.formState.errors.websiteUrl?.message}
              {...form.register('websiteUrl')}
            />
            <Select
              label="Category"
              options={[{ value: '', label: 'Select a category (optional)' }, ...categoryOptions]}
              {...form.register('category', { setValueAs: (value: string) => value || null })}
              error={form.formState.errors.category?.message}
            />
            <Textarea
              label="What should it connect to?"
              required
              maxLength={1000}
              rows={3}
              error={form.formState.errors.connectTo?.message}
              {...form.register('connectTo')}
            />
            <Textarea
              label="Business reason / use case (optional)"
              maxLength={2000}
              rows={3}
              error={form.formState.errors.businessReason?.message}
              {...form.register('businessReason')}
            />
          </fieldset>
          {create.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(create.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-3">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Submitting...' : 'Submit request'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
