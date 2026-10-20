'use client';

import type { IntegrationOptionField, IntegrationSettings } from '@firmivra/types';
import { Button, Checkbox, Input, Select, Toggle } from '@firmivra/ui';

type IntegrationSettingValue = NonNullable<IntegrationSettings['options']>[string];

export function SetupOption({
  option,
  value,
  disabled,
  connected,
  onChange,
}: {
  option: IntegrationOptionField;
  value: IntegrationSettingValue | undefined;
  disabled: boolean;
  connected: boolean;
  onChange: (value: IntegrationSettingValue) => void;
}) {
  const unavailable = option.afterConnect && (!connected || !option.choices.length);
  const locked = disabled || unavailable;
  return (
    <div className="flex flex-col gap-1">
      {option.type === 'TOGGLE' ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-text">{option.label}</span>
          <Toggle
            label={option.label}
            checked={value === true}
            disabled={locked}
            onChange={onChange}
          />
        </div>
      ) : option.type === 'SELECT' ? (
        <Select
          label={option.label}
          value={typeof value === 'string' ? value : ''}
          disabled={locked}
          options={[
            {
              value: '',
              label: unavailable ? 'Available after authorization' : 'Select an option',
            },
            ...option.choices,
          ]}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : option.type === 'MULTI_SELECT' ? (
        <fieldset disabled={locked}>
          <legend className="text-sm font-semibold text-heading">{option.label}</legend>
          {option.choices.length ? (
            option.choices.map((choice) => (
              <Checkbox
                key={choice.value}
                label={choice.label}
                checked={Array.isArray(value) && value.includes(choice.value)}
                onChange={(e) => {
                  const selected = Array.isArray(value) ? value : [];
                  onChange(
                    e.target.checked
                      ? [...selected, choice.value]
                      : selected.filter((item) => item !== choice.value),
                  );
                }}
              />
            ))
          ) : (
            <p className="text-sm text-muted">No choices available.</p>
          )}
          {option.key === 'folders' ? (
            <div className="mt-2">
              <Button
                variant="ghost"
                disabled
                title="Custom folders are not offered by this provider configuration"
              >
                + Add Custom Folder
              </Button>
              <p className="text-xs text-muted">
                Choose from the folders supplied by your provider.
              </p>
            </div>
          ) : null}
        </fieldset>
      ) : (
        <Input
          label={option.label}
          value={typeof value === 'string' ? value : ''}
          disabled={locked}
          maxLength={500}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {option.help ? <p className="text-xs text-muted">{option.help}</p> : null}
      {unavailable ? (
        <p className="text-xs text-muted">Authorize your account to load provider choices.</p>
      ) : null}
    </div>
  );
}
