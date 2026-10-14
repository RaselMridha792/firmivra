import type { Icon } from '@phosphor-icons/react';

const TONES = {
  blue: 'bg-info-soft text-info',
  amber: 'bg-warning-soft text-gold',
  red: 'bg-danger-soft text-danger',
  purple: 'bg-purple-soft text-purple',
  green: 'bg-success-soft text-success',
} as const;

export type Tone = keyof typeof TONES;

/** A round tinted tile behind a solid icon in a stronger shade of the same colour. */
export function IconTile({
  icon: Glyph,
  tone,
  small = false,
}: {
  icon: Icon;
  tone: Tone;
  small?: boolean;
}) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full ${small ? 'size-11' : 'size-14'} ${TONES[tone]}`}
    >
      <Glyph aria-hidden weight="fill" className={small ? 'size-6' : 'size-7'} />
    </span>
  );
}
