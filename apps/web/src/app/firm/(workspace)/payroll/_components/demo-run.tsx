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
  // The lead (Nov 7): three sample employees, round figures, so the pay grid has rows to review.
  const addSamples = async (payrollClientId: string, runId: string) => {
    const samples = [
      {
        name: 'Alex Rivera (sample)',
        type: 'FULL_TIME',
        pay: 'SALARY',
        hours: 160,
        cents: 400_000,
      },
      { name: 'Jordan Lee (sample)', type: 'PART_TIME', pay: 'HOURLY', hours: 80, cents: 200_000 },
      { name: 'Sam Patel (sample)', type: 'CONTRACTOR', pay: 'HOURLY', hours: 40, cents: 200_000 },
    ] as const;
    const lines = [];
    for (const s of samples) {
      const w = await client.addWorker(payrollClientId, {
        displayName: s.name,
        workerType: s.type,
        payType: s.pay,
        rateCents: s.pay === 'HOURLY' ? s.cents / s.hours : s.cents,
      });
      lines.push({
        workerId: w.id,
        hours: s.hours,
        regularPayCents: s.cents,
        deductionsCents: s.type === 'CONTRACTOR' ? 0 : 30_000,
      });
    }
    await client.saveRunLines(runId, { lines });
  };
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
        if (open.lineCounts.total === 0) await addSamples(open.payrollClientId, open.id);
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
      await addSamples(first.id, made.id);
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
