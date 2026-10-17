'use client';

import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  CaretRight,
  CheckCircle,
  Eye,
  Tag,
  Trash,
  User,
  Briefcase,
  BookOpen,
  ChartBar,
  Money,
  FileText,
  type Icon,
} from '@phosphor-icons/react';
import { Button, Card, IconButton, Input, Modal } from '@firmivra/ui';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';

export const iconChoices: Record<string, Icon> = {
  user: User,
  briefcase: Briefcase,
  book: BookOpen,
  'chart-bar': ChartBar,
  money: Money,
  'file-text': FileText,
  tag: Tag,
};
export const money = (cents: number | null | undefined) =>
  cents == null
    ? 'Quote required'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);

export function CatalogHeader({ edit = false, onBack }: { edit?: boolean; onBack?: () => void }) {
  return (
    <header className="space-y-4">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-action">
        <Link href="/services-pricing">Services &amp; Pricing</Link>
        <CaretRight weight="fill" aria-hidden className="size-3 text-muted" />
        <span className="text-heading">{edit ? 'Edit Service' : 'Add New Service'}</span>
      </nav>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-action text-on-action">
            <Tag weight="fill" className="size-9" />
          </span>
          <div>
            <h1 className="font-display text-3xl font-bold text-heading sm:text-4xl">
              {edit ? 'Edit Service' : 'Add New Service'}
            </h1>
            <p className="mt-1 text-action">
              {edit
                ? 'Update your service, pricing, and what’s included.'
                : 'Create a new service, set pricing, and define what’s included.'}
            </p>
          </div>
        </div>
        {onBack ? (
          <Button variant="outline" onClick={onBack}>
            <BackLabel />
          </Button>
        ) : null}
      </div>
    </header>
  );
}

export function Panel({
  title,
  marker,
  action,
  children,
}: {
  title: string;
  marker: number | ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-divider bg-surface"
      data-testid={`panel-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`}
    >
      <header className="flex items-center justify-between gap-2 bg-table-head px-3 py-2">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-action text-sm font-bold text-on-action">
            {marker}
          </span>
          <h2 className="min-w-0 wrap-break-word text-base font-semibold text-heading">{title}</h2>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </header>
      <div className="min-w-0 space-y-3 p-3">{children}</div>
    </section>
  );
}

export function IconPicker({
  value,
  onChange,
}: {
  value: string | null | undefined;
  onChange: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const Glyph = iconChoices[value ?? ''] ?? Tag;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-text">Service Icon</p>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex size-16 items-center justify-center rounded-lg bg-danger-soft text-danger">
          <Glyph weight="fill" className="size-9" />
        </span>
        <div className="flex flex-col">
          <Button variant="outline" onClick={() => setOpen(true)}>
            Change Icon
          </Button>
          <Button variant="ghost" className="text-xs underline" onClick={() => onChange(null)}>
            Remove
          </Button>
        </div>
      </div>
      <Modal open={open} title="Choose service icon" onClose={() => setOpen(false)}>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(iconChoices).map(([key, Icon]) => (
            <Button
              key={key}
              variant="secondary"
              aria-label={`Choose ${key} icon`}
              onClick={() => {
                onChange(key);
                setOpen(false);
              }}
            >
              <Icon weight="fill" className="size-6" />
            </Button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

export function TextList({
  label,
  items,
  onChange,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-heading">{label}</h3>
        <Button
          variant="ghost"
          className="min-h-8 px-2 py-1 text-xs"
          onClick={() => setEditing(true)}
          aria-label={`Edit ${label}`}
        >
          Edit
        </Button>
      </div>
      <ul className="list-inside list-disc space-y-1 text-xs text-text">
        {items.filter(Boolean).map((text) => (
          <li key={text} className="break-words">
            {text}
          </li>
        ))}
      </ul>
      {!items.length ? <p className="text-xs text-muted">No items listed.</p> : null}
      <Modal
        open={editing}
        title={label}
        onClose={() => {
          onChange(items.map((text) => text.trim()).filter(Boolean));
          setEditing(false);
        }}
        footer={
          <Button
            onClick={() => {
              onChange(items.map((text) => text.trim()).filter(Boolean));
              setEditing(false);
            }}
          >
            Done
          </Button>
        }
      >
        {items.map((item, index) => (
          <div key={index} className="flex min-w-0 items-start gap-1">
            <div className="min-w-0 flex-1">
              <Input
                label={`${label} item ${index + 1}`}
                hideLabel
                value={item}
                maxLength={200}
                onChange={(e) =>
                  onChange(items.map((text, i) => (i === index ? e.target.value : text)))
                }
              />
            </div>
            <IconButton
              icon={ArrowUp}
              tone="action"
              label={`Move ${label} item ${index + 1} up`}
              disabled={index === 0}
              onClick={() => {
                const next = [...items];
                [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                onChange(next);
              }}
            />
            <IconButton
              icon={ArrowDown}
              tone="action"
              label={`Move ${label} item ${index + 1} down`}
              disabled={index === items.length - 1}
              onClick={() => {
                const next = [...items];
                [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                onChange(next);
              }}
            />
            <IconButton
              icon={Trash}
              tone="danger"
              label={`Remove ${label} item ${index + 1}`}
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            />
          </div>
        ))}
        <Button
          variant="ghost"
          disabled={items.length >= 30}
          onClick={() => onChange([...items, ''])}
        >
          + Add item
        </Button>
      </Modal>
    </div>
  );
}

export function ClientPreview({
  name,
  description,
  icon,
  price,
  included,
  addons,
  fullDescription,
}: {
  name?: string;
  description?: string | null;
  icon?: string | null;
  price: string;
  included: string[];
  addons: { name: string; priceCents: number }[];
  fullDescription?: string | null;
}) {
  const [full, setFull] = useState(false);
  const Glyph = iconChoices[icon ?? ''] ?? Tag;
  // The card matches the design (What's Included, then Book This Service); the full page adds
  // the full description and the add-ons.
  const content = (expanded: boolean) => (
    <Card className="space-y-4" data-testid="client-preview">
      <div className="flex items-start gap-3">
        <span className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
          <Glyph weight="fill" className="size-9" />
        </span>
        <div className="min-w-0">
          <h3 className="break-words font-display text-xl font-bold text-heading">
            {name || 'Service Preview'}
          </h3>
          <p className="text-lg font-bold text-action">{price}</p>
          {description ? (
            <p className="wrap-break-word text-xs text-action">{description}</p>
          ) : (
            <p className="text-sm text-muted">Add a short description to show your clients.</p>
          )}
        </div>
      </div>
      <div>
        <h4 className="mb-2 font-semibold text-heading">What&apos;s Included:</h4>
        {included.length ? (
          <ul className="space-y-2">
            {included.map((text, i) => (
              <li key={i} className="flex gap-2 text-sm">
                <CheckCircle weight="fill" className="size-4 shrink-0 text-action" />
                <span className="break-words">{text}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No included items yet.</p>
        )}
      </div>
      {expanded && fullDescription ? (
        <p className="whitespace-pre-wrap break-words text-sm text-text">
          {fullDescription.replace(/<[^>]*>/g, ' ')}
        </p>
      ) : null}
      {expanded && addons.length ? (
        <div className="border-t border-divider pt-3">
          <h4 className="font-semibold text-heading">Optional Add-Ons:</h4>
          <ul className="mt-2 space-y-2 text-sm">
            {addons.map((a, i) => (
              <li key={i} className="break-words">
                {a.name} (+{money(a.priceCents)})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {/* Looks like the client's button; booking is not part of this staff preview. */}
      <Button className="pointer-events-none w-full" aria-disabled="true" tabIndex={-1}>
        Book This Service
      </Button>
    </Card>
  );
  return (
    <>
      <Panel
        title="Service Preview (Client View)"
        marker={<Eye weight="fill" className="size-4" />}
        action={
          <Button className="text-xs" variant="outline" onClick={() => setFull(true)}>
            <Eye weight="fill" className="size-4" />
            View Full Page
          </Button>
        }
      >
        {content(false)}
      </Panel>
      <Modal open={full} title="Service Preview (Client View)" onClose={() => setFull(false)}>
        {full ? content(true) : null}
      </Modal>
    </>
  );
}

export function BackLabel() {
  return (
    <>
      <ArrowLeft weight="fill" className="size-4" />
      Back to Services
    </>
  );
}
