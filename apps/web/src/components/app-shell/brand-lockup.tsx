export function BrandLockup({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex items-center gap-3" aria-label={`Firmivra ${subtitle}`}>
      <svg aria-hidden="true" viewBox="0 0 52 58" className="size-12 shrink-0">
        <defs>
          <linearGradient id="firmivra-mark-blue" x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="#0874ef" />
            <stop offset="1" stopColor="#21b9ef" />
          </linearGradient>
          <linearGradient id="firmivra-mark-teal" x1="0" y1="1" x2="1" y2="0">
            <stop stopColor="#00a7a5" />
            <stop offset="1" stopColor="#63f0c7" />
          </linearGradient>
        </defs>
        <path d="M5 18 44 0v15L18 28v25L5 45z" fill="url(#firmivra-mark-blue)" />
        <path d="m19 12 25-12v15L19 27z" fill="url(#firmivra-mark-teal)" />
        <path d="m5 18 14 8v17L5 35z" fill="#0756c9" />
        <path d="m19 27 25-13v14L19 42z" fill="#087bdc" />
      </svg>
      <span className="min-w-0">
        <span className="block text-[1.7rem] font-bold leading-none tracking-tight">Firmivra</span>
        <span className="mt-2 block text-[0.6rem] font-medium uppercase tracking-[0.3em] text-brand-100">
          {subtitle}
        </span>
      </span>
    </div>
  );
}
