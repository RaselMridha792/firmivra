'use client';

import { Info } from '@phosphor-icons/react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export interface HelpTipProps {
  /** What it explains ("Merge fields"): the bubble's title, and the icon is read "About Merge fields". */
  topic: string;
  /**
   * One to three short sentences: what the area is for, what it needs, its limits and what
   * happens. Text and inline marks only (it is also the icon's description for screen readers).
   */
  children: ReactNode;
  className?: string;
}

/** Why the bubble is open: a mouse on the icon or bubble, keyboard focus, or a press (click, tap, Enter). */
export interface HelpTipState {
  hover: boolean;
  focus: boolean;
  pinned: boolean;
  /** Escape, a second press or a press elsewhere closed it; it stays closed until the next hover or focus. */
  dismissed: boolean;
}
export type HelpTipEvent = 'enter' | 'leave' | 'focus' | 'blur' | 'press' | 'escape' | 'outside';

export const HELP_TIP_CLOSED: HelpTipState = {
  hover: false,
  focus: false,
  pinned: false,
  dismissed: false,
};

export function helpTipOpen(state: HelpTipState): boolean {
  return !state.dismissed && (state.hover || state.focus || state.pinned);
}

/**
 * The bubble's rules. Hover and keyboard focus show it while they last; a press keeps it open
 * (a tap has no hover) until a second press, Escape, a press elsewhere or focus moving away.
 */
export function nextHelpTip(state: HelpTipState, event: HelpTipEvent): HelpTipState {
  switch (event) {
    case 'enter':
      return state.hover ? state : { ...state, hover: true, dismissed: false };
    case 'leave':
      return { ...state, hover: false };
    case 'focus':
      return { ...state, focus: true, dismissed: false };
    case 'blur':
      return { ...state, focus: false, pinned: false };
    case 'press':
      return state.pinned
        ? { ...state, pinned: false, dismissed: true }
        : { ...state, pinned: true, dismissed: false };
    case 'escape':
      return { ...state, pinned: false, dismissed: true };
    case 'outside':
      return { ...state, hover: false, pinned: false, dismissed: true };
  }
}

/** Space kept between the bubble and the icon, and between the bubble and the window's edges. */
const GAP = 6;
const EDGE = 8;
/** How long a mouse may take to cross from the icon to the bubble. */
const LEAVE_MS = 150;

/**
 * Where the bubble goes: below the icon, or above it when there is more room there; centred on
 * the icon but always inside the window.
 */
export function placeTip(
  trigger: { top: number; bottom: number; left: number; right: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
): { top: number; left: number } {
  const below = viewport.height - trigger.bottom - GAP - EDGE;
  const above = trigger.top - GAP - EDGE;
  const up = tip.height > below && above > below;
  const top = up ? Math.max(EDGE, trigger.top - GAP - tip.height) : trigger.bottom + GAP;
  const centred = (trigger.left + trigger.right) / 2 - tip.width / 2;
  const left = Math.max(EDGE, Math.min(centred, viewport.width - tip.width - EDGE));
  return { top, left };
}

/**
 * The info icon beside a functional area: a short explainer on hover, keyboard focus and tap or
 * click, closed by Escape, a press elsewhere or moving away. The bubble is drawn above the page
 * (in the icon's dialog when it is in one) and stays inside the window; screen readers hear the
 * same text as the icon's description.
 */
export function HelpTip({ topic, children, className = '' }: HelpTipProps) {
  const [state, dispatch] = useReducer(nextHelpTip, HELP_TIP_CLOSED);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const open = helpTipOpen(state) && host !== null;
  const rootRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const leaveTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const descriptionId = useId();

  const show = (event: HelpTipEvent, from: HTMLElement) => {
    setHost((current) => current ?? from.closest('dialog') ?? document.body);
    dispatch(event);
  };
  const enter = (from: HTMLElement) => {
    clearTimeout(leaveTimerRef.current);
    show('enter', from);
  };
  const leaveSoon = () => {
    clearTimeout(leaveTimerRef.current);
    leaveTimerRef.current = setTimeout(() => dispatch('leave'), LEAVE_MS);
  };

  useEffect(() => () => clearTimeout(leaveTimerRef.current), []);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const button = buttonRef.current;
      const tip = tipRef.current;
      if (!button || !tip) return;
      const at = placeTip(
        button.getBoundingClientRect(),
        { width: tip.offsetWidth, height: tip.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      tip.style.top = `${at.top}px`;
      tip.style.left = `${at.left}px`;
      tip.style.visibility = 'visible';
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !tipRef.current?.contains(target)) {
        dispatch('outside');
      }
    };
    // Escape closes it wherever focus is (a hover needs no focus); the first Escape in a dialog
    // closes the bubble, not the dialog.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      dispatch('escape');
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  const tip = (
    <div
      ref={tipRef}
      aria-hidden
      data-testid="help-tip"
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') clearTimeout(leaveTimerRef.current);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') leaveSoon();
      }}
      style={{ position: 'fixed', top: 0, left: 0, visibility: 'hidden' }}
      className="z-50 w-72 max-w-[calc(100vw-1rem)] rounded-xl border border-divider bg-surface p-3 text-left text-sm font-normal text-text shadow-lg"
    >
      <span className="block font-semibold text-heading">{topic}</span>
      <span className="mt-1 block leading-relaxed">{children}</span>
    </div>
  );

  return (
    <span ref={rootRef} className={`inline-flex align-middle ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label={`About ${topic}`}
        aria-expanded={open}
        aria-describedby={descriptionId}
        onPointerEnter={(event) => {
          if (event.pointerType === 'mouse') enter(event.currentTarget);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') leaveSoon();
        }}
        onFocus={(event) => {
          // Keyboard focus only: a click or tap focuses too, and is handled as a press.
          if (event.currentTarget.matches(':focus-visible')) show('focus', event.currentTarget);
        }}
        onBlur={() => dispatch('blur')}
        onClick={(event) => show('press', event.currentTarget)}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted hover:text-heading focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-expanded:text-action"
      >
        <Info aria-hidden weight="bold" className="size-4" />
      </button>
      <span id={descriptionId} hidden>
        {children}
      </span>
      {open ? createPortal(tip, host) : null}
    </span>
  );
}
