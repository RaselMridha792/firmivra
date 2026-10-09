import type { EsignAccessRole } from '@firmivra/types';
import { Card } from '@firmivra/ui';
import {
  CircleHelp,
  FilePlus,
  Layers,
  type LucideIcon,
  Monitor,
  Settings,
  Upload,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { canCreate, isFirmManager } from '../../../../../components/esign/esign-role';

interface Action {
  label: string;
  icon: LucideIcon;
  href: string;
  /** Who sees it: creating needs more than view access; settings are Owner and Admin. */
  who: 'create' | 'managers' | 'all';
  soon?: true;
}

const ACTIONS: Action[] = [
  {
    label: 'Create Template',
    icon: FilePlus,
    href: '/firm-sign/templates',
    who: 'create',
    soon: true,
  },
  {
    label: 'Upload a Template',
    icon: Upload,
    href: '/firm-sign/templates?new=1',
    who: 'create',
    soon: true,
  },
  { label: 'Manage Templates', icon: Layers, href: '/firm-sign/templates', who: 'all', soon: true },
  { label: 'Bulk Send', icon: Users, href: '/firm-sign/bulk', who: 'create', soon: true },
  // In person starts from a request whose signer signs on this device.
  { label: 'In-Person Signing', icon: Monitor, href: '/firm-sign/requests', who: 'create' },
  {
    label: 'Signing Settings',
    icon: Settings,
    href: '/firm-sign/settings',
    who: 'managers',
    soon: true,
  },
];

const visible = (a: Action, role: EsignAccessRole | null) =>
  a.who === 'all' ||
  (a.who === 'create' && canCreate(role)) ||
  (a.who === 'managers' && isFirmManager(role));

/** The mockup's Quick Actions and Need Help panels. */
export function QuickActions({ role }: { role: EsignAccessRole | null }) {
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <h2 className="mb-4 font-display text-2xl text-heading">Quick Actions</h2>
        <ul className="flex flex-col gap-2">
          {ACTIONS.filter((a) => visible(a, role)).map(({ label, icon: Icon, href, soon }) => {
            const body = (
              <>
                <Icon aria-hidden className="size-5 text-brand-700" />
                <span className="flex-1">{label}</span>
                {soon && <span className="text-xs text-muted">Soon</span>}
              </>
            );
            const look =
              'flex min-h-11 items-center gap-3 rounded-control bg-brand-50 px-3 text-sm font-medium text-heading';
            return (
              <li key={label}>
                {soon ? (
                  <div aria-disabled="true" className={`${look} opacity-70`}>
                    {body}
                  </div>
                ) : (
                  <Link
                    href={href}
                    className={`${look} hover:bg-brand-100 focus-visible:outline-2 focus-visible:outline-focus`}
                  >
                    {body}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
      <Card>
        <div className="flex gap-3">
          <CircleHelp aria-hidden className="size-8 shrink-0 text-platform-navy" />
          <div className="flex flex-col gap-1">
            <h2 className="font-semibold text-heading">Need Help?</h2>
            <p className="text-sm text-muted">View guides or contact support.</p>
            <p className="text-sm text-muted">Help Center: Soon</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

const STEPS = [
  { title: 'Choose Document', text: 'Upload or use a template' },
  { title: 'Add Recipients', text: 'Auto-fill from client data' },
  { title: 'Prepare & Send', text: 'Add fields, set order, review' },
  { title: 'Track & Complete', text: "Stay informed until it's signed" },
];

/** The mockup's four steps. */
export function HowItWorks() {
  return (
    <Card>
      <h2 className="mb-6 font-display text-2xl text-heading">How It Works</h2>
      <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex flex-col items-center gap-2 text-center">
            <span
              aria-hidden="true"
              className={`flex size-12 items-center justify-center rounded-pill text-xl font-semibold ${
                i % 2 ? 'bg-warning-soft text-heading' : 'bg-brand-100 text-heading'
              }`}
            >
              {i + 1}
            </span>
            <span className="text-lg font-semibold text-heading">{s.title}</span>
            <span className="text-sm text-muted">{s.text}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
