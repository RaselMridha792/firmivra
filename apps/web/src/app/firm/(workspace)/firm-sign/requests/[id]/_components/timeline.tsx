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
  DELIVERED: 'Email delivered',
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

/** Events that went wrong or ended the request (Expired in amber, as its status badge). */
const DANGER: readonly EsignEventType[] = [
  'AUTH_FAILED',
  'DECLINED',
  'VOIDED',
  'APPROVAL_REJECTED',
];
const tone = (type: EsignEventType) =>
  DANGER.includes(type) ? 'text-danger' : type === 'EXPIRED' ? 'text-warning' : 'text-heading';

/** Who did it, and for whom when that is someone else. */
const who = (e: EsignEvent) =>
  e.recipient && e.recipient.name !== e.actorName
    ? `${e.actorName}, for ${e.recipient.name}`
    : e.actorName;

/** The request's events (shared by the page, which starts loading them, and the timeline). */
export const useEvents = (id: string) =>
  useApiQuery(['esign', 'requests', id, 'events'], () => api.esign.events(id));

/** The request's events, newest first: the spec's audit timeline. */
export function Timeline({ id }: { id: string }) {
  const events = useEvents(id);
  // PageState's loading and error states are cards of their own, so the card wraps only the list.
  return (
    <PageState query={events} isEmpty={() => false}>
      {(d) => (
        <Card>
          <h2 className="mb-4 font-display text-2xl text-heading">Timeline</h2>
          {d.items.length === 0 ? (
            <p className="text-sm text-muted">Nothing has happened yet.</p>
          ) : (
            <ol
              data-testid="timeline"
              className="flex flex-col gap-4 border-l-2 border-border pl-4"
            >
              {[...d.items].reverse().map((e) => (
                <li key={e.id} className="flex flex-col gap-1">
                  <span className={`font-semibold ${tone(e.type)}`}>{EVENT_LABELS[e.type]}</span>
                  <span className="text-sm break-words text-text">{who(e)}</span>
                  {e.reason && (
                    <span className="text-sm break-words text-text">Reason: {e.reason}</span>
                  )}
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
        </Card>
      )}
    </PageState>
  );
}
