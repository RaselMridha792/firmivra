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
import { COMPANY } from '../../../../../../lib/company';
import {
  CardLink,
  Facts,
  Quiet,
  SettingsCard,
  SettingsHeader,
} from '../../_components/settings-parts';

/** A Backups row with nothing recorded behind it: quiet, never a made-up date. */
const NOT_RECORDED = <span className="font-normal text-muted">Not recorded yet</span>;

/**
 * Settings > Data & Backups (guide §11-12; Octavia's review of Oct 19,
 * docs/specs/settings-review-2026-10-20/data-and-backups--...). Backups and restores are run by the
 * Firmivra platform (RDS automated backups and versioned document storage, infra/), for every firm.
 * Nothing in Firmivra records a backup or a restore test yet, so the two "last successful" rows say
 * so instead of showing a date. A full company export and a self-service restore have no API and no
 * job behind them yet, so neither is offered as a button: the cards say what happens today. The
 * audit log is linked (approved).
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
              ['Restore test', 'Every month'],
              ['Last successful backup', NOT_RECORDED],
              ['Last successful restore test', NOT_RECORDED],
            ]}
          />
        </SettingsCard>

        <SettingsCard
          title="Retention"
          subtitle="How long records are kept while your firm uses Firmivra."
          icon={Scales}
          testId="data-retention"
        >
          <Facts
            rows={[
              ['Tax records', '7 years'],
              ['Payroll records', 'At least 4 years'],
              ['Business formation records', 'Kept while your firm is active'],
              ['Audit log', 'Kept; never changed or removed'],
            ]}
          />
          <p className="text-sm text-text">
            While your firm is active, records stay until your firm deletes them. Each document
            category sets how long its documents are kept before they can be deleted, and a document
            on legal hold can&apos;t be deleted. These periods are guidance, not legal minimums for
            every firm: your firm keeps any records it must hold beyond its Firmivra access. Backups
            only bring data back; they don&apos;t keep it longer.
          </p>
          <CardLink href="/settings/forms-documents">Document categories</CardLink>
        </SettingsCard>

        <SettingsCard
          title="Export Company Data"
          subtitle="A full copy of your firm's records."
          icon={DownloadSimple}
          testId="data-export"
        >
          <Quiet>
            A full export of your firm&apos;s records and uploaded files can&apos;t be made in
            Firmivra yet. Documents download from Documents, and each report exports from Reports.
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
            Restoring is done by the Firmivra platform team, not on this page. To ask for data back
            from a recovery point, email Firmivra Support at{' '}
            <a href={`mailto:${COMPANY.supportEmail}`} className="font-medium text-link underline">
              {COMPANY.supportEmail}
            </a>{' '}
            with what needs to come back and from when.
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
