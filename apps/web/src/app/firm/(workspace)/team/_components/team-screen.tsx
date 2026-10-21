'use client';

import { useState } from 'react';
import { StaffDirectory } from './staff-directory';
import { StaffHeader } from './staff-header';
import { StaffKpis } from './staff-kpis';
import { StaffLinks } from './staff-links';

/**
 * Staff Management (staff-mangement.jpg, guide §1): the header, the four summary cards, the nine
 * tiles and the Staff Directory. Create Staff Account and Add Staff open the four-step wizard
 * (/team/new); each person's ⋮ menu opens their pages and the account actions their status
 * allows. Owner and Admin change; the API checks every rule again. Each part keeps its frame when
 * its call fails (design-match rule 2).
 */
export function TeamScreen() {
  // The directory's ticks: Account Access & Security opens the one ticked person's page.
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StaffHeader />
      <StaffKpis />
      <StaffLinks selected={selected} />
      <StaffDirectory selected={selected} onSelect={setSelected} />
    </div>
  );
}
