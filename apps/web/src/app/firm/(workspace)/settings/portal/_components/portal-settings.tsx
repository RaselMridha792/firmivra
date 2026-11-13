'use client';

import { PortalFields, portalValues } from '../../../../setup/_components/portal-step';
import { SettingsForm, SettingsScreen } from '../../../../setup/_components/settings-form';
import { PortalContactCard } from './portal-contact';
import { PortalFeatures } from './portal-features';

/**
 * Settings > Client portal: the heading, welcome message and client sign-up from setup, the
 * portal's Contact Information (PRT-3), and the portal's tabs on and off (Portal Features).
 */
export function PortalSettings() {
  return (
    <SettingsScreen
      title="Client portal settings"
      intro="What clients see when they open your portal."
    >
      {(firm) => (
        <div className="flex flex-col gap-4">
          <SettingsForm defaults={portalValues(firm)}>
            {(form) => <PortalFields form={form} firm={firm} />}
          </SettingsForm>
          <PortalContactCard />
          <PortalFeatures />
        </div>
      )}
    </SettingsScreen>
  );
}
