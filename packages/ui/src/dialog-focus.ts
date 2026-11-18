// Integrations Review Two I-R2-09: Tab and Shift+Tab stay inside an open dialog. The native modal
// dialog keeps focus off the page behind it, but Tab past the last control still leaves for the
// browser's own toolbar; from the last control Tab now goes back to the first, and Shift+Tab from
// the first goes to the last. Anywhere in between, the browser moves focus as usual.

/**
 * Where Tab (or Shift+Tab, `back`) should go from `from` among a dialog's stops in order, or null
 * to let the browser move focus. `same` says when two stops are one (a radio group is one stop).
 */
export function wrapStop<T>(
  stops: readonly T[],
  from: T | null,
  back: boolean,
  same: (a: T, b: T) => boolean = Object.is,
): T | null {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (first === undefined || last === undefined || from === null) return null;
  if (!stops.some((s) => same(s, from))) return null;
  if (back) return same(from, first) ? last : null;
  return same(from, last) ? first : null;
}

const STOPS =
  'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]';

/** The controls Tab reaches in `root`, in page order: shown, enabled and not taken out of order. */
export function dialogStops(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(STOPS)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !el.matches(':disabled') &&
      !(el instanceof HTMLInputElement && el.type === 'hidden') &&
      !el.closest('[inert]') &&
      el.getClientRects().length > 0,
  );
}

const radio = (el: HTMLElement): el is HTMLInputElement =>
  el instanceof HTMLInputElement && el.type === 'radio' && el.name !== '';

/** One Tab stop: the same control, or two radios of one group. */
export function sameStop(a: HTMLElement, b: HTMLElement): boolean {
  return a === b || (radio(a) && radio(b) && a.name === b.name && a.form === b.form);
}

/** Focuses a stop; for a radio group, its chosen radio, as the browser would. */
export function focusStop(stop: HTMLElement, stops: readonly HTMLElement[]): void {
  const chosen = radio(stop)
    ? stops.find((s): s is HTMLInputElement => sameStop(s, stop) && radio(s) && s.checked)
    : undefined;
  (chosen ?? stop).focus();
}
