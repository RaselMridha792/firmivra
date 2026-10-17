'use client';

import { Input, Textarea, Toggle } from '@firmivra/ui';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { createElement, useState } from 'react';
import type { DraftSettings } from './builder-draft';
import { type BuilderState, BuilderCard } from './builder-parts';
import { PALETTE, QUESTION_LOOKS, TILE_DRAG } from './question-types';

/**
 * 3. Add Questions: one tile per question type. A click adds the question to the chosen section
 * (the last one if none is chosen); a tile can also be dragged onto a section.
 */
export function AddQuestionsCard({ state }: { state: BuilderState | null }) {
  const target = state?.draft.sections.find((s) => s.key === state.active);
  return (
    <BuilderCard
      title="3. Add Questions"
      subtitle="Drag and drop a field type into your form."
      testId="add-questions"
    >
      <ul className="grid grid-cols-6 gap-2">
        {PALETTE.map((type, i) => {
          const look = QUESTION_LOOKS[type];
          const wide = i >= PALETTE.length - 2;
          return (
            <li key={type} className={wide ? 'col-span-3' : 'col-span-2'}>
              <button
                type="button"
                draggable={Boolean(state)}
                disabled={!state}
                aria-label={`Add ${look.label}`}
                onClick={() => state?.addQuestion(type)}
                onDragStart={(ev) => {
                  ev.dataTransfer.setData(TILE_DRAG, type);
                  ev.dataTransfer.effectAllowed = 'copy';
                }}
                className="flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded-lg border border-divider bg-canvas px-1 py-2 text-center text-sm text-heading hover:border-action hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createElement(look.icon, {
                  'aria-hidden': true,
                  weight: 'bold',
                  className: 'size-7 text-action',
                })}
                <span>{look.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {state ? (
        <p className="text-xs text-muted">
          {target
            ? `Adds to ${target.title || 'the chosen section'}.`
            : 'Adds to the last section. Click a section to choose it.'}
        </p>
      ) : null}
    </BuilderCard>
  );
}

const SWITCHES: { key: keyof DraftSettings; label: string }[] = [
  { key: 'requireAllQuestions', label: 'Require all questions to be completed' },
  { key: 'allowFileUploads', label: 'Allow file uploads' },
  { key: 'requireSignature', label: 'Require e-signature' },
  { key: 'showProgressBar', label: 'Show progress bar' },
  { key: 'expires', label: 'Set expiration date' },
];

/** 4. Form Settings: folds away (guide Frame 1); the firm's defaults fill a new form. */
export function FormSettingsCard({ state }: { state: BuilderState }) {
  const [open, setOpen] = useState(true);
  const s = state.draft.settings;
  const e = state.errors;
  const set = <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) =>
    state.update((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
  return (
    <BuilderCard
      title="4. Form Settings"
      testId="form-settings"
      action={
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Fold Form Settings' : 'Open Form Settings'}
          onClick={() => setOpen(!open)}
          className="flex size-10 items-center justify-center rounded-control text-heading hover:bg-canvas"
        >
          {open ? (
            <CaretUp aria-hidden weight="bold" className="size-5" />
          ) : (
            <CaretDown aria-hidden weight="bold" className="size-5" />
          )}
        </button>
      }
    >
      {open ? (
        <>
          <ul className="flex flex-col gap-1">
            {SWITCHES.map((sw) => (
              <li key={sw.key} className="flex min-h-10 items-center gap-3">
                <Toggle
                  label={sw.label}
                  checked={Boolean(s[sw.key])}
                  onChange={(on) => set(sw.key, on)}
                />
                <span className="text-sm text-heading">{sw.label}</span>
              </li>
            ))}
          </ul>
          {s.expires ? (
            <Input
              label="Days after sending"
              type="number"
              min={1}
              max={365}
              value={String(s.expiresAfterDays)}
              error={e.expiresAfterDays}
              onChange={(ev) => set('expiresAfterDays', Number(ev.target.value))}
            />
          ) : null}
          <div className="flex flex-col gap-1">
            <Textarea
              label="Custom Success Message"
              rows={3}
              maxLength={200}
              placeholder="Thank you! We've received your information and will be in touch soon."
              value={s.successMessage}
              error={e.successMessage}
              onChange={(ev) => set('successMessage', ev.target.value)}
            />
            <p className="-mt-1 self-end text-xs text-muted">{`${s.successMessage.length}/200`}</p>
          </div>
        </>
      ) : null}
    </BuilderCard>
  );
}
