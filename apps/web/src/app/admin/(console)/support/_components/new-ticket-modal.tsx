'use client';

import { Button, Callout, Checkbox, FileDropzone, IconButton, Modal } from '@firmivra/ui';
import { Paperclip, Trash, Warning } from '@phosphor-icons/react';
import { useId, useRef, useState, type FormEvent } from 'react';
import {
  adminSupport,
  ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  NEW_TICKET_STATUSES,
  TICKET_SOURCES,
  TICKET_STATUSES,
  validateNewTicket,
  type AttachmentInput,
  type NewTicket,
  type NewTicketField,
  type SupportTicket,
  type TicketSource,
  type TicketStatus,
} from '../../../../../mocks/admin-support';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { AreaField, SelectField, TextField } from './fields';
import { QuietLine } from './support-parts';
import {
  fileSize,
  loadError,
  PRIORITY_DOTS,
  STATUS_DOTS,
  SUPPORT,
  SUPPORT_ERRORS,
  supportKeys,
} from './support-data';
import { assigneeOptions } from './ticket-actions';

type Draft = Omit<NewTicket, 'requestId' | 'attachments'> & { attachments: File[] };

const blank: Omit<Draft, 'attachments'> = {
  firmId: '',
  contactId: '',
  subject: '',
  categoryId: '',
  priorityId: '',
  assignTo: '',
  status: 'OPEN',
  source: 'PORTAL',
  description: '',
  internalNote: '',
  notifyAssignee: false,
};
const START: Draft = { ...blank, attachments: [] };

/**
 * Create New Support Ticket (create-new-support-ticket-modal.jpg, docx §2): a modal on the Support
 * page. Firms and contacts come from the firm records, categories and priorities from Support
 * Settings (active ones only), and assignees from the team. Required fields are checked here and
 * again by the API; one request id per opening stops a double click making two tickets.
 */
export function NewTicketModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (ticket: SupportTicket) => void;
}) {
  const id = useId();
  const directory = useApiQuery(supportKeys.directory, () => adminSupport.directory());
  const settings = useApiQuery(supportKeys.settings, () => adminSupport.settings());
  const [draft, setDraft] = useState<Draft>(START);
  const [errors, setErrors] = useState<Partial<Record<NewTicketField, string>>>({});
  const [rejected, setRejected] = useState('');
  const [confirming, setConfirming] = useState(false);
  // The dialog closes itself on Escape; a new key opens it again to ask about unsaved changes.
  const [shown, setShown] = useState(0);
  const requestId = useRef<string | null>(null);
  const create = useApiMutation((body: NewTicket) => adminSupport.createTicket(body), {
    invalidate: SUPPORT,
  });

  const firm = directory.data?.firms.find((f) => f.id === draft.firmId);
  const categories = (settings.data?.categories ?? []).filter((c) => c.active);
  const priorities = (settings.data?.priorities ?? [])
    .filter((p) => p.active)
    .sort((a, b) => a.rank - b.rank);
  const priority = priorities.find((p) => p.id === draft.priorityId);
  const dirty =
    draft.attachments.length > 0 ||
    (Object.keys(blank) as (keyof typeof blank)[]).some((key) => draft[key] !== blank[key]);
  const failed = directory.error ?? settings.error;
  const loading = directory.isPending || settings.isPending;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setConfirming(false);
  };

  function requestClose() {
    if (!dirty || confirming || create.isPending) {
      onClose();
      return;
    }
    setConfirming(true);
    setShown((n) => n + 1);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (create.isPending || !directory.data || !settings.data) return;
    const once = (requestId.current ??= crypto.randomUUID());
    const body: NewTicket = {
      ...draft,
      requestId: once,
      attachments: draft.attachments.map((file): AttachmentInput => ({
        name: file.name,
        type: file.type,
        size: file.size,
        file,
      })),
    };
    const found = validateNewTicket(body, directory.data, settings.data);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    create.mutate(body, { onSuccess: onCreated });
  }

  return (
    <Modal
      key={shown}
      open
      title="Create New Support Ticket"
      subtitle="Submit a new support request. Fill in the details below and assign it to a team member."
      onClose={requestClose}
    >
      {failed ? <QuietLine testId="new-ticket-error">{loadError(failed)}</QuietLine> : null}
      <form
        id={`${id}-form`}
        noValidate
        onSubmit={submit}
        aria-label="New support ticket"
        className="grid gap-x-6 gap-y-3 sm:grid-cols-2"
      >
        <SelectField
          id={`${id}-firm`}
          label="Firm"
          required
          placeholder={loading ? 'Loading firms…' : 'Select a firm'}
          disabled={loading || Boolean(failed)}
          options={(directory.data?.firms ?? []).map((f) => ({ value: f.id, label: f.name }))}
          value={draft.firmId}
          error={errors.firmId}
          onChange={(event) => {
            const firmId = event.target.value;
            const next = directory.data?.firms.find((f) => f.id === firmId);
            setDraft((current) => ({
              ...current,
              firmId,
              contactId: next?.contacts.find((c) => c.primary)?.id ?? '',
            }));
            setConfirming(false);
          }}
        />
        <SelectField
          id={`${id}-contact`}
          label="Contact / User"
          required
          placeholder={firm ? 'Select a contact' : 'Select a firm first'}
          disabled={!firm}
          options={(firm?.contacts ?? []).map((c) => ({
            value: c.id,
            label: `${c.name} (${c.email})`,
          }))}
          value={draft.contactId}
          error={errors.contactId}
          onChange={(event) => set('contactId', event.target.value)}
        />
        <TextField
          id={`${id}-subject`}
          label="Subject"
          required
          maxLength={150}
          placeholder="Enter a brief summary"
          value={draft.subject}
          error={errors.subject}
          onChange={(event) => set('subject', event.target.value)}
        />
        <SelectField
          id={`${id}-category`}
          label="Category"
          required
          placeholder={
            !loading && categories.length === 0 ? 'No active categories' : 'Select a category'
          }
          disabled={loading || Boolean(failed)}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
          value={draft.categoryId}
          error={errors.categoryId}
          onChange={(event) => set('categoryId', event.target.value)}
        />
        <SelectField
          id={`${id}-priority`}
          label="Priority"
          required
          placeholder={
            !loading && priorities.length === 0 ? 'No active priorities' : 'Select a priority'
          }
          dot={priority ? PRIORITY_DOTS[priority.color] : undefined}
          disabled={loading || Boolean(failed)}
          options={priorities.map((p) => ({ value: p.id, label: p.name }))}
          value={draft.priorityId}
          error={errors.priorityId}
          onChange={(event) => set('priorityId', event.target.value)}
        />
        <SelectField
          id={`${id}-assign`}
          label="Assign To"
          required
          placeholder="Select a team member"
          disabled={loading || Boolean(failed)}
          options={assigneeOptions(directory.data, settings.data, {
            queue: settings.data?.assignment.defaultQueue ?? false,
          })}
          value={draft.assignTo}
          error={errors.assignTo}
          onChange={(event) => set('assignTo', event.target.value)}
        />
        <SelectField
          id={`${id}-status`}
          label="Status"
          required
          dot={STATUS_DOTS[draft.status]}
          options={NEW_TICKET_STATUSES.map((s) => ({ value: s, label: TICKET_STATUSES[s] }))}
          value={draft.status}
          error={errors.status}
          onChange={(event) => set('status', event.target.value as TicketStatus)}
        />
        <SelectField
          id={`${id}-source`}
          label="Source"
          options={(Object.keys(TICKET_SOURCES) as TicketSource[]).map((s) => ({
            value: s,
            label: TICKET_SOURCES[s],
          }))}
          value={draft.source}
          error={errors.source}
          onChange={(event) => set('source', event.target.value as TicketSource)}
        />
        <div className="sm:col-span-2">
          <AreaField
            id={`${id}-description`}
            label="Description"
            required
            rows={4}
            maxLength={5000}
            placeholder="Provide detailed information about the issue..."
            value={draft.description}
            error={errors.description}
            onChange={(event) => set('description', event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2 sm:col-span-2">
          <span className="text-sm font-medium text-text">Attachments</span>
          <FileDropzone
            label="Attachments"
            icon={Paperclip}
            title="Drag and drop files here, or click to browse"
            accept={ATTACHMENT_TYPES}
            maxBytes={MAX_ATTACHMENT_BYTES}
            onFiles={(files) => {
              setRejected('');
              set('attachments', [...draft.attachments, ...files]);
            }}
            onReject={(rejections) =>
              setRejected(
                rejections
                  .map(({ file, reason }) =>
                    reason === 'size'
                      ? `${file.name} is larger than 10 MB.`
                      : `${file.name} is not an image, PDF or document.`,
                  )
                  .join(' '),
              )
            }
          />
          <p className="text-xs text-muted">Supports images, PDFs, and documents (max 10MB each)</p>
          {rejected || errors.attachments ? (
            <p role="alert" className="text-xs text-danger">
              {rejected || errors.attachments}
            </p>
          ) : null}
          {draft.attachments.length ? (
            <ul aria-label="Files to attach" className="flex flex-col gap-1">
              {draft.attachments.map((file, index) => (
                <li
                  key={`${file.name}-${file.size}-${file.lastModified}`}
                  className="flex items-center justify-between gap-3 rounded-lg bg-canvas px-3 py-1.5 text-sm"
                >
                  <span className="min-w-0 truncate text-text">
                    {file.name} <span className="text-muted">({fileSize(file.size)})</span>
                  </span>
                  <IconButton
                    icon={Trash}
                    tone="danger"
                    label={`Remove ${file.name}`}
                    onClick={() =>
                      set(
                        'attachments',
                        draft.attachments.filter((_, at) => at !== index),
                      )
                    }
                  />
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="sm:col-span-2">
          <AreaField
            id={`${id}-note`}
            label="Internal Note (Optional)"
            rows={3}
            maxLength={5000}
            placeholder="Add an internal note (not visible to the customer)..."
            value={draft.internalNote}
            error={errors.internalNote}
            onChange={(event) => set('internalNote', event.target.value)}
          />
        </div>
        {confirming ? (
          <div className="sm:col-span-2">
            <Callout
              icon={Warning}
              surface="warning"
              tone="amber"
              title="Discard this ticket?"
              action={
                <span className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setConfirming(false)}>
                    Keep editing
                  </Button>
                  <Button variant="dark" onClick={onClose}>
                    Discard
                  </Button>
                </span>
              }
            >
              The details you entered are not saved yet.
            </Callout>
          </div>
        ) : null}
        {create.error ? (
          <p role="alert" className="text-sm text-danger sm:col-span-2">
            {errorMessage(create.error, SUPPORT_ERRORS)}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 pt-2 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
          <Checkbox
            label="Send notification to assigned team member"
            checked={draft.notifyAssignee}
            onChange={(event) => set('notifyAssignee', event.target.checked)}
          />
          <span className="flex justify-end gap-3">
            <Button variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending || loading || Boolean(failed)}>
              {create.isPending ? 'Creating…' : 'Create Ticket'}
            </Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
