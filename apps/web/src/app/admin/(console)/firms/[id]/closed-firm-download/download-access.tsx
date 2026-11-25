'use client';

import { ApiRequestError, type FirmRecord } from '@firmivra/types';
import { Badge, Button, Card, Modal, PageHeader, Textarea } from '@firmivra/ui';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { useMe } from '../../../../../../components/signed-in';
import { api } from '../../../../../../lib/api';
import { adminDownloadAccess, type DownloadGrant } from '../../../../../../lib/firm-data-downloads';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { firmDetailKey } from '../../_components/firm-account';

const DAY = 86_400_000;
const dateTime = (value: string | number) => new Date(value).toLocaleString();
const eventLabels: Record<string, string> = {
  ISSUED: 'Issued',
  REVOKED: 'Revoked',
  DOWNLOADED: 'Download',
};

function GrantCard({
  grant,
  now,
  busy,
  onRevoke,
}: {
  grant: DownloadGrant;
  now: number;
  busy: boolean;
  onRevoke: () => void;
}) {
  const pending = Date.parse(grant.startsAt) > now;
  const open = !grant.revokedAt && Date.parse(grant.expiresAt) > now;
  return (
    <Card className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h3 className="font-semibold text-heading">
            {grant.kind === 'AUTOMATIC' ? 'Automatic access' : 'Temporary access'}
          </h3>
          <Badge tone={open && !pending ? 'success' : 'neutral'}>
            {grant.revokedAt ? 'Revoked' : !open ? 'Expired' : pending ? 'Scheduled' : 'Active'}
          </Badge>
          <p className="text-sm text-muted">
            Starts {dateTime(grant.startsAt)} · Expires {dateTime(grant.expiresAt)}
          </p>
          {grant.reason ? (
            <p className="text-sm break-words text-text">Issue reason: {grant.reason}</p>
          ) : null}
          {grant.revokeReason ? (
            <p className="text-sm break-words text-text">Revoke reason: {grant.revokeReason}</p>
          ) : null}
        </div>
        {open ? (
          <Button variant="danger" disabled={busy} onClick={onRevoke}>
            Revoke access
          </Button>
        ) : null}
      </div>
      {grant.log.length ? (
        <details className="mt-4 text-sm text-text">
          <summary className="cursor-pointer font-semibold">Activity</summary>
          <ul className="mt-2 space-y-1">
            {grant.log.map((event, i) => (
              <li key={i}>
                {eventLabels[event.event] ?? event.event} · {dateTime(event.occurredAt)}
                {event.fileCount === null ? '' : ' · Count ' + event.fileCount}
                {event.bytes === null ? '' : ' · ' + event.bytes + ' bytes'}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Card>
  );
}

type Action = { kind: 'issue' } | { kind: 'revoke'; grantId: string };

function GrantManager({ firm }: { firm: FirmRecord }) {
  const key = ['closed-firm-download', firm.id];
  const grants = useApiQuery(key, () => adminDownloadAccess.list(firm.id));
  const [action, setAction] = useState<Action | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const change = useApiMutation(
    async (input: { action: Action; reason: string }) =>
      input.action.kind === 'issue'
        ? adminDownloadAccess.issue(firm.id, input.reason)
        : adminDownloadAccess.revoke(firm.id, input.action.grantId, input.reason),
    { invalidate: key },
  );
  const closed = firm.closedAt ? Date.parse(firm.closedAt) : Number.NaN;
  const first = closed + 30 * DAY;
  const last = closed + 90 * DAY;
  const [now, setNow] = useState(Date.now);
  const canIssue = now < last;
  const heading = action?.kind === 'revoke' ? 'Revoke access' : 'Grant temporary download access';

  function open(next: Action) {
    setAction(next);
    setReason('');
    setNotice('');
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || change.isPending) return;
    const trimmed = reason.trim();
    if (!trimmed || trimmed.length > 1000) {
      setError('Enter a reason of 1 to 1,000 characters.');
      return;
    }
    setError('');
    try {
      const result = await change.mutateAsync({ action, reason: trimmed });
      setNow(Date.now());
      setNotice(
        'revoked' in result
          ? 'Download access revoked.'
          : result.emailAccepted
            ? 'Temporary access granted. The email provider accepted the link.'
            : 'Temporary access granted, but the email provider could not accept the link.',
      );
      setAction(null);
    } catch (failure) {
      setError(
        failure instanceof ApiRequestError && failure.status < 500
          ? failure.message
          : 'Could not update access. Try again.',
      );
    }
  }

  return (
    <>
      <Card title="Temporary download access">
        <p className="mb-3 text-sm text-muted">
          Grant requested access from day 31 through day 90 after closure. The grant expires at the
          end of that window.
        </p>
        {Number.isFinite(last) ? (
          <p className="mb-3 text-sm text-muted">
            {now < first
              ? 'Available from ' + dateTime(first)
              : now >= last
                ? 'Window ended ' + dateTime(last)
                : 'Available until ' + dateTime(last)}
          </p>
        ) : (
          <p className="mb-3 text-sm text-muted">Closure date is unavailable.</p>
        )}
        <Button disabled={!canIssue || change.isPending} onClick={() => open({ kind: 'issue' })}>
          Grant temporary download access
        </Button>
      </Card>
      {notice ? (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      ) : null}
      <section aria-label="Download grants" className="flex min-w-0 flex-col gap-3">
        <h2 className="text-lg font-semibold text-heading">Download grants</h2>
        {grants.isPending ? <p role="status">Loading grants…</p> : null}
        {grants.isError ? (
          <div role="alert">
            <p>Could not load download grants.</p>
            <Button variant="secondary" onClick={() => void grants.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}
        {grants.data?.length === 0 ? (
          <p className="text-sm text-muted">No download grants have been issued.</p>
        ) : null}
        {grants.data?.map((grant) => (
          <GrantCard
            key={grant.id}
            grant={grant}
            now={now}
            busy={change.isPending}
            onRevoke={() => open({ kind: 'revoke', grantId: grant.id })}
          />
        ))}
      </section>
      <Modal
        open={!!action}
        title={heading}
        onClose={() => {
          if (!change.isPending) setAction(null);
        }}
      >
        <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
          {action?.kind === 'revoke' ? (
            <p className="text-sm text-text">
              The owner’s link and verified download session will stop working.
            </p>
          ) : null}
          <Textarea
            label="Reason"
            value={reason}
            maxLength={1000}
            onChange={(event) => setReason(event.target.value)}
            error={error || undefined}
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={change.isPending} onClick={() => setAction(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={action?.kind === 'revoke' ? 'danger' : 'primary'}
              disabled={change.isPending}
            >
              {heading}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function FirmDownloads({ firmId }: { firmId: string }) {
  const firm = useApiQuery(firmDetailKey(firmId), () => api.firmApplications.getFirm(firmId));
  if (firm.isPending) return <p role="status">Loading firm…</p>;
  if (firm.isError)
    return (
      <div role="alert">
        <p>Could not load the firm.</p>
        <Button variant="secondary" onClick={() => void firm.refetch()}>
          Retry
        </Button>
      </div>
    );
  if (firm.data.status !== 'CLOSED')
    return <Card>Download access is available only for closed firms.</Card>;
  return (
    <>
      <p className="break-words text-muted">{firm.data.name}</p>
      <GrantManager firm={firm.data} />
    </>
  );
}

export function DownloadAccess({ firmId, backTo }: { firmId: string; backTo: string }) {
  const { me } = useMe();
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <PageHeader
        title="Manage download access"
        above={
          <Link href={backTo} className="text-sm font-semibold text-link hover:underline">
            Back to firm details
          </Link>
        }
      />
      {me.platformAdmin ? (
        <FirmDownloads firmId={firmId} />
      ) : (
        <p role="alert">Only Super Admins can manage download access.</p>
      )}
    </div>
  );
}
