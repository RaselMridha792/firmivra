// SM08 (Staff Management Review 2): the assignment warning's boundaries. Synthetic names only.
import { describe, expect, it } from 'vitest';
import { workloadWarning } from './workload';

const uid = '0199c0a0-0a00-7000-8000-000000000001';
const person = (
  activeClients: number,
  maxActiveClients: number | null,
  acceptsNewClients = true,
) => ({
  userId: uid,
  name: 'Fake Preparer',
  workload: { activeClients, maxActiveClients, acceptsNewClients },
});

describe('workloadWarning', () => {
  it('stays quiet up to the maximum, and warns one past it', () => {
    expect(workloadWarning(person(49, 50), 1)).toBeNull();
    expect(workloadWarning(person(50, 50), 1)).toBe(
      'Fake Preparer would have 51 active clients, over their maximum of 50. You can still assign them.',
    );
    // Several at once count together.
    expect(workloadWarning(person(48, 50), 2)).toBeNull();
    expect(workloadWarning(person(48, 50), 3)).toContain('would have 51 active clients');
  });

  it('warns for someone not taking new clients, and never without a maximum or a new client', () => {
    expect(workloadWarning(person(0, null, false), 1)).toBe(
      'Fake Preparer is not taking new clients. You can still assign them.',
    );
    expect(workloadWarning(person(500, null), 1)).toBeNull();
    expect(workloadWarning(person(50, 50, false), 0)).toBeNull();
    expect(workloadWarning(undefined, 1)).toBeNull();
    expect(workloadWarning({ userId: uid, name: 'Fake Preparer' }, 1)).toBeNull();
  });
});
