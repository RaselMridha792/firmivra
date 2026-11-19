'use client';

import { createContext, createElement, type ReactNode, use } from 'react';

/**
 * The request's CSP nonce (lib/csp.ts, made by the proxy), handed down from the root layout so
 * a client component can put it on an inline script it renders. Undefined where there is none.
 */
const NonceContext = createContext<string | undefined>(undefined);

export function NonceProvider({
  nonce,
  children,
}: {
  nonce: string | undefined;
  children?: ReactNode;
}) {
  return createElement(NonceContext, { value: nonce }, children);
}

/** The nonce for an inline `<script>`: pair it with suppressHydrationWarning (browsers hide it). */
export function useNonce(): string | undefined {
  return use(NonceContext);
}
