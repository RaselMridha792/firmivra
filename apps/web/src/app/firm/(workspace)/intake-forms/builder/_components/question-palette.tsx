'use client';

import { Input, Textarea, Toggle } from '@firmivra/ui';
import { CaretDown, CaretUp } from '@phosphor-icons/react';
import { useState } from 'react';
import type { DraftSettings } from './builder-draft';
import { type BuilderState, BuilderCard } from './builder-parts';
import { PALETTE, QUESTION_LOOKS, TILE_DRAG } from './question-types';

/**
 * 3. Add Questions: one tile per question type. A click adds the question to the chosen section
 * (the last one if none is chosen); a tile can also be dragged onto a section. While the form
 * loads or could not load, the tiles keep their frame and do nothing.
 */
export function AddQuestionsCard({ state }: { state: BuilderState | null }) {
  const sections = state?.draft.sections ?? [];
  const target = sections.find((s) => s.key === state?.active) ?? sections.at(-1);
  const chosen = Boolean(state?.active && target?.key === state.active);
  return (
    <BuilderCard
      title="3. Add Questions"
      subtitle="Drag and drop a field type into your form."
      testId="add-questions"
    >
      <ul className="grid grid-cols-6 gap-2.5">
        {PALETTE.map((type, i) => {
          const look = QUESTION_LOOKS[type];
          const Glyph = look.icon;
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
                className="flex h-full min-h-16 w-full flex-col items-center justify-center gap-1 rounded-lg border border-divider bg-canvas px-1 py-2 text-center text-xs text-heading shadow-sm hover:border-action hover:bg-info-soft disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-divider disabled:hover:bg-canvas"
              >
                <Glyph aria-hidden weight="fill" className="size-6 shrink-0 text-action" />
                <span>{look.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {state ? (
        <p data-testid="add-target" className="text-xs text-muted">
          {!target
            ? 'Adds Section 1 with the question.'
            : chosen
              ? `Adds to ${target.title || 'the chosen section'}.`
              : `Adds to ${target.title || 'the last section'}. Click a section to choose another.`}
        </p>
      ) : null}
    </BuilderCard>
  );
}

/** The on/off settings (every setting but the days and the message). */
type Switch = {
  [K in keyof DraftSettings]: DraftSettings[K] extends boolean ? K : never;
}[keyof DraftSettings];
const SWITCHES: { key: Switch; label: string }[] = [
  { key: 'requireAllQuestions', label: 'Require all questions to be completed' },
  { key: 'allowFileUploads', label: 'Allow file uploads' },
  { key: 'requireSignature', label: 'Require e-signature' },
  { key: 'showProgressBar', label: 'Show progress bar' },
  { key: 'expires', label: 'Set expiration date' },
];

/**
 * 4. Form Settings: folds away (guide Frame 1: collapsible); the firm's defaults (Frame 5) fill a
 * new form. Set expiration date asks for the number of days after sending.
 */
export function FormSettingsCard({
  state,
  className,
}: {
  state: BuilderState;
  className?: string;
}) {
  const [open, setOpen] = useState(true);
  const s = state.draft.settings;
  const e = state.errors;
  const set = <K extends keyof DraftSettings>(key: K, value: DraftSettings[K]) =>
    state.update((d) => ({ ...d, settings: { ...d.settings, [key]: value } }));
  return (
    <BuilderCard
      title="4. Form Settings"
      testId="form-settings"
      className={className}
      action={
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Collapse Form Settings' : 'Expand Form Settings'}
          onClick={() => setOpen(!open)}
          className="flex size-8 shrink-0 items-center justify-center rounded-control text-heading hover:bg-canvas"
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
          <ul className="flex flex-col gap-0.5">
            {SWITCHES.map((sw) => (
              <li key={sw.key}>
                <label className="flex min-h-7 cursor-pointer items-center gap-3">
                  <Toggle label={sw.label} checked={s[sw.key]} onChange={(on) => set(sw.key, on)} />
                  <span className="text-sm text-heading">{sw.label}</span>
                </label>
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
              rows={2}
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
