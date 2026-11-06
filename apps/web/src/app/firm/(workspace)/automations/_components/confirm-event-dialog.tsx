'use client';

import type { AutomationCatalog } from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import { AUTOMATIONS_KEY, AUTOMATION_ERRORS } from './automations-shared';

// AU-F31 to F33 (Octavia's Oct 28 review): a member confirms one known external outcome for one
// record and occurrence: never in bulk, only while Manual Event Confirmation is on. It records the
// fact and nothing else. The record comes from its module's own list.

interface Choice {
  id: string;
  label: string;
  /** The occurrence the record suggests: a tax year, a due date, a pay period's end. */
  occurrence: string;
}

export function ConfirmEventDialog({
  catalog,
  onClose,
  onDone,
}: {
  catalog: AutomationCatalog;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const events = catalog.events.filter((e) => e.confirmation);
  const [event, setEvent] = useState(events[0]?.code ?? '');
  const [clientId, setClientId] = useState('');
  const [recordId, setRecordId] = useState('');
  const [occurrence, setOccurrence] = useState('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const kind = events.find((e) => e.code === event)?.recordKind ?? '';
  const settings = useApiQuery([...AUTOMATIONS_KEY, 'settings'], () => api.automations.settings());
  const off = settings.data ? !settings.data.manualConfirmationEnabled : false;
  const clients = useApiQuery(['clients', 'confirm-event'], () => api.clients.list({ limit: 100 }));
  const records = useApiQuery(
    [...AUTOMATIONS_KEY, 'confirm-records', kind, clientId],
    async (): Promise<Choice[]> => {
      if (kind === 'payroll_run') {
        const page = await api.payroll.runs({});
        return page.items.map((r) => ({
          id: r.id,
          label: `${r.clientName} · ${r.periodStart} to ${r.periodEnd}`,
          occurrence: r.periodEnd,
        }));
      }
      if (!clientId) return [];
      if (kind === 'tax_return') {
        const rows = await api.taxReturns.listForClient(clientId);
        return rows.map((r) => ({
          id: r.id,
          label: `${r.taxYear} ${r.formType ?? 'return'}`,
          occurrence: String(r.taxYear),
        }));
      }
      if (kind === 'deadline') {
        const page = await api.compliance.deadlines({ clientId });
        return page.items.map((d) => ({
          id: d.id,
          label: `${d.name} · due ${d.dueOn}`,
          occurrence: d.dueOn,
        }));
      }
      return [];
    },
  );
  const pick = (id: string) => {
    setRecordId(id);
    setOccurrence(records.data?.find((r) => r.id === id)?.occurrence ?? '');
  };
  const confirm = useApiMutation(
    () =>
      api.automations.confirmEvent({
        event,
        recordId,
        occurrence,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    { invalidate: [...AUTOMATIONS_KEY] },
  );
  const ready = !off && event && recordId && occurrence.trim() && !confirm.isPending;

  return (
    <Modal
      open
      title="Confirm an External Event"
      subtitle="Record one outcome you know, for one record."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!ready}
            onClick={() =>
              confirm.mutate(undefined, { onSuccess: () => onDone('Outcome confirmed.') })
            }
          >
            {confirm.isPending ? 'Confirming…' : 'Confirm'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="confirm-event">
        <p className="text-sm text-text">
          This records a fact you know, once per occurrence; it can&apos;t be changed afterwards. It
          never files, submits, charges or changes the record. Rules waiting for this outcome then
          run.
        </p>
        {off ? (
          <p role="alert" className="text-sm text-danger">
            Manual Event Confirmation is off. An Owner or Admin turns it on in Automation Settings.
          </p>
        ) : null}
        <Select
          label="Outcome *"
          value={event}
          onChange={(e) => {
            setEvent(e.target.value);
            setRecordId('');
            setOccurrence('');
          }}
          options={events.map((e) => ({ value: e.code, label: e.label }))}
        />
        {kind !== 'payroll_run' ? (
          <Select
            label="Client *"
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value);
              setRecordId('');
              setOccurrence('');
            }}
            options={[
              { value: '', label: 'Choose a client' },
              ...(clients.data?.items ?? []).map((c) => ({ value: c.id, label: c.displayName })),
            ]}
          />
        ) : null}
        <Select
          label="Record *"
          value={recordId}
          onChange={(e) => pick(e.target.value)}
          options={[
            {
              value: '',
              label: records.isPending
                ? 'Loading…'
                : (records.data?.length ?? 0) === 0
                  ? 'No records to choose'
                  : 'Choose a record',
            },
            ...(records.data ?? []).map((r) => ({ value: r.id, label: r.label })),
          ]}
        />
        <div>
          <Input
            label="Occurrence *"
            value={occurrence}
            maxLength={60}
            onChange={(e) => setOccurrence(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">The year, period or date this outcome is for.</p>
        </div>
        <div>
          <Input
            label="Reference"
            value={reference}
            maxLength={200}
            onChange={(e) => setReference(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">
            An acknowledgment or confirmation number; never a password.
          </p>
        </div>
        <Input
          label="Note"
          value={note}
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
        {confirm.error ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(confirm.error, AUTOMATION_ERRORS)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
