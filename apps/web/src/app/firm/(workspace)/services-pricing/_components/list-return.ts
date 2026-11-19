'use client';

import { useSearchParams } from 'next/navigation';
import { ORIGIN_PARAM, safeOrigin, withOrigin } from '../../../../../lib/origin';

/**
 * Services & Pricing Review Two R6: where a service's Save, Cancel and Back return: the list as
 * it was (its `?from=`, SH1), else the list's first page. `keep` carries the way back onward
 * (Preview to Edit).
 */
export function useListReturn() {
  const params = useSearchParams();
  const from = safeOrigin(params.get(ORIGIN_PARAM));
  const back = from?.startsWith('/services-pricing') ? from : '/services-pricing';
  const keep = (href: string) => (from ? withOrigin(href, from) : href);
  return { back, keep };
}
