'use client';

import {
  Buildings,
  ChatText,
  EnvelopeSimple,
  MapPin,
  Phone,
  type Icon,
} from '@phosphor-icons/react';
import { Avatar, Button, Skeleton } from '@firmivra/ui';
import type { ReactNode } from 'react';
import type { AdminTeamMember } from '../../../../../mocks/admin-team';
import { MemberMenu, type MemberCommand } from './member-menu';
import { Presence, TitleBadge } from './team-parts';

function Line({ icon: Glyph, children }: { icon: Icon; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-3">
      <Glyph aria-hidden weight="fill" className="size-5 shrink-0 text-action" />
      <span className="min-w-0 wrap-anywhere">{children}</span>
    </li>
  );
}

/** One person in Card View: photo or initials, presence, name, title, details and Message. */
export function MemberCard({
  member,
  selected,
  onSelect,
  onCommand,
}: {
  member: AdminTeamMember;
  selected: boolean;
  onSelect: (on: boolean) => void;
  onCommand: (command: MemberCommand, member: AdminTeamMember) => void;
}) {
  return (
    <article
      data-testid="member-card"
      aria-label={member.name}
      data-selected={selected || undefined}
      className="relative flex min-w-0 flex-col rounded-xl bg-surface p-4 shadow-md data-selected:ring-2 data-selected:ring-action"
    >
      <input
        type="checkbox"
        aria-label={`Select ${member.name}`}
        checked={selected}
        onChange={(event) => onSelect(event.target.checked)}
        className="absolute top-4 left-4 size-5 cursor-pointer"
      />
      <div className="absolute top-3 right-3">
        <MemberMenu member={member} vertical onCommand={onCommand} />
      </div>
      <div className="flex min-w-0 items-start gap-3 pl-7">
        <Avatar name={member.name} size="xl" />
        <div className="flex min-w-0 flex-1 flex-col items-start gap-1.5">
          {/* The presence chip shares its line with the menu button. */}
          <span className="pr-16">
            <Presence value={member.availability} pill />
          </span>
          <button
            type="button"
            onClick={() => onCommand('profile', member)}
            className="text-left text-base font-bold text-heading wrap-anywhere hover:text-action hover:underline"
          >
            {member.name}
            {member.isYou ? <span className="font-normal text-muted"> (you)</span> : null}
          </button>
          <TitleBadge departmentId={member.departmentId}>{member.jobTitle}</TitleBadge>
        </div>
      </div>
      <ul className="mt-4 flex flex-col gap-2 text-sm text-text">
        <Line icon={Buildings}>{member.departmentName}</Line>
        <Line icon={MapPin}>{member.locationName ?? 'No location'}</Line>
        <Line icon={EnvelopeSimple}>
          <a href={`mailto:${member.email}`} className="text-link hover:underline">
            {member.email}
          </a>
        </Line>
        <Line icon={Phone}>
          {member.phone ? (
            <a
              href={`tel:${member.phone.replace(/[^\d+]/g, '')}`}
              className="text-link hover:underline"
            >
              {member.phone}
            </a>
          ) : (
            <span className="text-muted">No phone number</span>
          )}
        </Line>
      </ul>
      <div className="mt-auto flex justify-center pt-4">
        <Button
          variant="secondary"
          disabled={!member.allowed.message}
          onClick={() => onCommand('message', member)}
          aria-label={`Message ${member.name}`}
          className="min-w-32"
        >
          <ChatText aria-hidden weight="fill" className="size-5 text-action" />
          Message
        </Button>
      </div>
    </article>
  );
}

/** A card's frame while the directory loads. */
export function MemberCardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-3 rounded-xl bg-surface p-4 shadow-md">
      <div className="flex items-center gap-3 pl-7">
        <Skeleton className="h-14 w-14 rounded-full" />
        <div className="flex flex-1 flex-col gap-2">
          <Skeleton className="w-16" />
          <Skeleton className="w-28" />
          <Skeleton className="w-24" />
        </div>
      </div>
      <Skeleton className="mt-2 w-3/4" />
      <Skeleton className="w-1/2" />
      <Skeleton className="w-4/5" />
      <Skeleton className="w-2/3" />
      <Skeleton className="mx-auto mt-2 h-10 w-32" />
    </div>
  );
}
