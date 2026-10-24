'use client';

import { Button, LinkCard, Modal, Select } from '@firmivra/ui';
import {
  ChartBar,
  FileText,
  GearSix,
  type Icon,
  LockKey,
  Network,
  ShieldCheck,
  UploadSimple,
  UserPlus,
  UsersThree,
} from '@phosphor-icons/react';
import { useRouter } from 'next/navigation';
import { type MouseEvent, useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { NOT_LOADED } from './quiet-card';

/** The directory section's id: Manage Staff Accounts scrolls to it. */
export const DIRECTORY_ID = 'staff-directory';

interface Tile {
  title: string;
  description: string;
  icon: Icon;
  /** Empty for Account Access & Security, which asks whose page first. */
  href: string;
}

/**
 * The nine tiles, as in the design and the guide §1. Reports has no staff filter yet, so it opens
 * the Reports overview (PAGE-MAP: "Reports from Staff Management opens /reports").
 */
const TILES: Tile[] = [
  {
    title: 'Create Staff Account',
    description: 'Add a new team member and set their role, permissions, and access.',
    icon: UserPlus,
    href: '/team/new',
  },
  {
    title: 'Manage Staff Accounts',
    description: 'View, edit, or deactivate staff accounts.',
    icon: UsersThree,
    // Octavia's SM9: one dedicated directory view, also from Staff Settings.
    href: '/team/directory',
  },
  {
    title: 'Roles & Permissions',
    description: 'Create and manage roles. Set what each staff member can see and do.',
    icon: ShieldCheck,
    href: '/team/roles',
  },
  {
    title: 'Teams & Departments',
    description: 'Organize staff into teams or departments.',
    icon: Network,
    href: '/team/departments',
  },
  {
    title: 'Account Access & Security',
    description: 'Reset passwords, manage MFA, and control sign-in access.',
    icon: LockKey,
    href: '',
  },
  {
    title: 'Activity & Login History',
    description: 'View staff activity, login history, and security logs.',
    icon: FileText,
    href: '/team/activity',
  },
  {
    title: 'Bulk Upload Staff',
    description: 'Add or update multiple staff accounts using a template file.',
    icon: UploadSimple,
    href: '/team/import',
  },
  {
    title: 'Staff Settings',
    description: 'Configure staff-related preferences and default access.',
    icon: GearSix,
    href: '/team/settings',
  },
  {
    title: 'Reports',
    description: 'View staff performance, activity, and access reports.',
    icon: ChartBar,
    href: '/reports',
  },
];

/**
 * The tiles under the summary cards (the kit's LinkCard). A plain click moves inside the app;
 * Ctrl or Cmd click still opens a new tab. Account Access & Security opens the security page of
 * the one staff member ticked in the directory, or asks whose page to open.
 */
export function StaffLinks({ selected }: { selected: string[] }) {
  const router = useRouter();
  const [picking, setPicking] = useState(false);
  const go = (href: string) => (event: MouseEvent<HTMLElement>) => {
    if (href.startsWith('#')) return;
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    router.push(href);
  };
  return (
    <>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="staff-links">
        {TILES.map((tile) => (
          <li key={tile.title} className="flex min-w-0">
            {tile.href ? (
              <LinkCard
                icon={tile.icon}
                title={tile.title}
                description={tile.description}
                href={tile.href}
                onClick={go(tile.href)}
              />
            ) : (
              <LinkCard
                icon={tile.icon}
                title={tile.title}
                description={tile.description}
                onClick={() => {
                  const [only] = selected;
                  if (selected.length === 1 && only) router.push(`/team/${only}/security`);
                  else setPicking(true);
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {picking ? (
        <PickStaffModal
          initial={selected[0] ?? ''}
          onClose={() => setPicking(false)}
          onPick={(id) => router.push(`/team/${id}/security`)}
        />
      ) : null}
    </>
  );
}

/** Account Access & Security: whose page to open, when not one person is ticked. */
function PickStaffModal({
  initial,
  onClose,
  onPick,
}: {
  initial: string;
  onClose: () => void;
  onPick: (id: string) => void;
}) {
  // The first 100 staff members: the most one page of the contract returns.
  const people = useApiQuery(['staff', 'list', 'pick'], () => api.staff.list({ pageSize: 100 }));
  const [id, setId] = useState(initial);
  const items = people.data?.items ?? [];
  const chosen = items.find((m) => m.id === id);
  return (
    <Modal
      open
      title="Account Access & Security"
      subtitle="Choose the staff member whose sign-in access and security to open."
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <Select
          label="Staff member"
          disabled={people.isPending}
          options={[
            {
              value: '',
              label: people.isPending
                ? 'Loading staff members'
                : items.length
                  ? 'Choose a staff member'
                  : 'No staff members to choose',
            },
            ...items.map((m) => ({ value: m.id, label: `${m.name} (${m.email})` })),
          ]}
          value={chosen ? id : ''}
          onChange={(event) => setId(event.target.value)}
        />
        {people.isError ? (
          <p role="alert" className="text-sm text-muted">
            {NOT_LOADED}
          </p>
        ) : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!chosen} onClick={() => chosen && onPick(chosen.id)}>
            Open Security
          </Button>
        </div>
      </div>
    </Modal>
  );
}
