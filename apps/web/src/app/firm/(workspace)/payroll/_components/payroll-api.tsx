'use client';

import { createContext, type ReactNode, useContext } from 'react';
import { api } from '../../../../../lib/api';

// PY-B02 (Octavia's Oct 25 Payroll review): the Run Payroll screen reads the payroll API from
// here: the firm's real one, or on the demo route an in-page client with synthetic data that
// saves and sends nothing.

export type PayrollApi = typeof api.payroll;
const PayrollApiContext = createContext<PayrollApi>(api.payroll);

export const usePayrollApi = (): PayrollApi => useContext(PayrollApiContext);

export function PayrollApiProvider({
  value,
  children,
}: {
  value: PayrollApi;
  children: ReactNode;
}) {
  return <PayrollApiContext.Provider value={value}>{children}</PayrollApiContext.Provider>;
}
