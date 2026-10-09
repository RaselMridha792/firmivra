'use client';

import { BusinessFields, businessValues } from '../../../../setup/_components/business-step';
import { SettingsForm, SettingsScreen } from '../../../../setup/_components/settings-form';

/** Settings > Profile: the business details from setup. The legal name stays locked. */
export function ProfileSettings() {
  return (
    <SettingsScreen title="Firm profile" intro="Your firm's details and contact information.">
      {(firm) => (
        <SettingsForm defaults={businessValues(firm)}>
          {(form) => <BusinessFields form={form} firm={firm} />}
        </SettingsForm>
      )}
    </SettingsScreen>
  );
}
