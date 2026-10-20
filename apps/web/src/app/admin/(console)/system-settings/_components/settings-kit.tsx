'use client';

import {
  type AdminBrandAsset,
  type AdminSettingsOverview,
  ApiRequestError,
  type PlatformBrandAssetKind,
} from '@firmivra/types';
import { Badge, Button, Callout, Card, Skeleton } from '@firmivra/ui';
import {
  ArrowLeft,
  ArrowRight,
  CaretRight,
  ClockCounterClockwise,
  Database,
  EnvelopeSimple,
  FileText,
  Info,
  LinkSimple,
  Palette,
  SlidersHorizontal,
  type Icon,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { useApiMutation } from '../../../../../lib/query';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiQuery } from '../../../../../lib/query';

/**
 * Shared parts of the System Settings pages (R55, designs in docs/mockups/super-admin/
 * system-settings/source/, API `api.adminSettings`): the page head with its breadcrumb, the
 * section anchors, section cards, the right column (Important, Current Configuration, Quick
 * Links), the save bar, and the brand image upload. A save names the version it loaded; someone
 * else's save first is 409 SAVE_CONFLICT, and the page says to reload.
 */

export const SS = ['admin-settings'] as const;

export function stamp(iso: string | null | undefined) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function loadError(error: unknown): string {
  if (error instanceof ApiRequestError && error.status === 404) return 'Not found.';
  return 'Could not load this right now. Try again in a moment.';
}
export const SETTINGS_ERRORS: Record<string, string> = {
  SAVE_CONFLICT: 'Someone else saved these settings first. Reload the page to see their changes.',
  ASSET_NOT_READY: 'The image is still being checked. Try again in a moment.',
};

/** The head: breadcrumb (← System Settings › Page), the icon disc, title, subtitle, Back. */
export function SettingsHeader({
  title,
  subtitle,
  icon: I,
  actions,
}: {
  title: string;
  subtitle: string;
  icon: Icon;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted">
        <Link href="/system-settings" className="inline-flex items-center gap-2 hover:text-action">
          <ArrowLeft aria-hidden weight="bold" className="size-4" />
          System Settings
        </Link>
        <CaretRight aria-hidden weight="bold" className="size-3" />
        <span aria-current="page" className="text-heading">
          {title}
        </span>
      </nav>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-info-soft text-action">
            <I aria-hidden weight="fill" className="size-8" />
          </span>
          <div>
            <h1 className="text-3xl font-bold text-heading">{title}</h1>
            <p className="text-base text-text">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          {actions}
          <Link
            href="/system-settings"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-divider bg-surface px-4 text-sm font-medium text-text hover:bg-canvas"
          >
            <ArrowLeft aria-hidden weight="bold" className="size-4" />
            Back to System Settings
          </Link>
        </div>
      </div>
    </header>
  );
}

/** The links under the head: anchors to the page's section cards. */
export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  return (
    <nav aria-label="Sections" className="flex gap-8 overflow-x-auto border-b border-divider">
      {items.map((s) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          aria-current={active === s.id ? 'location' : undefined}
          onClick={() => setActive(s.id)}
          className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 text-sm font-medium ${active === s.id ? 'border-action text-action' : 'border-transparent text-text hover:text-heading'}`}
        >
          {s.label}
        </a>
      ))}
    </nav>
  );
}

/** A section card: the icon disc, title and subtitle, then the controls. */
export function SectionCard({
  id,
  title,
  subtitle,
  icon: I,
  action,
  children,
}: {
  id: string;
  title: string;
  subtitle: string;
  icon: Icon;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card
      id={id}
      className="flex min-w-0 scroll-mt-24 flex-col gap-4 p-5!"
      data-testid={`section-${id}`}
    >
      <div className="flex items-start gap-4">
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-info-soft text-action">
          <I aria-hidden weight="fill" className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-heading">{title}</h2>
          <p className="text-sm text-muted">{subtitle}</p>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

/** A card body in its three states: the controls, the quiet error line, or a skeleton. */
export function Body<T>({
  query,
  rows = 3,
  children,
}: {
  query: { data?: T; isError: boolean; error: unknown };
  rows?: number;
  children: (data: T) => ReactNode;
}) {
  if (query.data !== undefined) return <>{children(query.data)}</>;
  if (query.isError) return <QuietLine>{loadError(query.error)}</QuietLine>;
  return (
    <div className="flex flex-col gap-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full" />
      ))}
    </div>
  );
}

export function QuietLine({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-canvas p-4 text-center text-sm text-muted">{children}</p>;
}

/** The "Important" note at the top of the right column. */
export function ImportantNote({ children, href }: { children: ReactNode; href?: string }) {
  return (
    <Callout surface="info" icon={Info} title="Important">
      <p>{children}</p>
      {href ? (
        <Link href={href} className="mt-2 inline-flex items-center gap-1 font-medium text-action">
          Learn more <ArrowRight aria-hidden weight="bold" className="size-3.5" />
        </Link>
      ) : null}
    </Callout>
  );
}

/** Current Configuration: the platform's facts from the overview, and this section's last save. */
export function CurrentConfiguration({
  updatedAt,
  updatedBy,
}: {
  updatedAt?: string | null;
  updatedBy?: string | null;
}) {
  const overview = useApiQuery([...SS, 'overview'], () => api.adminSettings.overview());
  const row = (label: string, value: ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <dt className="text-text">{label}</dt>
      <dd className="text-right text-heading">{value}</dd>
    </div>
  );
  return (
    <Card className="flex flex-col gap-3 p-5!" data-testid="current-configuration">
      <h2 className="flex items-center gap-3 text-base font-bold text-heading">
        <span className="flex size-10 items-center justify-center rounded-full bg-info-soft text-action">
          <FileText aria-hidden weight="fill" className="size-5" />
        </span>
        Current Configuration
      </h2>
      <Body query={overview} rows={4}>
        {(o: AdminSettingsOverview) => (
          <dl>
            {row('Platform Version', o.system.version)}
            {row('Environment', <Badge tone="success">{o.system.environment}</Badge>)}
            {row('Last Updated', stamp(updatedAt ?? o.system.lastUpdatedAt))}
            {row('Updated By', updatedBy ?? '—')}
            {row('Total Firms', o.system.totalFirms.toLocaleString('en-US'))}
            {row('Total Users', o.system.totalUsers.toLocaleString('en-US'))}
          </dl>
        )}
      </Body>
    </Card>
  );
}

const LINKS: { label: string; text: string; href: string; icon: Icon }[] = [
  {
    label: 'Branding & Appearance',
    text: 'Manage logo, colors, and theme settings',
    href: '/system-settings/branding',
    icon: Palette,
  },
  {
    label: 'Email & Notifications',
    text: 'Configure system emails and notifications',
    href: '/system-settings/email-notifications',
    icon: EnvelopeSimple,
  },
  {
    label: 'Feature Management',
    text: 'Enable or disable platform features',
    href: '/system-settings/features',
    icon: SlidersHorizontal,
  },
  {
    label: 'Data & Retention',
    text: 'Manage data retention and archiving',
    href: '/system-settings/data-retention',
    icon: Database,
  },
  {
    label: 'View Audit Logs',
    text: 'See recent changes to system settings',
    href: '/audit-security?view=policies',
    icon: ClockCounterClockwise,
  },
];

/** Quick Links to the other settings pages (this page's own left out). */
export function QuickLinks({ current }: { current?: string }) {
  return (
    <Card className="flex flex-col gap-2 p-5!" data-testid="quick-links">
      <h2 className="flex items-center gap-3 text-base font-bold text-heading">
        <span className="flex size-10 items-center justify-center rounded-full bg-info-soft text-action">
          <LinkSimple aria-hidden weight="bold" className="size-5" />
        </span>
        Quick Links
      </h2>
      <ul className="divide-y divide-divider">
        {LINKS.filter((l) => l.href !== current).map((l) => (
          <li key={l.href}>
            <Link href={l.href} className="flex items-center gap-3 py-2.5 hover:text-action">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-info-soft text-action">
                <l.icon aria-hidden weight="fill" className="size-4.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-heading">{l.label}</span>
                <span className="block text-xs text-muted">{l.text}</span>
              </span>
              <CaretRight aria-hidden weight="bold" className="size-4 text-muted" />
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The save bar: status on the left, Reset to Default and Save Changes on the right. */
export function SaveBar({
  status,
  onReset,
  onSave,
  saving,
  disabled,
  resetLabel = 'Reset to Default',
}: {
  status: { tone: 'ok' | 'error' | 'info'; text: string } | null;
  onReset?: () => void;
  onSave: () => void;
  saving: boolean;
  disabled: boolean;
  resetLabel?: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p
        role={status?.tone === 'error' ? 'alert' : 'status'}
        data-testid="settings-status"
        className={`text-sm ${status?.tone === 'error' ? 'text-danger' : status?.tone === 'ok' ? 'text-success' : 'text-muted'}`}
      >
        {status?.text ?? ''}
      </p>
      <div className="flex justify-end gap-3">
        {onReset ? (
          <Button variant="secondary" disabled={disabled} onClick={onReset}>
            {resetLabel}
          </Button>
        ) : null}
        <Button disabled={disabled || saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}

/** What the save bar says after a save attempt. */
export const savedStatus = {
  tone: 'ok' as const,
  text: 'Saved. The change was added to the audit log.',
};
export const failedStatus = (error: unknown) => ({
  tone: 'error' as const,
  text: errorMessage(error, SETTINGS_ERRORS),
});

// ---------- Brand images ----------

const TYPES: Record<string, 'image/png' | 'image/webp' | 'image/x-icon' | 'image/jpeg'> = {
  png: 'image/png',
  webp: 'image/webp',
  ico: 'image/x-icon',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};
export const BRAND_ACCEPT = ['.png', '.webp', '.ico', '.jpg', '.jpeg'];

async function sha256(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
async function size(file: File): Promise<{ width?: number; height?: number }> {
  try {
    const bitmap = await createImageBitmap(file);
    return { width: bitmap.width, height: bitmap.height };
  } catch {
    return {};
  }
}

/**
 * A brand image: the three-step upload (ticket, PUT, confirm), then it is put in use. A new image
 * is checked first (malware scan); while it is, setting it answers 409 ASSET_NOT_READY.
 */
export async function uploadBrandImage(
  kind: PlatformBrandAssetKind,
  file: File,
): Promise<AdminBrandAsset> {
  const type = TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''];
  if (!type)
    throw new ApiRequestError(400, 'VALIDATION_FAILED', 'Upload a PNG, WebP, ICO or JPG image.');
  const ticket = await api.adminSettings.createBrandAssetUpload({
    kind,
    fileName: file.name,
    contentType: type,
    sizeBytes: file.size,
    sha256: await sha256(file),
    ...(await size(file)),
  });
  const put = await fetch(ticket.url, { method: 'PUT', headers: ticket.headers, body: file });
  if (!put.ok)
    throw new ApiRequestError(502, 'UPLOAD_FAILED', 'The upload did not go through. Try again.');
  const asset = await api.adminSettings.confirmBrandAssetUpload({
    uploadToken: ticket.uploadToken,
  });
  if (asset.scanStatus === 'CLEAN')
    await api.adminSettings.setBrandAsset(kind, { assetId: asset.id });
  return asset;
}

/**
 * The newest image uploaded for a kind, when it is not the one in use: still being checked (the
 * malware scan), ready ("Use new image" puts it in use), or refused by the scan.
 */
export function NewImage({
  kind,
  currentId,
  onDone,
}: {
  kind: PlatformBrandAssetKind;
  currentId: string | null;
  onDone: (s: { tone: 'ok' | 'error' | 'info'; text: string }) => void;
}) {
  const list = useApiQuery([...SS, 'brand-assets', kind], () =>
    api.adminSettings.brandAssets(kind),
  );
  const use = useApiMutation(
    (assetId: string) => api.adminSettings.setBrandAsset(kind, { assetId }),
    {
      invalidate: [...SS],
    },
  );
  const newest = list.data?.items[0];
  if (!newest || newest.id === currentId) return null;
  if (newest.scanStatus === 'PENDING')
    return (
      <p className="flex items-center gap-2 text-xs text-muted" data-testid={`new-image-${kind}`}>
        {newest.fileName} is being checked.
        <button type="button" className="text-action" onClick={() => void list.refetch()}>
          Check again
        </button>
      </p>
    );
  if (newest.scanStatus !== 'CLEAN')
    return (
      <p className="text-xs text-danger">
        {newest.fileName} could not be used. Upload another image.
      </p>
    );
  return (
    <Button
      variant="secondary"
      disabled={use.isPending}
      onClick={() =>
        use.mutate(newest.id, {
          onSuccess: () => onDone({ tone: 'ok', text: `${newest.fileName} is in use.` }),
          onError: (e) => onDone(failedStatus(e)),
        })
      }
    >
      <span className="text-xs text-action">Use new image ({newest.fileName})</span>
    </Button>
  );
}
