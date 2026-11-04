import type { ReactNode } from 'react';
import { ReportsDayWatch } from './_components/report-date-controls';

/** Every Reports page: its ranges follow the firm's day, which turns at the firm's midnight (RP-F04). */
export default function ReportsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <ReportsDayWatch />
      {children}
    </>
  );
}
