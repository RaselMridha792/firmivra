'use client';

import { Avatar, Badge, Skeleton } from '@firmivra/ui';
import { ArrowsClockwise, CalendarDots, Plus, WarningCircle } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type DragEvent } from 'react';
import {
  lostReasonLabel,
  type PipelineStage,
  type SalesOpportunity,
} from '../../../../../../mocks/admin-sales';
import {
  ATTENTION_TONE,
  attentionLabel,
  dateText,
  money,
  STAGE_STYLE,
} from '../../_components/sales-ui';

/** The line at the bottom of a card: the date that matters in this stage. */
function dateLine(opp: SalesOpportunity, stage: PipelineStage) {
  if (opp.stageType === 'CONVERTED')
    return `Since ${dateText(opp.convertedAt ?? opp.stageEnteredAt)}`;
  if (opp.stageType === 'TRANSACTION')
    return opp.transaction?.estimatedCloseAt
      ? `Est. Close: ${dateText(opp.transaction.estimatedCloseAt)}`
      : `Since ${dateText(opp.stageEnteredAt)}`;
  if (opp.stageType === 'CLOSED') return `Closed: ${dateText(opp.closedAt ?? opp.stageEnteredAt)}`;
  if (opp.stageType === 'LOST') return dateText(opp.lostAt ?? opp.stageEnteredAt);
  if (stage.requires.includes('APPOINTMENT') && opp.nextAppointment) return null;
  return dateText(opp.lastActivityAt);
}

/** One compact marker per card (docx §11): attention first, then what the stage cares about. */
function CardMarker({ opp, stage }: { opp: SalesOpportunity; stage: PipelineStage }) {
  const flag = opp.attention[0];
  if (flag) {
    const tone = ATTENTION_TONE[flag];
    return (
      <Badge tone={tone} icon={tone === 'danger' ? WarningCircle : undefined}>
        {attentionLabel(flag)}
      </Badge>
    );
  }
  if ((opp.stageType === 'TRANSACTION' || opp.stageType === 'CLOSED') && opp.transaction)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-text">
        <ArrowsClockwise aria-hidden weight="bold" className="size-4 text-success" />
        Synced to Transactions
      </span>
    );
  if (opp.stageType === 'LOST' && opp.lostReason)
    return <Badge tone="danger">{lostReasonLabel(opp.lostReason)}</Badge>;
  if (stage.requires.includes('APPOINTMENT') && opp.nextAppointment)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <CalendarDots aria-hidden weight="fill" className="size-4 text-danger" />
        <time dateTime={opp.nextAppointment.startsAt}>
          {dateText(opp.nextAppointment.startsAt)}
        </time>
      </span>
    );
  if (opp.stageType === 'ACTIVE' && opp.attempts > 0 && !opp.contactedAt)
    return (
      <Badge tone={opp.attempts === 1 ? 'warning' : 'neutral'}>
        {opp.attempts} {opp.attempts === 1 ? 'attempt' : 'attempts'}
      </Badge>
    );
  if ((opp.stageType === 'ACTIVE' && opp.stageOrder >= 3) || opp.stageType === 'CONVERTED')
    return <Badge tone={STAGE_STYLE[stage.tone].badge}>{stage.name}</Badge>;
  return null;
}

function OpportunityCard({
  opp,
  stage,
  draggable,
}: {
  opp: SalesOpportunity;
  stage: PipelineStage;
  draggable: boolean;
}) {
  const line = dateLine(opp, stage);
  return (
    <li
      data-testid="pipeline-card"
      draggable={draggable}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/plain', opp.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      className={`flex flex-col gap-1 rounded-lg border border-divider bg-surface p-2.5 shadow-sm ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <Link
        href={`/sales/opportunities/${opp.id}`}
        draggable={false}
        className="text-sm leading-snug font-semibold text-heading hover:text-action hover:underline"
      >
        {opp.firmName}
      </Link>
      <span className="truncate text-xs text-muted">{opp.contactName}</span>
      <span className="text-sm font-semibold text-heading">
        {opp.valueCents === null ? (
          <span className="font-normal text-muted">No value yet</span>
        ) : (
          money(opp.valueCents)
        )}
      </span>
      <span className="min-h-6">
        <CardMarker opp={opp} stage={stage} />
      </span>
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs text-muted">{line}</span>
        {opp.owner ? (
          <span title={opp.owner.name} className="shrink-0">
            <Avatar name={opp.owner.name} size="sm" />
          </span>
        ) : (
          <span
            role="img"
            aria-label="Unassigned"
            title="Unassigned"
            className="size-6 shrink-0 rounded-full border border-dashed border-control-border"
          />
        )}
      </span>
    </li>
  );
}

/**
 * Card View (docx §7): one column per stage, readable width, sideways scroll for the rest. Cards
 * move by drag and drop; a stage that needs data asks for it before the move completes.
 */
export function PipelineBoard({
  stages,
  records,
  canMove,
  onMove,
  onAdd,
}: {
  stages: PipelineStage[];
  records: SalesOpportunity[];
  canMove: boolean;
  onMove: (opp: SalesOpportunity, stage: PipelineStage) => void;
  onAdd: (stage: PipelineStage) => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  function drop(event: DragEvent, stage: PipelineStage) {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData('text/plain');
    const opp = records.find((record) => record.id === id);
    if (opp && opp.stageId !== stage.id) onMove(opp, stage);
  }
  return (
    <div
      role="region"
      aria-label="Pipeline board"
      tabIndex={0}
      className="relative max-w-full min-w-0 overflow-x-auto pb-2 contain-paint focus-visible:outline-2 focus-visible:outline-focus"
    >
      <ol className="flex min-w-max gap-2">
        {stages.map((stage, index) => {
          const style = STAGE_STYLE[stage.tone];
          const cards = records.filter((record) => record.stageId === stage.id);
          const total = cards.reduce((sum, record) => sum + (record.valueCents ?? 0), 0);
          return (
            <li
              key={stage.id}
              data-testid="pipeline-column"
              aria-label={`${stage.name}: ${cards.length} records`}
              onDragOver={(event) => {
                if (!canMove) return;
                event.preventDefault();
                setOver(stage.id);
              }}
              onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
              onDrop={(event) => drop(event, stage)}
              className={`flex w-44 shrink-0 flex-col overflow-hidden rounded-xl bg-subtle shadow-sm ${over === stage.id ? 'outline-2 outline-action' : ''}`}
            >
              <div className={`flex min-h-14 flex-col justify-center px-3 py-2 ${style.head}`}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm leading-tight font-semibold">{stage.name}</h3>
                  <span className="text-base leading-tight font-bold">{cards.length}</span>
                </div>
                <span className="text-xs opacity-80">{money(total)}</span>
              </div>
              <ul className="flex max-h-72 min-h-40 flex-col gap-2 overflow-y-auto p-2">
                {cards.length ? (
                  cards.map((opp) => (
                    <OpportunityCard key={opp.id} opp={opp} stage={stage} draggable={canMove} />
                  ))
                ) : (
                  <li className="px-1 py-4 text-center text-xs text-muted">No records here yet.</li>
                )}
              </ul>
              <button
                type="button"
                onClick={() => onAdd(stage)}
                className={`mt-auto flex h-11 items-center justify-center gap-1.5 text-sm font-medium hover:underline ${style.foot} ${style.add}`}
              >
                <Plus aria-hidden weight="bold" className="size-4" />
                {index === 0 ? 'Add Lead' : 'Add'}
                <span className="sr-only"> to {stage.name}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The board's frame while the stages load. */
export function BoardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading the pipeline"
      className="relative flex min-w-0 gap-2 overflow-hidden contain-paint"
    >
      {['a', 'b', 'c', 'd', 'e', 'f'].map((key) => (
        <div key={key} className="flex w-44 shrink-0 flex-col gap-2 rounded-xl bg-subtle p-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ))}
    </div>
  );
}
