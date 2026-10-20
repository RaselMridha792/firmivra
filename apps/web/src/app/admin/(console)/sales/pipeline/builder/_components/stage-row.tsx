'use client';

import { Checkbox, IconButton, Input, Select, Toggle } from '@firmivra/ui';
import { ArrowDown, ArrowUp, Trash } from '@phosphor-icons/react';
import {
  STAGE_AUTOMATIONS,
  STAGE_REQUIREMENTS,
  STAGE_TONES,
  STAGE_TYPES,
  type StageDraft,
} from '../../../_components/sales-api';
import { STAGE_STYLE } from '../../../_components/sales-ui';

/** A stage being edited; `key` is the stage id, or a temporary key for a new stage. */
export interface DraftStage extends StageDraft {
  key: string;
}

/**
 * One stage of the builder: name, type, colour, on/off, the data it requires on entry and its
 * automation, with move up, move down and remove. The header preview shows its board colour.
 */
export function StageRow({
  stage,
  index,
  count,
  records,
  errors,
  onChange,
  onMove,
  onRemove,
}: {
  stage: DraftStage;
  index: number;
  count: number;
  records: number;
  errors: Record<string, string>;
  onChange: (next: DraftStage) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const label = stage.name.trim() || `Stage ${index + 1}`;
  const style = STAGE_STYLE[stage.tone];
  return (
    <li
      data-testid="builder-stage"
      className={`flex flex-col gap-3 rounded-xl border p-3 ${stage.active ? 'border-divider bg-surface' : 'border-dashed border-control-border bg-subtle'}`}
    >
      <div className="flex flex-wrap items-center gap-3">
        <span
          aria-hidden
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-table-head text-sm font-semibold text-heading"
        >
          {index + 1}
        </span>
        <span
          className={`inline-flex min-h-8 min-w-0 max-w-full items-center rounded-lg px-3 text-sm font-semibold ${style.head}`}
        >
          <span className="truncate">{label}</span>
        </span>
        <span className="text-sm text-muted">
          {records} {records === 1 ? 'record' : 'records'}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <IconButton
            icon={ArrowUp}
            label={`Move ${label} up`}
            weight="bold"
            disabled={index === 0}
            onClick={() => onMove(-1)}
          />
          <IconButton
            icon={ArrowDown}
            label={`Move ${label} down`}
            weight="bold"
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          />
          <IconButton icon={Trash} label={`Remove ${label}`} tone="danger" onClick={onRemove} />
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          label="Stage name"
          maxLength={40}
          value={stage.name}
          error={errors[`stage-${index}-name`]}
          onChange={(event) => onChange({ ...stage, name: event.target.value })}
        />
        <Select
          label="Type"
          value={stage.type}
          error={errors[`stage-${index}-type`]}
          onChange={(event) => {
            const type = STAGE_TYPES.find((item) => item.id === event.target.value);
            if (type) onChange({ ...stage, type: type.id });
          }}
          options={STAGE_TYPES.map((type) => ({ value: type.id, label: type.label }))}
        />
        <Select
          label="Colour"
          value={stage.tone}
          onChange={(event) => {
            const tone = STAGE_TONES.find((item) => item.id === event.target.value);
            if (tone) onChange({ ...stage, tone: tone.id });
          }}
          options={STAGE_TONES.map((tone) => ({ value: tone.id, label: tone.label }))}
        />
        <Select
          label="On entry"
          value={stage.automation}
          onChange={(event) => {
            const automation = STAGE_AUTOMATIONS.find((item) => item.id === event.target.value);
            if (automation) onChange({ ...stage, automation: automation.id });
          }}
          options={STAGE_AUTOMATIONS.map((item) => ({ value: item.id, label: item.label }))}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
        <fieldset className="flex flex-wrap items-center gap-x-5">
          <legend className="sr-only">Required before entry</legend>
          <span aria-hidden className="text-sm font-medium text-text">
            Requires:
          </span>
          {STAGE_REQUIREMENTS.map((requirement) => (
            <Checkbox
              key={requirement.id}
              label={requirement.label}
              checked={stage.requires.includes(requirement.id)}
              onChange={(event) =>
                onChange({
                  ...stage,
                  requires: event.target.checked
                    ? [...stage.requires, requirement.id]
                    : stage.requires.filter((item) => item !== requirement.id),
                })
              }
            />
          ))}
        </fieldset>
        <label className="flex cursor-pointer items-center gap-3 text-sm text-text">
          <Toggle
            label={`${label} is switched on`}
            checked={stage.active}
            onChange={(checked) => onChange({ ...stage, active: checked })}
          />
          {stage.active ? 'Switched on' : 'Switched off'}
        </label>
      </div>
      {errors[`stage-${index}-active`] ? (
        <p className="text-xs text-danger">{errors[`stage-${index}-active`]}</p>
      ) : null}
    </li>
  );
}
