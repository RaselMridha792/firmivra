import type { Icon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export interface BulkAction {
  label: string;
  icon: Icon;
  onClick: () => void;
  danger?: boolean;
}

/** "3 clients selected" and the actions for the selected rows; off until a row is selected. */
export function BulkBar({
  count,
  noun,
  actions,
  children,
}: {
  count: number;
  noun: string;
  actions: BulkAction[];
  /** More controls at the end, such as a "Bulk Actions" ActionMenu. */
  children?: ReactNode;
}) {
  return (
    <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2">
      <p aria-live="polite" className="mr-2 text-sm font-semibold text-heading">
        {count} {noun} selected
      </p>
      {actions.map(({ label, icon: Glyph, onClick, danger }) => (
        <button
          key={label}
          type="button"
          disabled={!count}
          onClick={onClick}
          className={`inline-flex h-9 items-center gap-2 rounded-lg border bg-surface px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${danger ? 'border-danger-soft text-danger enabled:hover:bg-danger-soft' : 'border-divider text-text enabled:hover:bg-canvas'}`}
        >
          <Glyph aria-hidden weight="fill" className={`size-4 ${danger ? '' : 'text-action'}`} />
          {label}
        </button>
      ))}
      {children}
    </div>
  );
}
