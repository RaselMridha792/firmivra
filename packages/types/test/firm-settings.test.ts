import { describe, it, expect } from 'vitest';
import { UpdateBusinessSettingsRequest, SaveBusinessSetupRequest } from '../src/firm-settings.js';
describe('settings input boundary', () => {
  it('rejects injected tenant/status, invalid timezone, empty patch and duplicate steps', () => {
    for (const input of [
      { businessId: 'ignored' },
      { status: 'ACTIVE' },
      {},
      { timezone: 'Bad/Zone' },
    ])
      expect(UpdateBusinessSettingsRequest.safeParse(input).success).toBe(false);
    expect(SaveBusinessSetupRequest.safeParse({ completedSteps: ['team', 'team'] }).success).toBe(
      false,
    );
  });
  it('permits clearing contact values without clearing the timezone', () => {
    expect(
      UpdateBusinessSettingsRequest.safeParse({ contactPhone: null, timezone: 'America/New_York' })
        .success,
    ).toBe(true);
    expect(UpdateBusinessSettingsRequest.safeParse({ timezone: null }).success).toBe(false);
  });
});
