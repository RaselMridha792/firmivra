'use client';

import {
  type LeadPriority,
  type LeadRouting,
  type LeadSource,
  matchLeadRoute,
  SaveLeadRoutingRequest,
} from '@firmivra/types';
import { Button, Card, Checkbox, Input, Select, Toggle } from '@firmivra/ui';
import { ArrowDown, ArrowUp, Plus, Trash } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageState } from '../../../../../../components/page-state';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import { LEAD_PIPELINE_KEY, PRIORITIES, SOURCES } from '../../../leads/_components/lead-shared';

const ROUTING_KEY = ['lead-routing'] as const;

interface Draft {
  key: string;
  id?: string;
  name: string;
  enabled: boolean;
  sources: LeadSource[];
  serviceIds: string[];
  priorities: LeadPriority[];
  assigneeUserId: string;
}

let nextKey = 0;
const toDraft = (r: LeadRouting['rules'][number]): Draft => ({
  key: r.id,
  id: r.id,
  name: r.name,
  enabled: r.enabled,
  sources: r.sources,
  serviceIds: r.serviceIds,
  priorities: r.priorities,
  assigneeUserId: r.assignee.userId,
});
const toggle = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/**
 * Settings > Lead assignment (Leads R2 17): ordered rules that give a new lead with no owner its
 * owner (Add New Lead without one, Begin Online requests), a fallback for a lead no rule matches,
 * and a preview. Rules never change an existing lead, and saving changes none; a manual
 * assignment always wins. The lead shows the rule that assigned it. Owner and Admin.
 */
export function LeadRoutingScreen() {
  const query = useApiQuery(ROUTING_KEY, () => api.leadRouting.get());
  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="lead-routing">
      <header>
        <h1 className="font-display text-3xl font-bold text-heading">Lead assignment</h1>
        <p className="text-muted">
          Rules give a new lead with no owner its owner. They never change a lead you already have.
        </p>
      </header>
      <PageState query={query} isEmpty={() => false}>
        {(routing) => <RoutingForm routing={routing} />}
      </PageState>
    </div>
  );
}

function RoutingForm({ routing }: { routing: LeadRouting }) {
  const queryClient = useQueryClient();
  const options = useApiQuery([...LEAD_PIPELINE_KEY, 'options'], () => api.leadPipeline.options());
  const staff = options.data?.staff ?? [];
  const services = options.data?.services ?? [];
  const [enabled, setEnabled] = useState(routing.enabled);
  const [fallback, setFallback] = useState(routing.fallback?.userId ?? '');
  const [rules, setRules] = useState<Draft[]>(routing.rules.map(toDraft));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState('');
  const save = useApiMutation((body: SaveLeadRoutingRequest) => api.leadRouting.save(body));
  const patch = (key: string, next: Partial<Draft>) =>
    setRules((list) => list.map((r) => (r.key === key ? { ...r, ...next } : r)));
  const move = (index: number, by: -1 | 1) =>
    setRules((list) => {
      const next = [...list];
      const [rule] = next.splice(index, 1);
      next.splice(index + by, 0, rule!);
      return next;
    });

  function submit() {
    const body = {
      enabled,
      fallbackUserId: fallback || null,
      rules: rules.map(({ key: _key, ...r }) => r),
    };
    const parsed = SaveLeadRoutingRequest.safeParse(body);
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const [, index, field] = issue.path;
        const rule = typeof index === 'number' ? rules[index] : undefined;
        found[rule ? `${rule.key}-${String(field)}` : 'form'] ??= issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    save.mutate(parsed.data, {
      onSuccess: (next) => {
        queryClient.setQueryData(ROUTING_KEY, next);
        // The saved rules (new ones now have ids), so saving again updates them.
        setRules(next.rules.map(toDraft));
        setEnabled(next.enabled);
        setFallback(next.fallback?.userId ?? '');
        setSaved('Lead assignment saved.');
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Toggle checked={enabled} onChange={setEnabled} label="Assign new leads by these rules" />
          <span className="text-sm font-medium text-heading">Assign new leads by these rules</span>
        </div>
        <Select
          label="When no rule matches, assign to"
          options={[
            { value: '', label: 'Nobody (leave unassigned)' },
            ...staff.map((m) => ({ value: m.userId, label: m.name })),
          ]}
          value={fallback}
          onChange={(event) => setFallback(event.target.value)}
        />
      </Card>

      <ol className="flex flex-col gap-3" aria-label="Rules, in the order they are tried">
        {rules.map((rule, index) => (
          <li key={rule.key}>
            <Card className="flex flex-col gap-3" data-testid="routing-rule">
              <div className="flex flex-wrap items-end gap-3">
                <span className="self-center text-sm font-semibold text-muted">{index + 1}.</span>
                <div className="min-w-48 flex-1">
                  <Input
                    label="Rule name"
                    maxLength={80}
                    value={rule.name}
                    error={errors[`${rule.key}-name`]}
                    onChange={(event) => patch(rule.key, { name: event.target.value })}
                  />
                </div>
                <div className="min-w-48 flex-1">
                  <Select
                    label="Assign to"
                    options={[
                      { value: '', label: 'Choose a member' },
                      ...staff.map((m) => ({ value: m.userId, label: m.name })),
                    ]}
                    value={rule.assigneeUserId}
                    error={errors[`${rule.key}-assigneeUserId`]}
                    onChange={(event) => patch(rule.key, { assigneeUserId: event.target.value })}
                  />
                </div>
                <Checkbox
                  label="On"
                  checked={rule.enabled}
                  onChange={(event) => patch(rule.key, { enabled: event.target.checked })}
                />
                <Button
                  variant="ghost"
                  aria-label={`Move ${rule.name || 'rule'} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Move ${rule.name || 'rule'} down`}
                  disabled={index === rules.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown aria-hidden className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Remove ${rule.name || 'rule'}`}
                  onClick={() => setRules((list) => list.filter((r) => r.key !== rule.key))}
                >
                  <Trash aria-hidden className="size-4" />
                </Button>
              </div>
              <p className="text-xs text-muted">Leave a group empty to match any value.</p>
              <ChoiceGroup
                legend="Source"
                options={SOURCES}
                chosen={rule.sources}
                onToggle={(v) => patch(rule.key, { sources: toggle(rule.sources, v) })}
              />
              <ChoiceGroup
                legend="Service"
                options={services.map((s) => ({ value: s.id, label: s.name }))}
                chosen={rule.serviceIds}
                onToggle={(v) => patch(rule.key, { serviceIds: toggle(rule.serviceIds, v) })}
              />
              <ChoiceGroup
                legend="Priority"
                options={PRIORITIES}
                chosen={rule.priorities}
                onToggle={(v) => patch(rule.key, { priorities: toggle(rule.priorities, v) })}
              />
            </Card>
          </li>
        ))}
      </ol>
      <div>
        <Button
          variant="secondary"
          onClick={() =>
            setRules((list) => [
              ...list,
              {
                key: `new-${nextKey++}`,
                name: '',
                enabled: true,
                sources: [],
                serviceIds: [],
                priorities: [],
                assigneeUserId: '',
              },
            ])
          }
        >
          <Plus aria-hidden className="size-4" />
          Add Rule
        </Button>
      </div>

      <Preview
        enabled={enabled}
        rules={rules}
        fallback={staff.find((m) => m.userId === fallback)?.name ?? null}
        staffName={(id) => staff.find((m) => m.userId === id)?.name ?? 'a member'}
        services={services}
      />

      {errors['form'] ? (
        <p role="alert" className="text-sm text-danger">
          {errors['form']}
        </p>
      ) : null}
      {save.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(save.error)}
        </p>
      ) : saved ? (
        <p role="status" className="text-sm text-success">
          {saved}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Button onClick={submit} disabled={save.isPending} data-testid="routing-save">
          Save Changes
        </Button>
      </div>
    </div>
  );
}

function ChoiceGroup<T extends string>({
  legend,
  options,
  chosen,
  onToggle,
}: {
  legend: string;
  options: { value: T; label: string }[];
  chosen: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium text-heading">{legend}</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {options.map((o) => (
          <Checkbox
            key={o.value}
            label={o.label}
            checked={chosen.includes(o.value)}
            onChange={() => onToggle(o.value)}
          />
        ))}
      </div>
    </fieldset>
  );
}

/** Where a lead with these values would go, with the rules as they stand on screen. */
function Preview({
  enabled,
  rules,
  fallback,
  staffName,
  services,
}: {
  enabled: boolean;
  rules: Draft[];
  fallback: string | null;
  staffName: (userId: string) => string;
  services: { id: string; name: string }[];
}) {
  const [source, setSource] = useState<LeadSource>('REFERRAL');
  const [service, setService] = useState('');
  const [priority, setPriority] = useState<LeadPriority | ''>('');
  const route = matchLeadRoute(
    { enabled, rules: rules.filter((r) => r.assigneeUserId) },
    { source, serviceIds: service ? [service] : [], priority: priority || null },
  );
  const result = !route
    ? 'Rules are off: the lead stays unassigned.'
    : 'rule' in route
      ? `Goes to ${staffName(route.rule.assigneeUserId)}, by the rule "${route.rule.name || 'unnamed'}".`
      : fallback
        ? `No rule matches: goes to ${fallback} (fallback).`
        : 'No rule matches: the lead stays unassigned.';
  return (
    <Card className="flex flex-col gap-3" data-testid="routing-preview">
      <h2 className="font-semibold text-heading">Preview</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select
          label="Source"
          options={SOURCES}
          value={source}
          onChange={(event) => setSource(event.target.value as LeadSource)}
        />
        <Select
          label="Service"
          options={[
            { value: '', label: 'Any' },
            ...services.map((s) => ({ value: s.id, label: s.name })),
          ]}
          value={service}
          onChange={(event) => setService(event.target.value)}
        />
        <Select
          label="Priority"
          options={[{ value: '', label: 'None' }, ...PRIORITIES]}
          value={priority}
          onChange={(event) => setPriority(event.target.value as LeadPriority | '')}
        />
      </div>
      <p role="status" className="text-sm text-heading">
        {result}
      </p>
    </Card>
  );
}
