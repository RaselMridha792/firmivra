'use client';

import type {
  AdminBrandingSection,
  AdminBrandingSettings,
  PlatformBrandAssetKind,
} from '@firmivra/types';
import { Button, ColorField, Input, Radio, Select, Textarea, Toggle } from '@firmivra/ui';
import {
  Buildings,
  Desktop,
  Gear,
  House,
  ImageSquare,
  List,
  Palette,
  UploadSimple,
  UsersThree,
  Wrench,
  FileText,
} from '@phosphor-icons/react';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { useApiMutation, useApiQuery } from '../../../../../../lib/query';
import {
  Body,
  BRAND_ACCEPT,
  failedStatus,
  ImportantNote,
  SaveBar,
  savedStatus,
  SectionCard,
  SettingsHeader,
  SS,
  uploadBrandImage,
} from '../../_components/settings-kit';

type Colors = AdminBrandingSettings['colors'];
/** The platform's colours when none is set (the console's own palette, as in the design). */
const BUILT_IN: Record<keyof Colors, string> = {
  primary: '#0066ff',
  secondary: '#00ccbb',
  accent: '#7b61ff',
  background: '#f8fafc',
  text: '#1f2937',
  sidebar: '#0b2a52',
};
const COLOR_LABELS: Record<keyof Colors, string> = {
  primary: 'Primary Color',
  secondary: 'Secondary Color',
  accent: 'Accent Color',
  background: 'Background Color',
  text: 'Text Color',
  sidebar: 'Sidebar Color',
};
const DEFAULTS: Omit<AdminBrandingSettings, 'tagline' | 'description'> = {
  colors: {
    primary: null,
    secondary: null,
    accent: null,
    background: null,
    text: null,
    sidebar: null,
  },
  appearance: 'LIGHT',
  allowUserAppearance: true,
  sidebarStyle: 'EXPANDED',
  borderRadius: 'MEDIUM',
  login: { showLogo: true, showTagline: true },
  portal: { usePlatformBranding: true, allowFirmBranding: true },
};
const IMAGES: { kind: PlatformBrandAssetKind; label: string; hint: string; wide?: boolean }[] = [
  {
    kind: 'LOGO',
    label: 'Platform Logo',
    hint: 'Recommended: 400 × 120 px (PNG, transparent background)',
    wide: true,
  },
  { kind: 'FAVICON', label: 'Favicon', hint: 'Recommended: 32 × 32 px (PNG)' },
  {
    kind: 'LOGIN_BACKGROUND',
    label: 'Login Background (Optional)',
    hint: 'Recommended: 1920 × 1080 px',
  },
];
const NAV = [
  { href: '#general', label: 'General' },
  { href: '#images', label: 'Logos & Images' },
  { href: '#colors', label: 'Colors & Theme' },
  { href: '#login-portal', label: 'Login & Portal' },
  { href: '/system-settings/email-notifications#branding', label: 'Email Branding' },
];

type Status = Parameters<typeof SaveBar>[0]['status'];

/**
 * Branding & Appearance (firmivra-branding-and-appearance-dashboard.jpg): the platform's tagline
 * and description, its images (logo, favicon, login background; each checked before use), the
 * colour palette, theme options with a preview, and the login page and client portal defaults.
 * The platform name is General Settings' (shown here, changed there). Custom CSS has no setting:
 * the tab is shown but shut.
 */
export function BrandingSettings() {
  const q = useApiQuery([...SS, 'branding'], () => api.adminSettings.branding());
  const general = useApiQuery([...SS, 'general'], () => api.adminSettings.general());
  const [draft, setDraft] = useState<AdminBrandingSettings>();
  const [status, setStatus] = useState<Status>(null);
  const value = draft ?? q.data?.value;
  const save = useApiMutation(
    () => api.adminSettings.saveBranding({ version: q.data!.version, value: value! }),
    { invalidate: [...SS] },
  );
  const set = (next: Partial<AdminBrandingSettings>) => {
    if (!value) return;
    setDraft({ ...value, ...next });
    setStatus(null);
  };
  const color = (k: keyof Colors) => value?.colors[k] ?? BUILT_IN[k];

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <SettingsHeader
        title="Branding & Appearance"
        subtitle="Customize the look and feel of the Firmivra platform and client portals."
        icon={Palette}
      />
      <nav aria-label="Sections" className="flex gap-8 overflow-x-auto border-b border-divider">
        {NAV.map((s, i) => (
          <a
            key={s.href}
            href={s.href}
            aria-current={i === 0 ? 'location' : undefined}
            className={`-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 text-sm font-medium ${i === 0 ? 'border-action text-action' : 'border-transparent text-text hover:text-heading'}`}
          >
            {s.label}
          </a>
        ))}
        <span
          aria-disabled
          title="Custom CSS is not a platform setting"
          className="-mb-px inline-flex min-h-11 shrink-0 cursor-not-allowed items-center border-b-2 border-transparent text-sm font-medium text-muted"
        >
          Custom CSS (Advanced)
        </span>
      </nav>

      <div className="grid min-w-0 gap-5 xl:grid-cols-2">
        <SectionCard
          id="general"
          title="Platform Branding"
          subtitle="Set the platform name and basic branding information."
          icon={Buildings}
        >
          <Body query={{ ...q, data: value }} rows={3}>
            {(v) => (
              <div className="flex flex-col gap-4">
                <div>
                  <Input
                    label="Platform Name"
                    value={general.data?.value.platformName ?? ''}
                    readOnly
                  />
                  <p className="mt-1 text-xs text-muted">
                    Changed in{' '}
                    <Link href="/system-settings/general" className="text-action">
                      General Settings
                    </Link>
                    .
                  </p>
                </div>
                <Input
                  label="Tagline (Optional)"
                  value={v.tagline ?? ''}
                  maxLength={160}
                  onChange={(e) => set({ tagline: e.target.value || null })}
                />
                <Textarea
                  label="Short Description (Optional)"
                  rows={3}
                  value={v.description ?? ''}
                  maxLength={1000}
                  onChange={(e) => set({ description: e.target.value || null })}
                />
              </div>
            )}
          </Body>
        </SectionCard>

        <SectionCard
          id="images"
          title="Logo & Favicon"
          subtitle="Upload and manage your platform logo, favicon, and related images."
          icon={ImageSquare}
        >
          <div className="grid gap-4 sm:grid-cols-[1.4fr_1fr_1.2fr]">
            {IMAGES.map((img) => (
              <BrandImage
                key={img.kind}
                {...img}
                section={q.data}
                failed={q.isError}
                onDone={setStatus}
              />
            ))}
          </div>
        </SectionCard>

        <SectionCard
          id="colors"
          title="Color Palette"
          subtitle="Customize the platform colors and theme."
          icon={Wrench}
        >
          <Body query={{ ...q, data: value }} rows={2}>
            {(v) => (
              <div className="grid gap-4 sm:grid-cols-3">
                {(Object.keys(COLOR_LABELS) as (keyof Colors)[]).map((k) => (
                  <ColorField
                    key={k}
                    label={COLOR_LABELS[k]}
                    value={color(k)}
                    hint={v.colors[k] ? undefined : "Firmivra's default"}
                    onChange={(hex) => set({ colors: { ...v.colors, [k]: hex.toLowerCase() } })}
                  />
                ))}
              </div>
            )}
          </Body>
        </SectionCard>

        <SectionCard
          id="theme"
          title="Theme Options"
          subtitle="Choose the default theme and appearance settings."
          icon={Gear}
        >
          <Body query={{ ...q, data: value }} rows={3}>
            {(v) => (
              <div className="grid gap-5 lg:grid-cols-[1fr_15rem]">
                <div className="flex flex-col gap-4">
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-heading">Default Theme</legend>
                    <div className="flex flex-wrap gap-5">
                      {(
                        [
                          ['LIGHT', 'Light'],
                          ['DARK', 'Dark'],
                          ['SYSTEM', 'System (Auto)'],
                        ] as const
                      ).map(([val, label]) => (
                        <Radio
                          key={val}
                          name="appearance"
                          label={label}
                          checked={v.appearance === val}
                          onChange={() => set({ appearance: val })}
                        />
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="mb-2 text-sm font-medium text-heading">Sidebar Style</legend>
                    <div className="flex flex-wrap gap-5">
                      {(
                        [
                          ['EXPANDED', 'Expanded (with text)'],
                          ['COLLAPSED', 'Collapsed (icons only)'],
                        ] as const
                      ).map(([val, label]) => (
                        <Radio
                          key={val}
                          name="sidebar-style"
                          label={label}
                          checked={v.sidebarStyle === val}
                          onChange={() => set({ sidebarStyle: val })}
                        />
                      ))}
                    </div>
                  </fieldset>
                  <Select
                    label="Border Radius"
                    value={v.borderRadius}
                    onChange={(e) =>
                      set({ borderRadius: e.target.value as AdminBrandingSettings['borderRadius'] })
                    }
                    options={[
                      { value: 'SMALL', label: 'Small' },
                      { value: 'MEDIUM', label: 'Medium' },
                      { value: 'LARGE', label: 'Large' },
                    ]}
                  />
                  <div className="flex items-center gap-3 text-sm text-heading">
                    <Toggle
                      label="Let users choose their own theme"
                      checked={v.allowUserAppearance}
                      onChange={(on) => set({ allowUserAppearance: on })}
                    />
                    <span aria-hidden>Let users choose their own theme</span>
                  </div>
                </div>
                <Preview
                  sidebar={color('sidebar')}
                  collapsed={v.sidebarStyle === 'COLLAPSED'}
                  logoUrl={q.data?.assets.LOGO?.url ?? null}
                />
              </div>
            )}
          </Body>
        </SectionCard>
      </div>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[1fr_1fr_24rem]">
        <SectionCard
          id="login-portal"
          title="Login Page Settings"
          subtitle="Customize the appearance of the login page."
          icon={Desktop}
        >
          <Body query={{ ...q, data: value }} rows={2}>
            {(v) => (
              <div className="flex flex-col gap-3">
                <Switch
                  label="Show platform logo on login page"
                  on={v.login.showLogo}
                  set={(on) => set({ login: { ...v.login, showLogo: on } })}
                />
                <Switch
                  label="Show tagline on login page"
                  on={v.login.showTagline}
                  set={(on) => set({ login: { ...v.login, showTagline: on } })}
                />
              </div>
            )}
          </Body>
        </SectionCard>
        <SectionCard
          id="portal"
          title="Client Portal Branding"
          subtitle="Set default branding for new firm client portals."
          icon={UsersThree}
        >
          <Body query={{ ...q, data: value }} rows={2}>
            {(v) => (
              <div className="flex flex-col gap-3">
                <Switch
                  label="Use platform branding by default"
                  on={v.portal.usePlatformBranding}
                  set={(on) => set({ portal: { ...v.portal, usePlatformBranding: on } })}
                />
                <Switch
                  label="Allow firms to customize their own branding"
                  on={v.portal.allowFirmBranding}
                  set={(on) => set({ portal: { ...v.portal, allowFirmBranding: on } })}
                />
              </div>
            )}
          </Body>
        </SectionCard>
        <div className="flex flex-col gap-5">
          <ImportantNote>
            Branding changes may take a few minutes to apply across the platform and client portals.
          </ImportantNote>
          <SaveBar
            status={status}
            saving={save.isPending}
            disabled={!value}
            onReset={() => {
              if (!value) return;
              setDraft({ ...value, ...DEFAULTS });
              setStatus({
                tone: 'info',
                text: "Firmivra's defaults are filled in. Nothing changes until you save.",
              });
            }}
            onSave={() =>
              save.mutate(undefined, {
                onSuccess: (s) => {
                  setDraft(s.value);
                  setStatus(savedStatus);
                },
                onError: (e) => setStatus(failedStatus(e)),
              })
            }
          />
        </div>
      </div>
    </div>
  );
}

function Switch({ label, on, set }: { label: string; on: boolean; set: (on: boolean) => void }) {
  return (
    <div className="flex items-center gap-3 text-sm text-heading">
      <Toggle label={label} checked={on} onChange={set} />
      <span aria-hidden>{label}</span>
    </div>
  );
}

/** The theme preview: the console's sidebar in the chosen sidebar colour and style. */
function Preview({
  sidebar,
  collapsed,
  logoUrl,
}: {
  sidebar: string;
  collapsed: boolean;
  logoUrl: string | null;
}) {
  const items = [
    [House, 'Dashboard'],
    [FileText, 'Firm Applications'],
    [Buildings, 'Firms'],
  ] as const;
  return (
    <figure className="overflow-hidden rounded-lg border border-divider" aria-label="Theme preview">
      <figcaption className="bg-canvas px-2 py-1 text-xs font-medium text-heading">
        Preview
      </figcaption>
      <div
        className="flex flex-col gap-3 p-3 text-on-navigation"
        style={{ backgroundColor: sidebar }}
      >
        <List aria-hidden weight="bold" className="size-5" />
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" className="h-8 object-contain object-left" />
        ) : (
          <span className="text-base font-bold">Firmivra</span>
        )}
        {items.map(([I, label]) => (
          <span key={label} className="flex items-center gap-2 text-xs">
            <I aria-hidden weight="regular" className="size-4" />
            {collapsed ? null : label}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** One brand image: what is in use (or the built-in one), Change and Remove. */
function BrandImage({
  kind,
  label,
  hint,
  section,
  failed,
  onDone,
}: {
  kind: PlatformBrandAssetKind;
  label: string;
  hint: string;
  section: AdminBrandingSection | undefined;
  failed: boolean;
  onDone: (s: Status) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const asset = section?.assets[kind] ?? null;
  const upload = useApiMutation((file: File) => uploadBrandImage(kind, file), {
    invalidate: [...SS],
  });
  const reset = useApiMutation(() => api.adminSettings.resetBrandAsset(kind), {
    invalidate: [...SS],
  });
  return (
    <div className="flex min-w-0 flex-col gap-2" data-testid={`brand-${kind}`}>
      <p className="text-sm font-medium text-heading">{label}</p>
      <div className="flex h-28 items-center justify-center rounded-lg border border-divider bg-surface p-2">
        {asset?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={label} className="max-h-full max-w-full object-contain" />
        ) : (
          <span className="text-center text-xs text-muted">
            {failed ? 'Could not load' : asset ? 'Being checked…' : 'Built-in'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          disabled={upload.isPending || !section}
          onClick={() => input.current?.click()}
        >
          <span className="inline-flex items-center gap-1.5 text-xs text-action">
            <UploadSimple aria-hidden weight="bold" className="size-3.5" />
            {upload.isPending ? '…' : 'Change'}
          </span>
        </Button>
        <Button
          variant="secondary"
          disabled={!asset || reset.isPending}
          onClick={() =>
            reset.mutate(undefined, {
              onSuccess: () =>
                onDone({ tone: 'ok', text: `${label}: back to Firmivra's built-in image.` }),
              onError: (e) => onDone(failedStatus(e)),
            })
          }
        >
          <span className="text-xs text-danger">Remove</span>
        </Button>
      </div>
      <input
        ref={input}
        type="file"
        accept={BRAND_ACCEPT.join(',')}
        className="sr-only"
        aria-label={`Choose an image for ${label}`}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file)
            upload.mutate(file, {
              onSuccess: (a) =>
                onDone(
                  a.scanStatus === 'CLEAN'
                    ? { tone: 'ok', text: `${label}: the new image is in use.` }
                    : {
                        tone: 'info',
                        text: `${label}: the image is being checked and goes in use once it is clean.`,
                      },
                ),
              onError: (err) => onDone(failedStatus(err)),
            });
        }}
      />
      <p className="text-xs text-muted">{hint}</p>
    </div>
  );
}
