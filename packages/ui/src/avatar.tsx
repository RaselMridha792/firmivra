const sizes = {
  sm: 'size-6 text-[0.625rem]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-14 text-lg',
};
export type AvatarSize = keyof typeof sizes;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join('');

/** A photo, or the person's initials on a lavender disc when there is none. */
export function Avatar({
  name,
  src,
  size = 'md',
}: {
  name: string;
  src?: string;
  size?: AvatarSize;
}) {
  return src ? (
    <img src={src} alt={name} className={`${sizes[size]} shrink-0 rounded-full object-cover`} />
  ) : (
    <span
      role="img"
      aria-label={name}
      className={`${sizes[size]} inline-flex shrink-0 items-center justify-center rounded-full bg-purple-soft font-semibold text-purple`}
    >
      {initials(name)}
    </span>
  );
}

/** Overlapping avatars with "+n" for the rest. */
export function AvatarGroup({
  people,
  max = 3,
  size = 'md',
}: {
  people: { name: string; src?: string }[];
  max?: number;
  size?: AvatarSize;
}) {
  const extra = people.length - max;
  return (
    <div role="group" aria-label={people.map((p) => p.name).join(', ')} className="flex -space-x-2">
      {people.slice(0, max).map((person) => (
        <span key={person.name} className="rounded-full ring-2 ring-surface">
          <Avatar {...person} size={size} />
        </span>
      ))}
      {extra > 0 ? (
        <span
          className={`${sizes[size]} inline-flex items-center justify-center rounded-full bg-table-head font-semibold text-muted ring-2 ring-surface`}
        >
          +{extra}
        </span>
      ) : null}
    </div>
  );
}
