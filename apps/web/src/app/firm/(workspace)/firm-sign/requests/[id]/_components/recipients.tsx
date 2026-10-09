import type { EsignRecipient, EsignRecipientRole, EsignRecipientStatus } from '@firmivra/types';
import { Badge, Card } from '@firmivra/ui';
import type { ReactNode } from 'react';
import { shortDate } from '../../../../../../../components/esign/format';

const KIND: Record<EsignRecipient['kind'], string> = {
  SIGNER: 'Signer',
  APPROVER: 'Approver',
  CC: 'Gets a copy',
};

const ROLE: Record<EsignRecipientRole, string> = {
  CLIENT: 'Client',
  SPOUSE: 'Spouse',
  BUSINESS_OWNER: 'Business owner',
  EMPLOYEE: 'Employee',
  PREPARER: 'Preparer',
  MANAGER: 'Manager',
  WITNESS: 'Witness',
  CUSTOM: 'Other',
};

const DELIVERY: Record<EsignRecipient['delivery'], string> = {
  EMAIL: 'By email',
  PORTAL: 'In the client portal',
  IN_PERSON: 'In person',
};

const STATUS: Record<
  EsignRecipientStatus,
  [string, 'info' | 'success' | 'warning' | 'danger' | 'neutral']
> = {
  WAITING: ['Waiting', 'neutral'],
  SENT: ['Sent', 'info'],
  DELIVERED: ['Sent', 'info'],
  VIEWED: ['Viewed', 'info'],
  SIGNED: ['Signed', 'success'],
  APPROVED: ['Approved', 'success'],
  REJECTED: ['Rejected', 'danger'],
  DECLINED: ['Declined', 'danger'],
};

/** What the recipient last did, and when. */
function lastStep(r: EsignRecipient): string | null {
  const [label, at] =
    r.status === 'SIGNED' || r.status === 'APPROVED'
      ? [r.status === 'SIGNED' ? 'Signed' : 'Approved', r.signedAt]
      : r.status === 'DECLINED' || r.status === 'REJECTED'
        ? [r.status === 'DECLINED' ? 'Declined' : 'Rejected', r.declinedAt]
        : ['Viewed', r.viewedAt];
  return at ? `${label} ${shortDate(at)}` : null;
}

/** Each recipient in signing order, with where they are. `actions` adds a recipient's buttons. */
export function Recipients({
  recipients,
  ordered,
  actions,
}: {
  recipients: EsignRecipient[];
  /** Sequential routing: show each one's turn. */
  ordered: boolean;
  actions?: (r: EsignRecipient) => ReactNode;
}) {
  const sorted = [...recipients].sort((a, b) => a.routingOrder - b.routingOrder);
  return (
    <Card>
      <h2 className="mb-4 font-display text-2xl text-heading">Recipients</h2>
      <ul className="flex flex-col divide-y divide-border">
        {sorted.map((r) => {
          const [label, tone] = STATUS[r.status];
          const step = lastStep(r);
          return (
            <li key={r.id} data-testid="recipient" className="flex flex-col gap-2 py-3 first:pt-0">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-heading">
                  {ordered && r.kind === 'SIGNER' && `${r.routingOrder}. `}
                  {r.name}
                </span>
                <Badge tone={tone}>{label}</Badge>
              </div>
              <span className="text-sm text-text">
                {KIND[r.kind]}
                {r.kind === 'SIGNER' && `, ${r.roleLabel ?? ROLE[r.role]}`}
                {' · '}
                {DELIVERY[r.delivery]}
                {r.email && ` · ${r.email}`}
              </span>
              {step && <span className="text-sm text-muted">{step}</span>}
              {r.reminderCount > 0 && (
                <span className="text-sm text-muted">
                  Reminded {r.reminderCount} {r.reminderCount === 1 ? 'time' : 'times'}, last{' '}
                  {shortDate(r.lastRemindedAt)}
                </span>
              )}
              {r.declineReason && (
                <span className="text-sm text-danger">Reason: {r.declineReason}</span>
              )}
              {actions?.(r)}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
