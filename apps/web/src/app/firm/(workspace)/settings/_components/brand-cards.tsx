'use client';

import {
  BRAND_ASSET_LIMITS,
  type BrandAssetKind,
  BrandingGroup,
  type BrandingSettings,
  DOCUMENT_ERRORS,
  type FirmSettings,
  LOGO_ERRORS,
  LOGO_LIMITS,
  type SidebarPosition,
  type SidebarStyle,
} from '@firmivra/types';
import {
  Button,
  Callout,
  ColorField,
  FileDropzone,
  Modal,
  Radio,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  Toggle,
} from '@firmivra/ui';
import {
  ArrowCounterClockwise,
  Bell,
  CalendarBlank,
  ChartBar,
  Eye,
  FloppyDisk,
  House,
  MagnifyingGlass,
  ShieldCheck,
  Trash,
  UsersThree,
} from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import Image from 'next/image';
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api } from '../../../../../lib/api';
import { errorMessage } from '../../../../../lib/errors';
import { useApiMutation } from '../../../../../lib/query';
import { uploadLogo } from '../../../../../lib/upload';
import { BrandPreview } from '../../../setup/_components/brand-preview';
import { FIRM_SETTINGS } from '../../../setup/_components/shared';
import { BrandCard } from './brand-frame';
import type { BrandDraft, BrandDraftState } from './brand-draft';
import { BRANDING } from './brand-draft';
import { NOT_LOADED } from './settings-parts';

export const BRAND_ERRORS: Record<string, string> = {
  ...LOGO_ERRORS,
  UPLOAD_FAILED: DOCUMENT_ERRORS.UPLOAD_FAILED,
  SAVE_CONFLICT:
    'Someone saved the branding after you opened it. Reload to see their changes, then make yours again.',
  LOW_CONTRAST:
    'These colours are hard to read against each other. Pick a darker or lighter shade and save again.',
  INVALID_ASSET: 'That image is not allowed: check its type and size.',
  ENCRYPTION_UNAVAILABLE: "The EIN can't be saved right now. Clear it to save the rest.",
};

const ACCEPT = [...Object.keys(LOGO_LIMITS.types), ...Object.values(LOGO_LIMITS.types).flat()];
const noSubscription = () => () => {};

/** A colour token's value now (the default a blank colour falls back to). */
function useTokenColour(token: string) {
  return useSyncExternalStore(
    noSubscription,
    () => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    () => '',
  );
}

/**
 * Upload or remove one brand image: the company logo (`api.settings`, light backgrounds) or a
 * branding asset (`api.branding`). Saves at once, as the contract's confirm step does.
 */
function useBrandImage(firm: FirmSettings, kind: 'LOGO' | BrandAssetKind, onDone: () => void) {
  const client = useQueryClient();
  const upload = useApiMutation(
    async (file: File) => {
      if (kind === 'LOGO') {
        await uploadLogo(file, {
          start: (body) => api.settings.createLogoUpload({ ...body, variant: 'light' }),
          finish: (uploadToken) => api.settings.confirmLogoUpload({ uploadToken }),
        });
      } else {
        await uploadLogo(file, {
          start: (body) => api.branding.createAssetUpload({ ...body, kind }),
          finish: (uploadToken) => api.branding.confirmAssetUpload({ uploadToken }),
        });
      }
    },
    { invalidate: kind === 'LOGO' ? FIRM_SETTINGS : BRANDING },
  );
  const remove = useApiMutation(
    async (_: void) => {
      if (kind === 'LOGO') await api.settings.removeLogo('light');
      else await api.branding.removeAsset(kind);
    },
    { invalidate: kind === 'LOGO' ? FIRM_SETTINGS : BRANDING },
  );
  const after = () => {
    onDone();
    // The firm sidebar reads the logo from the portal info, under its own key.
    void client.invalidateQueries({ queryKey: ['firm', firm.business.id, 'branding'] });
  };
  return {
    upload: (file: File) => {
      remove.reset();
      upload.mutate(file, { onSuccess: after });
    },
    remove: () => {
      upload.reset();
      remove.mutate(undefined, { onSuccess: after });
    },
    busy: upload.isPending || remove.isPending,
    error: upload.error ?? remove.error,
  };
}

/** One image of Logo & Brand Assets: the preview box, Change and the bin, and the guidance. */
function BrandImage({
  firm,
  kind,
  label,
  url,
  recommended,
  testId,
}: {
  firm: FirmSettings;
  kind: 'LOGO' | BrandAssetKind;
  label: string;
  url: string | null;
  recommended: string;
  testId: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState('');
  const image = useBrandImage(firm, kind, () => setDone(`${label} saved.`));
  const short = kind === 'LOGO' ? 'Logo' : 'Favicon';
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={testId}>
      <p className="text-sm font-semibold text-heading">{label}</p>
      <div className="flex h-24 items-center justify-center rounded-lg border border-divider bg-surface p-2">
        {url ? (
          <Image
            unoptimized
            src={url}
            alt={`${firm.name} ${short.toLowerCase()}`}
            width={176}
            height={80}
            className="h-auto max-h-20 w-auto max-w-full object-contain"
          />
        ) : (
          <span className="text-xs text-muted">No {short.toLowerCase()} yet</span>
        )}
      </div>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-10 flex-1"
          disabled={image.busy}
          onClick={() => inputRef.current?.click()}
        >
          {image.busy ? 'Saving…' : `Change ${short}`}
        </Button>
        <button
          type="button"
          aria-label={`Remove the ${short.toLowerCase()}`}
          title={`Remove the ${short.toLowerCase()}`}
          disabled={image.busy || !url}
          onClick={() => {
            setDone('');
            image.remove();
          }}
          className="flex size-10 shrink-0 items-center justify-center rounded-control border border-border text-heading hover:bg-canvas disabled:text-muted"
        >
          <Trash aria-hidden weight="fill" className="size-4" />
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        hidden
        accept={ACCEPT.join(',')}
        aria-label={`${label} file`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setDone('');
          image.upload(file);
        }}
      />
      <p className="text-xs text-muted">Recommended: {recommended}</p>
      {image.error ? (
        <p role="alert" className="text-xs text-danger">
          {errorMessage(image.error, BRAND_ERRORS)}
        </p>
      ) : done ? (
        <p role="status" className="text-xs text-success">
          {done}
        </p>
      ) : null}
    </div>
  );
}

/** Logo & Brand Assets: the company logo and the favicon. */
export function LogoAssetsCard({
  firm,
  branding,
}: {
  firm: FirmSettings;
  branding: BrandingSettings;
}) {
  return (
    <BrandCard
      title="Logo & Brand Assets"
      subtitle="Upload your logo, favicon, and brand images. Recommended formats: PNG or JPG."
      testId="brand-assets"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <BrandImage
          firm={firm}
          kind="LOGO"
          label="Company Logo *"
          url={firm.logoLightUrl}
          recommended={`400 x 200 px (${LOGO_LIMITS.typeNames})`}
          testId="brand-logo"
        />
        <BrandImage
          firm={firm}
          kind="FAVICON"
          label="Favicon"
          url={branding.faviconUrl}
          recommended="64 x 64 px (PNG)"
          testId="brand-favicon"
        />
      </div>
    </BrandCard>
  );
}

/** Brand Colors: Primary, Secondary, Accent and Background, each a swatch and its hex code. */
export function BrandColorsCard({ state }: { state: BrandDraftState }) {
  const primary = useTokenColour('--color-firm-primary');
  const accent = useTokenColour('--color-firm-accent');
  const secondary = useTokenColour('--color-gold');
  const background = useTokenColour('--color-canvas');
  const d = state.draft;
  if (!d) return null;
  const fields: [keyof BrandDraft & `${string}Color`, string, string][] = [
    ['primaryColor', 'Primary Color', primary],
    ['secondaryColor', 'Secondary Color', secondary],
    ['accentColor', 'Accent Color', accent],
    ['backgroundColor', 'Background Color', background],
  ];
  return (
    <BrandCard
      title="Brand Colors"
      subtitle="Customize the platform colors to match your brand."
      testId="brand-colors"
    >
      <div className="grid grid-cols-2 gap-3 min-[1700px]:grid-cols-4">
        {fields.map(([key, label, fallback]) => (
          <ColorField
            key={key}
            label={label}
            value={d[key] || fallback}
            error={state.errors[key]}
            onChange={(hex) => state.set(key, hex)}
          />
        ))}
      </div>
    </BrandCard>
  );
}

/** Theme Options: the mode, the sidebar's style and position, logo text and rounded corners. */
export function ThemeOptionsCard({ state }: { state: BrandDraftState }) {
  const d = state.draft;
  if (!d) return null;
  return (
    <BrandCard
      title="Theme Options"
      subtitle="Choose your preferred appearance and style."
      testId="theme-options"
    >
      <div className="grid grid-cols-2 gap-4 min-[1700px]:grid-cols-[auto_1fr_1fr]">
        <fieldset className="flex flex-col gap-2">
          <legend className="sr-only">Appearance</legend>
          {(
            [
              ['LIGHT', 'Light Mode'],
              ['DARK', 'Dark Mode'],
              ['SYSTEM', 'System Default'],
            ] as const
          ).map(([value, label]) => (
            <Radio
              key={value}
              name="theme-mode"
              label={label}
              checked={d.themeMode === value}
              onChange={() => state.set('themeMode', value)}
            />
          ))}
        </fieldset>
        <Select
          label="Sidebar Style"
          options={[
            { value: 'SOLID', label: 'Solid' },
            { value: 'GRADIENT', label: 'Gradient' },
          ]}
          value={d.sidebarStyle}
          onChange={(e) => state.set('sidebarStyle', e.target.value as SidebarStyle)}
        />
        <Select
          label="Sidebar Position"
          options={[
            { value: 'LEFT', label: 'Left (Default)' },
            { value: 'RIGHT', label: 'Right' },
          ]}
          value={d.sidebarPosition}
          onChange={(e) => state.set('sidebarPosition', e.target.value as SidebarPosition)}
        />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <span className="inline-flex items-center gap-2 text-sm text-heading">
          <Toggle
            label="Show Logo Text in Sidebar"
            checked={d.showLogoText}
            onChange={(on) => state.set('showLogoText', on)}
          />
          Show Logo Text in Sidebar
        </span>
        <span className="inline-flex items-center gap-2 text-sm text-heading">
          <Toggle
            label="Use Rounded Corners"
            checked={d.roundedCorners}
            onChange={(on) => state.set('roundedCorners', on)}
          />
          Use Rounded Corners
        </span>
      </div>
    </BrandCard>
  );
}

/** Login Page Customization (Optional): the background image and the welcome message. */
export function LoginPageCard({
  state,
  firm,
  branding,
}: {
  state: BrandDraftState;
  firm: FirmSettings;
  branding: BrandingSettings;
}) {
  const [done, setDone] = useState('');
  const image = useBrandImage(firm, 'LOGIN_BACKGROUND', () => {
    setDone('Background saved.');
    state.refreshBranding();
  });
  const d = state.draft;
  if (!d) return null;
  return (
    <BrandCard
      title="Login Page Customization (Optional)"
      subtitle="Add a custom image or message to your login page."
      testId="login-page"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-sm font-semibold text-heading">Login Background Image</p>
          {branding.loginBackgroundUrl ? (
            <div className="flex items-center gap-2">
              <Image
                unoptimized
                src={branding.loginBackgroundUrl}
                alt="Login background"
                width={160}
                height={90}
                className="h-16 w-auto rounded-lg object-cover"
              />
              <Button
                type="button"
                variant="ghost"
                disabled={image.busy}
                onClick={() => {
                  setDone('');
                  image.remove();
                }}
              >
                Remove
              </Button>
            </div>
          ) : (
            <FileDropzone
              label="Login background image"
              icon="image"
              title="Drag & drop or click to upload"
              hints={[`Recommended: ${BRAND_ASSET_LIMITS.LOGIN_BACKGROUND.recommended}`]}
              accept={ACCEPT}
              maxBytes={LOGO_LIMITS.maxBytes}
              disabled={image.busy}
              onFiles={([file]) => {
                setDone('');
                if (file) image.upload(file);
              }}
            />
          )}
          {image.error ? (
            <p role="alert" className="text-xs text-danger">
              {errorMessage(image.error, BRAND_ERRORS)}
            </p>
          ) : done ? (
            <p role="status" className="text-xs text-success">
              {done}
            </p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <Textarea
            label="Login Message"
            rows={4}
            maxLength={200}
            placeholder="Welcome to your client portal."
            value={d.loginMessage}
            error={state.errors.loginMessage}
            onChange={(e) => state.set('loginMessage', e.target.value)}
          />
          <p className="self-end text-xs text-muted">{d.loginMessage.length}/200</p>
        </div>
      </div>
    </BrandCard>
  );
}

/** Sets the firm colour variables on the preview, so the portal theme draws in the draft's colours. */
function useFirmColours(primary: string, accent: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const style = ref.current?.style;
    if (!style) return;
    const colours = { '--color-firm-primary': primary, '--color-firm-accent': accent };
    for (const [property, value] of Object.entries(colours)) {
      if (/^#[0-9a-f]{6}$/i.test(value)) style.setProperty(property, value);
      else style.removeProperty(property);
    }
  }, [primary, accent]);
  return ref;
}

function DashboardPreview({ d, firm }: { d: BrandDraft; firm: FirmSettings }) {
  const ref = useFirmColours(d.primaryColor, d.accentColor);
  const items: [typeof House, string][] = [
    [House, 'Dashboard'],
    [UsersThree, 'Clients'],
    [CalendarBlank, 'Appointments'],
    [ChartBar, 'Reports'],
  ];
  return (
    <div
      ref={ref}
      data-theme="portal"
      data-testid="preview-dashboard"
      className={`flex overflow-hidden border border-divider bg-canvas ${d.roundedCorners ? 'rounded-xl' : ''} ${d.sidebarPosition === 'RIGHT' ? 'flex-row-reverse' : ''}`}
    >
      <div className="flex w-32 shrink-0 flex-col gap-1 bg-navigation p-2 text-on-action">
        {firm.logoUrl ? (
          <Image
            unoptimized
            src={firm.logoUrl}
            alt=""
            width={112}
            height={40}
            className="mb-1 h-auto max-h-8 w-auto"
          />
        ) : null}
        {d.showLogoText || !firm.logoUrl ? (
          <p className="mb-1 truncate text-xs font-bold">{d.name}</p>
        ) : null}
        {items.map(([icon, label], i) => {
          const Glyph = icon;
          return (
            <span
              key={label}
              className={`flex items-center gap-1.5 px-1.5 py-1 text-xs ${i === 0 ? 'bg-action' : ''} ${d.roundedCorners ? 'rounded-md' : ''}`}
            >
              <Glyph aria-hidden weight="fill" className="size-3.5" />
              {label}
            </span>
          );
        })}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-2">
        <span className="flex items-center gap-1.5 rounded-md bg-surface px-2 py-1 text-xs text-muted">
          <MagnifyingGlass aria-hidden weight="bold" className="size-3" />
          Search clients, documents, returns…
        </span>
        <div className="grid grid-cols-2 gap-2">
          {['Total Clients', 'Pending Returns'].map((label) => (
            <span
              key={label}
              className={`flex flex-col gap-1 bg-surface p-2 ${d.roundedCorners ? 'rounded-lg' : ''}`}
            >
              <span className="text-xs font-semibold text-heading">{label}</span>
              <span className="h-3 w-10 rounded-sm bg-action" />
            </span>
          ))}
        </div>
        <span
          className={`flex flex-col gap-1.5 bg-surface p-2 ${d.roundedCorners ? 'rounded-lg' : ''}`}
        >
          <span className="text-xs font-semibold text-heading">Recent Activity</span>
          {[0, 1, 2].map((i) => (
            <span key={i} className="flex items-center gap-1.5">
              <Bell aria-hidden weight="fill" className="size-3 text-action" />
              <span className="h-2 flex-1 rounded-sm bg-subtle" />
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}

function LoginPreview({
  d,
  firm,
  branding,
}: {
  d: BrandDraft;
  firm: FirmSettings;
  branding: BrandingSettings;
}) {
  const ref = useFirmColours(d.primaryColor, d.accentColor);
  return (
    <div
      ref={ref}
      data-theme="portal"
      data-testid="preview-login"
      className="relative flex min-h-56 items-center justify-center overflow-hidden rounded-xl border border-divider bg-navigation p-4"
    >
      {branding.loginBackgroundUrl ? (
        <Image
          unoptimized
          src={branding.loginBackgroundUrl}
          alt=""
          fill
          className="object-cover opacity-40"
        />
      ) : null}
      <div className="relative flex w-full max-w-60 flex-col items-center gap-2 rounded-xl bg-surface p-4 text-center">
        {firm.logoLightUrl ? (
          <Image
            unoptimized
            src={firm.logoLightUrl}
            alt=""
            width={120}
            height={48}
            className="h-auto max-h-10 w-auto"
          />
        ) : (
          <p className="font-bold text-heading">{d.name}</p>
        )}
        {d.loginMessage ? (
          <p className="text-xs whitespace-pre-wrap text-muted">{d.loginMessage}</p>
        ) : null}
        <span className="h-6 w-full rounded-md border border-border" />
        <span className="h-6 w-full rounded-md border border-border" />
        <span className="w-full rounded-md bg-action py-1 text-xs font-semibold text-on-action">
          Sign in
        </span>
      </div>
    </div>
  );
}

function EmailPreview({
  d,
  firm,
  branding,
}: {
  d: BrandDraft;
  firm: FirmSettings;
  branding: BrandingSettings;
}) {
  const ref = useFirmColours(d.primaryColor, d.accentColor);
  const logo = branding.email.logoUrl ?? firm.logoLightUrl;
  return (
    <div
      ref={ref}
      data-theme="portal"
      data-testid="preview-email"
      className="overflow-hidden rounded-xl border border-divider bg-surface"
    >
      <div className="flex items-center gap-2 border-b-3 border-action px-4 py-3">
        {logo ? (
          <Image
            unoptimized
            src={logo}
            alt=""
            width={96}
            height={32}
            className="h-auto max-h-8 w-auto"
          />
        ) : null}
        <p className="text-sm font-bold text-heading">{branding.email.fromName || d.name}</p>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3 text-xs text-text">
        {branding.email.header ? <p className="font-semibold">{branding.email.header}</p> : null}
        <span className="h-2 w-3/4 rounded-sm bg-subtle" />
        <span className="h-2 w-2/3 rounded-sm bg-subtle" />
        <span className="w-fit rounded-md bg-action px-3 py-1 font-semibold text-on-action">
          View in portal
        </span>
      </div>
      <div className="border-t border-divider bg-canvas px-4 py-2 text-xs text-muted">
        {branding.email.footer || d.name}
        {branding.email.disclaimer ? <p className="mt-1">{branding.email.disclaimer}</p> : null}
      </div>
    </div>
  );
}

const PREVIEWS = ['dashboard', 'portal', 'login', 'emails'] as const;
type PreviewTab = (typeof PREVIEWS)[number];

function Previews({
  d,
  firm,
  branding,
  tab,
  onTab,
}: {
  d: BrandDraft;
  firm: FirmSettings;
  branding: BrandingSettings;
  tab: PreviewTab;
  onTab: (t: PreviewTab) => void;
}) {
  const content: Record<PreviewTab, ReactNode> = {
    dashboard: <DashboardPreview d={d} firm={firm} />,
    portal: (
      <BrandPreview
        name={firm.portalName || `${d.name} Client Portal`}
        logoUrl={firm.logoLightUrl}
        primary={d.primaryColor}
        accent={d.accentColor}
        header={firm.portalHeader}
        welcome={firm.welcomeMessage}
        signUp={firm.clientSignUpEnabled}
      />
    ),
    login: <LoginPreview d={d} firm={firm} branding={branding} />,
    emails: <EmailPreview d={d} firm={firm} branding={branding} />,
  };
  const labels: Record<PreviewTab, string> = {
    dashboard: 'Dashboard',
    portal: 'Client Portal',
    login: 'Login Page',
    emails: 'Emails',
  };
  // On a phone the four tabs wrap to a second line instead of scrolling sideways.
  return (
    <div className="max-sm:[&_[role=tablist]]:flex-wrap max-sm:[&_[role=tablist]]:gap-x-4">
      <Tabs
        label="Preview"
        variant="underline"
        value={tab}
        onChange={(id) => onTab(id as PreviewTab)}
        items={PREVIEWS.map((id) => ({ id, label: labels[id], content: content[id] }))}
      />
    </div>
  );
}

/** Live Preview: the dashboard, portal, login page and emails in the unsaved values. */
export function LivePreviewCard({
  state,
  firm,
  branding,
}: {
  state: BrandDraftState;
  firm: FirmSettings;
  branding: BrandingSettings;
}) {
  const [tab, setTab] = useState<PreviewTab>('dashboard');
  const d = state.draft;
  return (
    <BrandCard
      title="Live Preview"
      subtitle="See how your branding will appear across the platform."
      testId="live-preview"
    >
      {d ? <Previews d={d} firm={firm} branding={branding} tab={tab} onTab={setTab} /> : null}
      <Callout icon={ShieldCheck} tone="green" surface="success" size="compact">
        Your branding changes will be applied throughout the system, including the client portal,
        emails, and documents.
      </Callout>
    </BrandCard>
  );
}

/** Actions: Save Changes, Preview Full Platform, and Reset to Default Brand Settings (asks first). */
export function BrandActionsCard({
  state,
  firm,
  branding,
}: {
  state: BrandDraftState;
  firm: FirmSettings;
  branding: BrandingSettings;
}) {
  const [dialog, setDialog] = useState<'preview' | 'reset' | null>(null);
  const [tab, setTab] = useState<PreviewTab>('dashboard');
  const reset = useApiMutation(
    async (_: void) => {
      await api.branding.reset({ groups: [...BrandingGroup.options], confirm: true });
      if (firm.primaryColor || firm.accentColor) {
        await api.settings.update({ primaryColor: null, accentColor: null });
      }
    },
    { invalidate: FIRM_SETTINGS },
  );
  const error = state.save.error ?? reset.error;
  return (
    <BrandCard title="Actions" testId="brand-actions">
      <Button
        type="button"
        className="min-h-12 text-base"
        disabled={state.save.isPending}
        onClick={state.submit}
      >
        <FloppyDisk aria-hidden weight="fill" className="size-5" />
        {state.save.isPending ? 'Saving…' : 'Save Changes'}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="min-h-12 text-base"
        onClick={() => setDialog('preview')}
      >
        <Eye aria-hidden weight="fill" className="size-5" />
        Preview Full Platform
      </Button>
      <button
        type="button"
        onClick={() => setDialog('reset')}
        className="inline-flex min-h-10 items-center justify-center gap-2 text-sm font-semibold text-action hover:underline"
      >
        <ArrowCounterClockwise aria-hidden weight="bold" className="size-4" />
        Reset to Default Brand Settings
      </button>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(error, BRAND_ERRORS)}
        </p>
      ) : state.saved ? (
        <p role="status" data-testid="brand-saved" className="text-sm text-success">
          {state.saved}
        </p>
      ) : Object.keys(state.errors).length ? (
        <p role="alert" className="text-sm text-danger">
          Check the highlighted fields.
        </p>
      ) : state.dirty ? (
        <p className="text-sm text-muted">Unsaved changes</p>
      ) : null}

      {dialog === 'preview' && state.draft ? (
        <Modal open title="Preview Full Platform" onClose={() => setDialog(null)}>
          <Previews d={state.draft} firm={firm} branding={branding} tab={tab} onTab={setTab} />
        </Modal>
      ) : null}
      {dialog === 'reset' ? (
        <Modal open title="Reset to Default Brand Settings" onClose={() => setDialog(null)}>
          <div className="flex flex-col gap-4">
            <p className="text-sm text-text">
              The colours, theme, login page, email, portal and document branding go back to
              Firmivra&apos;s defaults. Your company information, logo and favicon stay.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button
                disabled={reset.isPending}
                onClick={() =>
                  reset.mutate(undefined, {
                    onSuccess: () => {
                      setDialog(null);
                      state.discard();
                      state.refreshBranding();
                      state.setSaved('Brand settings are back to the defaults.');
                    },
                  })
                }
              >
                Reset
              </Button>
            </div>
          </div>
        </Modal>
      ) : null}
    </BrandCard>
  );
}

/** Each card's frame while the settings load, or when they could not. */
export function BrandCardFrame({ title, loading }: { title: string; loading: boolean }) {
  return (
    <BrandCard title={title}>
      {loading ? (
        <Skeleton className="h-32" />
      ) : (
        <p className="rounded-lg bg-subtle p-4 text-sm text-muted">{NOT_LOADED}</p>
      )}
    </BrandCard>
  );
}
