/**
 * A field label as the designs draw it: a trailing " *" (required) in red. The text, and so the
 * field's accessible name ("First Name *"), stays the same.
 */
export function LabelText({ label }: { label: string }) {
  if (!label.endsWith(' *')) return <>{label}</>;
  return (
    <>
      {label.slice(0, -2)}
      <span className="text-danger"> *</span>
    </>
  );
}
