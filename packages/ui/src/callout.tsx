import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { discTones, textTones, tileTones, type TileTone } from './tones';

const surfaces = {
  info: 'bg-info-soft',
  success: 'bg-success-soft',
  warning: 'bg-warning-soft',
  plain: 'border border-border bg-subtle',
};
export type CalloutSurface = keyof typeof surfaces;

export interface CalloutProps {
  icon: Icon;
  title?: string;
  children?: ReactNode;
  /** A link ("Go to Automations →") or button ("View Guide") under the text. */
  action?: ReactNode;
  surface?: CalloutSurface;
  /** `disc`: a solid round icon (Pro Tip's bulb, "Need Help?"); `tile`: a soft square tile. */
  iconStyle?: 'disc' | 'tile';
  /** The disc's or tile's colour. */
  tone?: TileTone;
  /** `tip`: the title in the action blue ("Pro Tip:"); `default`: navy. */
  titleStyle?: 'tip' | 'default';
  /** `compact`: one line of small text, icon inline (the "visible to administrators only" notes). */
  size?: 'default' | 'compact';
}

/**
 * A highlighted note: Pro Tip, Need Help?, Make It Yours, and the small notices beside a form
 * ("Compensation details are only visible to administrators").
 */
export function Callout({
  icon: Glyph,
  title,
  children,
  action,
  surface = 'info',
  iconStyle = 'disc',
  tone = 'blue',
  titleStyle = 'default',
  size = 'default',
}: CalloutProps) {
  if (size === 'compact') {
    return (
      <div
        className={`flex items-start gap-3 rounded-lg p-3 text-sm text-text ${surfaces[surface]}`}
      >
        <Glyph aria-hidden weight="fill" className={`mt-0.5 size-5 shrink-0 ${textTones[tone]}`} />
        <div className="flex min-w-0 flex-col gap-1">
          {title ? <span className="font-semibold text-heading">{title}</span> : null}
          {children}
        </div>
      </div>
    );
  }
  const iconBox =
    iconStyle === 'disc' ? `rounded-full ${discTones[tone]}` : `rounded-lg ${tileTones[tone]}`;
  return (
    <div className={`flex items-start gap-4 rounded-xl p-5 ${surfaces[surface]}`}>
      <span className={`flex size-11 shrink-0 items-center justify-center ${iconBox}`}>
        <Glyph aria-hidden weight="fill" className="size-6" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title ? (
          <p
            className={`text-lg font-bold ${titleStyle === 'tip' ? 'text-action' : 'text-heading'}`}
          >
            {title}
          </p>
        ) : null}
        {children ? <div className="text-sm text-text">{children}</div> : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </div>
  );
}
