'use client';

import type { LibraryDocument, TaxReturnDocumentKind } from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { useUnsavedChanges } from '../../../../../lib/unsaved';

// Client Portal instructions 19, the Documents row menu's Link to Record, Reclassify and Rename
// Metadata, through the Documents library's own routes (each audited by Documents). Rename is in
// place on the row, so an unsaved name counts as unsaved work (instructions 13 and 27).

const DOCUMENTS = ['client-portal'] as const;

/** Rename: the row's name becomes a field; Save keeps it, Cancel or Escape drops it. */
export function RenameInline({ doc, onDone }: { doc: LibraryDocument; onDone: () => void }) {
  const [name, setName] = useState(doc.fileName);
  const dirty = name.trim() !== doc.fileName;
  useUnsavedChanges(dirty);
  const save = useApiMutation(
    (fileName: string) => api.documentLibrary.update(doc.id, { fileName }),
    { invalidate: DOCUMENTS },
  );
  return (
    <form
      noValidate
      aria-label={`Rename ${doc.fileName}`}
      className="flex min-w-0 flex-wrap items-start gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!name.trim()) return;
        if (!dirty) return onDone();
        save.mutate(name.trim(), { onSuccess: onDone });
      }}
      onKeyDown={(event) => event.key === 'Escape' && onDone()}
    >
      <div className="min-w-0 flex-1">
        <Input
          label={`New name for ${doc.fileName}`}
          hideLabel
          value={name}
          maxLength={255}
          autoFocus
          error={name.trim() ? undefined : 'Enter a name'}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <Button type="submit" disabled={save.isPending || !name.trim()}>
        {save.isPending ? 'Saving…' : 'Save'}
      </Button>
      <Button variant="secondary" onClick={onDone}>
        Cancel
      </Button>
      {save.error ? (
        <p role="alert" className="w-full text-sm text-danger">
          {errorMessage(save.error)}
        </p>
      ) : null}
    </form>
  );
}

/** Reclassify: the document's type (category), from the firm's live categories. */
export function ReclassifyDialog({ doc, onClose }: { doc: LibraryDocument; onClose: () => void }) {
  const categories = useApiQuery(['document-categories'], () => api.documents.categories());
  const [categoryId, setCategoryId] = useState(doc.category?.id ?? '');
  const save = useApiMutation(
    (id: string | null) => api.documentLibrary.update(doc.id, { categoryId: id }),
    { invalidate: DOCUMENTS },
  );
  const live = (categories.data ?? []).filter((c) => !c.archivedAt || c.id === doc.category?.id);
  const changed = categoryId !== (doc.category?.id ?? '');
  return (
    <Modal
      open
      title={`Reclassify ${doc.fileName}`}
      subtitle="Its type changes; Documents keeps who changed it and when."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!changed || save.isPending}
            onClick={() => save.mutate(categoryId || null, { onSuccess: onClose })}
          >
            {save.isPending ? 'Saving…' : 'Save Type'}
          </Button>
        </>
      }
    >
      <div className="flex w-full max-w-md flex-col gap-3">
        <Select
          label="Document type"
          value={categoryId}
          disabled={categories.isPending}
          options={[
            { value: '', label: 'No type' },
            ...live.map((c) => ({ value: c.id, label: c.name })),
          ]}
          onChange={(e) => setCategoryId(e.target.value)}
        />
        {categories.error || save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error ?? categories.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}

const KINDS: [TaxReturnDocumentKind, string][] = [
  ['DRAFT_RETURN', 'Draft'],
  ['SIGNATURE_FORM', 'Signature Form'],
  ['FILED_RETURN', 'Filed Return'],
  ['ACKNOWLEDGMENT', 'Acknowledgment'],
  ['VOUCHER', 'Voucher'],
  ['PAYMENT_PROOF', 'Payment Proof'],
  ['EXTENSION', 'Extension'],
];

/**
 * Link to Record: one of the client's tax returns (as the return's document of a kind) or one of
 * their tasks (an attachment), through the return's and the task's own routes.
 */
export function LinkRecordDialog({
  doc,
  clientId,
  onClose,
}: {
  doc: LibraryDocument;
  clientId: string;
  onClose: () => void;
}) {
  const [target, setTarget] = useState<'' | 'return' | 'task'>('');
  const [recordId, setRecordId] = useState('');
  const [kind, setKind] = useState<TaxReturnDocumentKind>('DRAFT_RETURN');
  const returns = useApiQuery(['client-portal', 'link-returns', clientId], () =>
    api.taxReturns.listForClient(clientId),
  );
  const tasks = useApiQuery(['client-portal', 'link-tasks', clientId], () =>
    api.taskWork.overview({ clientId }),
  );
  const link = useApiMutation(
    async () => {
      if (target === 'return') {
        await api.taxReturnWorkspace.linkDocument(recordId, { documentId: doc.id, kind });
      } else {
        await api.taskWork.addAttachment(recordId, { documentId: doc.id });
      }
    },
    { invalidate: DOCUMENTS },
  );
  const records =
    target === 'return'
      ? (returns.data ?? []).map((r) => ({
          value: r.id,
          label: `${r.taxYear}${r.quarter ? ` Q${r.quarter}` : ''} ${r.formType ?? (r.filingType === 'BUSINESS' ? 'Business' : 'Personal')} return`,
        }))
      : target === 'task'
        ? (tasks.data?.items ?? []).map((t) => ({ value: t.id, label: t.title }))
        : [];
  return (
    <Modal
      open
      title={`Link ${doc.fileName}`}
      subtitle="Link it to one of this client's records. The document itself does not move."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!recordId || link.isPending}
            onClick={() => link.mutate(undefined, { onSuccess: onClose })}
          >
            {link.isPending ? 'Linking…' : 'Link Document'}
          </Button>
        </>
      }
    >
      <div className="flex w-full max-w-md flex-col gap-3">
        <Select
          label="Record type"
          value={target}
          options={[
            { value: '', label: 'Choose a record type' },
            { value: 'return', label: 'Tax return' },
            { value: 'task', label: 'Task' },
          ]}
          onChange={(e) => {
            setTarget(e.target.value as '' | 'return' | 'task');
            setRecordId('');
          }}
        />
        {target ? (
          <Select
            label={target === 'return' ? 'Tax return' : 'Task'}
            value={recordId}
            options={[
              {
                value: '',
                label: records.length
                  ? `Choose a ${target === 'return' ? 'return' : 'task'}`
                  : `This client has no ${target === 'return' ? 'tax returns' : 'tasks'} yet`,
              },
              ...records,
            ]}
            onChange={(e) => setRecordId(e.target.value)}
          />
        ) : null}
        {target === 'return' ? (
          <Select
            label="Document kind"
            value={kind}
            options={KINDS.map(([value, label]) => ({ value, label }))}
            onChange={(e) => setKind(e.target.value as TaxReturnDocumentKind)}
          />
        ) : null}
        {link.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(link.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
