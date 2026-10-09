'use client';

import { type EsignAuthMethod, type EsignEvent, type EsignEventType } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import { dateTime } from '../../../../../../../components/esign/format';
import { PageState } from '../../../../../../../components/page-state';
import { api } from '../../../../../../../lib/api';
import { useApiQuery } from '../../../../../../../lib/query';

const EVENT_LABELS: Record<EsignEventType, string> = {
  CREATED: 'Created',
  EDITED: 'Edited',
  APPROVAL_REQUESTED: 'Sent for approval',
  APPROVED: 'Approved',
  APPROVAL_REJECTED: 'Approval rejected',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  VIEWED: 'Viewed',
  AUTH_PASSED: 'Identity check passed',
  AUTH_FAILED: 'Identity check failed',
  CONSENTED: 'Agreed to sign electronically',
  SIGNED: 'Signed',
  REMINDER_SENT: 'Reminder sent',
  EXPIRY_WARNING_SENT: 'Expiry warning sent',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  VOIDED: 'Voided',
  CORRECTED: 'Recipient corrected',
  REPLACED: 'Replaced',
  COMPLETED: 'Completed',
  COPY_SENT: 'Completed copy sent',
  DOWNLOADED: 'Downloaded',
  IN_PERSON_STARTED: 'In-person signing started',
  IN_PERSON_ENDED: 'In-person signing ended',
};

const AUTH_LABELS: Record<EsignAuthMethod, string> = {
  LINK: 'their signing link',
  EMAIL_CODE: 'an email code',
  ACCESS_CODE: 'an access code',
  PORTAL_SESSION: 'their portal sign-in',
  IN_PERSON: 'a staff member, in person',
};

/** How the signer proved who they are, or tried to. */
const authLine = (e: EsignEvent, method: EsignAuthMethod) =>
  `${e.type === 'AUTH_FAILED' ? 'Tried' : 'Verified by'} ${AUTH_LABELS[method]}`;

/** Events that went wrong or ended the request. */
const WARN: readonly EsignEventType[] = [
  'AUTH_FAILED',
  'DECLINED',
  'EXPIRED',
  'VOIDED',
  'APPROVAL_REJECTED',
];

/** Who did it, and for whom when that is someone else. */
const who = (e: EsignEvent) =>
  e.recipient && e.recipient.name !== e.actorName
    ? `${e.actorName}, for ${e.recipient.name}`
    : e.actorName;

/** The request's events, newest first: the spec's audit timeline. */
export function Timeline({ id }: { id: string }) {
  const events = useApiQuery(['esign', 'requests', id, 'events'], () => api.esign.events(id));
  return (
    <Card>
      <h2 className="mb-4 font-display text-2xl text-heading">Timeline</h2>
      <PageState
        query={events}
        isEmpty={(d) => d.items.length === 0}
        empty="Nothing has happened yet."
      >
        {(d) => (
          <ol data-testid="timeline" className="flex flex-col gap-4 border-l-2 border-border pl-4">
            {[...d.items].reverse().map((e) => (
              <li key={e.id} className="flex flex-col gap-1">
                <span
                  className={`font-semibold ${WARN.includes(e.type) ? 'text-danger' : 'text-heading'}`}
                >
                  {EVENT_LABELS[e.type]}
                </span>
                <span className="text-sm text-text">{who(e)}</span>
                {e.reason && <span className="text-sm text-text">Reason: {e.reason}</span>}
                {e.authMethod && (
                  <span className="text-sm text-muted">{authLine(e, e.authMethod)}</span>
                )}
                <time dateTime={e.createdAt} className="text-sm text-muted">
                  {dateTime(e.createdAt)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </PageState>
    </Card>
  );
}
