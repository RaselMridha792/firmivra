'use client';

import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../../../../../lib/errors';
import { BK_ERRORS, BK_KEY } from './bookkeeping-shared';

export type Notice = (text: string, tone: 'success' | 'error') => void;

/** Runs one action, refreshes every Bookkeeping view, and reports in a toast that outlives the row. */
export function useAct(onNotice: Notice) {
  const qc = useQueryClient();
  return async <T>(work: () => Promise<T>, done: string): Promise<T | undefined> => {
    try {
      const result = await work();
      await qc.invalidateQueries({ queryKey: [...BK_KEY] });
      onNotice(done, 'success');
      return result;
    } catch (e) {
      onNotice(errorMessage(e, BK_ERRORS), 'error');
      return undefined;
    }
  };
}
