'use client';

import { CaretRight, UsersThree } from '@phosphor-icons/react';
import Link from 'next/link';
import { useState } from 'react';
import { type DirectoryStatus, StaffDirectory } from '../../_components/staff-directory';

/**
 * The dedicated Staff Directory (Octavia's SM9): Manage Staff Accounts, Staff Settings > Staff
 * Directory and the summary cards all open it, with search, the department and status filters
 * (Drafts for the Owner and Admins) and each person's actions.
 */
export function DirectoryScreen({ view }: { view: DirectoryStatus }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-2">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <Link href="/team" className="text-link hover:underline">
            Staff Management
          </Link>
          <CaretRight aria-hidden weight="bold" className="size-3 text-muted" />
          <span aria-current="page" className="font-semibold text-heading">
            Staff Directory
          </span>
        </nav>
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-xl bg-action text-on-action">
            <UsersThree aria-hidden weight="fill" className="size-9" />
          </span>
          <div className="min-w-0">
            <h1 data-testid="page-title" className="text-3xl font-bold text-heading">
              Staff Directory
            </h1>
            <p className="text-lg text-link">Find, filter and manage every staff account.</p>
          </div>
        </div>
      </header>
      <StaffDirectory selected={selected} onSelect={setSelected} initialView={view} />
    </div>
  );
}
