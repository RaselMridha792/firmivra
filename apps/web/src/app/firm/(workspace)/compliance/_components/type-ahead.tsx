'use client';

import { Input } from '@firmivra/ui';
import { useId, useState } from 'react';

/**
 * CD-F04 (Octavia, Oct 28): a filter over a long list (clients, team members) that is searched by
 * typing. The browser's own suggestions narrow the list; a name typed or picked in full chooses
 * it, and an empty box chooses everything. Leaving the box shows the choice in force again.
 */
export function TypeAheadFilter({
  label,
  placeholder,
  value,
  options,
  onPick,
}: {
  label: string;
  /** What an empty box means ("All Clients"). */
  placeholder: string;
  value: string;
  options: { value: string; label: string }[];
  onPick: (value: string) => void;
}) {
  const listId = useId();
  // What is being typed; null shows the choice in force.
  const [text, setText] = useState<string | null>(null);
  const chosen = options.find((o) => o.value === value)?.label ?? '';
  return (
    <>
      <Input
        label={label}
        type="search"
        list={listId}
        autoComplete="off"
        placeholder={placeholder}
        value={text ?? chosen}
        onChange={(e) => {
          const typed = e.target.value;
          setText(typed);
          const name = typed.trim().toLowerCase();
          if (!name) onPick('');
          else {
            const match = options.find((o) => o.label.toLowerCase() === name);
            if (match) onPick(match.value);
          }
        }}
        onBlur={() => setText(null)}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.value} value={o.label} />
        ))}
      </datalist>
    </>
  );
}
