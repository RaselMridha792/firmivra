'use client';

import type { FirmAccountAction, FirmAccountEvent, FirmRecord } from '@firmivra/types';
import { ActionMenu, Button, Card, Modal } from '@firmivra/ui';
import { ChatText, PauseCircle, PlayCircle, Prohibit } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { History } from 'lucide-react';
import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';
import { api } from '../../../../../lib/api';
import { errorCode, errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { CardHeading } from '../../applications/_components/application-cards';
import { dateText } from '../../applications/_components/application-ui';
import { RequestInfoDialog } from './request-info';

/** The firm page's query key (firm-detail.tsx). */
export const firmDetailKey = (id: string) => ['firms', 'detail', id] as const;

const ERRORS: Record<string, string> = {
  FIRM_STATUS_CHANGED:
    "This firm's status changed while you were looking. The page now shows it as it is.",
  NOT_FOUND: 'This firm no longer exists.',
};

/** Each action's words: the menu item, the dialog and its button. */
const ACTIONS: Record<
  FirmAccountAction,
  { item: string; title: (name: string) => string; button: string; busy: string }
> = {
  suspend: {
    item: 'Suspend Account',
    title: (name) => `Suspend ${name}?`,
    button: 'Suspend Account',
    busy: 'Suspending…',
  },
  reactivate: {
    item: 'Reactivate Account',
    title: (name) => `Reactivate ${name}?`,
    button: 'Reactivate Account',
    busy: 'Reactivating…',
  },
  close: {
    item: 'Close Account',
    title: (name) => `Close ${name}?`,
    button: 'Close Account',
    busy: 'Closing…',
  },
};

/** What the action does, in the dialog: the firm by name, and what stays. */
function consequence(action: FirmAccountAction, firm: FirmRecord): string {
  if (action === 'suspend') {
    return `${firm.name}'s staff and clients can't use the firm workspace or client portal until you reactivate it. Nothing is deleted.`;
  }
  if (action === 'reactivate') {
    return firm.activatedAt
      ? `${firm.name}'s staff and clients can use the firm workspace and client portal again.`
      : `${firm.name} goes back to Pending Setup, so its owner can finish setting up.`;
  }
  return `Closing is final: ${firm.name} can't be reopened. Its staff and clients lose access, and its records are kept. Firmivra staff gain no access to them.`;
}

/** Why an action isn't offered now (the API refuses it with 409 FIRM_STATUS_CHANGED). */
function unavailable(action: FirmAccountAction, status: FirmRecord['status']): string {
  if (status === 'CLOSED') return 'This firm is closed';
  if (action === 'suspend') return 'This firm is already suspended';
  if (action === 'reactivate') return 'Only a suspended firm can be reactivated';
  return 'Not available';
}

/**
 * SA-FRM-F02 to F04, Y10: the firm page's top-right Actions menu (the console is Super Admins
 * only; the API checks every action again) and the confirmation each action asks for: the firm by
 * name and a required reason. Cancel changes nothing. The firm page shows the API's answer.
 */
export function FirmAccountActions({
  firm,
  trigger = 'Actions',
}: {
  firm: FirmRecord;
  /** The menu button's words (Billing: "Firm Account", next to the invoice's own menu). */
  trigger?: string;
}) {
  const client = useQueryClient();
  const reasonId = useId();
  const [action, setAction] = useState<FirmAccountAction | null>(null);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [done, setDone] = useState('');
  // SA-FRM-F06: the Request Information dialog.
  const [asking, setAsking] = useState(false);
  const run = useApiMutation(
    (input: { action: FirmAccountAction; reason: string }) =>
      api.firmApplications.firmAction(firm.id, input.action, { reason: input.reason }),
    { invalidate: ['admin-firms'] },
  );
  const can = firm.can;
  if (!can) return null;

  const open = (next: FirmAccountAction) => () => {
    run.reset();
    setReason('');
    setMissing(false);
    setDone('');
    setAction(next);
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || run.isPending) return;
    const text = reason.trim();
    if (!text) {
      setMissing(true);
      return;
    }
    run.mutate(
      { action, reason: text },
      {
        onSuccess: (record) => {
          client.setQueryData(firmDetailKey(firm.id), record);
          setDone(
            action === 'suspend'
              ? `${firm.name} is suspended.`
              : action === 'close'
                ? `${firm.name} is closed.`
                : `${firm.name} is reactivated.`,
          );
          setAction(null);
        },
        onError: (error) => {
          // Someone else changed it: show the firm as it is now.
          if (errorCode(error) === 'FIRM_STATUS_CHANGED') {
            void client.invalidateQueries({ queryKey: firmDetailKey(firm.id) });
          }
        },
      },
    );
  }

  const item = (key: FirmAccountAction, icon: typeof PauseCircle, danger = false) => ({
    label: ACTIONS[key].item,
    icon,
    danger,
    onSelect: open(key),
    ...(can[key] ? {} : { disabled: unavailable(key, firm.status) }),
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <ActionMenu
        label={trigger}
        trigger={trigger}
        align="right"
        className="[&>button]:min-h-11 [&>button]:rounded-control [&>button]:border-border [&>button]:px-4"
        sections={[
          // SA-FRM-F06 (an older API build sends no requestInfo: no item).
          ...(can.requestInfo === undefined
            ? []
            : [
                {
                  title: 'Firm',
                  items: [
                    {
                      label: 'Request Information',
                      icon: ChatText,
                      onSelect: () => {
                        setDone('');
                        setAsking(true);
                      },
                      ...(can.requestInfo
                        ? {}
                        : { disabled: 'Only an active firm with an owner can answer' }),
                    },
                  ],
                },
              ]),
          {
            title: 'Account',
            items: [
              item('suspend', PauseCircle),
              item('reactivate', PlayCircle),
              item('close', Prohibit, true),
            ],
          },
        ]}
      />
      {done ? (
        <p role="status" data-testid="firm-action-done" className="text-sm text-success">
          {done}
        </p>
      ) : null}
      <RequestInfoDialog
        firm={firm}
        open={asking}
        onClose={() => setAsking(false)}
        onSent={(record) => {
          client.setQueryData(firmDetailKey(firm.id), record);
          const ticket = record.accountHistory?.find((e) => e.type === 'INFO_REQUESTED')?.ticket;
          setDone(
            `Your request was sent to ${firm.owner?.name ?? 'the firm owner'}${ticket ? ` as Support ticket #${ticket.number}` : ''}.`,
          );
        }}
      />
      <Modal
        open={action !== null}
        title={action ? ACTIONS[action].title(firm.name) : ''}
        onClose={() => setAction(null)}
      >
        {action ? (
          <form onSubmit={submit} noValidate className="flex max-w-lg flex-col gap-4">
            <p className="text-sm text-text">{consequence(action, firm)}</p>
            <div className="flex flex-col gap-1">
              <label htmlFor={reasonId} className="text-sm font-medium text-heading">
                Reason (required)
              </label>
              <textarea
                id={reasonId}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value);
                  setMissing(false);
                }}
                rows={3}
                maxLength={1000}
                aria-invalid={missing || undefined}
                aria-describedby={`${reasonId}-help`}
                className="w-full resize-none rounded-control border border-border bg-surface p-3 text-sm text-text"
              />
              <p id={`${reasonId}-help`} className="text-xs text-muted">
                {missing
                  ? 'Enter the reason.'
                  : "Kept in the firm's history and the audit log. It isn't sent to the firm."}
              </p>
            </div>
            {run.error ? (
              <p role="alert" className="text-sm text-danger">
                {errorMessage(run.error, ERRORS)}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAction(null)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={run.isPending}
                className={
                  action === 'reactivate'
                    ? ''
                    : 'enabled:!bg-danger enabled:hover:!bg-danger/90 enabled:!text-white'
                }
              >
                {run.isPending ? ACTIONS[action].busy : ACTIONS[action].button}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}

const EVENT_TITLES: Record<FirmAccountEvent['type'], string> = {
  ACTIVATED: 'Activated',
  SUSPENDED: 'Suspended',
  REACTIVATED: 'Reactivated',
  CLOSED: 'Closed',
  INFO_REQUESTED: 'Information requested',
};

/**
 * SA-FRM-F03, F04, Y07, Y10: the account's lifecycle, newest first, in US Eastern time: who acted
 * and why. Activation is the owner finishing setup; an older closure has no one and no reason.
 */
export function FirmAccountHistory({ events }: { events: FirmAccountEvent[] }) {
  return (
    <Card className="!p-4" data-testid="firm-account-history">
      <CardHeading icon={History}>Account History</CardHeading>
      {events.length ? (
        <ol className="mt-4 flex flex-col gap-3">
          {events.map((event) => (
            <li
              key={`${event.type}-${event.at}`}
              data-testid="firm-account-event"
              className="rounded-control bg-canvas p-3 text-sm"
            >
              <p className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-heading">{EVENT_TITLES[event.type]}</span>
                <time dateTime={event.at} className="text-xs text-muted">
                  {dateText(event.at)} ET
                </time>
              </p>
              <p className="mt-1 text-muted">
                {event.by
                  ? `By ${event.by.name}`
                  : event.type === 'ACTIVATED'
                    ? 'The owner finished setup'
                    : 'Recorded by the platform'}
              </p>
              {event.reason ? (
                <p className="mt-1 whitespace-pre-wrap break-words text-text">
                  {event.type === 'INFO_REQUESTED' ? 'Subject' : 'Reason'}: {event.reason}
                </p>
              ) : null}
              {/* SA-FRM-F06: the request is a Support ticket; the owner's answer arrives there. */}
              {event.ticket ? (
                <Link
                  href={`/support/tickets/${event.ticket.id}`}
                  className="mt-1 inline-block font-medium text-link hover:underline"
                >
                  Open Support ticket #{event.ticket.number}
                </Link>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 text-sm text-muted">
          Nothing yet: the owner hasn&apos;t finished setup.
        </p>
      )}
    </Card>
  );
}
