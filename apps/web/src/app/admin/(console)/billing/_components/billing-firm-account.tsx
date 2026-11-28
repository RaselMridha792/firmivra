'use client';

import { api } from '../../../../../lib/api';
import { mocked } from '../../../../../lib/mock';
import { useApiQuery } from '../../../../../lib/query';
import { FirmAccountActions, firmDetailKey } from '../../firms/_components/firm-account';

/**
 * SA-BIL-A2e: the firm's account controls next to an invoice's actions, so Billing can suspend or
 * close the firm it bills without leaving the page. One server action with SA-FRM-F03 / F04: the
 * same menu, confirmation, required reason and account history as the firm page. Never automatic.
 * The billing mock has no firm records, so the menu shows only on the API.
 */
export function BillingFirmAccount({ firmId }: { firmId: string }) {
  if (mocked('adminBilling')) return null;
  return <FirmAccountMenu firmId={firmId} />;
}

function FirmAccountMenu({ firmId }: { firmId: string }) {
  const firm = useApiQuery(firmDetailKey(firmId), () => api.firmApplications.getFirm(firmId));
  if (!firm.data) return null;
  return <FirmAccountActions firm={firm.data} trigger="Firm Account" />;
}
