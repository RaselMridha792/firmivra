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
  const addSamples = async (payrollClientId: string) => {
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
    return lines;
  };
  const demo = useQuery({
    queryKey: [...PAYROLL_KEY, 'demo-run'],
    queryFn: async () => {
      // PY-B02, N01: a run of its own holding only the three samples, so the grid shows what the
      // banner says ("The three employees are samples"). A run takes every active employee of its
      // client, so in this page's own mock the client's employees are set inactive first.
      const c = (await client.clients({})).items.find((x) => x.provider && x.status !== 'ON_HOLD');
      if (!c) return null;
      const own = await client.workers(c.id, { pageSize: 100 });
      for (const w of own.items) await client.updateWorker(c.id, w.id, { status: 'INACTIVE' });
      const lines = await addSamples(c.id);
      const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
      // This period, else a later one when the client's run for it has started already.
      for (const offset of [0, 28, 56]) {
        try {
          const made = await client.createRun(c.id, {
            periodStart: day(offset - 13),
            periodEnd: day(offset),
            payDate: day(offset + 5),
          });
          await client.saveRunLines(made.id, { lines });
          return made.id;
        } catch {
          // A run for that period exists: the next period.
        }
      }
      return null;
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
