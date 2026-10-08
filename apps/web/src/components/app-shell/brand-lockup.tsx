export function BrandLockup({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-center gap-3" aria-label={`Firmivra ${subtitle}`}>
      <svg aria-hidden="true" viewBox="0 0 52 58" className="size-12 shrink-0">
        <path className="fill-action" d="M5 18 44 0v15L18 28v25L5 45z" />
        <path className="fill-accent" d="m19 12 25-12v15L19 27z" />
        <path className="fill-action" d="m5 18 14 8v17L5 35z" />
        <path className="fill-info" d="m19 27 25-13v14L19 42z" />
      </svg>
      <span className="min-w-0">
        <span className="block text-2xl font-bold leading-none tracking-tight">Firmivra</span>
        <span className="mt-2 block text-xs font-medium uppercase tracking-eyebrow text-brand-100">
          {subtitle}
        </span>
      </span>
    </div>
  );
}
