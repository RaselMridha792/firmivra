import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { discTones, tileTones, type TileTone } from './tones';

export interface TimelineItem {
  id: string;
  icon: Icon;
  tone?: TileTone;
  /** "Email sent: **Welcome to LVP**": bold parts as elements. */
  title: ReactNode;
  /** The formatted time ("Sep 18, 2026, 10:24 AM"). */
  time: string;
  /** ISO time for the <time> element. */
  dateTime?: string;
  /** Who did it, on the right ("K. Allen", "System"). */
  actor?: string;
}

export interface TimelineProps {
  items: TimelineItem[];
  /**
   * `rail`: hollow dots on a line, a soft icon disc, the time under the title, the actor on the
   * right (Lead Profile's Recent Activity). `connected`: solid icon discs joined by a line and the
   * time on the right (Intake's Activity Timeline). `plain`: soft icon discs, no line (Settings'
   * Recent Changes and Recent Administrative Activity).
   */
  variant?: 'rail' | 'connected' | 'plain';
  emptyText?: string;
  /** The list's accessible name. */
  label?: string;
}

/** A vertical activity list, newest first as given. */
export function Timeline({
  items,
  variant = 'rail',
  emptyText = 'No activity yet.',
  label = 'Activity',
}: TimelineProps) {
  if (items.length === 0) {
    return <p className="py-4 text-sm text-muted">{emptyText}</p>;
  }
  return (
    <ol aria-label={label} className="flex flex-col">
      {items.map((item, index) => {
        const tone = item.tone ?? 'blue';
        const last = index === items.length - 1;
        const time = (
          <time dateTime={item.dateTime} className="text-sm text-muted">
            {item.time}
          </time>
        );
        if (variant === 'connected') {
          return (
            <li key={item.id} className="relative flex items-center gap-3 py-1.5">
              {last ? null : (
                <span
                  aria-hidden
                  className="absolute top-1/2 left-3.5 h-full w-0.5 bg-folder-border"
                />
              )}
              <span
                className={`relative flex size-7 shrink-0 items-center justify-center rounded-full ${discTones[tone]}`}
              >
                <item.icon aria-hidden weight="fill" className="size-4" />
              </span>
              <span className="min-w-0 flex-1 text-sm text-text">{item.title}</span>
              {time}
            </li>
          );
        }
        return (
          <li
            key={item.id}
            className={`relative flex items-center gap-3 py-3 ${last || variant === 'plain' ? '' : 'border-b border-divider'}`}
          >
            {variant === 'rail' ? (
              <span aria-hidden className="relative flex w-4 shrink-0 justify-center self-stretch">
                <span
                  className={`absolute w-0.5 bg-folder-border ${index === 0 ? 'top-1/2' : '-top-3'} ${last ? 'bottom-1/2' : '-bottom-3'}`}
                />
                <span className="relative my-auto size-3 rounded-full border-2 border-heading bg-surface" />
              </span>
            ) : null}
            <span
              className={`flex size-10 shrink-0 items-center justify-center rounded-full ${tileTones[tone]}`}
            >
              <item.icon aria-hidden weight="fill" className="size-5" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-sm text-heading">{item.title}</span>
              {time}
            </span>
            {item.actor ? <span className="shrink-0 text-sm text-muted">{item.actor}</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
