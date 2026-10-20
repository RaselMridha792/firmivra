'use client';

import { Button, Callout, Checkbox, Modal } from '@firmivra/ui';
import { Warning } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import {
  isActive,
  TICKET_STATUSES,
  type SupportDirectory,
  type SupportPermission,
  type SupportSettings,
  type SupportTicket,
  type TicketStatus,
} from '../../../../../mocks/admin-support';
import { adminSupport } from './support-api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { AreaField, SelectField } from './fields';
import { QuietLine } from './support-parts';
import {
  loadError,
  STATUS_DOTS,
  SUPPORT,
  SUPPORT_ERRORS,
  supportKeys,
  ticketNo,
} from './support-data';

/**
 * The ticket actions both Support pages offer (the list's row menu, the ticket's header and Quick
 * Actions): each is a modal on the page, with no route. Every one sends the ticket's version, so a
 * change made elsewhere in the meantime is refused instead of overwritten.
 */
export type TicketAction = 'assign' | 'status' | 'escalate' | 'close' | 'merge' | 'delete';

interface ActionProps {
  ticket: SupportTicket;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function TicketActionModal({ action, ...props }: ActionProps & { action: TicketAction }) {
  switch (action) {
    case 'assign':
      return <AssignModal {...props} />;
    case 'status':
      return <StatusModal {...props} />;
    case 'escalate':
      return <EscalateModal {...props} />;
    case 'close':
      return <CloseModal {...props} />;
    case 'merge':
      return <MergeModal {...props} />;
    case 'delete':
      return <DeleteModal {...props} />;
  }
}

/** Who may take a ticket: active members whose role can see tickets, plus the rule-based choices. */
export function assigneeOptions(
  directory: SupportDirectory | undefined,
  settings: SupportSettings | undefined,
  { queue }: { queue: boolean },
) {
  const options: { value: string; label: string }[] = [];
  if (settings?.assignment.roundRobin) {
    options.push({ value: 'AUTO', label: 'Auto-assign (round robin)' });
  }
  if (queue) options.push({ value: 'QUEUE', label: 'Support Team queue (unassigned)' });
  for (const agent of directory?.agents ?? []) {
    const rights = settings?.permissions[agent.role] ?? [];
    if (!agent.active || !(rights.includes('VIEW_ALL') || rights.includes('VIEW_OWN'))) continue;
    options.push({ value: agent.id, label: agent.available ? agent.name : `${agent.name} (away)` });
  }
  return options;
}

/** The statuses this person may set by hand. Escalated asks for a reason. */
export function statusOptions(permissions: SupportPermission[]) {
  return (Object.keys(TICKET_STATUSES) as TicketStatus[])
    .filter(
      (status) =>
        (status !== 'RESOLVED' || permissions.includes('RESOLVE')) &&
        (status !== 'CLOSED' || permissions.includes('CLOSE')) &&
        (status !== 'ESCALATED' || permissions.includes('ESCALATE')),
    )
    .map((status) => ({ value: status, label: TICKET_STATUSES[status] }));
}

function Footer({
  onClose,
  onConfirm,
  label,
  busy,
  disabled,
}: {
  onClose: () => void;
  onConfirm: () => void;
  label: string;
  busy: boolean;
  disabled?: boolean;
}) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button onClick={onConfirm} disabled={busy || disabled}>
        {busy ? 'Saving…' : label}
      </Button>
    </>
  );
}

function ErrorLine({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="mt-4 text-sm text-danger">
      {errorMessage(error, SUPPORT_ERRORS)}
    </p>
  );
}

function AssignModal({ ticket, onClose, onDone }: ActionProps) {
  const id = useId();
  const directory = useApiQuery(supportKeys.directory, () => adminSupport.directory());
  const settings = useApiQuery(supportKeys.settings, () => adminSupport.settings());
  const [assignTo, setAssignTo] = useState(ticket.assignee?.active ? ticket.assignee.id : '');
  const [notify, setNotify] = useState(true);
  const [missing, setMissing] = useState(false);
  const assign = useApiMutation(
    (value: string) =>
      adminSupport.assign(ticket.id, { version: ticket.version, assignTo: value, notify }),
    { invalidate: SUPPORT },
  );
  const failed = directory.error ?? settings.error;
  return (
    <Modal
      open
      title={`Assign ${ticketNo(ticket.number)}`}
      subtitle={ticket.subject}
      onClose={onClose}
      footer={
        <Footer
          onClose={onClose}
          label="Assign"
          busy={assign.isPending}
          disabled={Boolean(failed)}
          onConfirm={() => {
            if (!assignTo) {
              setMissing(true);
              return;
            }
            assign.mutate(assignTo, {
              onSuccess: (saved) =>
                onDone(
                  saved.assignee
                    ? `${ticketNo(saved.number)} assigned to ${saved.assignee.name}.`
                    : `${ticketNo(saved.number)} moved to the Support Team queue.`,
                ),
            });
          }}
        />
      }
    >
      {failed ? (
        <QuietLine>{loadError(failed)}</QuietLine>
      ) : (
        <div className="flex flex-col gap-3">
          <SelectField
            id={`${id}-assignee`}
            label="Assign To"
            required
            placeholder="Select a team member"
            options={assigneeOptions(directory.data, settings.data, { queue: true })}
            value={assignTo}
            disabled={directory.isPending || settings.isPending}
            error={missing && !assignTo ? 'Select a team member.' : undefined}
            onChange={(event) => setAssignTo(event.target.value)}
          />
          <Checkbox
            label="Send notification to assigned team member"
            checked={notify}
            onChange={(event) => setNotify(event.target.checked)}
          />
        </div>
      )}
      <ErrorLine error={assign.error} />
    </Modal>
  );
}

function StatusModal({ ticket, onClose, onDone }: ActionProps) {
  const id = useId();
  const me = useApiQuery(supportKeys.me, () => adminSupport.me());
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const save = useApiMutation(
    (next: TicketStatus) =>
      next === 'ESCALATED'
        ? adminSupport.escalate(ticket.id, { version: ticket.version, reason })
        : adminSupport.updateTicket(ticket.id, { version: ticket.version, status: next }),
    { invalidate: SUPPORT },
  );
  const options = statusOptions(me.data?.permissions ?? []);
  return (
    <Modal
      open
      title={`Change status of ${ticketNo(ticket.number)}`}
      subtitle={ticket.subject}
      onClose={onClose}
      footer={
        <Footer
          onClose={onClose}
          label="Change Status"
          busy={save.isPending}
          disabled={status === ticket.status || Boolean(me.error)}
          onConfirm={() => {
            if (status === 'ESCALATED' && !reason.trim()) {
              setMissing(true);
              return;
            }
            save.mutate(status, {
              onSuccess: (saved) =>
                onDone(`${ticketNo(saved.number)} is now ${TICKET_STATUSES[saved.status]}.`),
            });
          }}
        />
      }
    >
      {me.error ? (
        <QuietLine>{loadError(me.error)}</QuietLine>
      ) : (
        <div className="flex flex-col gap-3">
          <SelectField
            id={`${id}-status`}
            label="Status"
            required
            dot={STATUS_DOTS[status]}
            options={options}
            value={status}
            disabled={me.isPending}
            onChange={(event) => setStatus(event.target.value as TicketStatus)}
          />
          {status === 'ESCALATED' ? (
            <AreaField
              id={`${id}-reason`}
              label="Reason for escalation"
              required
              maxLength={500}
              value={reason}
              error={missing && !reason.trim() ? 'Give a reason.' : undefined}
              onChange={(event) => setReason(event.target.value)}
            />
          ) : null}
          {status === 'CLOSED' && ticket.status !== 'CLOSED' ? (
            <Callout icon={Warning} surface="warning" tone="amber" size="compact">
              Closing ends the ticket for the client. It stays searchable and can be reopened.
            </Callout>
          ) : null}
          {!isActive(ticket.status) && isActive(status) ? (
            <Callout icon={Warning} surface="info" size="compact">
              This reopens the ticket and restarts its response clock.
            </Callout>
          ) : null}
        </div>
      )}
      <ErrorLine error={save.error} />
    </Modal>
  );
}

function EscalateModal({ ticket, onClose, onDone }: ActionProps) {
  const id = useId();
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const escalate = useApiMutation(
    (text: string) => adminSupport.escalate(ticket.id, { version: ticket.version, reason: text }),
    { invalidate: SUPPORT },
  );
  return (
    <Modal
      open
      title={`Escalate ${ticketNo(ticket.number)}`}
      subtitle="The ticket is marked escalated and the escalation contacts are notified."
      onClose={onClose}
      footer={
        <Footer
          onClose={onClose}
          label="Escalate"
          busy={escalate.isPending}
          onConfirm={() => {
            if (!reason.trim()) {
              setMissing(true);
              return;
            }
            escalate.mutate(reason, {
              onSuccess: (saved) => onDone(`${ticketNo(saved.number)} was escalated.`),
            });
          }}
        />
      }
    >
      <AreaField
        id={`${id}-reason`}
        label="Reason for escalation"
        required
        maxLength={500}
        value={reason}
        placeholder="What needs attention, and why now?"
        error={missing && !reason.trim() ? 'Give a reason.' : undefined}
        onChange={(event) => setReason(event.target.value)}
      />
      <ErrorLine error={escalate.error} />
    </Modal>
  );
}

function CloseModal({ ticket, onClose, onDone }: ActionProps) {
  const close = useApiMutation(
    () => adminSupport.updateTicket(ticket.id, { version: ticket.version, status: 'CLOSED' }),
    { invalidate: SUPPORT },
  );
  return (
    <Modal
      open
      title={`Close ${ticketNo(ticket.number)}?`}
      subtitle={ticket.subject}
      onClose={onClose}
      footer={
        <Footer
          onClose={onClose}
          label="Close Ticket"
          busy={close.isPending}
          onConfirm={() =>
            close.mutate(undefined, {
              onSuccess: (saved) => onDone(`${ticketNo(saved.number)} was closed.`),
            })
          }
        />
      }
    >
      <p className="text-sm text-text">
        Closing is different from resolving: it ends the ticket for the client and records who
        closed it and when. The ticket stays searchable and can be reopened from More.
      </p>
      <ErrorLine error={close.error} />
    </Modal>
  );
}

function MergeModal({ ticket, onClose, onDone }: ActionProps) {
  const id = useId();
  const query = { pageSize: 100 };
  const candidates = useApiQuery(supportKeys.tickets(query), () => adminSupport.tickets(query));
  const [sourceId, setSourceId] = useState('');
  const [sure, setSure] = useState(false);
  const merge = useApiMutation(
    (source: string) =>
      adminSupport.merge(ticket.id, { version: ticket.version, sourceId: source }),
    { invalidate: SUPPORT },
  );
  const others = (candidates.data?.items ?? [])
    .filter((t) => t.id !== ticket.id && !t.mergedInto)
    .sort((a, b) => Number(b.firm.id === ticket.firm.id) - Number(a.firm.id === ticket.firm.id));
  const source = others.find((t) => t.id === sourceId);
  return (
    <Modal
      open
      title={`Merge into ${ticketNo(ticket.number)}`}
      subtitle="Choose the related ticket to fold into this one."
      onClose={onClose}
      footer={
        <Footer
          onClose={onClose}
          label="Merge Tickets"
          busy={merge.isPending}
          disabled={!source || !sure}
          onConfirm={() =>
            merge.mutate(sourceId, {
              onSuccess: (saved) =>
                onDone(
                  `${source ? ticketNo(source.number) : 'The ticket'} was merged into ${ticketNo(saved.number)}.`,
                ),
            })
          }
        />
      }
    >
      {candidates.error ? (
        <QuietLine>{loadError(candidates.error)}</QuietLine>
      ) : (
        <div className="flex flex-col gap-3">
          <SelectField
            id={`${id}-source`}
            label="Ticket to merge"
            required
            placeholder={candidates.isPending ? 'Loading tickets…' : 'Select a ticket'}
            disabled={candidates.isPending}
            options={others.map((t) => ({
              value: t.id,
              label: `${ticketNo(t.number)} · ${t.subject} (${t.firm.name})`,
            }))}
            value={sourceId}
            onChange={(event) => {
              setSourceId(event.target.value);
              setSure(false);
            }}
          />
          {source ? (
            <>
              <Callout icon={Warning} surface="warning" tone="amber" size="compact">
                {ticketNo(source.number)}&apos;s conversation ({source.counts.messages} messages),
                attachments ({source.counts.attachments}), internal notes and activity history move
                to {ticketNo(ticket.number)}. {ticketNo(source.number)} is then closed and keeps a
                link to {ticketNo(ticket.number)}. Nothing is deleted.
              </Callout>
              <Checkbox
                label={`I understand ${ticketNo(source.number)} will be closed`}
                checked={sure}
                onChange={(event) => setSure(event.target.checked)}
              />
            </>
          ) : null}
        </div>
      )}
      <ErrorLine error={merge.error} />
    </Modal>
  );
}

function DeleteModal({ ticket, onClose, onDone }: ActionProps) {
  const remove = useApiMutation(
    () => adminSupport.deleteTicket(ticket.id, { version: ticket.version }),
    { invalidate: SUPPORT },
  );
  return (
    <Modal
      open
      title={`Delete ${ticketNo(ticket.number)}?`}
      subtitle={ticket.subject}
      onClose={onClose}
      footer={
        <Footer
          onClose={onClose}
          label="Delete Ticket"
          busy={remove.isPending}
          onConfirm={() =>
            remove.mutate(undefined, {
              onSuccess: () => onDone(`${ticketNo(ticket.number)} was deleted.`),
            })
          }
        />
      }
    >
      <p className="text-sm text-text">
        The ticket, its conversation, notes and attachments disappear from every Support list. Merge
        or close a ticket instead when its history still matters.
      </p>
      <ErrorLine error={remove.error} />
    </Modal>
  );
}
