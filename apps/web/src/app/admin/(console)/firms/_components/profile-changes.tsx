'use client';

import {
  APPLICABLE_PROFILE_FIELDS,
  type ApplicableProfileField,
  ApiRequestError,
  ApplyProfileChangeRequest,
  FIRM_PROFILE_ERRORS,
  type FirmProfileChangeRequest,
  PROFILE_CHANGE_FIELDS,
  PROFILE_CHANGE_KIND_LABELS,
} from '@firmivra/types';
import { Button, Card, Input, Modal, Skeleton } from '@firmivra/ui';
import { FilePenLine } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { CardHeading } from '../../applications/_components/application-cards';
import { dateText } from '../../applications/_components/application-ui';

/** The Super Admin queue's words for a ticket's status. */
const STATUS_WORDS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In Progress',
  WAITING_ON_CUSTOMER: 'Waiting on Firm',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};
const APPLICABLE: readonly string[] = APPLICABLE_PROFILE_FIELDS;
const FULL_EIN = /^\d{2}-?\d{7}$/;
const labels = (fields: readonly string[]) =>
  fields.map((f) => PROFILE_CHANGE_FIELDS[f as ApplicableProfileField].label).join(', ');

/** Why a request cannot be applied here, or null when it can. */
function blocked(r: FirmProfileChangeRequest, live: boolean): string | null {
  if (!live) return 'The firm is in setup or closed: it changes these itself in setup.';
  if (r.status === 'CLOSED') return 'Closed. Reopen the ticket to apply it.';
  if (!r.fields.some((f) => APPLICABLE.includes(f)))
    return 'Licensing details can be applied once their records are added.';
  return null;
}

/**
 * The firm's Company Profile Request Changes (R60) on its Super Admin page, and applying one (R56,
 * Rasel Oct 24): the values come prefilled from the ticket and are confirmed before they apply.
 * The firm hears of it when the ticket is resolved with a reply, from the ticket's page.
 */
export function ProfileChanges({ firmId }: { firmId: string }) {
  const query = useApiQuery(['firms', 'profile-changes', firmId], () =>
    api.adminFirmProfile.list(firmId),
  );
  const [open, setOpen] = useState<FirmProfileChangeRequest | null>(null);
  const [done, setDone] = useState('');
  const data = query.data;
  const live = data?.firm.status === 'ACTIVE' || data?.firm.status === 'SUSPENDED';
  return (
    <Card className="!p-4" data-testid="profile-changes">
      <CardHeading icon={FilePenLine}>Company Profile Change Requests</CardHeading>
      <p className="mt-1 text-sm text-muted">
        The legal name, EIN and licensing details the firm asked Firmivra to change. Apply an
        approved request here, then resolve its ticket with a reply to tell the firm.
      </p>
      {done ? (
        <p role="status" className="mt-3 text-sm text-success" data-testid="profile-change-applied">
          {done}
        </p>
      ) : null}
      {query.isPending ? (
        <Skeleton className="mt-4 h-24" />
      ) : query.isError || !data ? (
        <p className="mt-4 rounded-control bg-canvas p-3 text-sm text-muted">
          Change requests are not available right now.
        </p>
      ) : data.requests.length === 0 ? (
        <p className="mt-4 rounded-control bg-canvas p-3 text-sm text-muted">
          No change requests from this firm.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col divide-y divide-surface overflow-hidden rounded-control bg-canvas">
          {data.requests.map((r) => {
            const why = blocked(r, live);
            return (
              <li
                key={r.ticketId}
                className="flex flex-wrap items-center justify-between gap-3 px-3 py-2"
                data-testid="profile-change"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold break-words text-heading">
                    <Link
                      href={`/support/tickets/${r.ticketId}`}
                      className="text-link hover:underline"
                    >
                      {r.number}
                    </Link>{' '}
                    {PROFILE_CHANGE_KIND_LABELS[r.kind]}: {labels(r.fields)}
                  </p>
                  <p className="text-xs text-muted">
                    Asked {dateText(r.submittedAt)} · {STATUS_WORDS[r.status] ?? r.status}
                    {r.applied
                      ? ` · Applied ${dateText(r.applied.at)}${r.applied.by ? ` by ${r.applied.by}` : ''}`
                      : ''}
                  </p>
                  {why ? <p className="text-xs text-muted">{why}</p> : null}
                </div>
                <Button
                  variant={r.applied ? 'secondary' : undefined}
                  disabled={why !== null}
                  onClick={() => {
                    setDone('');
                    setOpen(r);
                  }}
                >
                  {r.applied ? 'Apply Again' : 'Apply'}
                  <span className="sr-only"> {r.number}</span>
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {open && data ? (
        <ApplyDialog
          firmId={firmId}
          legalName={data.firm.legalName}
          request={open}
          onClose={() => setOpen(null)}
          onApplied={(text) => {
            setOpen(null);
            setDone(text);
          }}
        />
      ) : null}
    </Card>
  );
}

function ApplyDialog({
  firmId,
  legalName,
  request,
  onClose,
  onApplied,
}: {
  firmId: string;
  legalName: string | null;
  request: FirmProfileChangeRequest;
  onClose: () => void;
  onApplied: (message: string) => void;
}) {
  const asked = APPLICABLE_PROFILE_FIELDS.filter((f) => request.fields.includes(f));
  const [values, setValues] = useState<Record<ApplicableProfileField, string>>(() => ({
    legalName: request.proposed.legalName ?? '',
    // Only a whole EIN is prefilled: once the ticket keeps its last four digits only (R60), the
    // Super Admin enters it from the firm's documents.
    ein: FULL_EIN.test(request.proposed.ein ?? '') ? (request.proposed.ein ?? '') : '',
  }));
  // Each value checked against the contract first, its message on its field; nothing sent.
  const [problems, setProblems] = useState<Partial<Record<ApplicableProfileField, string>>>({});
  const body = (): ApplyProfileChangeRequest =>
    Object.fromEntries(asked.map((f) => [f, values[f].trim()]));
  const save = useApiMutation(() => api.adminFirmProfile.apply(firmId, request.ticketId, body()), {
    invalidate: ['firms'],
  });
  const fieldError = (field: ApplicableProfileField) =>
    problems[field] ??
    (save.error instanceof ApiRequestError
      ? save.error.details?.find((d) => d.path === field)?.message
      : undefined);
  const put = (field: ApplicableProfileField, value: string) => {
    setValues((now) => ({ ...now, [field]: value }));
    setProblems((now) => ({ ...now, [field]: undefined }));
  };
  return (
    <Modal open title={`Apply ${request.number}`} onClose={onClose}>
      <form
        className="flex max-w-lg flex-col gap-4"
        data-testid="apply-profile-change"
        onSubmit={(e) => {
          e.preventDefault();
          const check = ApplyProfileChangeRequest.safeParse(body());
          setProblems(
            check.success
              ? {}
              : Object.fromEntries(check.error.issues.map((i) => [String(i.path[0]), i.message])),
          );
          if (!check.success) return;
          save.mutate(undefined, {
            onSuccess: (r) =>
              onApplied(
                `Applied ${labels(r.fields)} from ${request.number}${
                  r.einLast4 ? ` (EIN ending in ${r.einLast4})` : ''
                }. Resolve the ticket with a reply to tell the firm.`,
              ),
          });
        }}
      >
        <p className="text-sm text-muted">
          Check each value against the request and the firm&apos;s documents. It takes effect at
          once on the firm&apos;s Company Profile.
        </p>
        {request.reason ? (
          <div>
            <p className="text-sm font-medium text-text">Their reason</p>
            <p className="text-sm whitespace-pre-line text-muted">{request.reason}</p>
          </div>
        ) : null}
        {asked.includes('legalName') ? (
          <div>
            <Input
              label="Legal Company Name"
              value={values.legalName}
              maxLength={200}
              error={fieldError('legalName')}
              onChange={(e) => put('legalName', e.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              Now: {legalName ?? request.current.legalName ?? 'Not on file'}
            </p>
          </div>
        ) : null}
        {asked.includes('ein') ? (
          <div>
            <Input
              label="EIN (Tax ID)"
              inputMode="numeric"
              autoComplete="off"
              value={values.ein}
              error={fieldError('ein')}
              onChange={(e) => put('ein', e.target.value)}
            />
            <p className="mt-1 text-xs text-muted">
              Now: {request.current.ein ?? 'Not on file'}
              {request.proposed.ein && !FULL_EIN.test(request.proposed.ein)
                ? `. Asked for: ${request.proposed.ein}`
                : ''}
              . Saved encrypted; afterwards only its last four digits show.
            </p>
          </div>
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(save.error, FIRM_PROFILE_ERRORS)}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button type="button" variant="secondary" disabled={save.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending || asked.some((f) => !values[f].trim())}>
            {save.isPending ? 'Applying…' : 'Apply Change'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
