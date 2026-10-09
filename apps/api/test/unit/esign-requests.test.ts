// R13 step 6, requests API part 1: status on an in-memory module switch. Synthetic data only.
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EsignRequestsService } from '../../src/esign/requests/requests.service.js';

describe('GET /esign/status', () => {
  it('says on with the caller’s role, and off (never an error) with no role', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const on = new Set<string>([a, b]);
    const svc = new EsignRequestsService({ isEnabled: (id) => Promise.resolve(on.has(id)) });
    const owner = { userId: randomUUID(), role: 'OWNER' as const };
    expect(await svc.status(a, owner)).toEqual({ enabled: true, myEsignRole: 'OWNER' });
    expect(await svc.status(a, { userId: randomUUID(), role: 'STAFF' })).toEqual({
      enabled: true,
      myEsignRole: 'STAFF',
    });
    on.delete(a);
    expect(await svc.status(a, owner)).toEqual({ enabled: false, myEsignRole: null });
    // One firm's switch is not another's.
    expect(await svc.status(b, owner)).toMatchObject({ enabled: true });
  });
});
