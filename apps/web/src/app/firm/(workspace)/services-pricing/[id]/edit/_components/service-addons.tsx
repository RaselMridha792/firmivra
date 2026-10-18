'use client';

import { CreateCatalogServiceRequest } from '@firmivra/types';
import { Button, IconButton, Input, Modal, Select, Textarea, Toggle } from '@firmivra/ui';
import { PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { money, Panel } from './service-parts';

type AddOn = NonNullable<CreateCatalogServiceRequest['addOns']>[number];
export function ServiceAddOns({
  items,
  onChange,
}: {
  items: AddOn[];
  onChange: (items: AddOn[]) => void;
}) {
  const [edit, setEdit] = useState<{ index: number | null; value: AddOn } | null>(null);
  const [error, setError] = useState('');
  const [remove, setRemove] = useState<number | null>(null);
  const save = () => {
    if (!edit) return;
    const parsed = CreateCatalogServiceRequest.shape.addOns.safeParse([edit.value]);
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join('. '));
      return;
    }
    onChange(
      edit.index === null
        ? [...items, edit.value]
        : items.map((item, i) => (i === edit.index ? edit.value : item)),
    );
    setEdit(null);
  };
  return (
    <>
      <Panel
        title="Optional Add-Ons"
        marker={<Plus weight="fill" className="size-4" />}
        action={
          <Button
            variant="outline"
            className="text-xs"
            disabled={items.length >= 30}
            onClick={() => {
              setError('');
              setEdit({
                index: null,
                value: {
                  name: '',
                  description: '',
                  priceCents: 0,
                  status: 'ACTIVE',
                  clientSelectable: true,
                },
              });
            }}
          >
            <Plus weight="fill" className="size-4" />
            Add Add-On
          </Button>
        }
      >
        <div className="grid grid-cols-6 gap-2 border-b border-divider bg-table-head px-2 py-2 text-xs font-medium text-heading">
          <span className="col-span-3">Add-On Name</span>
          <span>Price</span>
          <span className="col-span-2 text-right">Actions</span>
        </div>
        {items.length ? (
          items.map((item, i) => (
            <div
              key={item.id ?? `addon-${i}`}
              className="grid grid-cols-6 items-center gap-2 border-b border-divider px-2 py-2 text-sm"
              data-testid="service-addon"
            >
              <div className="col-span-3 min-w-0">
                <p className="break-words">{item.name}</p>
                {item.status === 'INACTIVE' ? <p className="text-xs text-muted">Inactive</p> : null}
              </div>
              <span>{money(item.priceCents)}</span>
              <div className="col-span-2 flex flex-wrap justify-end gap-1">
                <IconButton
                  icon={PencilSimple}
                  tone="action"
                  label={`Edit add-on ${i + 1}`}
                  onClick={() => {
                    setError('');
                    setEdit({ index: i, value: { ...item } });
                  }}
                />
                <IconButton
                  icon={Trash}
                  label={`Remove add-on ${i + 1}`}
                  onClick={() =>
                    item.id ? setRemove(i) : onChange(items.filter((_, index) => index !== i))
                  }
                />
              </div>
            </div>
          ))
        ) : (
          <p className="py-3 text-sm text-muted">No optional add-ons added.</p>
        )}
      </Panel>
      <Modal
        open={edit !== null}
        title={edit?.index == null ? 'Add service add-on' : 'Edit service add-on'}
        onClose={() => setEdit(null)}
        footer={<Button onClick={save}>Save Add-On</Button>}
      >
        {edit ? (
          <div className="space-y-3">
            <Input
              label="Add-On Name *"
              maxLength={120}
              value={edit.value.name}
              onChange={(e) => setEdit({ ...edit, value: { ...edit.value, name: e.target.value } })}
            />
            <Textarea
              label="Add-On Description"
              maxLength={300}
              value={edit.value.description ?? ''}
              onChange={(e) =>
                setEdit({ ...edit, value: { ...edit.value, description: e.target.value } })
              }
            />
            <Input
              label="Add-On Price"
              type="number"
              min={0}
              step="0.01"
              value={edit.value.priceCents / 100}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  value: { ...edit.value, priceCents: Math.round(Number(e.target.value) * 100) },
                })
              }
            />
            <Select
              label="Add-On Status"
              value={edit.value.status ?? 'ACTIVE'}
              options={[
                { value: 'ACTIVE', label: 'Active' },
                { value: 'INACTIVE', label: 'Inactive' },
              ]}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  value: { ...edit.value, status: e.target.value as AddOn['status'] },
                })
              }
            />
            <div className="flex items-center gap-3 text-sm">
              <Toggle
                label="Client selectable"
                checked={!!edit.value.clientSelectable}
                onChange={(next) =>
                  setEdit({ ...edit, value: { ...edit.value, clientSelectable: next } })
                }
              />
              <span>Client selectable</span>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>
      <Modal
        open={remove !== null}
        title="Remove saved add-on?"
        onClose={() => setRemove(null)}
        footer={
          <Button
            onClick={() => {
              onChange(items.filter((_, i) => i !== remove));
              setRemove(null);
            }}
          >
            Remove add-on
          </Button>
        }
      >
        <p>Existing transaction snapshots will stay unchanged.</p>
      </Modal>
    </>
  );
}
