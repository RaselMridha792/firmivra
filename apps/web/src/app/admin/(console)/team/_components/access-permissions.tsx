'use client';

import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { Badge, Button, PermissionMatrix, type PermissionValue } from '@firmivra/ui';
import { useId, useState } from 'react';
import {
  ACTION_REQUIRES,
  MODULE_ORDER,
  type ModuleKey,
  PERMISSION_ACTIONS,
  type TeamPermissions,
  teamModules,
} from './team-api';

/** The kit grid's value (granted action ids per row) and back, keeping only real actions. */
const toMatrix = (value: TeamPermissions): PermissionValue =>
  Object.fromEntries(
    teamModules().map((area): [string, string[]] => [area.id, value[area.id] ?? []]),
  );
function fromMatrix(next: PermissionValue): TeamPermissions {
  const result: TeamPermissions = {};
  for (const area of teamModules()) {
    const actions = area.actions.filter((action) => next[area.id]?.includes(action));
    if (actions.length) result[area.id] = actions;
  }
  return result;
}

/**
 * The design's Access Permissions box (module checkboxes and All Access) with the docx's
 * granular actions under "Advanced permissions". `ceiling` is what this admin may grant: boxes
 * outside it are disabled, and the whole box is read-only for admins who may not customize.
 */
export function AccessPermissions({
  value,
  onChange,
  template,
  ceiling,
  unrestricted,
  readOnly,
  custom,
  note,
}: {
  value: TeamPermissions;
  onChange: (next: TeamPermissions) => void;
  template: TeamPermissions;
  ceiling: TeamPermissions;
  unrestricted: boolean;
  readOnly: boolean;
  custom: boolean;
  note?: string;
}) {
  const id = useId();
  const [advanced, setAdvanced] = useState(false);
  // The rows and their columns: the API's catalog once loaded (team-api.ts), else the mock's.
  const modules = teamModules();
  const byModule = new Map(modules.map((area) => [area.id, area]));
  const allGranted = modules.every((area) => (value[area.id]?.length ?? 0) === area.actions.length);
  const toggleModule = (area: ModuleKey, on: boolean) => {
    const next = { ...value };
    if (on) {
      const preferred = template[area]?.length ? template[area] : ['view' as const];
      next[area] = (preferred ?? []).filter((action) => ceiling[area]?.includes(action));
      if (!next[area]?.length) delete next[area];
    } else delete next[area];
    onChange(next);
  };
  const toggleAll = (on: boolean) =>
    onChange(
      on
        ? fromMatrix(
            Object.fromEntries(modules.map((area): [string, string[]] => [area.id, area.actions])),
          )
        : { ...template },
    );

  const box = (area: ModuleKey) => {
    const entry = byModule.get(area);
    if (!entry) return null;
    const grantable = Boolean(ceiling[area]?.length);
    const checked = Boolean(value[area]?.length);
    return (
      <label
        key={area}
        className={`flex items-start gap-3 ${readOnly || !grantable ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={readOnly || (!grantable && !checked)}
          onChange={(event) => toggleModule(area, event.target.checked)}
          className="mt-0.5 size-5 shrink-0"
        />
        <span className="flex min-w-0 flex-col">
          <span className="text-base font-medium text-heading">{entry.label}</span>
          <span className="text-sm text-muted">
            {grantable || checked ? entry.description : 'Outside the access you can grant'}
          </span>
        </span>
      </label>
    );
  };

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 id={`${id}-title`} className="text-lg font-semibold text-heading">
            Access Permissions
          </h2>
          <p className="text-sm text-muted">Set what this team member can access.</p>
        </div>
        {custom ? <Badge tone="warning">Custom Permissions Applied</Badge> : null}
      </div>
      {note ? <p className="text-sm text-muted">{note}</p> : null}
      <div className="grid gap-x-8 gap-y-4 rounded-lg bg-canvas p-4 sm:grid-cols-2">
        {MODULE_ORDER.map((column, index) => (
          <div key={column.join('-')} className="flex flex-col gap-4">
            {column.map(box)}
            {index === MODULE_ORDER.length - 1 ? (
              <label
                className={`flex items-start gap-3 ${readOnly || !unrestricted ? 'cursor-not-allowed' : 'cursor-pointer'}`}
              >
                <input
                  type="checkbox"
                  checked={allGranted}
                  disabled={readOnly || !unrestricted}
                  onChange={(event) => toggleAll(event.target.checked)}
                  className="mt-0.5 size-5 shrink-0"
                />
                <span className="flex min-w-0 flex-col">
                  <span className="text-base font-medium text-heading">All Access</span>
                  <span className="text-sm text-muted">
                    {unrestricted
                      ? 'Full access to all modules'
                      : 'Only the CEO grants full access'}
                  </span>
                </span>
              </label>
            ) : null}
          </div>
        ))}
      </div>
      <div>
        <Button
          variant="ghost"
          aria-expanded={advanced}
          aria-controls={`${id}-advanced`}
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced ? (
            <CaretUp aria-hidden weight="bold" className="size-4" />
          ) : (
            <CaretDown aria-hidden weight="bold" className="size-4" />
          )}
          Advanced permissions
        </Button>
      </div>
      {advanced ? (
        <div id={`${id}-advanced`}>
          <PermissionMatrix
            caption="Permissions by module and action"
            rowHeader="Module"
            rows={modules.map((area) => ({ id: area.id, label: area.label }))}
            columns={PERMISSION_ACTIONS}
            value={toMatrix(value)}
            onChange={(next) => onChange(fromMatrix(next))}
            requires={ACTION_REQUIRES}
            fullAccess
            readOnly={readOnly}
            isAvailable={(row, column) =>
              Boolean(
                byModule.get(row as ModuleKey)?.actions.some((action) => action === column) &&
                (ceiling[row as ModuleKey]?.some((action) => action === column) ||
                  value[row as ModuleKey]?.some((action) => action === column)),
              )
            }
          />
        </div>
      ) : null}
    </section>
  );
}
