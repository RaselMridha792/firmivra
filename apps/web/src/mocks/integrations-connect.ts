import {
  IntegrationConnectionSummary,
  IntegrationProviderDetail,
  IntegrationTestResult,
} from '@firmivra/types';

export function setupConnection() {
  return IntegrationConnectionSummary.parse({
    id: '10000000-0000-4000-8000-000000000301',
    provider: 'microsoft365',
    environment: 'LIVE',
    status: 'CONNECTED',
    issue: null,
    statusMessage: null,
    statusAction: null,
    accountLabel: 'Synthetic workspace',
    direction: 'TWO_WAY',
    syncMode: 'AUTO',
    syncEveryMinutes: 60,
    connectedAt: '2026-10-18T08:00:00Z',
    lastSyncAt: null,
    nextSyncAt: null,
  });
}
export function setupFixture(
  state: 'data' | 'empty' | 'readonly' | 'connected' | 'limited' = 'data',
) {
  const entities = [
    ['email', 'Email (Outlook)', 'Sync emails and link them to client records.'],
    ['calendar', 'Calendar', 'Sync appointments and events.'],
    ['contacts', 'Contacts', 'Sync contact information.'],
    ['files', 'Files (OneDrive / SharePoint)', 'Access and attach files to client records.'],
  ];
  return IntegrationProviderDetail.parse({
    provider: {
      provider: 'microsoft365',
      name: 'Microsoft 365',
      category: 'PRODUCTIVITY',
      summary: 'Outlook email and calendar',
      description:
        'Connect your Microsoft 365 account to sync email, calendar, contacts and files with Firmivra.',
      logo: 'microsoft365',
      featured: true,
      badge: 'RECOMMENDED',
      popularity: 95,
      authMethod: 'OAUTH2',
      environments: ['LIVE', 'TEST'],
      directions: state === 'limited' ? ['IMPORT'] : ['IMPORT', 'EXPORT', 'TWO_WAY'],
      frequencies: [15, 30, 60, 240, 1440],
      entities:
        state === 'empty'
          ? []
          : entities.map(([key, label, description]) => ({
              key,
              label,
              description,
              defaultEnabled: true,
              directions: key === 'files' ? ['IMPORT', 'TWO_WAY'] : ['IMPORT', 'EXPORT', 'TWO_WAY'],
            })),
      permissions:
        state === 'empty'
          ? []
          : [
              {
                key: 'mail.readwrite',
                label: 'Read and manage your email',
                entity: 'email',
                required: true,
              },
              {
                key: 'calendars.readwrite',
                label: 'Read and write calendar events',
                entity: 'calendar',
                required: true,
              },
              { key: 'contacts.read', label: 'Read contacts', entity: 'contacts', required: true },
              {
                key: 'files.readwrite',
                label: 'Read and manage files (OneDrive/SharePoint)',
                entity: 'files',
                required: true,
              },
              {
                key: 'user.read',
                label: 'Sign you in and read your profile',
                entity: null,
                required: true,
              },
            ],
      options:
        state === 'empty'
          ? []
          : [
              {
                key: 'mailbox',
                label: 'Mailbox / Account',
                help: null,
                type: 'SELECT',
                choices: [],
                defaultValue: null,
                afterConnect: true,
              },
              {
                key: 'defaultCalendar',
                label: 'Default Calendar',
                help: null,
                type: 'SELECT',
                choices: [{ value: 'primary', label: 'Calendar (Primary)' }],
                defaultValue: 'primary',
                afterConnect: false,
              },
              {
                key: 'createAppointments',
                label: 'Create appointments in Firmivra from new calendar events',
                help: null,
                type: 'TOGGLE',
                choices: [],
                defaultValue: true,
                afterConnect: false,
              },
              {
                key: 'attachClientEmails',
                label: 'Automatically attach client emails to records',
                help: null,
                type: 'TOGGLE',
                choices: [],
                defaultValue: true,
                afterConnect: false,
              },
              {
                key: 'folders',
                label: 'Folder Options',
                help: null,
                type: 'MULTI_SELECT',
                choices: ['Inbox', 'Sent Items', 'Drafts', 'Important', 'Other Mail'].map(
                  (label, index) => ({
                    value: ['inbox', 'sent', 'drafts', 'important', 'other'][index],
                    label,
                  }),
                ),
                defaultValue: ['inbox', 'sent'],
                afterConnect: false,
              },
            ],
      credentialFields: [],
      mappingScopes: [],
      multipleConnections: false,
      comingSoon: false,
      learnMoreUrl: 'https://www.microsoft.com/microsoft-365',
    },
    connections: state === 'connected' ? [setupConnection()] : [],
    canManage: state !== 'readonly',
  });
}
export function setupTestResult() {
  return IntegrationTestResult.parse({
    ok: true,
    summary: 'Connection verified.',
    checks: [{ key: 'AUTHENTICATION', label: 'Authorization', ok: true, message: null }],
    suggestions: [],
    checkedAt: '2026-10-18T08:00:00Z',
    runId: '10000000-0000-4000-8000-000000000302',
  });
}
