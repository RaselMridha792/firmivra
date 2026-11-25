import { MutationObserver, QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { apiMutationOptions } from './query';

// Appointments Review 2 rows 8 / P8 (R61's live FAIL): after Confirm in the portal, the list
// reload removes the prompt, and with it the component that called `mutate`. A callback passed
// to `mutate` is then dropped; useApiMutation's own `onSuccess` is not. An observer with no
// subscriber stands for the unmounted component.
describe('useApiMutation onSuccess outlives the component', () => {
  it('runs before the refetch even with no component left, where a mutate callback is dropped', async () => {
    const client = new QueryClient();
    const order: string[] = [];
    client.setQueryData(['list'], 1);
    const refetch = vi.spyOn(client, 'invalidateQueries').mockImplementation(async () => {
      order.push('refetch');
    });
    const observer = new MutationObserver(
      client,
      apiMutationOptions(client, async (n: number) => n * 2, {
        invalidate: ['list'],
        onSuccess: (result) => order.push(`message ${result}`),
      }),
    );
    const dropped = vi.fn();
    await observer.mutate(21, { onSuccess: dropped });
    expect(order).toEqual(['message 42', 'refetch']);
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['list'] });
    // No subscriber (the prompt unmounted): the per-call callback never ran.
    expect(dropped).not.toHaveBeenCalled();
  });

  it('runs nothing on failure', async () => {
    const client = new QueryClient();
    const done = vi.fn();
    const observer = new MutationObserver(
      client,
      apiMutationOptions(client, () => Promise.reject(new Error('Fake: refused')), {
        onSuccess: done,
      }),
    );
    await expect(observer.mutate(undefined)).rejects.toThrow('Fake: refused');
    expect(done).not.toHaveBeenCalled();
  });
});
