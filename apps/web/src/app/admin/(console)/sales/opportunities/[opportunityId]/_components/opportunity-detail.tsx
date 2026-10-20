'use client';

import { ApiRequestError } from '@firmivra/types';
import { Badge, Button, Card, PageHeader, Toast } from '@firmivra/ui';
import {
  Buildings,
  CalendarDots,
  ChatCircleText,
  Clock,
  ClockCounterClockwise,
  CurrencyDollar,
  FolderOpen,
  LinkSimple,
  ListChecks,
  Note,
  Tag,
  UserSwitch,
  XCircle,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { MoveStageDialog } from '../../../_components/move-stage-dialog';
import { SalesActionDialog } from '../../../_components/sales-action-dialog';
import {
  adminSales,
  errorMessage,
  planName,
  sourceLabel,
  type OpportunityRecord,
  type PipelineStage,
} from '../../../_components/sales-api';
import {
  ATTENTION_TONE,
  attentionLabel,
  Crumbs,
  dateText,
  FrameState,
  moneyExact,
  Panel,
  SALES_KEY,
  SalesKpi,
  STAGE_STYLE,
  useSalesMeta,
} from '../../../_components/sales-ui';
import { needsEntryData } from '../../../_components/stage-entry-fields';
import {
  AppointmentsPanelBody,
  AssignmentPanelBody,
  CommunicationsPanelBody,
  DetailsForm,
  DocumentsPanelBody,
  NotesPanelBody,
  StageAndHistory,
  TasksPanelBody,
  TransactionPanelBody,
  valueText,
} from './opportunity-panels';

const notFound = (error: unknown) => error instanceof ApiRequestError && error.code === 'NOT_FOUND';

/**
 * One lead or opportunity (docx §22, no frame): its core data, stage and history, notes,
 * communications, follow-ups, appointments, linked transaction and documents, from the same
 * record the board and the list show. Every panel keeps its frame while loading or unreachable.
 */
export function OpportunityDetail({ opportunityId }: { opportunityId: string }) {
  const meta = useSalesMeta();
  const record = useApiQuery([...SALES_KEY, 'opportunity', opportunityId], () =>
    adminSales.opportunity(opportunityId),
  );
  const [moving, setMoving] = useState<PipelineStage | null>(null);
  const [scheduling, setScheduling] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const move = useApiMutation(
    (body: { id: string; stageId: string }) => adminSales.moveStage(body),
    { invalidate: SALES_KEY },
  );
  const data = record.data;
  const opp = data?.opportunity;
  const lostStage = data?.pipeline.stages.find((stage) => stage.type === 'LOST' && stage.active);
  const open = opp
    ? opp.stageType === 'ACTIVE' || opp.stageType === 'CONVERTED' || opp.stageType === 'TRANSACTION'
    : false;

  function requestMove(stage: PipelineStage) {
    if (!opp) return;
    if (
      needsEntryData(stage, {
        hasAppointment: Boolean(opp.nextAppointment),
        hasTransaction: Boolean(opp.transaction),
      })
    ) {
      setMoving(stage);
      return;
    }
    move.mutate(
      { id: opp.id, stageId: stage.id },
      {
        onSuccess: (moved) =>
          setToast({ message: `Moved to ${moved.stageName}.`, tone: 'success' }),
        onError: (error) => setToast({ message: errorMessage(error), tone: 'error' }),
      },
    );
  }

  const crumbs = (
    <Crumbs
      items={[
        { label: 'Dashboard', href: '/' },
        { label: 'Sales', href: '/sales' },
        { label: 'Pipeline', href: '/sales/pipeline' },
        { label: opp?.firmName ?? 'Opportunity' },
      ]}
    />
  );

  if (record.isError && notFound(record.error))
    return (
      <div className="flex flex-col gap-4">
        <PageHeader above={crumbs} title="Opportunity" />
        <Card data-testid="page-not-found">
          <p className="font-medium text-text">We couldn&apos;t find this record.</p>
          <p className="mt-1 text-sm text-muted">
            It may have been removed, or the link is wrong.{' '}
            <Link href="/sales/pipeline" className="font-medium text-action hover:underline">
              Back to the pipeline
            </Link>
          </p>
        </Card>
      </div>
    );

  const state = record.isPending ? 'loading' : record.isError && !data ? 'error' : 'ready';
  const body = (children: (loaded: OpportunityRecord) => ReactNode, lines = 4) => (
    <FrameState query={record} empty="" isEmpty={() => false} lines={lines}>
      {children}
    </FrameState>
  );

  return (
    <div data-testid="opportunity-detail" className="flex min-w-0 flex-col gap-4">
      <PageHeader
        above={crumbs}
        title={opp?.firmName ?? 'Opportunity'}
        subtitle={
          opp
            ? `${opp.contactName} · ${sourceLabel(opp.source)} · added ${dateText(opp.createdAt)}`
            : undefined
        }
        actions={
          <>
            <Link
              href="/sales/pipeline"
              className="inline-flex min-h-11 items-center rounded-control border border-border bg-surface px-4 text-sm font-medium text-text hover:bg-canvas"
            >
              Back to Pipeline
            </Link>
            {opp && open ? (
              <Button variant="secondary" onClick={() => setScheduling(true)}>
                <CalendarDots aria-hidden weight="fill" className="size-4" />
                Schedule Appointment
              </Button>
            ) : null}
            {opp && open && lostStage ? (
              <Button variant="secondary" onClick={() => setMoving(lostStage)}>
                <XCircle aria-hidden weight="fill" className="size-4 text-danger" />
                Mark {lostStage.name}
              </Button>
            ) : null}
          </>
        }
      />

      {opp ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="opportunity-badges">
          <Badge tone={STAGE_STYLE[opp.stageTone].badge}>{opp.stageName}</Badge>
          {opp.attention.map((flag) => (
            <Badge key={flag} tone={ATTENTION_TONE[flag]}>
              {attentionLabel(flag)}
            </Badge>
          ))}
          {opp.tags.map((tag) => (
            <Badge key={tag.id} tone="neutral" icon={Tag}>
              {tag.name}
            </Badge>
          ))}
          {opp.trialActive && opp.trialEndsAt ? (
            <Badge tone="warning">Trial until {dateText(opp.trialEndsAt)}</Badge>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />
      ) : null}

      <section
        aria-label="Record summary"
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      >
        <SalesKpi
          testId="summary-value"
          icon={CurrencyDollar}
          tone="green"
          label="Estimated value"
          state={state}
          value={valueText(opp?.valueCents ?? null)}
        />
        <SalesKpi
          icon={Tag}
          tone="purple"
          label="Plan"
          state={state}
          value={opp?.plan ? planName(opp.plan) : 'Not decided'}
          note={opp?.monthlyCents ? `${moneyExact(opp.monthlyCents)} a month` : undefined}
        />
        <SalesKpi
          icon={CalendarDots}
          tone="blue"
          label="Next follow-up"
          state={state}
          value={opp?.nextFollowUpAt ? dateText(opp.nextFollowUpAt) : 'None set'}
          note={opp?.nextStep ?? undefined}
        />
        <SalesKpi
          icon={Clock}
          tone="orange"
          label="In this stage since"
          state={state}
          value={opp ? dateText(opp.stageEnteredAt) : '—'}
        />
      </section>

      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-12 xl:items-start">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-8">
          <Panel icon={Buildings} title="Opportunity Details" testId="opportunity-details">
            {body(
              (loaded) => (
                <DetailsForm key={loaded.opportunity.id} data={loaded} meta={meta.data} />
              ),
              6,
            )}
          </Panel>
          <Panel icon={ClockCounterClockwise} title="Stage & History" testId="stage-history">
            {body(
              (loaded) => (
                <StageAndHistory data={loaded} onMove={requestMove} moving={move.isPending} />
              ),
              6,
            )}
          </Panel>
          <Panel icon={ChatCircleText} title="Communications" testId="communications">
            {body((loaded) => (
              <CommunicationsPanelBody data={loaded} />
            ))}
          </Panel>
          <Panel icon={Note} title="Notes" testId="notes">
            {body((loaded) => (
              <NotesPanelBody data={loaded} />
            ))}
          </Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-4">
          <Panel icon={UserSwitch} title="Assignment" testId="assignment">
            {body(
              (loaded) => (
                <AssignmentPanelBody
                  key={loaded.opportunity.owner?.id ?? 'none'}
                  data={loaded}
                  meta={meta.data}
                />
              ),
              2,
            )}
          </Panel>
          <Panel icon={LinkSimple} title="Linked Transaction" testId="linked-transaction">
            {body(
              (loaded) => (
                <TransactionPanelBody data={loaded} />
              ),
              3,
            )}
          </Panel>
          <Panel icon={ListChecks} title="Tasks & Follow-ups" testId="follow-ups">
            {body((loaded) => (
              <TasksPanelBody data={loaded} />
            ))}
          </Panel>
          <Panel
            icon={CalendarDots}
            title="Appointments"
            testId="appointments"
            action={
              opp && open ? (
                <button
                  type="button"
                  onClick={() => setScheduling(true)}
                  className="text-sm font-medium text-action hover:underline"
                >
                  Schedule
                </button>
              ) : undefined
            }
          >
            {body(
              (loaded) => (
                <AppointmentsPanelBody data={loaded} />
              ),
              3,
            )}
          </Panel>
          <Panel icon={FolderOpen} title="Documents" testId="documents">
            {body(
              (loaded) => (
                <DocumentsPanelBody data={loaded} />
              ),
              2,
            )}
          </Panel>
        </div>
      </div>

      {moving && opp ? (
        <MoveStageDialog
          opportunity={opp}
          stage={moving}
          reps={meta.data?.reps ?? []}
          onClose={() => setMoving(null)}
          onMoved={(moved) =>
            setToast({ message: `Moved to ${moved.stageName}.`, tone: 'success' })
          }
        />
      ) : null}
      {scheduling && opp ? (
        <SalesActionDialog
          action="APPOINTMENT"
          opportunityId={opp.id}
          onClose={() => setScheduling(false)}
          onDone={(message) => {
            setScheduling(false);
            setToast({ message, tone: 'success' });
          }}
        />
      ) : null}
    </div>
  );
}
