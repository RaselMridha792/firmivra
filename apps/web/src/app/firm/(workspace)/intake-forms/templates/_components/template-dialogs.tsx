'use client';

import { FORM_CATEGORY_LABELS, type FormCategory, type IntakeFormListItem } from '@firmivra/types';
import { Button, Modal, Select, Skeleton } from '@firmivra/ui';
import type { UseQueryResult } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { LoadFailed, Quiet } from './template-look';

/** A service a new template can be for, with the category its forms show under. */
export interface NewTemplateService {
  id: string;
  name: string;
  category: FormCategory;
}

/**
 * Create Template asks which service the template is for: every form belongs to one of the
 * firm's services (the API refuses a form without one). The services are the ones the library's
 * forms are for, so each has its built-in form; the open category's service is chosen when it is
 * the only one. Mounted only while open.
 */
export function CreateTemplateDialog({
  library,
  category,
  busy,
  onClose,
  onCreate,
}: {
  library: UseQueryResult<IntakeFormListItem[]>;
  category: FormCategory | null;
  busy: boolean;
  onClose: () => void;
  onCreate: (service: NewTemplateService) => void;
}) {
  const services = [
    ...new Map(
      (library.data ?? [])
        .filter((form) => form.service && form.status !== 'RETIRED')
        .map((form) => [
          form.service!.id,
          { id: form.service!.id, name: form.service!.name, category: form.category },
        ]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const inCategory = services.filter((service) => service.category === category);
  const [id, setId] = useState(inCategory.length === 1 ? (inCategory[0]?.id ?? '') : '');
  const chosen = services.find((service) => service.id === id);
  return (
    <Modal
      open
      title="Create Template"
      subtitle="Choose the service this template is for. It starts as a blank draft."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!chosen || busy} onClick={() => chosen && onCreate(chosen)}>
            Create Template
          </Button>
        </>
      }
    >
      {library.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Loading services…</span>
          <Skeleton className="w-1/3" />
          <Skeleton className="h-11!" />
        </div>
      ) : library.isError && !library.data ? (
        <LoadFailed error={library.error} onRetry={() => void library.refetch()} />
      ) : services.length === 0 ? (
        <Quiet>
          Your firm has no service with an intake form yet.{' '}
          <Link href="/services-pricing" className="font-medium text-link underline">
            Add one in Services &amp; Pricing
          </Link>
        </Quiet>
      ) : (
        <Select
          label="Service"
          value={id}
          onChange={(event) => setId(event.target.value)}
          options={[
            { value: '', label: 'Choose a service' },
            ...services.map((service) => ({
              value: service.id,
              label: `${service.name} (${FORM_CATEGORY_LABELS[service.category]})`,
            })),
          ]}
        />
      )}
    </Modal>
  );
}

/**
 * Import Template is in the design, but the guide (Frame 4) leaves its file types and field
 * mapping to be confirmed: the button explains that instead of calling an API that doesn't exist.
 */
export function ImportTemplateDialog({
  open,
  onClose,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <Modal
      open={open}
      title="Import Template"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onCreate}>Create Template</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-text">
          Importing a template from a file is not available yet: the file types and how their fields
          become questions are still being decided.
        </p>
        <p className="text-muted">
          You can create a template, or duplicate one from the library and change it.
        </p>
      </div>
    </Modal>
  );
}

/** Archive asks first: the template leaves the library, past forms and answers stay. */
export function ArchiveTemplateDialog({
  template,
  busy,
  onClose,
  onConfirm,
}: {
  template: IntakeFormListItem | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (template: IntakeFormListItem) => void;
}) {
  return (
    <Modal
      open={template !== null}
      title="Archive template?"
      subtitle={template?.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={busy || !template} onClick={() => template && onConfirm(template)}>
            Archive Template
          </Button>
        </>
      }
    >
      <p className="text-sm text-text">
        The template leaves the library and can no longer be sent. Forms already sent with it, and
        their answers, stay as they are.
      </p>
    </Modal>
  );
}

/**
 * Quick Actions' Preview Template and Duplicate Template need a template: this asks for one,
 * from the whole library (not the filtered grid). Mounted only while open.
 */
export function ChooseTemplateDialog({
  mode,
  library,
  busy,
  onClose,
  onChoose,
}: {
  mode: 'preview' | 'duplicate';
  library: UseQueryResult<IntakeFormListItem[]>;
  busy: boolean;
  onClose: () => void;
  onChoose: (template: IntakeFormListItem) => void;
}) {
  const [id, setId] = useState('');
  const templates = (library.data ?? [])
    .filter((template) => template.status !== 'RETIRED')
    .sort((a, b) => a.name.localeCompare(b.name));
  const chosen = templates.find((template) => template.id === id);
  const verb = mode === 'preview' ? 'Preview' : 'Duplicate';
  return (
    <Modal
      open
      title={`${verb} Template`}
      subtitle="Choose the template first."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!chosen || busy} onClick={() => chosen && onChoose(chosen)}>
            {verb}
          </Button>
        </>
      }
    >
      {library.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-2">
          <span className="sr-only">Loading templates…</span>
          <Skeleton className="w-1/3" />
          <Skeleton className="h-11!" />
        </div>
      ) : library.isError && !library.data ? (
        <LoadFailed error={library.error} onRetry={() => void library.refetch()} />
      ) : templates.length === 0 ? (
        <Quiet>No templates yet.</Quiet>
      ) : (
        <Select
          label="Template"
          value={id}
          onChange={(event) => setId(event.target.value)}
          options={[
            { value: '', label: 'Choose a template' },
            ...templates.map((template) => ({ value: template.id, label: template.name })),
          ]}
        />
      )}
    </Modal>
  );
}
