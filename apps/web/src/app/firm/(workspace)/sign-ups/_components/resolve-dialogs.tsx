'use client';

import {
  type ClientSignUpDetail,
  type RecordSignUpChecksRequest,
  type SignUpCandidate,
} from '@firmivra/types';
import { Button, Modal, Select } from '@firmivra/ui';
import { useRef, useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { TextArea } from '../../../setup/_components/fields';
import { SIGN_UP_ERRORS, SIGN_UPS } from './sign-up-parts';

type Checks = Omit<RecordSignUpChecksRequest, 'candidateClientId'>;

const CONTACTS = [
  { value: 'CLIENT_PHONE', label: 'The phone number on the client record' },
  { value: 'CLIENT_EMAIL', label: 'The email on the client record' },
  { value: 'CLIENT_CONTACT', label: 'Another contact on the client record' },
];
const SCOPES = [
  { value: '', label: 'No permission given' },
  { value: 'RESTORE_ACCESS', label: 'Restore access to their existing login' },
  { value: 'LINK_RECORD', label: 'Link this sign-up to the record' },
  { value: 'BOTH', label: 'Either of the two' },
];

/** A key per opened dialog, so a retry after a lost answer returns the first outcome. */
function useKey() {
  const ref = useRef<string | null>(null);
  return {
    get: () => (ref.current ??= crypto.randomUUID()),
    clear: () => {
      ref.current = null;
    },
  };
}

/**
 * Record Checks (Octavia's D2): the call to a contact already on the client record (never the
 * sign-up's own), the identity result and the client's permission with its scope. They count for
 * 24 hours; the API checks them again before Restore Access or Link Existing Record.
 */
export function ChecksDialog({
  request,
  candidate,
  onClose,
}: {
  request: ClientSignUpDetail;
  candidate: SignUpCandidate | null;
  onClose: () => void;
}) {
  const [checks, setChecks] = useState<Partial<Checks>>({ permissionScope: null });
  const record = useApiMutation(
    (body: RecordSignUpChecksRequest) =>
      api.clientSignUps.recordChecks(request.clientAccountId, body),
    { invalidate: SIGN_UPS },
  );
  const close = () => {
    record.reset();
    setChecks({ permissionScope: null });
    onClose();
  };
  const ready = !!checks.contactRef && !!checks.callOutcome && !!checks.identityResult;
  return (
    <Modal
      open={candidate !== null}
      title="Record the checks"
      {...(candidate ? { subtitle: `${candidate.clientNumber} · ${candidate.displayName}` } : {})}
      onClose={close}
    >
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!candidate || !ready) return;
          record.mutate(
            {
              candidateClientId: candidate.clientId,
              contactRef: checks.contactRef!,
              callOutcome: checks.callOutcome!,
              identityResult: checks.identityResult!,
              permissionScope: checks.permissionScope ?? null,
            },
            { onSuccess: close },
          );
        }}
      >
        <p className="text-sm text-muted">
          Call a contact already on the client record, never one from this sign-up. Record what
          happened; the evidence itself stays out of Firmivra.
        </p>
        <Select
          label="Who you called"
          value={checks.contactRef ?? ''}
          onChange={(e) =>
            setChecks({
              ...checks,
              contactRef: (e.target.value || undefined) as Checks['contactRef'],
            })
          }
          options={[{ value: '', label: 'Choose the contact' }, ...CONTACTS]}
        />
        <Select
          label="The call"
          value={checks.callOutcome ?? ''}
          onChange={(e) =>
            setChecks({
              ...checks,
              callOutcome: (e.target.value || undefined) as Checks['callOutcome'],
            })
          }
          options={[
            { value: '', label: 'Choose the result' },
            { value: 'REACHED', label: 'Reached the client' },
            { value: 'NOT_REACHED', label: 'Could not reach them' },
          ]}
        />
        <Select
          label="Identity"
          value={checks.identityResult ?? ''}
          onChange={(e) =>
            setChecks({
              ...checks,
              identityResult: (e.target.value || undefined) as Checks['identityResult'],
            })
          }
          options={[
            { value: '', label: 'Choose the result' },
            { value: 'VERIFIED', label: 'Identity verified' },
            { value: 'NOT_VERIFIED', label: 'Not verified' },
          ]}
        />
        <Select
          label="The client's permission"
          value={checks.permissionScope ?? ''}
          onChange={(e) =>
            setChecks({
              ...checks,
              permissionScope: (e.target.value || null) as Checks['permissionScope'],
            })
          }
          options={SCOPES}
        />
        {record.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(record.error, SIGN_UP_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!ready || record.isPending}>
            Record Checks
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Restore Access or Link Existing Record, confirmed: what happens, said plainly. The version and
 * the key make it safe to retry; the API checks the three checks again.
 */
export function ResolveDialog({
  request,
  action,
  onClose,
  onDone,
}: {
  request: ClientSignUpDetail;
  action: { kind: 'RESTORE_ACCESS' | 'LINK'; candidate: SignUpCandidate } | null;
  onClose: () => void;
  onDone: (text: string, clientId?: string) => void;
}) {
  const key = useKey();
  const resolve = useApiMutation(
    async (a: { kind: 'RESTORE_ACCESS' | 'LINK'; candidateClientId: string }) => {
      const body = {
        candidateClientId: a.candidateClientId,
        version: request.version,
        idempotencyKey: key.get(),
      };
      const done =
        a.kind === 'LINK'
          ? await api.clientSignUps.link(request.clientAccountId, body)
          : await api.clientSignUps.restoreAccess(request.clientAccountId, body);
      key.clear();
      return done;
    },
    { invalidate: SIGN_UPS },
  );
  const close = () => {
    resolve.reset();
    key.clear();
    onClose();
  };
  const c = action?.candidate;
  const link = action?.kind === 'LINK';
  return (
    <Modal
      open={action !== null}
      title={link ? 'Link Existing Record' : 'Restore Access'}
      {...(c ? { subtitle: `${c.clientNumber} · ${c.displayName}` } : {})}
      onClose={close}
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-text">
          {link
            ? `${request.name}'s login joins this client record. Its Client ID and contacts stay as they are, and ${request.name} is emailed that the portal is ready.`
            : `${request.name} already has a login on this client record. This request closes, no new client is made, and that login gets the portal's password recovery email at the contact on file.`}
        </p>
        {resolve.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(resolve.error, SIGN_UP_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            disabled={resolve.isPending || !action}
            onClick={() =>
              action &&
              resolve.mutate(
                { kind: action.kind, candidateClientId: action.candidate.clientId },
                {
                  onSuccess: (done) => {
                    resolve.reset();
                    onDone(
                      link
                        ? `${request.name} is linked to ${action.candidate.clientNumber} and can now use your client portal.`
                        : `${request.name}'s existing login was sent a recovery email. This request is closed.`,
                      done.clientId,
                    );
                  },
                },
              )
            }
          >
            {link ? 'Link Existing Record' : 'Restore Access'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Not a Match (Owner and Admin): the phone matches are not this person, with a short reason. */
export function NotAMatchDialog({
  request,
  open,
  onClose,
  onDone,
}: {
  request: ClientSignUpDetail;
  open: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const key = useKey();
  const [reason, setReason] = useState('');
  const resolve = useApiMutation(
    async (why: string) => {
      const done = await api.clientSignUps.notAMatch(request.clientAccountId, {
        reason: why,
        version: request.version,
        idempotencyKey: key.get(),
      });
      key.clear();
      return done;
    },
    { invalidate: SIGN_UPS },
  );
  const close = () => {
    resolve.reset();
    key.clear();
    setReason('');
    onClose();
  };
  return (
    <Modal open={open} title="Not a Match" onClose={close}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!reason.trim()) return;
          resolve.mutate(reason.trim(), {
            onSuccess: () => {
              setReason('');
              resolve.reset();
              onDone(
                `The matching records are marked as not ${request.name}. Approve checks for matches again.`,
              );
            },
          });
        }}
      >
        <p className="text-sm text-text">
          These records share the phone number but are not {request.name}. Each is recorded with
          your name, the time and the reason, and stops holding this request back.
        </p>
        <TextArea
          label="Why they are not this person"
          rows={3}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        {resolve.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(resolve.error, SIGN_UP_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={!reason.trim() || resolve.isPending}>
            Not a Match
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Keep Pending: nothing changes; an optional note for the firm goes in the activity. */
export function KeepPendingDialog({
  request,
  open,
  onClose,
  onDone,
}: {
  request: ClientSignUpDetail;
  open: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
}) {
  const key = useKey();
  const [note, setNote] = useState('');
  const keep = useApiMutation(
    async (text: string) => {
      const done = await api.clientSignUps.keepPending(request.clientAccountId, {
        ...(text ? { note: text } : {}),
        idempotencyKey: key.get(),
      });
      key.clear();
      return done;
    },
    { invalidate: SIGN_UPS },
  );
  const close = () => {
    keep.reset();
    key.clear();
    setNote('');
    onClose();
  };
  return (
    <Modal open={open} title="Keep Pending" onClose={close}>
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          keep.mutate(note.trim(), {
            onSuccess: () => {
              setNote('');
              keep.reset();
              onDone(`${request.name}'s request stays waiting for approval. Nothing was changed.`);
            },
          });
        }}
      >
        <TextArea
          label="Note for your firm (optional)"
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {keep.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(keep.error, SIGN_UP_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={keep.isPending}>
            Keep Pending
          </Button>
        </div>
      </form>
    </Modal>
  );
}
