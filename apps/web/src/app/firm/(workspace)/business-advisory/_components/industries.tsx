'use client';

import { ADVISORY_INDUSTRY_DEFAULTS, type AdvisoryIndustryList } from '@firmivra/types';
import { Button, Input, Modal, Select } from '@firmivra/ui';
import { ArrowDown, ArrowUp, Plus } from '@phosphor-icons/react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { useApiQuery } from '../../../../../lib/query';
import { BA_KEY, errorText } from './ba-shared';

// A-X02 (Business Advisory Review Two, B16): the firm's own industry choices, used by Add
// Advisory Client, Edit Client and the plan's Business Profile. A client or plan keeps the text
// it was saved with; "Other" with Specify is always offered.

export const INDUSTRIES_KEY = [...BA_KEY, 'industries'] as const;

export const useIndustries = () => useApiQuery(INDUSTRIES_KEY, () => api.advisory.industries());

/** The live industry names in the firm's order; the built-in ones when the list can't be read. */
export const industryNames = (list: AdvisoryIndustryList | null | undefined): string[] =>
  list ? list.items.filter((i) => !i.archived).map((i) => i.name) : [...ADVISORY_INDUSTRY_DEFAULTS];

/**
 * An industry picked from the firm's list, or Other with its own words (Specify). `value` is the
 * text saved; one outside the list shows as Other with it in Specify.
 */
export function IndustryField({
  value,
  onChange,
  label = 'Industry',
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const list = useIndustries();
  const names = industryNames(list.data);
  const [otherChosen, setOtherChosen] = useState(false);
  const listed = value !== '' && names.includes(value);
  const choice = listed ? value : value !== '' || otherChosen ? 'Other' : '';
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Select
        label={label}
        value={choice}
        onChange={(e) => {
          const next = e.target.value;
          setOtherChosen(next === 'Other');
          onChange(next === 'Other' ? '' : next);
        }}
        options={[
          { value: '', label: 'Not set' },
          ...names.map((n) => ({ value: n, label: n })),
          { value: 'Other', label: 'Other' },
        ]}
      />
      {choice === 'Other' ? (
        <Input
          label="Specify industry"
          maxLength={100}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}
    </div>
  );
}

interface Row {
  key: string;
  id: string | null;
  name: string;
  archived: boolean;
}
let nextKey = 0;
const keyOf = () => `industry-${(nextKey += 1)}`;

/**
 * A-X02: Manage Industries (Advisory Admin). The firm's list in its order: rename, reorder,
 * archive or restore, and add. Saving the built-in list the first time makes it the firm's own.
 * An archived industry is kept for the clients and plans that use it, but no longer offered.
 */
export function ManageIndustriesDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const qc = useQueryClient();
  const list = useIndustries();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [added, setAdded] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  // The list as loaded, once; then the edits.
  if (rows === null && list.data)
    setRows(
      list.data.items.map((i) => ({
        key: keyOf(),
        id: i.id,
        name: i.name,
        archived: i.archived,
      })),
    );
  const current: Row[] = rows ?? [];
  const edit = (next: Row[]) => setRows(next);
  const change = (key: string, patch: Partial<Row>) =>
    edit(current.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (index: number, by: -1 | 1) => {
    const next = [...current];
    const [row] = next.splice(index, 1);
    if (row) next.splice(index + by, 0, row);
    edit(next);
  };
  const add = () => {
    const name = added.trim();
    if (!name) return;
    edit([...current, { key: keyOf(), id: null, name, archived: false }]);
    setAdded('');
  };
  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await api.advisory.saveIndustries({
        items: current.map((r) => ({
          ...(r.id ? { id: r.id } : {}),
          name: r.name.trim(),
          archived: r.archived,
        })),
      });
      await qc.invalidateQueries({ queryKey: [...INDUSTRIES_KEY] });
      onSaved('Industries saved.');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      title="Manage Industries"
      subtitle="The industries offered for advisory clients and business plans. Other, with Specify, is always offered too."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || !list.data || current.every((r) => r.archived)}
            onClick={() => void save()}
          >
            Save Industries
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="manage-industries">
        {error ? (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        ) : null}
        {list.isError ? (
          <p className="text-sm text-danger">The industries could not be loaded.</p>
        ) : list.isPending ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : (
          <ol className="flex flex-col gap-2" aria-label="Industries">
            {current.map((r, i) => (
              <li key={r.key} className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <Input
                    label={`Industry ${i + 1}`}
                    hideLabel
                    maxLength={80}
                    value={r.name}
                    disabled={r.archived}
                    onChange={(e) => change(r.key, { name: e.target.value })}
                  />
                </div>
                <Button
                  variant="ghost"
                  aria-label={`Move ${r.name} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <ArrowUp aria-hidden weight="bold" className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  aria-label={`Move ${r.name} down`}
                  disabled={i === current.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <ArrowDown aria-hidden weight="bold" className="size-4" />
                </Button>
                <Button
                  variant="secondary"
                  aria-label={`${r.archived ? 'Restore' : 'Archive'} ${r.name}`}
                  onClick={() => change(r.key, { archived: !r.archived })}
                >
                  {r.archived ? 'Restore' : 'Archive'}
                </Button>
              </li>
            ))}
          </ol>
        )}
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <Input
              label="Add an industry"
              maxLength={80}
              value={added}
              onChange={(e) => setAdded(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  add();
                }
              }}
            />
          </div>
          <Button variant="secondary" disabled={!added.trim()} onClick={add}>
            <Plus aria-hidden weight="bold" className="size-4" /> Add
          </Button>
        </div>
      </div>
    </Modal>
  );
}
