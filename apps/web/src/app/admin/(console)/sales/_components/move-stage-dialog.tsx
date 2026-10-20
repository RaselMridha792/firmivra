'use client';

import { Button, Modal } from '@firmivra/ui';
import { useState, type FormEvent } from 'react';
import { useApiMutation } from '../../../../../lib/query';
import {
  adminSales,
  errorMessage,
  fieldErrors,
  type PipelineStage,
  type SalesOpportunity,
  type SalesRep,
  type StageEntryInput,
} from './sales-api';
import { SALES_KEY } from './sales-ui';
import { EMPTY_ENTRY, entryInput, StageEntryFields, type EntryState } from './stage-entry-fields';

/**
 * Moving into a stage that needs data (a lost reason, a linked transaction, an appointment):
 * the move completes only once the data is given (docx §12 "Dependent Validation").
 */
export function MoveStageDialog({
  opportunity,
  stage,
  reps,
  onClose,
  onMoved,
}: {
  opportunity: Pick<
    SalesOpportunity,
    'id' | 'firmName' | 'stageName' | 'transaction' | 'nextAppointment'
  >;
  stage: PipelineStage;
  reps: SalesRep[];
  onClose: () => void;
  onMoved?: (moved: SalesOpportunity) => void;
}) {
  const [entry, setEntry] = useState<EntryState>(EMPTY_ENTRY);
  const move = useApiMutation(
    (body: { id: string; stageId: string } & StageEntryInput) => adminSales.moveStage(body),
    { invalidate: SALES_KEY },
  );
  const errors = fieldErrors(move.error);
  const general = move.error && !Object.keys(errors).length ? errorMessage(move.error) : null;

  function submit(event: FormEvent) {
    event.preventDefault();
    move.mutate(
      { id: opportunity.id, stageId: stage.id, ...entryInput(entry, stage) },
      {
        onSuccess: (moved) => {
          onMoved?.(moved);
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      open
      title={`Move to ${stage.name}`}
      subtitle={`${opportunity.firmName}: ${opportunity.stageName} → ${stage.name}. The earlier stages stay in its history.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="sales-move-stage" disabled={move.isPending}>
            {move.isPending ? 'Moving…' : `Move to ${stage.name}`}
          </Button>
        </>
      }
    >
      <form id="sales-move-stage" noValidate onSubmit={submit} className="flex flex-col gap-3">
        <StageEntryFields
          stage={stage}
          value={entry}
          onChange={setEntry}
          errors={errors}
          reps={reps}
          hasAppointment={Boolean(opportunity.nextAppointment)}
          hasTransaction={Boolean(opportunity.transaction)}
        />
        {errors['stageId'] ? <p className="text-sm text-danger">{errors['stageId']}</p> : null}
        {general ? (
          <p role="alert" className="text-sm text-danger">
            {general}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
