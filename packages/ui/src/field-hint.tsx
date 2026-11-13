// Persistent helper text for a labelled field (Input, Textarea, Select): it sits between the label
// and the control, is always visible (no hover) and describes the control for assistive
// technology. Octavia's review of Oct 25, B14.

/** The control's `aria-describedby`: its hint, then its error; nothing when it has neither. */
export function describedBy(fieldId: string, hint?: string, error?: string): string | undefined {
  const ids = [hint ? `${fieldId}-hint` : null, error ? `${fieldId}-error` : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

/** The helper text under the label; renders nothing when there is no hint. */
export function FieldHint({ id, hint }: { id: string; hint?: string | undefined }) {
  if (!hint) return null;
  return (
    <p id={`${id}-hint`} className="text-sm text-muted">
      {hint}
    </p>
  );
}
