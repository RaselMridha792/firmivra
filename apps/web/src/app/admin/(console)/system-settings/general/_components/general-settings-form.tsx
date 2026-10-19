'use client';

import { ApiRequestError, SaveAdminGeneralRequest } from '@firmivra/types';
import { Button, Modal } from '@firmivra/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { FloppyDisk } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import {
  GENERAL_SETTINGS,
  saveGeneralSettings,
  type GeneralSettingsData,
} from './general-settings-data';
import { GeneralSettingsFields } from './general-settings-fields';
import { GeneralSettingsRail } from './general-settings-rail';

function emptyForm(): SaveAdminGeneralRequest {
  return {
    version: 0,
    value: {
      platformName: '',
      tagline: '',
      supportEmail: '',
      supportPhone: '',
      defaultTimeZone: '',
      defaultLocale: '',
      defaultCurrency: '',
      // Enum controls have an unselected option until settings have loaded.
      dateFormat: 'MM/DD/YYYY',
      timeFormat: '12H',
      numberFormat: '1,234.56',
      preferences: {
        darkModeOption: false,
        productUpdates: false,
        helpCenter: false,
        userFeedback: false,
        maintenanceBanner: false,
        betaFeatures: false,
      },
    },
  };
}

export function GeneralSettingsForm({
  data,
  loading,
  platformUrl,
  onSaved,
  onReload,
}: {
  data?: GeneralSettingsData;
  loading: boolean;
  platformUrl: string;
  onSaved: (message: string) => void;
  onReload: () => void;
}) {
  const client = useQueryClient();
  const form = useForm<SaveAdminGeneralRequest>({
    resolver: zodResolver(SaveAdminGeneralRequest),
    defaultValues: data?.general
      ? { version: data.general.version, value: data.general.value }
      : emptyForm(),
  });
  const [confirmSave, setConfirmSave] = useState<SaveAdminGeneralRequest | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [learnMore, setLearnMore] = useState(false);
  const save = useApiMutation((body: SaveAdminGeneralRequest) =>
    saveGeneralSettings(body, data?.preview ?? false),
  );
  const resetLogo = useApiMutation(() => api.adminSettings.resetBrandAsset('LOGO'));
  const conflict = save.error instanceof ApiRequestError && save.error.code === 'SAVE_CONFLICT';
  const permissionError =
    save.error instanceof ApiRequestError && [401, 403].includes(save.error.status);
  const disabled =
    !data?.general ||
    loading ||
    save.isPending ||
    resetLogo.isPending ||
    permissionError ||
    conflict;

  function persist(body: SaveAdminGeneralRequest) {
    save.mutate(body, {
      onSuccess: (general) => {
        setConfirmSave(null);
        form.reset({ version: general.version, value: general.value });
        client.setQueryData<GeneralSettingsData>(GENERAL_SETTINGS, (previous) =>
          previous ? { ...previous, general } : previous,
        );
        onSaved(
          data?.preview
            ? 'Preview updated for this session. No platform settings were saved.'
            : 'General settings saved.',
        );
      },
    });
  }

  return (
    <FormProvider {...form}>
      <form
        noValidate
        aria-label="General settings"
        aria-busy={loading || save.isPending}
        onSubmit={form.handleSubmit((body) => {
          if (disabled) return;
          if (
            (['maintenanceBanner', 'betaFeatures'] as const).some(
              (key) => body.value.preferences[key] !== data?.general?.value.preferences[key],
            )
          )
            setConfirmSave(body);
          else persist(body);
        })}
      >
        {save.error ? (
          <div
            role="alert"
            className="mb-3 rounded-card border border-border bg-surface p-4 text-sm text-danger"
          >
            {errorMessage(save.error, {
              SAVE_CONFLICT:
                'These settings changed after you opened the page. Reload the latest settings before saving.',
            })}
            {conflict ? (
              <Button variant="secondary" onClick={onReload} className="ml-3">
                Reload settings
              </Button>
            ) : null}
          </div>
        ) : null}
        <div className="grid min-w-0 gap-5 xl:grid-cols-26">
          <div className="min-w-0 xl:col-span-18">
            <GeneralSettingsFields
              data={data}
              disabled={disabled}
              platformUrl={platformUrl}
              onRemoveLogo={() => setRemoveLogo(true)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-4.5 xl:col-span-8">
            <GeneralSettingsRail
              data={data}
              loading={loading}
              onLearnMore={() => setLearnMore(true)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                disabled
                title="Default settings have not been provided by the configuration service"
                className="min-h-10.5 border-folder-border! bg-info-soft! px-5 text-xs text-heading! disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reset to Default
              </Button>
              <Button
                type="submit"
                disabled={disabled}
                className="min-h-10.5 min-w-44 px-5 text-xs font-semibold"
              >
                <FloppyDisk aria-hidden weight="fill" className="size-4.5" />
                {save.isPending ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      </form>

      <Modal open={learnMore} onClose={() => setLearnMore(false)} title="Platform-wide settings">
        <p className="text-sm text-muted">
          General settings provide the platform's identity, support contacts, localization, and
          preferences. Changes apply across Firmivra. Explicit firm or user preferences take
          precedence where supported.
        </p>
      </Modal>
      <Modal
        open={confirmSave !== null}
        onClose={() => {
          if (!save.isPending) setConfirmSave(null);
        }}
        title="Save platform preferences?"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={save.isPending}
              onClick={() => setConfirmSave(null)}
            >
              Cancel
            </Button>
            <Button
              disabled={save.isPending}
              onClick={() => {
                if (confirmSave) persist(confirmSave);
              }}
            >
              {save.isPending ? 'Saving…' : 'Confirm changes'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Maintenance banner or beta feature preferences have changed. This affects all firms using
          the platform defaults.
        </p>
        {save.error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {errorMessage(save.error, {
              SAVE_CONFLICT:
                'Settings changed elsewhere. Close this dialog and reload the latest settings.',
            })}
          </p>
        ) : null}
      </Modal>
      <Modal
        open={removeLogo}
        onClose={() => {
          if (!resetLogo.isPending) setRemoveLogo(false);
        }}
        title="Remove custom platform logo?"
        footer={
          <>
            <Button
              variant="secondary"
              disabled={resetLogo.isPending}
              onClick={() => setRemoveLogo(false)}
            >
              Cancel
            </Button>
            <Button
              disabled={resetLogo.isPending}
              onClick={() =>
                resetLogo.mutate(undefined, {
                  onSuccess: (branding) => {
                    client.setQueryData<GeneralSettingsData>(GENERAL_SETTINGS, (previous) =>
                      previous ? { ...previous, branding } : previous,
                    );
                    setRemoveLogo(false);
                    onSaved('The built-in platform logo has been restored.');
                  },
                })
              }
            >
              {resetLogo.isPending ? 'Removing…' : 'Remove logo'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          Firmivra's built-in logo will replace the custom logo across the platform.
        </p>
        {resetLogo.error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {errorMessage(resetLogo.error)}
          </p>
        ) : null}
      </Modal>
    </FormProvider>
  );
}
