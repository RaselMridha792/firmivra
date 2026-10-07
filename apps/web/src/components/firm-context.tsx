'use client';

import type { BusinessSummary, MembershipRole } from '@firmivra/types';
import { createContext, use } from 'react';

export interface FirmValue {
  firm: BusinessSummary;
  /** The signed-in staff user's role in this firm (undefined without an active membership). */
  role: MembershipRole | undefined;
}

/** Set by the firm workspace layout, which loads the firm once (GET /business). */
export const FirmContext = createContext<FirmValue | null>(null);

/** The current firm and your role in it, inside the firm workspace (firm/(workspace)/...). */
export function useFirm(): FirmValue {
  const value = use(FirmContext);
  if (!value) throw new Error('useFirm() works only inside the firm workspace layout');
  return value;
}
