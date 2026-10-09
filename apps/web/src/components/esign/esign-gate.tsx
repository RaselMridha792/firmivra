'use client';

import type { EsignAccessRole } from '@firmivra/types';
import { EmptyState } from '@firmivra/ui';
import type { ReactNode } from 'react';
import { api } from '../../lib/api';
import { useApiQuery } from '../../lib/query';
import { PageState } from '../page-state';

/**
 * Every Firm Sign page reads `status()` first, as the contract asks: with Firm Sign off for the
 * firm, a notice instead of the page (whose calls would answer 403 MODULE_OFF).
 */
export function EsignGate({ children }: { children: (role: EsignAccessRole | null) => ReactNode }) {
  const status = useApiQuery(['esign', 'status'], () => api.esign.status());
  return (
    <PageState query={status} isEmpty={() => false}>
      {(s) =>
        s.enabled ? (
          children(s.myEsignRole)
        ) : (
          <EmptyState
            title="Firm Sign is off"
            description="Firm Sign isn't turned on for your firm. Ask Firmivra support to turn it on."
          />
        )
      }
    </PageState>
  );
}
