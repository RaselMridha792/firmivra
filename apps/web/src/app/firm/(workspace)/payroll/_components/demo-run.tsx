'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { createPayrollMock } from '../../../../../mocks/payroll';
import { PayrollApiProvider } from './payroll-api';
import { RunScreen } from './run-screen';
import { PAYROLL_KEY, quiet } from './payroll-shared';

/**
 * /payroll/runs/demo (PY-B02, Octavia's Oct 25 Payroll review): the five Run Payroll steps
 * (Payroll Period, Employees & Hours, Earnings & Deductions, Taxes & Employer Costs, Review &
 * Approve) on a synthetic run that lives in this page only. No payroll is processed: a draft can
 * be saved, but Mark Ready, Approve and Submit are off, nothing is sent to a payroll provider, and
 * leaving the page forgets it.
 */
export function DemoRunScreen() {
  // One synthetic payroll for the page: the firm's data is never read or written here.
  const [client] = useState(() => createPayrollMock({ role: 'OWNER' }));
  const demo = useQuery({
    queryKey: [...PAYROLL_KEY, 'demo-run'],
    queryFn: async () => {
      const page = await client.runs({});
      // The run being prepared with the most lines, so the pay grid has rows (one not started
      // is started, in this page only); else a new one.
      const candidates = page.items.filter((r) =>
        ['DRAFT', 'IN_PROGRESS', 'NOT_STARTED'].includes(r.status),
      );
      const full = await Promise.all(candidates.map((r) => client.getRun(r.id)));
      const open = full.sort((x, y) => y.lineCounts.total - x.lineCounts.total)[0];
      if (open) {
        if (open.status === 'NOT_STARTED') await client.updateRun(open.id, { step: 1 });
        return open.id;
      }
      const first = (await client.clients({})).items[0];
      if (!first) return null;
      const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
      const made = await client.createRun(first.id, {
        periodStart: day(-13),
        periodEnd: day(0),
        payDate: day(5),
      });
      return made.id;
    },
    staleTime: Infinity,
  });
  if (!demo.data) {
    return (
      <p className={quiet}>{demo.isPending ? 'Loading…' : 'The demo run is not available.'}</p>
    );
  }
  return (
    <PayrollApiProvider value={client}>
      <RunScreen id={demo.data} demo />
    </PayrollApiProvider>
  );
}
