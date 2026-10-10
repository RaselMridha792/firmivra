import {
  ESIGN_OPEN_STATUSES,
  type EsignAction,
  type EsignNextAction,
  type EsignRecipientStatus,
  type EsignRequestStatus,
} from '@firmivra/types';
import type { EsignRecipientRecord, EsignRequestRecord } from './esign.repository.js';
import type { EsignActor } from './requests.service.js';

// What a request waits on and what the caller may do with it now (the row's `nextAction` and the
// Actions menu's `allowedActions`), as the contract's mock (apps/web/src/mocks/esign.ts) has them.

const OPEN: readonly EsignRequestStatus[] = ESIGN_OPEN_STATUSES;
/** A signer whose turn it is. */
export const TURN: readonly EsignRecipientStatus[] = ['SENT', 'DELIVERED', 'VIEWED'];

export const isOpen = (status: EsignRequestStatus) => OPEN.includes(status);

export function nextAction(
  status: EsignRequestStatus,
  recipients: readonly EsignRecipientRecord[],
): EsignNextAction {
  if (status === 'DRAFT') return { kind: 'FINISH_DRAFT', waitingOn: [] };
  if (status === 'NEEDS_APPROVAL') {
    const waiting = recipients.filter((r) => r.kind === 'APPROVER' && r.status !== 'APPROVED');
    return { kind: 'AWAIT_APPROVAL', waitingOn: waiting.map((r) => r.name) };
  }
  if (!isOpen(status)) return { kind: 'NONE', waitingOn: [] };
  const turn = signersOf(recipients).filter((r) => TURN.includes(r.status));
  return { kind: 'AWAIT_SIGNATURE', waitingOn: turn.map((r) => r.name) };
}

/** The signers in signing order. */
export const signersOf = (recipients: readonly EsignRecipientRecord[]) =>
  recipients.filter((r) => r.kind === 'SIGNER').sort((a, b) => a.routingOrder - b.routingOrder);

/**
 * `actor` null: the answer to a draft write by someone who may change it. `approverOnly`: reached
 * only as an approver, who may decide and download but never change it. A VIEWER only downloads.
 */
export function allowedActions(
  record: Pick<EsignRequestRecord, 'status' | 'sentAt'>,
  recipients: readonly EsignRecipientRecord[],
  actor: EsignActor | null,
  approverOnly: boolean,
): EsignAction[] {
  const download: EsignAction[] = record.sentAt ? ['DOWNLOAD'] : [];
  const deciding =
    actor !== null &&
    record.status === 'NEEDS_APPROVAL' &&
    recipients.some(
      (r) =>
        r.kind === 'APPROVER' &&
        r.link.type === 'STAFF' &&
        r.link.userId === actor.userId &&
        r.status !== 'APPROVED',
    );
  if (actor?.role === 'VIEWER') return download;
  if (approverOnly) return deciding ? ['APPROVE', ...download] : download;
  switch (record.status) {
    case 'DRAFT':
      return recipients.some((r) => r.kind === 'APPROVER' && r.status !== 'APPROVED')
        ? ['EDIT', 'DISCARD', 'SUBMIT_FOR_APPROVAL']
        : ['EDIT', 'DISCARD', 'SEND'];
    case 'NEEDS_APPROVAL':
      return deciding ? ['APPROVE', 'VOID'] : ['VOID'];
    case 'COMPLETED':
      return ['RESEND_COPY', 'DOWNLOAD'];
    default:
      if (!isOpen(record.status)) return download;
      return recipients.some((r) => r.delivery === 'IN_PERSON')
        ? ['REMIND', 'VOID', 'CORRECT', 'REPLACE', 'DOWNLOAD', 'START_IN_PERSON']
        : ['REMIND', 'VOID', 'CORRECT', 'REPLACE', 'DOWNLOAD'];
  }
}
