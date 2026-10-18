'use client';

import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { Badge, Button, PermissionMatrix, type PermissionValue } from '@firmivra/ui';
import { useId, useState } from 'react';
import {
  ACTION_REQUIRES,
  MODULE_ORDER,
  type ModuleKey,
  PERMISSION_ACTIONS,
  TEAM_MODULES,
  type TeamPermissions,
} from '../../../../../mocks/admin-team';

const MODULES = new Map(TEAM_MODULES.map((module) => [module.id, module]));

/** The kit grid's value (granted action ids per row) and back, keeping only real actions. */
const toMatrix = (value: TeamPermissions): PermissionValue =>
  Object.fromEntries(
    TEAM_MODULES.map((module): [string, string[]] => [module.id, value[module.id] ?? []]),
  );
function fromMatrix(next: PermissionValue): TeamPermissions {
  const result: TeamPermissions = {};
  for (const module of TEAM_MODULES) {
    const actions = module.actions.filter((action) => next[module.id]?.includes(action));
    if (actions.length) result[module.id] = actions;
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
  const allGranted = TEAM_MODULES.every(
    (module) => (value[module.id]?.length ?? 0) === module.actions.length,
  );
  const toggleModule = (module: ModuleKey, on: boolean) => {
    const next = { ...value };
    if (on) {
      const preferred = template[module]?.length ? template[module] : ['view' as const];
      next[module] = (preferred ?? []).filter((action) => ceiling[module]?.includes(action));
      if (!next[module]?.length) delete next[module];
    } else delete next[module];
    onChange(next);
  };
  const toggleAll = (on: boolean) =>
    onChange(
      on
        ? fromMatrix(
            Object.fromEntries(
              TEAM_MODULES.map((module): [string, string[]] => [module.id, module.actions]),
            ),
          )
        : { ...template },
    );

  const box = (module: ModuleKey) => {
    const entry = MODULES.get(module);
    if (!entry) return null;
    const grantable = Boolean(ceiling[module]?.length);
    const checked = Boolean(value[module]?.length);
    return (
      <label
        key={module}
        className={`flex items-start gap-3 ${readOnly || !grantable ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          type="checkbox"
          checked={checked}
          disabled={readOnly || (!grantable && !checked)}
          onChange={(event) => toggleModule(module, event.target.checked)}
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
          <div key={column[0] ?? index} className="flex flex-col gap-4">
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
            rows={TEAM_MODULES.map((module) => ({ id: module.id, label: module.label }))}
            columns={PERMISSION_ACTIONS}
            value={toMatrix(value)}
            onChange={(next) => onChange(fromMatrix(next))}
            requires={ACTION_REQUIRES}
            fullAccess
            readOnly={readOnly}
            isAvailable={(row, column) =>
              Boolean(
                MODULES.get(row as ModuleKey)?.actions.some((action) => action === column) &&
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
