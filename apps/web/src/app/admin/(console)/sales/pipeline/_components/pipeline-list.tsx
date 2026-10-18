'use client';

import { Badge, BulkBar, Button, Modal, Select, Table, type Column } from '@firmivra/ui';
import { ArrowsClockwise, Tag, Users } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import {
  adminSales,
  fieldErrors,
  planName,
  sourceLabel,
  type PipelineStage,
  type SalesMeta,
  type SalesOpportunity,
  type StageEntryInput,
} from '../../../../../../mocks/admin-sales';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import {
  ATTENTION_TONE,
  attentionLabel,
  dateText,
  money,
  SALES_KEY,
  STAGE_STYLE,
} from '../../_components/sales-ui';
import {
  EMPTY_ENTRY,
  entryInput,
  StageEntryFields,
  type EntryState,
} from '../../_components/stage-entry-fields';

type Bulk = 'ASSIGN' | 'STAGE' | 'TAG';

const COLUMNS: Column<SalesOpportunity>[] = [
  {
    id: 'firm',
    label: 'Firm / Opportunity',
    sortValue: (row) => row.firmName.toLowerCase(),
    cell: (row) => (
      <Link
        href={`/sales/opportunities/${row.id}`}
        className="font-semibold text-heading hover:text-action hover:underline"
      >
        {row.firmName}
      </Link>
    ),
  },
  {
    id: 'contact',
    label: 'Contact',
    sortValue: (row) => row.contactName.toLowerCase(),
    cell: (row) => (
      <span className="flex flex-col">
        {row.contactName}
        {row.email ? <span className="text-muted">{row.email}</span> : null}
      </span>
    ),
  },
  {
    id: 'stage',
    label: 'Stage',
    sortValue: (row) => row.stageOrder,
    cell: (row) => <Badge tone={STAGE_STYLE[row.stageTone].badge}>{row.stageName}</Badge>,
  },
  {
    id: 'owner',
    label: 'Assigned To',
    sortValue: (row) => row.owner?.name ?? '~',
    cell: (row) => row.owner?.name ?? <span className="text-muted">Unassigned</span>,
  },
  {
    id: 'source',
    label: 'Source',
    sortValue: (row) => sourceLabel(row.source),
    cell: (row) => sourceLabel(row.source),
  },
  {
    id: 'plan',
    label: 'Plan',
    sortValue: (row) => (row.plan ? planName(row.plan) : '~'),
    cell: (row) => (row.plan ? planName(row.plan) : <span className="text-muted">—</span>),
  },
  {
    id: 'value',
    label: 'Value',
    sortValue: (row) => row.valueCents ?? -1,
    className: 'text-right',
    cell: (row) =>
      row.valueCents === null ? <span className="text-muted">—</span> : money(row.valueCents),
  },
  {
    id: 'activity',
    label: 'Last Activity',
    sortValue: (row) => Date.parse(row.lastActivityAt),
    cell: (row) => dateText(row.lastActivityAt),
  },
  {
    id: 'follow-up',
    label: 'Next Follow-Up',
    sortValue: (row) => (row.nextFollowUpAt ? Date.parse(row.nextFollowUpAt) : Number.MAX_VALUE),
    cell: (row) =>
      row.nextFollowUpAt ? dateText(row.nextFollowUpAt) : <span className="text-muted">—</span>,
  },
  {
    id: 'attention',
    label: 'Attention Status',
    sortValue: (row) => row.attention.length,
    cell: (row) =>
      row.attention.length ? (
        <span className="flex flex-wrap gap-1">
          {row.attention.map((flag) => (
            <Badge key={flag} tone={ATTENTION_TONE[flag]}>
              {attentionLabel(flag)}
            </Badge>
          ))}
        </span>
      ) : (
        <span className="text-muted">On track</span>
      ),
  },
  {
    id: 'created',
    label: 'Created Date',
    sortValue: (row) => Date.parse(row.createdAt),
    cell: (row) => dateText(row.createdAt),
  },
];

/**
 * List View (docx §8): the same records as the cards, sortable and paged, with row selection and
 * bulk assign, stage change and tagging. Each bulk action states how many records it changes.
 */
export function PipelineList({
  records,
  stages,
  meta,
  pipelineEmpty,
  onDone,
}: {
  records: SalesOpportunity[];
  stages: PipelineStage[];
  meta: SalesMeta | undefined;
  /** The pipeline has no records at all (not only none that match). */
  pipelineEmpty: boolean;
  onDone: (message: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(10);
  const [bulk, setBulk] = useState<Bulk | null>(null);
  // Only rows still shown count, so a filter change never acts on hidden records.
  const picked = selected.filter((id) => records.some((record) => record.id === id));
  const canBulk = meta?.permissions.bulkEdit ?? false;
  return (
    <div className="flex flex-col gap-3">
      {canBulk ? (
        <BulkBar
          count={picked.length}
          noun={picked.length === 1 ? 'opportunity' : 'opportunities'}
          actions={[
            { label: 'Assign', icon: Users, onClick: () => setBulk('ASSIGN') },
            { label: 'Change Stage', icon: ArrowsClockwise, onClick: () => setBulk('STAGE') },
            { label: 'Add Tag', icon: Tag, onClick: () => setBulk('TAG') },
          ]}
        />
      ) : null}
      <Table
        rows={records}
        columns={COLUMNS}
        rowKey={(row) => row.id}
        caption="Opportunities in this pipeline"
        noun="opportunities"
        dense
        pageSize={pageSize}
        pageSizes={[10, 25, 50]}
        onPageSize={setPageSize}
        selection={canBulk ? { selected: picked, onChange: setSelected } : undefined}
        emptyTitle={pipelineEmpty ? 'No opportunities yet' : 'No records match these filters'}
        emptyText={
          pipelineEmpty
            ? 'Use Add Lead to start the pipeline.'
            : 'Change or clear the filters to see more records.'
        }
      />
      {bulk ? (
        <BulkDialog
          kind={bulk}
          ids={picked}
          stages={stages}
          meta={meta}
          onClose={() => setBulk(null)}
          onDone={(message) => {
            setBulk(null);
            setSelected([]);
            onDone(message);
          }}
        />
      ) : null}
    </div>
  );
}

function BulkDialog({
  kind,
  ids,
  stages,
  meta,
  onClose,
  onDone,
}: {
  kind: Bulk;
  ids: string[];
  stages: PipelineStage[];
  meta: SalesMeta | undefined;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [ownerId, setOwnerId] = useState('');
  const [stageId, setStageId] = useState('');
  const [tagId, setTagId] = useState('');
  const [entry, setEntry] = useState<EntryState>(EMPTY_ENTRY);
  const stage = stages.find((item) => item.id === stageId);
  const count = `${ids.length} ${ids.length === 1 ? 'opportunity' : 'opportunities'}`;
  const run = useApiMutation(
    async (): Promise<string> => {
      if (kind === 'ASSIGN') {
        const result = await adminSales.assign({ ids, ownerId: ownerId || null });
        return `${result.updated} reassigned.`;
      }
      if (kind === 'STAGE') {
        const body: { ids: string[]; stageId: string } & StageEntryInput = {
          ids,
          stageId,
          ...entryInput(entry, stage),
        };
        const result = await adminSales.bulkStage(body);
        return `${result.updated} moved to ${stage?.name ?? 'the stage'}.`;
      }
      const result = await adminSales.bulkTag({ ids, tagId });
      return `${result.updated} tagged.`;
    },
    { invalidate: SALES_KEY },
  );
  const errors = fieldErrors(run.error);
  const general = run.error && !Object.keys(errors).length ? errorMessage(run.error) : null;
  const titles: Record<Bulk, string> = {
    ASSIGN: `Assign ${count}`,
    STAGE: `Move ${count}`,
    TAG: `Tag ${count}`,
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    run.mutate(undefined, { onSuccess: onDone });
  }

  return (
    <Modal
      open
      title={titles[kind]}
      subtitle="Every change is recorded in each record's history."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="sales-bulk" disabled={run.isPending || !ids.length}>
            {run.isPending ? 'Saving…' : `Apply to ${count}`}
          </Button>
        </>
      }
    >
      <form id="sales-bulk" noValidate onSubmit={submit} className="flex flex-col gap-3">
        {kind === 'ASSIGN' ? (
          <Select
            label="Assign to"
            value={ownerId}
            error={errors['ownerId']}
            onChange={(event) => setOwnerId(event.target.value)}
            options={[
              { value: '', label: 'Unassigned' },
              ...(meta?.reps ?? []).map((rep) => ({ value: rep.id, label: rep.name })),
            ]}
          />
        ) : null}
        {kind === 'STAGE' ? (
          <>
            <Select
              label="Move to"
              value={stageId}
              error={errors['stageId']}
              onChange={(event) => setStageId(event.target.value)}
              options={[
                { value: '', label: 'Choose a stage' },
                ...stages
                  .filter((item) => !item.requires.includes('APPOINTMENT'))
                  .map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
            <p className="text-xs text-muted">
              Stages that need an appointment are moved one record at a time.
            </p>
            <StageEntryFields
              stage={stage}
              value={entry}
              onChange={setEntry}
              errors={errors}
              reps={meta?.reps ?? []}
            />
          </>
        ) : null}
        {kind === 'TAG' ? (
          <Select
            label="Tag"
            value={tagId}
            error={errors['tagId']}
            onChange={(event) => setTagId(event.target.value)}
            options={[
              { value: '', label: 'Choose a tag' },
              ...(meta?.tags ?? []).map((tag) => ({ value: tag.id, label: tag.name })),
            ]}
          />
        ) : null}
        {errors['ids'] ? <p className="text-sm text-danger">{errors['ids']}</p> : null}
        {general ? (
          <p role="alert" className="text-sm text-danger">
            {general}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
