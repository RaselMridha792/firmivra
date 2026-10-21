import { FIRM_ROLE_LABELS, type MembershipRole, type StaffListItem } from '@firmivra/types';

/** The design's role chips: one tint per role (Administrator amber, Staff blue, Manager purple). */
const ROLE_CHIPS: Record<MembershipRole, string> = {
  OWNER: 'bg-warning-soft text-warning',
  ADMIN: 'bg-warning-soft text-warning',
  MANAGER: 'bg-purple-soft text-purple',
  STAFF: 'bg-info-soft text-link',
  BOOKKEEPER: 'bg-info-soft text-link',
  TAX_PREPARER: 'bg-info-soft text-link',
  CLIENT_SUPPORT: 'bg-info-soft text-link',
  BUSINESS_CONSULTANT: 'bg-info-soft text-link',
  READ_ONLY: 'bg-disabled text-text',
};

/** The design's status chips with their dot; DEACTIVATED reads "Inactive" (R42 contract). */
const STATUS_CHIPS: Record<StaffListItem['status'], { label: string; chip: string; dot: string }> =
  {
    ACTIVE: { label: 'Active', chip: 'bg-success-soft text-success', dot: 'bg-success' },
    INVITED: { label: 'Invited', chip: 'bg-warning-soft text-warning', dot: 'bg-gold' },
    LOCKED: { label: 'Locked', chip: 'bg-danger-soft text-danger', dot: 'bg-danger' },
    DEACTIVATED: { label: 'Inactive', chip: 'bg-disabled text-text', dot: 'bg-muted' },
  };

const chip = 'inline-flex items-center rounded-md px-2.5 py-0.5 font-medium whitespace-nowrap';

export function RoleChip({ role }: { role: MembershipRole }) {
  return (
    <span
      data-testid="staff-role"
      className={`${chip} min-w-28 justify-center ${ROLE_CHIPS[role]}`}
    >
      {FIRM_ROLE_LABELS[role]}
    </span>
  );
}

export function StatusChip({ status }: { status: StaffListItem['status'] }) {
  const look = STATUS_CHIPS[status];
  return (
    <span data-testid="staff-status" className={`${chip} gap-2 ${look.chip}`}>
      <span aria-hidden className={`size-2.5 rounded-full ${look.dot}`} />
      {look.label}
    </span>
  );
}

const day = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const time = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/**
 * Last Login as the design writes it: "Today 9:12 AM" or "Sep 28, 2026 4:15 PM". Someone not yet
 * joined shows their invite instead ("Invited Sep 25, 2026", or "Invite expired").
 */
export function LastLogin({ member, now }: { member: StaffListItem; now: number }) {
  if (member.status === 'INVITED') {
    const invite = member.invite;
    if (invite && Date.parse(invite.expiresAt) < now)
      return <span className="whitespace-nowrap text-danger">Invite expired</span>;
    return (
      <span className="whitespace-nowrap">
        {invite ? `Invited ${day(new Date(invite.sentAt))}` : 'Invited'}
      </span>
    );
  }
  if (!member.lastLoginAt) return <span className="whitespace-nowrap text-muted">Never</span>;
  const at = new Date(member.lastLoginAt);
  const today = at.toDateString() === new Date(now).toDateString();
  return <span className="whitespace-nowrap">{`${today ? 'Today' : day(at)} ${time(at)}`}</span>;
}
