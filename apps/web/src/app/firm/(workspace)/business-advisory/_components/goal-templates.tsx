'use client';

import { Input } from '@firmivra/ui';
import { useState } from 'react';
import { GOAL_TEMPLATES, matchTemplates } from './goal-templates-data';

/**
 * B24: searchable suggestions beside the goal's title. Choosing one only fills the title, which
 * stays editable; it never creates or saves a goal, and typing a custom goal is always possible.
 */
export function GoalSuggestions({ onPick }: { onPick: (title: string) => void }) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const shown = matchTemplates(term);
  return (
    <div className="flex flex-col gap-2" data-testid="goal-suggestions">
      <button
        type="button"
        className="self-start text-sm font-medium text-link underline"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? 'Hide suggestions' : `Start from a suggestion (${GOAL_TEMPLATES.length})`}
      </button>
      {open ? (
        <div className="flex flex-col gap-2 rounded-lg border border-divider p-3">
          <Input
            label="Search suggestions"
            placeholder="For example: cash, website, staff"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
          {shown.length ? (
            <ul className="flex flex-wrap gap-2" aria-label="Goal suggestions">
              {shown.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    className="rounded-full border border-divider px-3 py-1 text-sm text-text hover:border-action hover:bg-accent-soft"
                    onClick={() => {
                      onPick(t);
                      setOpen(false);
                      setTerm('');
                    }}
                  >
                    {t}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">No suggestion matches; type your own goal above.</p>
          )}
          <p className="text-xs text-muted">
            A suggestion only fills the goal&rsquo;s name, which you can change. Nothing is saved
            until you add the goal.
          </p>
        </div>
      ) : null}
    </div>
  );
}
