import type { Icon } from '@phosphor-icons/react';
import { IconTile } from '../../../_components/icon-tile';

/** A module's name and solid icon in a tinted tile, in the dashboard's card style. */
export function ModuleCard({ label, icon }: { label: string; icon: Icon }) {
  return (
    <section
      aria-label={label}
      data-testid="module-card"
      className="flex max-w-xl items-center gap-4 rounded-xl bg-surface p-5 shadow-md"
    >
      <IconTile icon={icon} tone="blue" />
      <div className="flex flex-col gap-1">
        <h1 data-testid="page-title" className="text-xl font-bold text-heading">
          {label}
        </h1>
        <p className="text-sm text-muted">This module is on its way.</p>
      </div>
    </section>
  );
}
