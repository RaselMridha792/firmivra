'use client';

import { PortalFields, portalValues } from '../../../../setup/_components/portal-step';
import { SettingsForm, SettingsScreen } from '../../../../setup/_components/settings-form';

/** Settings > Client portal: the heading, welcome message and client sign-up from setup. */
export function PortalSettings() {
  return (
    <SettingsScreen
      title="Client portal settings"
      intro="What clients see when they open your portal."
    >
      {(firm) => (
        <SettingsForm defaults={portalValues(firm)}>
          {(form) => <PortalFields form={form} firm={firm} />}
        </SettingsForm>
      )}
    </SettingsScreen>
  );
}
