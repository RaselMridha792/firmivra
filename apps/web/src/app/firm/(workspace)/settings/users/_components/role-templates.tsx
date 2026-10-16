'use client';

import type { MembershipRole, RoleSummary } from '@firmivra/types';
import { Button, Skeleton, tileTones } from '@firmivra/ui';
import {
  BuildingApartment,
  BuildingOffice,
  Buildings,
  type Icon,
  Plus,
  UsersThree,
  WarningCircle,
} from '@phosphor-icons/react';
import { createElement } from 'react';
import { ROLE_LOOKS } from '../../../team/roles/_components/role-parts';
import { BandCard, NOT_LOADED, Quiet } from '../../_components/settings-parts';

/** The design's template icons; roles it does not draw keep Staff Management's icon. */
const ICONS: Partial<Record<MembershipRole, Icon>> = {
  ADMIN: Buildings,
  TAX_PREPARER: UsersThree,
  BOOKKEEPER: BuildingOffice,
  CLIENT_SUPPORT: BuildingApartment,
  READ_ONLY: WarningCircle,
};

/**
 * Role Templates (users-and-role.jpg): each firm role in its tint, without member counts. A
 * template opens Create Custom Role starting from that role. The Owner role is not a template.
 */
export function RoleTemplates({
  roles,
  loading,
  canChange,
  onUse,
  onCreate,
}: {
  roles: RoleSummary[] | undefined;
  loading: boolean;
  canChange: boolean;
  onUse: (role: MembershipRole) => void;
  onCreate: () => void;
}) {
  return (
    <BandCard title="Role Templates" testId="role-templates">
      <div className="flex flex-col gap-2 p-3 pt-2">
        <p className="text-sm text-text">Use a template to quickly create a role.</p>
        {roles ? (
          <ul className="flex flex-col gap-2">
            {roles
              .filter((r) => r.role !== 'OWNER')
              .map((r) => {
                const [glyph, tone] = ROLE_LOOKS[r.role];
                return (
                  <li key={r.role}>
                    <button
                      type="button"
                      data-testid="role-template"
                      disabled={!canChange}
                      onClick={() => onUse(r.role)}
                      className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium disabled:cursor-not-allowed ${tileTones[tone]}`}
                    >
                      {createElement(ICONS[r.role] ?? glyph, {
                        'aria-hidden': true,
                        weight: 'fill',
                        className: 'size-5 shrink-0',
                      })}
                      <span className="min-w-0 flex-1 truncate">{r.label}</span>
                    </button>
                  </li>
                );
              })}
          </ul>
        ) : loading ? (
          <Skeleton className="h-40" />
        ) : (
          <Quiet>{NOT_LOADED}</Quiet>
        )}
        {canChange ? (
          <Button variant="outline" className="mt-1 w-full" onClick={onCreate}>
            <Plus aria-hidden weight="bold" className="size-4" />
            Create Custom Role
          </Button>
        ) : null}
      </div>
    </BandCard>
  );
}
