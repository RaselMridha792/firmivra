'use client';

import { Badge } from '@firmivra/ui';
import {
  ClipboardText,
  ClockCounterClockwise,
  CloudArrowDown,
  Database,
  DownloadSimple,
  Scales,
  ShieldCheck,
} from '@phosphor-icons/react';
import {
  CardLink,
  Facts,
  Quiet,
  SettingsCard,
  SettingsHeader,
} from '../../_components/settings-parts';

/**
 * Settings > Data & Backups (guide §11-12: backup status, retention, export, restore and
 * lifecycle). Backups and restores are run by the Firmivra platform (docs/SYSTEM-DESIGN.md:
 * encrypted backups, 35-day point-in-time recovery, a quarterly restore test). Export and restore
 * are high-risk and have no API yet (Settings contract), so they are not offered as buttons: the
 * cards say how they work today. The audit log is linked.
 */
export function DataScreen() {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <SettingsHeader
        icon={Database}
        title="Data & Backups"
        subtitle="How your firm's data is backed up, kept, exported and restored."
      />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <SettingsCard
          title="Backups"
          subtitle="Run by the Firmivra platform for every firm."
          icon={CloudArrowDown}
          tone="green"
          testId="data-backups"
          action={
            <Badge tone="success" icon={ShieldCheck}>
              Automatic
            </Badge>
          }
        >
          <Facts
            rows={[
              ['Backups', 'Continuous, encrypted'],
              ['Recovery window', 'Any point in the last 35 days'],
              ['Restore test', 'Every quarter'],
            ]}
          />
        </SettingsCard>

        <SettingsCard
          title="Retention"
          subtitle="How long records are kept, even after an account closes."
          icon={Scales}
          testId="data-retention"
        >
          <Facts
            rows={[
              ['Tax records', '7 years'],
              ['Payroll records', 'At least 4 years'],
              ['Business formation records', 'Kept permanently'],
              ['Audit log', 'Kept; never changed or removed'],
            ]}
          />
          <CardLink href="/settings/forms-documents">Document categories</CardLink>
        </SettingsCard>

        <SettingsCard
          title="Export Company Data"
          subtitle="A full copy of your firm's records."
          icon={DownloadSimple}
          testId="data-export"
        >
          <Quiet>
            Exporting all of your firm&apos;s records is a restricted action that is recorded in the
            audit log. It is not offered on this page yet; contact Firmivra Support.
          </Quiet>
        </SettingsCard>

        <SettingsCard
          title="Restore"
          subtitle="Bringing back data from a backup."
          icon={ClockCounterClockwise}
          tone="amber"
          testId="data-restore"
        >
          <Quiet>
            Restoring from a backup is a high-risk action for the Firmivra platform team, recorded
            in the audit log. Contact Firmivra Support if you need data brought back.
          </Quiet>
        </SettingsCard>

        <SettingsCard
          title="Audit Log"
          subtitle="Every administrative and security action in your firm."
          icon={ClipboardText}
          testId="data-audit"
          className="lg:col-span-2"
        >
          <p className="text-sm text-text">
            Who did what, newest first. Entries cannot be changed or removed.
          </p>
          <CardLink href="/audit-log">Open Audit Log</CardLink>
        </SettingsCard>
      </div>
    </div>
  );
}
