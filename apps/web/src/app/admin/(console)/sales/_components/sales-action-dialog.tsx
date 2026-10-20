'use client';

import { Button, Input, Modal, Select } from '@firmivra/ui';
import { useState, type FormEvent } from 'react';
import { useApiMutation, useApiQuery } from '../../../../../lib/query';
import {
  adminSales,
  APPOINTMENT_TYPES,
  errorMessage,
  fieldErrors,
  maxExtraUsers,
  monthlyCents,
  planName,
  type AppointmentType,
  type PlanId,
} from './sales-api';
import { FrameError, money, moneyExact, parseMoney, SALES_KEY, useSalesMeta } from './sales-ui';

/** A check the form makes before calling the API. */
class LocalError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? 'Check the form.');
  }
}

export type SalesAction = 'TRIAL' | 'DEMO' | 'APPOINTMENT' | 'PROPOSAL' | 'ASSIGN';

const TITLES: Record<SalesAction, { title: string; subtitle: string; submit: string }> = {
  TRIAL: {
    title: 'Start 14-Day Trial',
    subtitle: 'The firm gets the plan for 14 days; the trial shows on its record.',
    submit: 'Start Trial',
  },
  DEMO: {
    title: 'Schedule a Demo',
    subtitle: 'Book a demo; a record before Appointment Set moves there.',
    submit: 'Schedule Demo',
  },
  APPOINTMENT: {
    title: 'Schedule Appointment',
    subtitle: 'Book a meeting with this firm.',
    submit: 'Schedule',
  },
  PROPOSAL: {
    title: 'Create Offer / Proposal',
    subtitle: 'Set the plan and the estimated value on the record.',
    submit: 'Create Proposal',
  },
  ASSIGN: {
    title: 'Assign Sales Rep',
    subtitle: 'The previous owner and the change stay in the record history.',
    submit: 'Assign',
  },
};

/**
 * The Sales Center's quick actions (and the record page's scheduling): one small form per
 * action, on the page, no route. `opportunityId` fixes the record; otherwise the user picks one.
 */
export function SalesActionDialog({
  action,
  plan: initialPlan,
  opportunityId: fixedId,
  onClose,
  onDone,
}: {
  action: SalesAction;
  plan?: PlanId;
  opportunityId?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const meta = useSalesMeta();
  const open = useApiQuery([...SALES_KEY, 'opportunities', { scope: 'OPEN' }], () =>
    adminSales.opportunities({ scope: 'OPEN' }),
  );
  const [opportunityId, setOpportunityId] = useState(fixedId ?? '');
  const [plan, setPlan] = useState<PlanId | ''>(initialPlan ?? '');
  const [extraUsers, setExtraUsers] = useState('0');
  const [value, setValue] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [type, setType] = useState<AppointmentType>('DEMO');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('10:00');
  const [withId, setWithId] = useState('');
  const run = useApiMutation(
    async (): Promise<string> => {
      const firm = open.data?.find((item) => item.id === opportunityId)?.firmName ?? 'the firm';
      if (!opportunityId) throw new LocalError({ opportunityId: 'Choose a firm.' });
      if (action === 'TRIAL') {
        await adminSales.startTrial({ opportunityId, plan });
        return `A 14-day trial started for ${firm}.`;
      }
      if (action === 'DEMO' || action === 'APPOINTMENT') {
        await adminSales.scheduleAppointment({
          opportunityId,
          type: action === 'DEMO' ? 'DEMO' : type,
          date,
          time,
          assignedId: withId || null,
        });
        return `Booked with ${firm}.`;
      }
      if (action === 'PROPOSAL') {
        const valueCents = parseMoney(value);
        if (Number.isNaN(valueCents))
          throw new LocalError({ valueCents: 'Enter an amount like 2,400 or 2400.00.' });
        await adminSales.sendProposal({
          opportunityId,
          plan,
          extraUsers: Number(extraUsers) || 0,
          valueCents,
        });
        return `The plan and value were saved for ${firm}.`;
      }
      await adminSales.assign({ ids: [opportunityId], ownerId: ownerId || null });
      return `${firm} was assigned.`;
    },
    { invalidate: SALES_KEY },
  );
  const errors = {
    ...fieldErrors(run.error),
    ...(run.error instanceof LocalError ? run.error.fields : {}),
  };
  const general = run.error && !Object.keys(errors).length ? errorMessage(run.error) : null;
  const text = TITLES[action];
  const reps = meta.data?.reps ?? [];
  const plans = (meta.data?.plans ?? []).filter(
    (item) => action !== 'TRIAL' || item.id !== 'ENTERPRISE',
  );
  const extraLimit = plan ? maxExtraUsers(plan) : 0;
  const failed = (open.isError && !open.data) || (meta.isError && !meta.data);

  function submit(event: FormEvent) {
    event.preventDefault();
    run.mutate(undefined, { onSuccess: (message) => onDone(message) });
  }

  return (
    <Modal
      open
      title={text.title}
      subtitle={text.subtitle}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="sales-action" disabled={run.isPending || failed}>
            {run.isPending ? 'Saving…' : text.submit}
          </Button>
        </>
      }
    >
      {failed ? (
        <FrameError
          onRetry={() => {
            void open.refetch();
            void meta.refetch();
          }}
        />
      ) : (
        <form id="sales-action" noValidate onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
          {fixedId ? null : (
            <div className="sm:col-span-2">
              <Select
                label="Firm"
                value={opportunityId}
                error={errors['opportunityId']}
                disabled={open.isPending}
                onChange={(event) => setOpportunityId(event.target.value)}
                options={[
                  { value: '', label: open.isPending ? 'Loading…' : 'Choose a firm' },
                  ...(open.data ?? []).map((item) => ({
                    value: item.id,
                    label: `${item.firmName} (${item.stageName})`,
                  })),
                ]}
              />
            </div>
          )}
          {action === 'TRIAL' || action === 'PROPOSAL' ? (
            <Select
              label="Plan"
              value={plan}
              error={errors['plan']}
              onChange={(event) => {
                setPlan(plans.find((item) => item.id === event.target.value)?.id ?? '');
                setExtraUsers('0');
              }}
              options={[
                { value: '', label: 'Choose a plan' },
                ...plans.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          ) : null}
          {action === 'PROPOSAL' && extraLimit > 0 ? (
            <Input
              label={`Extra users (0–${extraLimit})`}
              type="number"
              min={0}
              max={extraLimit}
              value={extraUsers}
              error={errors['extraUsers']}
              onChange={(event) => setExtraUsers(event.target.value)}
            />
          ) : null}
          {action === 'PROPOSAL' ? (
            <Input
              label="Estimated annual value ($)"
              inputMode="decimal"
              maxLength={14}
              placeholder={plan ? money(monthlyCents(plan, Number(extraUsers) || 0, 0) * 12) : ''}
              value={value}
              error={errors['valueCents']}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : null}
          {plan && (action === 'TRIAL' || action === 'PROPOSAL') ? (
            <p className="text-sm text-muted sm:col-span-2" data-testid="action-price">
              {planName(plan)}: {moneyExact(monthlyCents(plan, Number(extraUsers) || 0, 0))} a
              month.
            </p>
          ) : null}
          {action === 'APPOINTMENT' ? (
            <Select
              label="Type"
              value={type}
              error={errors['appointmentType']}
              onChange={(event) => {
                const next = APPOINTMENT_TYPES.find((item) => item.id === event.target.value);
                if (next) setType(next.id);
              }}
              options={APPOINTMENT_TYPES.map((item) => ({ value: item.id, label: item.label }))}
            />
          ) : null}
          {action === 'DEMO' || action === 'APPOINTMENT' ? (
            <>
              <Select
                label="With"
                value={withId}
                error={errors['appointmentAssignedId']}
                onChange={(event) => setWithId(event.target.value)}
                options={[
                  { value: '', label: 'The record owner' },
                  ...reps.map((rep) => ({ value: rep.id, label: rep.name })),
                ]}
              />
              <Input
                label="Date"
                type="date"
                required
                value={date}
                error={errors['appointmentDate']}
                onChange={(event) => setDate(event.target.value)}
              />
              <Input
                label="Time"
                type="time"
                required
                value={time}
                error={errors['appointmentTime']}
                onChange={(event) => setTime(event.target.value)}
              />
            </>
          ) : null}
          {action === 'ASSIGN' ? (
            <Select
              label="Sales rep"
              value={ownerId}
              error={errors['ownerId']}
              onChange={(event) => setOwnerId(event.target.value)}
              options={[
                { value: '', label: 'Unassigned' },
                ...reps.map((rep) => ({ value: rep.id, label: `${rep.name} (${rep.role})` })),
              ]}
            />
          ) : null}
          {general ? (
            <p role="alert" className="text-sm text-danger sm:col-span-2">
              {general}
            </p>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
