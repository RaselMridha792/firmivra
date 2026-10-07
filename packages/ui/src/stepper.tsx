export interface StepItem {
  id: string;
  label: string;
}
/** Progress is announced without making incomplete steps look finished. */
export function Stepper({
  steps,
  current,
  label = 'Setup progress',
}: {
  steps: StepItem[];
  current: string;
  label?: string;
}) {
  const index = steps.findIndex((step) => step.id === current);
  return (
    <ol aria-label={label} className="flex flex-wrap gap-4">
      {steps.map((step, number) => (
        <li
          key={step.id}
          aria-current={step.id === current ? 'step' : undefined}
          className="flex items-center gap-2 text-sm"
        >
          <span
            aria-hidden="true"
            className={`flex h-8 w-8 items-center justify-center rounded-full ${number <= index ? 'bg-action text-on-action' : 'bg-disabled text-muted'}`}
          >
            {number < index ? '✓' : number + 1}
          </span>
          <span className={step.id === current ? 'font-semibold text-heading' : 'text-muted'}>
            {step.label}
            {number < index ? <span className="sr-only">, completed</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}
