'use client';

import type { AdvisoryServiceOption } from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Select, Textarea } from '@firmivra/ui';
import { Plus, Trash } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';
import { AREA_LABEL, BA_ERRORS, BA_KEY, BUSINESS_STAGES, GOAL_STATUS, today } from './ba-shared';

/** The firm's active members, for the advisor and owner pickers; empty when the role may not list them. */
function useMembers() {
  const q = useApiQuery([...BA_KEY, 'members'], () => api.team.list());
  return (q.data ?? [])
    .filter((m) => m.status === 'ACTIVE')
    .map((m) => ({ value: m.user.id, label: m.user.name }));
}

const ErrorLine = ({ text }: { text: string | undefined }) =>
  text ? (
    <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
      {text}
    </p>
  ) : null;

/**
 * "Add Advisory Client": a firm client joins the program with a primary service focus from
 * Services & Pricing, any additional services, an advisor and their stage.
 */
export function AddClientDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: (advisoryClientId: string, name: string) => void;
}) {
  const qc = useQueryClient();
  const firmClients = useApiQuery([...BA_KEY, 'firm-clients'], () =>
    api.clients.list({ limit: 100 }),
  );
  const services = useApiQuery([...BA_KEY, 'services'], () => api.advisory.serviceOptions());
  const members = useMembers();
  const [clientId, setClientId] = useState('');
  const [primaryId, setPrimaryId] = useState('');
  const [additional, setAdditional] = useState<string[]>([]);
  const [advisor, setAdvisor] = useState('');
  const [industry, setIndustry] = useState('');
  const [stage, setStage] = useState('');
  const [since, setSince] = useState(today);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const label = (s: AdvisoryServiceOption) => (s.referralOnly ? `${s.name} (referral)` : s.name);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const c = await api.advisory.addClient({
        clientId,
        primaryServiceId: primaryId,
        additionalServiceIds: additional.filter((s) => s !== primaryId),
        ...(advisor ? { advisorUserId: advisor } : {}),
        ...(industry.trim() ? { industry: industry.trim() } : {}),
        ...(stage ? { businessStage: stage } : {}),
        ...(since ? { since } : {}),
      });
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      onAdded(c.id, c.client.name);
    } catch (e) {
      setError(errorMessage(e, BA_ERRORS));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Add Advisory Client"
      subtitle="Add a client to the advisory program with the services they need."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!clientId || !primaryId || saving} onClick={() => void save()}>
            Add Client
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-advisory-client">
        <ErrorLine text={error} />
        <Select
          label="Client"
          required
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          options={[
            {
              value: '',
              label: firmClients.isError ? 'Clients could not be loaded' : 'Choose a client…',
            },
            ...(firmClients.data?.items ?? []).map((c) => ({ value: c.id, label: c.displayName })),
          ]}
        />
        <Select
          label="Primary service focus"
          required
          value={primaryId}
          onChange={(e) => setPrimaryId(e.target.value)}
          options={[
            {
              value: '',
              label: services.isError ? 'Services could not be loaded' : 'Choose a service…',
            },
            ...(services.data ?? []).map((s) => ({ value: s.serviceId, label: label(s) })),
          ]}
        />
        {services.data && services.data.length > 1 ? (
          <fieldset className="flex flex-col">
            <legend className="text-sm font-medium text-text">Additional services</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2">
              {services.data
                .filter((s) => s.serviceId !== primaryId)
                .map((s) => (
                  <Checkbox
                    key={s.serviceId}
                    label={label(s)}
                    checked={additional.includes(s.serviceId)}
                    onChange={(e) =>
                      setAdditional((a) =>
                        e.target.checked ? [...a, s.serviceId] : a.filter((x) => x !== s.serviceId),
                      )
                    }
                  />
                ))}
            </div>
          </fieldset>
        ) : null}
        {members.length ? (
          <Select
            label="Advisor"
            value={advisor}
            onChange={(e) => setAdvisor(e.target.value)}
            options={[{ value: '', label: 'Me' }, ...members]}
          />
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Industry"
            value={industry}
            maxLength={100}
            onChange={(e) => setIndustry(e.target.value)}
          />
          <Select
            label="Business stage"
            value={stage}
            onChange={(e) => setStage(e.target.value)}
            options={[
              { value: '', label: 'Not set' },
              ...BUSINESS_STAGES.map((s) => ({ value: s, label: s })),
            ]}
          />
        </div>
        <Input
          label="Advisory client since"
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
        />
      </div>
    </Modal>
  );
}

/**
 * "Add Business Goal": a goal for an advisory client, optionally in one of their plans, with
 * its first milestones.
 */
export function AddGoalDialog({
  advisoryClientId: preset,
  onClose,
  onAdded,
}: {
  advisoryClientId?: string;
  onClose: () => void;
  onAdded: (title: string) => void;
}) {
  const qc = useQueryClient();
  const clients = useApiQuery([...BA_KEY, 'pick-clients'], () =>
    api.advisory.clients({ pageSize: 100 }),
  );
  const members = useMembers();
  const [clientId, setClientId] = useState(preset ?? '');
  const plans = useApiQuery([...BA_KEY, 'pick-plans', clientId], () =>
    clientId
      ? api.advisory.plans({ advisoryClientId: clientId, pageSize: 100 })
      : Promise.resolve(null),
  );
  const [planId, setPlanId] = useState('');
  const [title, setTitle] = useState('');
  const [area, setArea] = useState('');
  const [targetDate, setTargetDate] = useState('');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState('NOT_STARTED');
  const [description, setDescription] = useState('');
  const [milestones, setMilestones] = useState<
    { key: number; title: string; targetDate: string }[]
  >([]);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api.advisory.createGoal({
        advisoryClientId: clientId,
        title: title.trim(),
        status: status as never,
        ...(planId ? { planId } : {}),
        ...(area ? { area } : {}),
        ...(targetDate ? { targetDate } : {}),
        ...(owner ? { ownerUserId: owner } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        milestones: milestones
          .filter((m) => m.title.trim())
          .map((m) => ({
            title: m.title.trim(),
            ...(m.targetDate ? { targetDate: m.targetDate } : {}),
          })),
      });
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      onAdded(title.trim());
    } catch (e) {
      setError(errorMessage(e, BA_ERRORS));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title="Add Business Goal"
      subtitle="Set a goal, its target date and the first milestones."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!clientId || !title.trim() || saving} onClick={() => void save()}>
            Add Goal
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="add-goal">
        <ErrorLine text={error} />
        <Select
          label="Advisory client"
          required
          value={clientId}
          onChange={(e) => {
            setClientId(e.target.value);
            setPlanId('');
          }}
          options={[
            {
              value: '',
              label: clients.isError
                ? 'Advisory clients could not be loaded'
                : clients.data && clients.data.items.length === 0
                  ? 'Add an advisory client first'
                  : 'Choose a client…',
            },
            ...(clients.data?.items ?? []).map((c) => ({
              value: c.id,
              label: c.businessName ? `${c.client.name} (${c.businessName})` : c.client.name,
            })),
          ]}
        />
        {plans.data && plans.data.items.length ? (
          <Select
            label="Business plan"
            value={planId}
            onChange={(e) => setPlanId(e.target.value)}
            options={[
              { value: '', label: 'Not in a plan' },
              ...plans.data.items.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        ) : null}
        <Input
          label="Goal"
          required
          value={title}
          maxLength={300}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            options={[
              { value: '', label: 'Not set' },
              ...Object.entries(AREA_LABEL).map(([value, l]) => ({ value, label: l })),
            ]}
          />
          <Input
            label="Target date"
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
          <Select
            label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            options={['NOT_STARTED', 'PLANNING', 'IN_PROGRESS', 'ON_TRACK', 'AT_RISK'].map((s) => ({
              value: s,
              label: GOAL_STATUS[s]!,
            }))}
          />
          {members.length ? (
            <Select
              label="Owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              options={[{ value: '', label: 'Me' }, ...members]}
            />
          ) : null}
        </div>
        <Textarea
          label="Description"
          rows={3}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">Milestones</legend>
          {milestones.map((m, i) => (
            <div key={m.key} className="grid grid-cols-[1fr_auto_auto] items-end gap-2">
              <Input
                label={`Milestone ${i + 1}`}
                value={m.title}
                maxLength={300}
                onChange={(e) =>
                  setMilestones((all) =>
                    all.map((x, k) => (k === i ? { ...x, title: e.target.value } : x)),
                  )
                }
              />
              <Input
                label="Target date"
                type="date"
                value={m.targetDate}
                onChange={(e) =>
                  setMilestones((all) =>
                    all.map((x, k) => (k === i ? { ...x, targetDate: e.target.value } : x)),
                  )
                }
              />
              <Button
                variant="secondary"
                aria-label={`Remove milestone ${i + 1}`}
                onClick={() => setMilestones((all) => all.filter((_, k) => k !== i))}
              >
                <Trash aria-hidden weight="fill" className="size-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            className="self-start"
            onClick={() =>
              setMilestones((all) => [
                ...all,
                { key: (all.at(-1)?.key ?? 0) + 1, title: '', targetDate: '' },
              ])
            }
          >
            <Plus aria-hidden weight="bold" className="size-4" /> Add milestone
          </Button>
        </fieldset>
      </div>
    </Modal>
  );
}
