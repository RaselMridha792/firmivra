'use client';

import type { RequestTemplate, TeamMember } from '@firmivra/types';
import { Avatar, Badge, Modal } from '@firmivra/ui';
import type { ReactNode } from 'react';
import { CUSTOM, formatDue, type RequestDraft, selectedItems } from './request-draft';
import { DocIcon, Section } from './request-sections';

export type StepId = 'details' | 'documents' | 'message' | 'review';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-sm font-semibold text-heading">{label}</dt>
      <dd className="min-w-0 text-sm text-text">{children}</dd>
    </div>
  );
}

const Edit = ({ onClick, what }: { onClick: () => void; what: string }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={`Edit ${what}`}
    className="text-sm font-medium text-action underline"
  >
    Edit
  </button>
);

/** Who receives it: the client, or the team member and the client it is about. */
export function recipientText(draft: RequestDraft, team: TeamMember[] | null): string {
  if (draft.recipientKind === 'MEMBER') {
    const member =
      team?.find((m) => m.user.id === draft.memberUserId)?.user.name ?? 'A team member';
    return `${member} (team), about ${draft.client?.displayName ?? '—'}`;
  }
  return draft.client?.displayName ?? '—';
}

/** Step 4, Review & Send: everything that will be sent, each part with a way back to it. */
export function ReviewStep({
  draft,
  types,
  team,
  onEdit,
}: {
  draft: RequestDraft;
  types: RequestTemplate[];
  team: TeamMember[] | null;
  onEdit: (step: StepId) => void;
}) {
  const items = selectedItems(draft);
  const type =
    draft.typeId === CUSTOM ? 'Custom' : (types.find((t) => t.id === draft.typeId)?.name ?? '—');
  const on = [
    draft.notifyEmail && 'Email notification',
    draft.notifyPortal && 'Portal notification',
    draft.notifySms && 'SMS notification (if available)',
    draft.reminder &&
      `Reminder ${draft.reminderDays} ${draft.reminderDays === 1 ? 'day' : 'days'} before the due date`,
    draft.allowMultipleFiles && 'Multiple file uploads',
    draft.allowClientComments && 'Comments from the client',
    draft.expires && draft.expiresOn && `Expires ${formatDue(draft.expiresOn)}`,
  ].filter(Boolean) as string[];

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-2" data-testid="review">
      <Section
        title="Recipient & Details"
        action={<Edit what="recipient and details" onClick={() => onEdit('details')} />}
      >
        <dl className="flex flex-col gap-3">
          <Row label="Recipient">
            <span className="flex items-center gap-2">
              {draft.client ? <Avatar name={draft.client.displayName} size="sm" /> : null}
              {recipientText(draft, team)}
            </span>
          </Row>
          <Row label="Request Title">{draft.title.trim() || '—'}</Row>
          <Row label="Request Type">{type}</Row>
          <Row label="Due Date">{formatDue(draft.dueOn) || '—'}</Row>
        </dl>
      </Section>
      <Section
        title={`Documents (${items.length})`}
        action={<Edit what="documents" onClick={() => onEdit('documents')} />}
      >
        {items.length ? (
          <ul className="flex flex-col divide-y divide-divider">
            {items.map((i) => (
              <li key={i.key} className="flex items-center gap-3 py-2 text-sm">
                <DocIcon />
                <span className="min-w-0 flex-1">
                  <span className="block text-heading">{i.title}</span>
                  {i.description ? (
                    <span className="block text-xs text-muted">{i.description}</span>
                  ) : null}
                </span>
                <Badge tone={i.required ? 'info' : 'neutral'}>
                  {i.required ? 'Required' : 'Optional'}
                </Badge>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No documents selected.</p>
        )}
      </Section>
      <Section title="Message" action={<Edit what="message" onClick={() => onEdit('message')} />}>
        <dl className="flex flex-col gap-3">
          <Row label="Subject">{draft.subject.trim() || '—'}</Row>
          <Row label="Message">
            <span className="block whitespace-pre-wrap">{draft.message.trim() || '—'}</span>
          </Row>
        </dl>
      </Section>
      <Section title="Options" action={<Edit what="options" onClick={() => onEdit('message')} />}>
        {on.length ? (
          <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-text">
            {on.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No notifications or reminders.</p>
        )}
      </Section>
    </div>
  );
}

/** The message as the recipient reads it, with the documents it asks for. */
export function PreviewDialog({
  open,
  onClose,
  draft,
  team,
}: {
  open: boolean;
  onClose: () => void;
  draft: RequestDraft;
  team: TeamMember[] | null;
}) {
  const items = selectedItems(draft);
  return (
    <Modal
      open={open}
      title="Message Preview"
      subtitle={`To ${recipientText(draft, team)}`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3 text-sm" data-testid="message-preview">
        <p className="font-semibold text-heading">{draft.subject.trim() || 'No subject yet'}</p>
        <p className="whitespace-pre-wrap text-text">{draft.message.trim() || 'No message yet.'}</p>
        {items.length ? (
          <div className="rounded-control bg-canvas p-3">
            <p className="mb-1 font-semibold text-heading">Documents requested</p>
            <ul className="list-disc pl-5 text-text">
              {items.map((i) => (
                <li key={i.key}>
                  {i.title}
                  {i.required ? '' : ' (optional)'}
                </li>
              ))}
            </ul>
            {draft.dueOn ? <p className="mt-2 text-muted">Due {formatDue(draft.dueOn)}</p> : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
