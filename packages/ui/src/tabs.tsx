'use client';

import { useId, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}
interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}
export function Tabs({ items, value, onChange, label }: TabsProps) {
  const prefixId = useId();
  return (
    <div>
      <div
        role="tablist"
        aria-label={label}
        className="flex overflow-x-auto border-b border-folder-border"
      >
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
            className={`min-h-11 shrink-0 rounded-t-lg border border-folder-border px-4 py-3 text-sm font-semibold ${value === item.id ? 'bg-surface text-heading' : 'bg-folder-surface text-muted hover:bg-folder-hover'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      {items.map((item) => (
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
      ))}
    </div>
  );
}
