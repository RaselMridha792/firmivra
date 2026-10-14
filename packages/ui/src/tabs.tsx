'use client';

import type { Icon } from '@phosphor-icons/react';
import { useId, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  /** The panel. Leave it out when the page shows the content itself (filters, routes). */
  content?: ReactNode;
  /** The number in the pill after the label ("Active 98"). */
  count?: number;
  icon?: Icon;
}
/** `folder` is the original look; the others are the firm workspace designs. */
export type TabsVariant = 'folder' | 'underline' | 'pill' | 'segmented';
const bar = {
  folder: 'flex overflow-x-auto border-b border-folder-border',
  underline: 'flex gap-6 overflow-x-auto border-b border-divider',
  pill: 'flex gap-1 overflow-x-auto',
  segmented: 'inline-flex rounded-lg border border-divider bg-surface p-0.5',
};
const tab = {
  folder: (on: boolean) =>
    `min-h-11 rounded-t-lg border border-folder-border px-4 py-3 font-semibold ${on ? 'bg-surface text-heading' : 'bg-folder-surface text-muted hover:bg-folder-hover'}`,
  underline: (on: boolean) =>
    `-mb-px min-h-10 border-b-2 py-2 font-medium ${on ? 'border-action text-action' : 'border-transparent text-muted hover:text-heading'}`,
  pill: (on: boolean) =>
    `min-h-10 rounded-lg px-4 py-2 font-medium ${on ? 'bg-navigation text-on-action' : 'bg-table-head text-text hover:bg-folder-surface'}`,
  segmented: (on: boolean) =>
    `min-h-9 rounded-md px-4 py-1.5 font-medium ${on ? 'bg-action text-on-action' : 'text-text hover:bg-canvas'}`,
};
interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  variant?: TabsVariant;
}
export function Tabs({ items, value, onChange, label, variant = 'folder' }: TabsProps) {
  const prefixId = useId();
  return (
    <div>
      <div role="tablist" aria-label={label} className={bar[variant]}>
        {items.map((item, index) => (
          <button
            key={item.id}
            role="tab"
            type="button"
            id={`${prefixId}-${item.id}`}
            aria-selected={value === item.id}
            aria-controls={`${prefixId}-${item.id}-panel`}
            tabIndex={value === item.id ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              const keys: Record<string, number> = {
                ArrowRight: (index + 1) % items.length,
                ArrowLeft: (index - 1 + items.length) % items.length,
                Home: 0,
                End: items.length - 1,
              };
              const next = keys[event.key];
              if (next === undefined) return;
              event.preventDefault();
              const item = items[next];
              if (item) {
                onChange(item.id);
                event.currentTarget.parentElement
                  ?.querySelector<HTMLButtonElement>(`[role="tab"]:nth-child(${next + 1})`)
                  ?.focus();
              }
            }}
            className={`inline-flex shrink-0 items-center gap-2 text-sm ${tab[variant](value === item.id)}`}
          >
            {item.icon ? <item.icon aria-hidden weight="fill" className="size-4" /> : null}
            {item.label}
            {item.count === undefined ? null : (
              <span
                className={`rounded-pill px-2 text-xs font-semibold ${value === item.id && variant === 'pill' ? 'bg-navigation-hover text-on-action' : 'bg-divider text-muted'}`}
              >
                {item.count}
              </span>
            )}
          </button>
        ))}
      </div>
      {items.map((item) =>
        item.content === undefined ? null : (
          <div
            key={item.id}
            role="tabpanel"
            id={`${prefixId}-${item.id}-panel`}
            aria-labelledby={`${prefixId}-${item.id}`}
            hidden={item.id !== value}
            tabIndex={0}
            className="py-6"
          >
            {item.content}
          </div>
        ),
      )}
    </div>
  );
}
