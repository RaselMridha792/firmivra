'use client';
import { useSyncExternalStore } from 'react';
const subscribe = () => () => {};
/** Forms stay disabled until browser event handlers are attached. */
export function useAuthReady() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
