'use client';

import { ChecklistCard } from '@firmivra/ui';
import { GearSix, Lightbulb } from '@phosphor-icons/react';
import { NeedHelpCard } from '../../../_components/need-help-card';
import { useMember } from '../../_components/use-member';
import { AccountButtons } from './account-buttons';
import { Panel } from './panel';
import {
  AccountNotesCard,
  AccountStatusCard,
  LoginHistoryCard,
  SecuritySettingsCard,
  SessionsCard,
} from './security-cards';
import { SecurityShell } from './security-shell';

const PRACTICES = [
  'Use strong, unique passwords.',
  'Require two-factor authentication (2FA).',
  'Review user access regularly.',
  'Limit access to only what’s needed.',
  'Deactivate accounts immediately when no longer needed.',
];

/**
 * Account Overview (staff-account-access-and-security.jpg, guide §14): Account Status, Security
 * Settings and Account Actions; Active Sessions and Login History; Account Notes, Security Best
 * Practices and Need Help?. Every card keeps its frame when its call fails (design-match rule 2).
 */
export function SecurityOverview({ id }: { id: string }) {
  const { member, manages, admin } = useMember(id);
  return (
    <SecurityShell id={id} tab="overview">
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-3">
        <AccountStatusCard id={id} />
        <SecuritySettingsCard id={id} name={member?.name} enabled={manages} />
        <Panel title="Account Actions" icon={GearSix} testId="account-actions">
          <AccountButtons member={member} enabled={manages} testId="account-buttons" />
        </Panel>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 min-[1440px]:grid-cols-2">
        <SessionsCard id={id} name={member?.name} enabled={manages} limit={3} />
        <LoginHistoryCard id={id} />
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2 min-[1440px]:grid-cols-[5fr_4fr_3fr]">
        {admin ? <AccountNotesCard id={id} enabled={manages} /> : null}
        <ChecklistCard
          title="Security Best Practices"
          icon={Lightbulb}
          iconTone="blue"
          items={PRACTICES.map((label) => ({ id: label, label, done: true }))}
        />
        <NeedHelpCard />
      </div>
    </SecurityShell>
  );
}
