'use client';

import type { EsignMemberRoleList, EsignPutRecipient, EsignTemplateRole } from '@firmivra/types';
import { Input, Select } from '@firmivra/ui';
import { roleName } from '../../../../../../components/esign/field-labels';

export type Who = EsignPutRecipient['who'];
/** What the sender chose for one role. `auto` leaves it to the template (the client's login). */
export interface RoleDraft {
  mode: '' | 'auto' | 'staff' | 'external';
  userId: string;
  name: string;
  email: string;
}
const EMPTY: RoleDraft = { mode: '', userId: '', name: '', email: '' };

/** The preparer is always the sender; the client and spouse can come from the client's logins. */
const canFillItself = (r: EsignTemplateRole, clientId: string) =>
  !!clientId && (r.role === 'CLIENT' || r.role === 'SPOUSE');

/** The sender's choice for a role, with the template's own filling as the starting point. */
export const draftOf = (
  drafts: Record<string, RoleDraft>,
  r: EsignTemplateRole,
  clientId: string,
): RoleDraft => {
  const d = drafts[r.key] ?? EMPTY;
  if (d.mode === 'auto' && !canFillItself(r, clientId)) return { ...d, mode: '' };
  return d.mode === '' && canFillItself(r, clientId) ? { ...d, mode: 'auto' } : d;
};

/** The roles the sender answers for: every one but the preparer. */
export const askedRoles = (roles: EsignTemplateRole[]) =>
  [...roles].filter((r) => r.role !== 'PREPARER').sort((a, b) => a.routingOrder - b.routingOrder);

/** Firm members as TemplateRoles lists them; approvers are Owners, Admins and Managers. */
export const memberOptions = (list: EsignMemberRoleList | undefined) =>
  (list?.items ?? []).map((m) => ({
    value: m.user.userId,
    label: m.user.name,
    canApprove: ['OWNER', 'ADMIN', 'MANAGER'].includes(m.esignRole),
  }));

/**
 * Where a schema issue under `roles[i]` shows: on that role's box (`key.name`, `key.email`, ...)
 * or its picker. `given` is the list that was parsed, so the index lines up.
 */
export function roleErrorKey(
  path: readonly PropertyKey[],
  given: readonly { r: EsignTemplateRole }[],
): string | undefined {
  const [first, index, , box] = path;
  const role = first === 'roles' && typeof index === 'number' ? given[index]?.r : undefined;
  if (!role) return undefined;
  return box ? `${role.key}.${String(box)}` : role.key;
}

/** The `who` for a role: undefined when the template fills it, null while nothing is chosen. */
export function toWho(d: RoleDraft): Who | undefined | null {
  if (d.mode === 'auto') return undefined;
  if (d.mode === 'staff') return d.userId ? { type: 'STAFF', userId: d.userId } : null;
  if (d.mode === 'external') return { type: 'EXTERNAL', name: d.name, email: d.email };
  return null;
}

/**
 * Who fills each role the template can't fill itself: a member of the firm, or someone outside it.
 * The client and spouse can be left to the client's portal logins. Errors are keyed by role key,
 * and `key.userId`, `key.name`, `key.email` for the boxes under it.
 */
export function TemplateRoles({
  roles,
  clientId,
  drafts,
  errors,
  members,
  onChange,
}: {
  roles: EsignTemplateRole[];
  clientId: string;
  drafts: Record<string, RoleDraft>;
  errors: Record<string, string>;
  /** Firm members to pick from; empty when the caller may not list them. */
  members: { value: string; label: string; canApprove: boolean }[];
  onChange: (key: string, draft: RoleDraft) => void;
}) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-4">
      <legend className="mb-2 font-semibold text-heading">Who fills each role</legend>
      {roles.some((r) => r.role === 'PREPARER') && (
        <p className="text-sm text-text">
          Preparer: <span className="text-muted">you</span>
        </p>
      )}
      {askedRoles(roles).map((r) => {
        const d = draftOf(drafts, r, clientId);
        const set = (patch: Partial<RoleDraft>) => onChange(r.key, { ...d, ...patch });
        const approver = r.kind === 'APPROVER';
        const offered = (approver ? members.filter((m) => m.canApprove) : members).map(
          ({ value, label }) => ({ value, label }),
        );
        return (
          <div key={r.key} className="flex flex-col gap-3">
            <Select
              label={`${roleName(r)}: who`}
              value={d.mode}
              error={errors[r.key]}
              onChange={(e) => set({ mode: e.target.value as RoleDraft['mode'] })}
              options={[
                canFillItself(r, clientId)
                  ? { value: 'auto', label: "The client's portal login" }
                  : { value: '', label: 'Choose who' },
                ...(offered.length ? [{ value: 'staff', label: 'A member of the firm' }] : []),
                ...(approver ? [] : [{ value: 'external', label: 'Someone outside the firm' }]),
              ]}
            />
            {approver && !offered.length && (
              <p className="text-sm text-muted">
                An approver is an Owner, Admin or Firm Sign Manager. Ask an Owner or Admin to start
                this request.
              </p>
            )}
            {d.mode === 'staff' && (
              <Select
                label={`${roleName(r)}: member`}
                value={d.userId}
                error={errors[`${r.key}.userId`]}
                onChange={(e) => set({ userId: e.target.value })}
                options={[{ value: '', label: 'Choose a member' }, ...offered]}
              />
            )}
            {d.mode === 'external' && (
              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  label={`${roleName(r)}: name`}
                  maxLength={120}
                  value={d.name}
                  error={errors[`${r.key}.name`]}
                  onChange={(e) => set({ name: e.target.value })}
                />
                <Input
                  label={`${roleName(r)}: email`}
                  type="email"
                  maxLength={254}
                  value={d.email}
                  error={errors[`${r.key}.email`]}
                  onChange={(e) => set({ email: e.target.value })}
                />
              </div>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
