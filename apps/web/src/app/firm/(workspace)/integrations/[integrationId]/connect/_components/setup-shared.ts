'use client';

import {
  ConnectIntegrationRequest,
  type IntegrationProvider,
  type IntegrationSettings,
} from '@firmivra/types';
import { useSyncExternalStore } from 'react';

export const steps = [
  { id: 'connect', label: 'Connect', description: 'Authorize and link your account', suffix: '' },
  {
    id: 'configure',
    label: 'Configure',
    description: 'Set sync preferences',
    suffix: '/configure',
  },
  {
    id: 'permissions',
    label: 'Permissions',
    description: 'Review and approve access',
    suffix: '/permissions',
  },
  { id: 'complete', label: 'Complete', description: 'Test and finish setup', suffix: '/complete' },
] as const;
export type WizardStep = (typeof steps)[number]['id'];
const event = 'integration-setup-draft';
const memory = new Map<string, string>();
function read(key: string) {
  try {
    return sessionStorage.getItem(key) ?? memory.get(key) ?? '';
  } catch {
    return memory.get(key) ?? '';
  }
}
function subscribe(listener: () => void) {
  window.addEventListener(event, listener);
  window.addEventListener('storage', listener);
  return () => {
    window.removeEventListener(event, listener);
    window.removeEventListener('storage', listener);
  };
}
/** Only non-secret preferences; scoped to firm, user and provider. Never credentials or tokens. */
export function useSetupDraft(key: string) {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => '',
  );
  let draft: ConnectIntegrationRequest = {};
  try {
    const parsed = ConnectIntegrationRequest.safeParse(JSON.parse(raw));
    if (parsed.success)
      draft = {
        environment: parsed.data.environment,
        settings: parsed.data.settings,
        testAfterConnect: parsed.data.testAfterConnect,
      };
  } catch {
    /* A missing or stale draft uses the provider defaults. */
  }
  return [
    draft,
    (value: ConnectIntegrationRequest) => {
      const safe = JSON.stringify({
        environment: value.environment,
        settings: value.settings,
        testAfterConnect: value.testAfterConnect,
      });
      memory.set(key, safe);
      try {
        sessionStorage.setItem(key, safe);
      } catch {
        /* Memory still supports step navigation. */
      }
      window.dispatchEvent(new Event(event));
    },
  ] as const;
}
export function defaultSettings(provider: IntegrationProvider): IntegrationSettings {
  return {
    entities: provider.entities.filter((item) => item.defaultEnabled).map((item) => item.key),
    direction: provider.directions.includes('TWO_WAY') ? 'TWO_WAY' : provider.directions[0],
    syncMode: provider.frequencies.length ? 'AUTO' : 'MANUAL',
    syncEveryMinutes: provider.frequencies.includes(60) ? 60 : (provider.frequencies[0] ?? null),
    options: Object.fromEntries(
      provider.options
        .filter((option) => option.defaultValue !== null && !option.afterConnect)
        .map((option) => [option.key, option.defaultValue!]),
    ),
  };
}
export const directionLabels = {
  IMPORT: 'Import to Firmivra',
  EXPORT: 'Export to provider',
  TWO_WAY: 'Two-way sync',
};
