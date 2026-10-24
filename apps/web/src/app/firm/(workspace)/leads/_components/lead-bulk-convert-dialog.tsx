'use client';

import type { BulkConvertLeadsRequest, BulkConvertLeadsResult, LeadOptions } from '@firmivra/types';
import { Button, Checkbox, Modal, Select } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useFirm } from '../../../../../components/firm-context';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from './lead-shared';

/** The API converts at most this many leads in one go. */
export const BULK_CONVERT_MAX = 25;

/**
 * Convert to Client from the bulk bar (her written spec; Rasel, Oct 24): each selected lead
 * becomes a client from its own record, with all of its history; one the record cannot convert
 * alone is listed with the reason, to convert on its own.
 */
export function LeadBulkConvertDialog({
  ids,
  options,
  onClose,
}: {
  ids: string[];
  options?: LeadOptions;
  onClose: () => void;
}) {
  const { role } = useFirm();
  // Owner and Admin may name one staff member for all; everyone else converts as themselves.
  const canChooseStaff = role === 'OWNER' || role === 'ADMIN';
  const [primaryStaffUserId, setPrimaryStaffUserId] = useState('');
  const [sendPortalInvite, setSendPortalInvite] = useState(false);
  // One key for this dialog, so a retry never converts a lead twice.
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<BulkConvertLeadsResult | null>(null);
  const convert = useApiMutation(
    (body: BulkConvertLeadsRequest) => api.leadPipeline.bulkConvert(body),
    { invalidate: LEAD_PIPELINE_KEY },
  );
  const tooMany = ids.length > BULK_CONVERT_MAX;
  const leads = (count: number) => `${count} ${count === 1 ? 'lead' : 'leads'}`;

  return (
    <Modal
      open
      title="Convert to Client"
      subtitle={`${leads(ids.length)} selected`}
      onClose={onClose}
      footer={
        result ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="lead-bulk-convert-form"
              disabled={convert.isPending || tooMany}
            >
              {convert.isPending ? 'Converting…' : `Convert ${leads(ids.length)}`}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="flex flex-col gap-4 text-sm" data-testid="bulk-convert-result">
          <p role="status" className="font-medium text-text">
            {result.converted.length
              ? `${leads(result.converted.length)} converted to clients.`
              : 'No lead was converted.'}
            {result.skipped.length ? ` ${leads(result.skipped.length)} left as they were.` : ''}
          </p>
          {result.converted.length ? (
            <ul aria-label="Converted" className="flex flex-col gap-1">
              {result.converted.map((c) => (
                <li key={c.leadId}>
                  <Link href={`/clients/${c.clientId}`} className="text-link underline">
                    {c.name}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {result.skipped.length ? (
            <ul aria-label="Left as leads" className="flex flex-col gap-1">
              {result.skipped.map((s) => (
                <li key={s.leadId}>
                  <span className="font-medium text-text">{s.name || 'A lead'}</span>
                  <span className="text-muted">: {s.reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <form
          id="lead-bulk-convert-form"
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (tooMany) return;
            convert.mutate(
              {
                idempotencyKey,
                ids,
                ...(canChooseStaff && primaryStaffUserId ? { primaryStaffUserId } : {}),
                sendPortalInvite,
              },
              { onSuccess: setResult },
            );
          }}
        >
          <p className="text-sm text-text">
            Each lead becomes a client with its contact details, services of interest and all of its
            history; the lead stays, Converted. A lead without a phone or a service, or whose email
            a client already has, is left for you to convert on its own.
          </p>
          {canChooseStaff ? (
            <Select
              label="Primary staff"
              value={primaryStaffUserId}
              onChange={(event) => setPrimaryStaffUserId(event.target.value)}
              options={[
                { value: '', label: "Each lead's assigned staff member" },
                ...(options?.staff.map((member) => ({
                  value: member.userId,
                  label: member.name,
                })) ?? []),
              ]}
            />
          ) : null}
          <Checkbox
            label="Send each new client a portal invitation now"
            checked={sendPortalInvite}
            onChange={(event) => setSendPortalInvite(event.target.checked)}
          />
          {tooMany ? (
            <p role="alert" className="text-sm text-danger">
              Choose at most {BULK_CONVERT_MAX} leads at a time.
            </p>
          ) : null}
          {convert.error ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(convert.error)}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
