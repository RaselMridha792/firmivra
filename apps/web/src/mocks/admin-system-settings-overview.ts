import { AdminSettingsOverview } from '@firmivra/types';
import { mockedEmpty } from '../lib/mock';

/** Synthetic values from the landing-page design, only loaded by its development preview. */
export function createAdminSystemSettingsOverviewPreview(): AdminSettingsOverview {
  const empty = mockedEmpty('adminSettings');

  return AdminSettingsOverview.parse({
    categories: [
      'GENERAL',
      'BRANDING',
      'EMAIL',
      'FEATURES',
      'RETENTION',
      'SECURITY',
      'SYSTEM',
      'MAINTENANCE',
      'DEFAULTS',
    ].map((key) => ({ key, lastChangedAt: null, lastChangedBy: null })),
    system: {
      version: '1.0.0',
      environment: 'Production',
      lastUpdatedAt: empty ? null : '2026-10-14T21:12:00Z',
      totalFirms: empty ? 0 : 24,
      totalUsers: empty ? 0 : 312,
    },
    maintenance: null,
    recentChanges: empty
      ? []
      : [
          {
            eventId: '00000000-0000-4000-8000-000000000001',
            label: 'Email settings updated',
            by: 'Super Admin',
            at: '2026-10-14T17:24:00Z',
          },
          {
            eventId: '00000000-0000-4000-8000-000000000002',
            label: 'Feature flag enabled: Advanced Reporting',
            by: 'Super Admin',
            at: '2026-10-13T14:17:00Z',
          },
          {
            eventId: '00000000-0000-4000-8000-000000000003',
            label: 'Password policy updated',
            by: 'Super Admin',
            at: '2026-10-12T11:03:00Z',
          },
          {
            eventId: '00000000-0000-4000-8000-000000000004',
            label: 'Branding settings updated',
            by: 'Super Admin',
            at: '2026-10-11T16:36:00Z',
          },
        ],
  });
}
