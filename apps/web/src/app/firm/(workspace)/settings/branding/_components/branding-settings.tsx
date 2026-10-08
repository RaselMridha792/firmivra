'use client';

import { BrandingFields, brandingValues } from '../../../../setup/_components/branding-step';
import { SettingsForm, SettingsScreen } from '../../../../setup/_components/settings-form';

/** Settings > Branding: the portal name and colours from setup, with the live preview. */
export function BrandingSettings() {
  return (
    <SettingsScreen title="Branding" intro="How your client portal looks to your clients.">
      {(firm) => (
        <SettingsForm defaults={brandingValues(firm)}>
          {(form) => <BrandingFields form={form} firm={firm} />}
        </SettingsForm>
      )}
    </SettingsScreen>
  );
}
