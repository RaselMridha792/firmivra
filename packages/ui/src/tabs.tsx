'use client';

import { useId, useRef, type ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}
export function Tabs({
  items,
  value,
  onChange,
  label,
}: {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const prefixId = useId();
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
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
            ref={(el) => {
              tabsRef.current[index] = el;
            }}
            role="tab"
            type="button"
            id={`${prefixId}-${item.id}`}
            aria-selected={value === item.id}
            aria-controls={`${prefixId}-${item.id}-panel`}
            tabIndex={value === item.id ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => {
              let next: number;
              if (event.key === 'ArrowRight') next = (index + 1) % items.length;
              else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = items.length - 1;
              else return;
              event.preventDefault();
              const item = items[next];
              if (item) {
                onChange(item.id);
                tabsRef.current[next]?.focus();
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
