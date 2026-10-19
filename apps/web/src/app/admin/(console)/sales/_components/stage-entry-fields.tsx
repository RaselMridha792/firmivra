'use client';

import { Input, Select, Textarea } from '@firmivra/ui';
import {
  APPOINTMENT_TYPES,
  LOST_REASONS,
  TRANSACTION_BY_REFERENCE,
  type AppointmentType,
  type LostReason,
  type PipelineStage,
  type SalesRep,
  type StageEntryInput,
} from './sales-api';

/** What a stage may require on entry, as the form holds it. */
export interface EntryState {
  lostReason: LostReason | '';
  lostNote: string;
  transactionReference: string;
  appointmentType: AppointmentType;
  appointmentDate: string;
  appointmentTime: string;
  appointmentAssignedId: string;
}

export const EMPTY_ENTRY: EntryState = {
  lostReason: '',
  lostNote: '',
  transactionReference: '',
  appointmentType: 'DEMO',
  appointmentDate: '',
  appointmentTime: '10:00',
  appointmentAssignedId: '',
};

/** Only what the target stage asks for goes to the API. */
export function entryInput(state: EntryState, stage: PipelineStage | undefined): StageEntryInput {
  const requires = stage?.requires ?? [];
  return {
    ...(requires.includes('LOST_REASON')
      ? { lostReason: state.lostReason || null, lostNote: state.lostNote }
      : {}),
    ...(requires.includes('TRANSACTION') && TRANSACTION_BY_REFERENCE
      ? { transactionReference: state.transactionReference }
      : {}),
    ...(requires.includes('APPOINTMENT') && state.appointmentDate
      ? {
          appointment: {
            type: state.appointmentType,
            date: state.appointmentDate,
            time: state.appointmentTime,
            assignedId: state.appointmentAssignedId || null,
          },
        }
      : {}),
  };
}

/**
 * True when the stage needs something this record does not have yet. On the API a transaction is
 * linked on the record page, never typed in here: the move goes ahead and the API's answer shows.
 */
export function needsEntryData(
  stage: PipelineStage,
  record: { hasAppointment: boolean; hasTransaction: boolean },
) {
  return (
    stage.requires.includes('LOST_REASON') ||
    (TRANSACTION_BY_REFERENCE &&
      stage.requires.includes('TRANSACTION') &&
      !record.hasTransaction) ||
    (stage.requires.includes('APPOINTMENT') && !record.hasAppointment)
  );
}

/**
 * The fields a stage requires before a record enters it (docx §12): a lost reason and note, the
 * linked transaction, or the appointment that was set.
 */
export function StageEntryFields({
  stage,
  value,
  onChange,
  errors,
  reps,
  hasAppointment = false,
  hasTransaction = false,
}: {
  stage: PipelineStage | undefined;
  value: EntryState;
  onChange: (next: EntryState) => void;
  errors: Record<string, string>;
  reps: SalesRep[];
  hasAppointment?: boolean;
  hasTransaction?: boolean;
}) {
  if (!stage) return null;
  const set = <K extends keyof EntryState>(key: K, next: EntryState[K]) =>
    onChange({ ...value, [key]: next });
  const lost = stage.requires.includes('LOST_REASON');
  const transaction =
    TRANSACTION_BY_REFERENCE && stage.requires.includes('TRANSACTION') && !hasTransaction;
  const appointment = stage.requires.includes('APPOINTMENT') && !hasAppointment;
  if (!lost && !transaction && !appointment) return null;
  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border border-divider bg-subtle p-3">
      <legend className="px-1 text-sm font-semibold text-heading">
        {stage.name} needs a few details
      </legend>
      {lost ? (
        <>
          <Select
            label="Lost reason"
            required
            value={value.lostReason}
            error={errors['lostReason']}
            onChange={(event) => {
              const reason = LOST_REASONS.find((item) => item.id === event.target.value);
              set('lostReason', reason?.id ?? '');
            }}
            options={[
              { value: '', label: 'Choose a reason' },
              ...LOST_REASONS.map((reason) => ({ value: reason.id, label: reason.label })),
            ]}
          />
          <Textarea
            label={value.lostReason === 'OTHER' ? 'Explain the reason' : 'Note (optional)'}
            rows={2}
            maxLength={500}
            value={value.lostNote}
            error={errors['lostNote']}
            onChange={(event) => set('lostNote', event.target.value)}
          />
        </>
      ) : null}
      {transaction ? (
        <>
          <Input
            label="Transaction reference"
            required
            placeholder="TX-2026-0142"
            maxLength={30}
            value={value.transactionReference}
            error={errors['transactionReference']}
            onChange={(event) => set('transactionReference', event.target.value)}
          />
          <p className="text-xs text-muted">
            From here the linked transaction keeps the stage in sync: no double entry.
          </p>
        </>
      ) : null}
      {appointment ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Appointment type"
            value={value.appointmentType}
            error={errors['appointmentType']}
            onChange={(event) => {
              const type = APPOINTMENT_TYPES.find((item) => item.id === event.target.value);
              if (type) set('appointmentType', type.id);
            }}
            options={APPOINTMENT_TYPES.map((type) => ({ value: type.id, label: type.label }))}
          />
          <Select
            label="With"
            value={value.appointmentAssignedId}
            error={errors['appointmentAssignedId']}
            onChange={(event) => set('appointmentAssignedId', event.target.value)}
            options={[
              { value: '', label: 'The record owner' },
              ...reps.map((rep) => ({ value: rep.id, label: rep.name })),
            ]}
          />
          <Input
            label="Date"
            type="date"
            required
            value={value.appointmentDate}
            error={errors['appointmentDate']}
            onChange={(event) => set('appointmentDate', event.target.value)}
          />
          <Input
            label="Time"
            type="time"
            required
            value={value.appointmentTime}
            error={errors['appointmentTime']}
            onChange={(event) => set('appointmentTime', event.target.value)}
          />
        </div>
      ) : null}
    </fieldset>
  );
}
