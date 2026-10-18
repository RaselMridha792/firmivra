'use client';

import { PermissionMatrix, type PermissionValue } from '@firmivra/ui';
import {
  ADMIN_ROLES,
  BILLING_CAPABILITIES,
  type AdminRole,
  type BillingSettings,
} from '../../../../../../mocks/admin-billing';
import { ADMIN_ROLE_LABELS, BILLING_CAPABILITY_LABELS } from '../../_components/billing-labels';
import { SettingsCard, type SettingsForm } from './settings-parts';

/**
 * Permissions (docx §15, §19): which Super Admin roles may create, edit, send and void invoices,
 * record payments, issue refunds, create, apply and void credits, manage recurring invoices,
 * change Billing Settings and see billing across firms. The Owner always keeps Edit Billing
 * Settings, so the settings can never be locked.
 */

type Permissions = BillingSettings['permissions'];

const ROWS = BILLING_CAPABILITIES.map((capability) => ({
  id: capability,
  label: BILLING_CAPABILITY_LABELS[capability],
}));
const COLUMNS = ADMIN_ROLES.map((role) => ({ id: role, label: ADMIN_ROLE_LABELS[role] }));

const isRole = (value: string): value is AdminRole =>
  (ADMIN_ROLES as readonly string[]).includes(value);

/** The grid's value back to the settings, with the Owner kept on Edit Billing Settings. */
function toPermissions(value: PermissionValue, before: Permissions): Permissions {
  const next = { ...before };
  for (const capability of BILLING_CAPABILITIES) {
    const roles = (value[capability] ?? []).filter(isRole);
    next[capability] = ADMIN_ROLES.filter((role) => roles.includes(role));
  }
  if (!next.EDIT_SETTINGS.includes('OWNER')) next.EDIT_SETTINGS = ['OWNER', ...next.EDIT_SETTINGS];
  return next;
}

export function PermissionsTab({ form }: { form: SettingsForm | null }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SettingsCard
        title="Billing Permissions"
        description="Who on the Firmivra team can do each billing action. The server checks these on every request."
        testId="settings-permissions"
      >
        {form ? (
          <div className="flex flex-col gap-3">
            <PermissionMatrix
              caption="Billing permissions by role"
              rowHeader="Action"
              rows={ROWS}
              columns={COLUMNS}
              value={form.value.permissions}
              onChange={(value) =>
                form.patch('permissions', toPermissions(value, form.value.permissions))
              }
            />
            <p className="text-sm text-muted">
              The Owner / Super Admin always keeps Edit Billing Settings.
              {form.myRole ? ` You are signed in as ${ADMIN_ROLE_LABELS[form.myRole]}.` : ''}
            </p>
          </div>
        ) : null}
      </SettingsCard>
    </div>
  );
}
