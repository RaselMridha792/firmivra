import type { PermissionModuleList, RoleSummary } from '@firmivra/types';
import { Badge, Button, Callout, tileTones } from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  Eraser,
  FileText,
  Lightning,
  Plus,
  UsersThree,
} from '@phosphor-icons/react';
import { createElement } from 'react';
import { ROLE_LOOKS } from './role-parts';

const card = 'rounded-xl border border-divider bg-surface p-4 shadow-sm';

/** Create Staff's "Role Description" panel for the chosen role. */
export function RoleDescription({ role }: { role: RoleSummary }) {
  return (
    <section aria-label="Role description" className={card} data-testid="role-description">
      <div className="flex items-start gap-4">
        <span
          aria-hidden
          className={`flex size-14 shrink-0 items-center justify-center rounded-xl ${tileTones[ROLE_LOOKS[role.role][1]]}`}
        >
          {createElement(ROLE_LOOKS[role.role][0], { weight: 'fill', className: 'size-8' })}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-heading">Role Description</p>
          <p className="text-xl font-bold text-heading">{role.label}</p>
          <p className="mt-1 text-sm text-link">{role.description}</p>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span className="inline-flex items-center gap-1">
              <UsersThree aria-hidden weight="fill" className="size-4" />
              {role.memberCount} {role.memberCount === 1 ? 'person' : 'people'}
            </span>
            {role.customized ? <Badge tone="warning">Customized</Badge> : null}
            {role.locked ? <Badge tone="neutral">Locked</Badge> : null}
          </p>
        </div>
      </div>
    </section>
  );
}

/** Quick Presets: the role's defaults back (Reset to Default) and every box off. */
export function QuickPresets({
  canChange,
  customized,
  pending,
  onDefaults,
  onClear,
}: {
  canChange: boolean;
  customized: boolean;
  pending: boolean;
  onDefaults: () => void;
  onClear: () => void;
}) {
  return (
    <section aria-labelledby="quick-presets" className={card}>
      <h2 id="quick-presets" className="mb-3 flex items-center gap-3 text-base font-bold">
        <span
          aria-hidden
          className={`flex size-10 items-center justify-center rounded-lg ${tileTones.blue}`}
        >
          <Lightning weight="fill" className="size-5" />
        </span>
        <span className="text-heading">Quick Presets</span>
      </h2>
      <div className="flex flex-col gap-3">
        <Button
          variant="secondary"
          disabled={!canChange || !customized || pending}
          onClick={onDefaults}
        >
          <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" />
          Apply Default Permissions for This Role
        </Button>
        <Button variant="secondary" disabled={!canChange || pending} onClick={onClear}>
          <Eraser aria-hidden weight="bold" className="size-4" />
          Clear All Permissions
        </Button>
      </div>
    </section>
  );
}

/** Role Templates (Settings > Users & Roles): each role as a tinted row; Create Custom Role. */
export function RoleTemplates({
  roles,
  selected,
  canChange,
  onSelect,
  onCreate,
}: {
  roles: RoleSummary[];
  selected: string;
  canChange: boolean;
  onSelect: (role: RoleSummary) => void;
  onCreate: () => void;
}) {
  return (
    <section aria-labelledby="role-templates" className={card}>
      <h2 id="role-templates" className="text-base font-bold text-heading">
        Role Templates
      </h2>
      <p className="mb-3 text-sm text-link">Choose a role to see its permissions.</p>
      <ul className="flex flex-col gap-2">
        {roles.map((r) => {
          const [glyph, tone] = ROLE_LOOKS[r.role];
          const on = r.role === selected;
          return (
            <li key={r.role}>
              <button
                type="button"
                aria-pressed={on}
                data-testid="role-template"
                onClick={() => onSelect(r)}
                className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold ${tileTones[tone]} ${on ? 'ring-2 ring-action' : ''}`}
              >
                {createElement(glyph, { 'aria-hidden': true, weight: 'fill', className: 'size-5' })}
                <span className="min-w-0 flex-1 truncate">{r.label}</span>
                <span className="text-xs font-medium">{r.memberCount}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {canChange ? (
        <Button variant="secondary" className="mt-3 w-full" onClick={onCreate}>
          <Plus aria-hidden weight="bold" className="size-4" />
          Create Custom Role
        </Button>
      ) : null}
    </section>
  );
}

/** Permission Notes, with what each column means (GET /business/permission-modules). */
export function PermissionNotes({ modules }: { modules: PermissionModuleList | undefined }) {
  return (
    <Callout icon={FileText} iconStyle="tile" tone="blue" surface="plain" title="Permission Notes">
      <p>
        Permissions control what people with this role can see and do in LVP. A change applies to
        everyone with the role on their next page load.
      </p>
      {modules ? (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {modules.capabilities.map((c) => (
            <div key={c.capability} className="contents">
              <dt className="font-semibold text-heading">{c.label}</dt>
              <dd>{c.description}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </Callout>
  );
}
