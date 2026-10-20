export const linkClass =
  'inline-flex min-h-9 items-center justify-center gap-2 rounded-control border border-action px-3 py-1.5 text-center text-sm font-semibold text-action hover:bg-info-soft focus-visible:outline-2 focus-visible:outline-focus';
export const dateLabel = (value: string | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(value))
    : 'Not checked yet';
