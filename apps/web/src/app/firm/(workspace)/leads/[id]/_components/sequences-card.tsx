'use client';

import {
  type ApplyLeadSequenceRequest,
  LEAD_STEP_MODE_LABELS,
  type LeadSequenceTemplate,
  previewSequence,
} from '@firmivra/types';
import { Badge, Button, Input, Modal, Select } from '@firmivra/ui';
import { ListNumbers } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useMe } from '../../../../../../components/signed-in';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { LEAD_PIPELINE_KEY } from '../../_components/lead-shared';
import {
  SEQUENCES_KEY,
  STEP_ACTIONS,
} from '../../../templates/lead-sequences/_components/lead-sequences-screen';
import { CardFrame } from './profile-cards';
import { useProfile } from './profile-frame';
import { useFirmTimeZone } from '../../../intake-forms/_components/expiry';
import { localParts, todayIn, toInstant } from '../../../calendar/_components/time';
import { profileKey, stamp, zoneName } from './profile-shared';

type Steps = ApplyLeadSequenceRequest['steps'];
type Step = Steps[number];

/**
 * "2026-11-20T09:00" in the firm's time zone from an ISO time, for a datetime-local field (Leads
 * time zone, DECISIONS Nov 16), and back.
 */
function localInput(iso: string, timeZone: string) {
  const { date, time } = localParts(iso, timeZone);
  return `${date}T${time}`;
}
const fromLocalInput = (value: string, timeZone: string) => {
  const [date = '', time = ''] = value.split('T');
  return toInstant(date, time.slice(0, 5), timeZone);
};

/**
 * Follow-up Sequences on the lead's Tasks tab (Leads R2 19): the sequences applied to the lead,
 * each stopped by hand or by conversion, Not Qualified or Lost, and Apply Sequence, which shows
 * the template's steps with their dates and owners to edit or drop before they become the lead's
 * follow-up steps. Nothing is sent: an outreach step reminds its owner to send the message.
 */
export function SequencesCard() {
  // Leads time zone (DECISIONS, Nov 16): times in the firm's zone, labelled with it.
  const timeZone = useFirmTimeZone();
  const { id, profile } = useProfile();
  const queryClient = useQueryClient();
  const [applying, setApplying] = useState(false);
  const closed = profile ? ['CONVERTED', 'DECLINED', 'LOST'].includes(profile.stage) : true;
  const stop = useApiMutation((runId: string) => api.leadSequences.stop(id, runId));
  const runs = profile?.sequences ?? [];
  return (
    <CardFrame
      icon={ListNumbers}
      title="Follow-up Sequences"
      testId="card-sequences"
      action={
        closed ? null : (
          <Button variant="ghost" onClick={() => setApplying(true)} data-testid="sequence-apply">
            Apply Sequence
          </Button>
        )
      }
    >
      {runs.length === 0 ? (
        <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">
          No sequence applied to this lead.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-divider" data-testid="sequence-runs">
          {runs.map((run) => (
            <li
              key={run.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <span className="min-w-0">
                <span className="font-semibold text-heading">{run.name}</span>{' '}
                <span className="text-muted">applied {stamp(run.appliedAt, timeZone)}</span>
              </span>
              {run.stoppedAt ? (
                <Badge tone="neutral">Stopped{run.stopReason ? `: ${run.stopReason}` : ''}</Badge>
              ) : (
                <span className="flex items-center gap-2">
                  <Badge tone="success">Running</Badge>
                  <Button
                    variant="ghost"
                    disabled={stop.isPending}
                    onClick={() =>
                      stop.mutate(run.id, {
                        onSuccess: (saved) => queryClient.setQueryData(profileKey(id), saved),
                      })
                    }
                  >
                    Stop<span className="sr-only"> {run.name}</span>
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {stop.isError ? (
        <p role="alert" className="mt-2 text-sm text-danger">
          {errorMessage(stop.error)}
        </p>
      ) : null}
      {applying && profile && timeZone ? (
        <ApplyDialog
          timeZone={timeZone}
          leadId={id}
          ownerId={profile.assignedTo?.userId ?? null}
          onClose={() => setApplying(false)}
          onApplied={async (saved) => {
            queryClient.setQueryData(profileKey(id), saved);
            await queryClient.invalidateQueries({ queryKey: LEAD_PIPELINE_KEY });
            setApplying(false);
          }}
        />
      ) : null}
    </CardFrame>
  );
}

function ApplyDialog({
  leadId,
  ownerId,
  onClose,
  onApplied,
  timeZone,
}: {
  timeZone: string;
  leadId: string;
  ownerId: string | null;
  onClose: () => void;
  onApplied: (saved: Awaited<ReturnType<typeof api.leadSequences.apply>>) => void;
}) {
  const { me } = useMe();
  const templates = useApiQuery(SEQUENCES_KEY, () => api.leadSequences.list());
  const [templateId, setTemplateId] = useState('');
  const [startOn, setStartOn] = useState(() => todayIn(timeZone));
  const [steps, setSteps] = useState<Steps>([]);
  const apply = useApiMutation(() => api.leadSequences.apply(leadId, { templateId, steps }));
  const choose = (template: LeadSequenceTemplate | undefined, start = startOn) => {
    setTemplateId(template?.id ?? '');
    setSteps(
      template
        ? previewSequence(template, {
            startOn: start,
            leadOwnerId: ownerId,
            applierId: me.user.id,
            timeZone,
          })
        : [],
    );
  };
  const list = templates.data ?? [];
  const patch = (i: number, next: Partial<Step>) =>
    setSteps((all) => all.map((s, j) => (j === i ? { ...s, ...next } : s)));
  return (
    <Modal
      open
      title="Apply a Follow-up Sequence"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!templateId || !steps.length || apply.isPending}
            onClick={() => apply.mutate(undefined, { onSuccess: onApplied })}
            data-testid="sequence-apply-confirm"
          >
            Apply Sequence
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Sequence"
            options={[
              { value: '', label: 'Choose a sequence' },
              ...list.map((t) => ({ value: t.id, label: t.name })),
            ]}
            value={templateId}
            onChange={(e) => choose(list.find((t) => t.id === e.target.value))}
          />
          <Input
            label="Starting"
            type="date"
            value={startOn}
            onChange={(e) => {
              setStartOn(e.target.value);
              choose(
                list.find((t) => t.id === templateId),
                e.target.value,
              );
            }}
          />
        </div>
        {steps.length ? (
          <ol
            className="flex flex-col gap-2"
            aria-label="Steps to add"
            data-testid="sequence-preview"
          >
            {steps.map((s, i) => (
              <li
                key={i}
                className="grid gap-2 rounded-control border border-border p-2 sm:grid-cols-[1fr_1fr_auto]"
              >
                <span className="text-sm">
                  <span className="font-semibold text-heading">
                    {STEP_ACTIONS.find((a) => a.value === s.actionType)?.label ?? s.actionType}
                  </span>{' '}
                  <Badge tone={s.mode === 'OUTREACH' ? 'warning' : 'info'}>
                    {LEAD_STEP_MODE_LABELS[s.mode]}
                  </Badge>
                </span>
                <Input
                  label={`Step ${i + 1} date and time (${zoneName(timeZone)})`}
                  type="datetime-local"
                  value={localInput(s.dueAt, timeZone)}
                  onChange={(e) =>
                    e.target.value && patch(i, { dueAt: fromLocalInput(e.target.value, timeZone) })
                  }
                />
                <Button
                  variant="ghost"
                  aria-label={`Leave out step ${i + 1}`}
                  onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}
                >
                  Leave out
                </Button>
              </li>
            ))}
          </ol>
        ) : null}
        <p className="text-xs text-muted">
          The steps become this lead&apos;s follow-ups. Nothing is sent: an outreach step reminds
          its owner to send the message.
        </p>
        {apply.isError ? (
          <p role="alert" className="text-sm text-danger">
            {errorMessage(apply.error)}
          </p>
        ) : null}
      </div>
    </Modal>
  );
}
