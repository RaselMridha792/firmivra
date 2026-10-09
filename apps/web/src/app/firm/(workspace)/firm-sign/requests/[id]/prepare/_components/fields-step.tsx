'use client';

import {
  ESIGN_ERRORS,
  type EsignFieldType,
  type EsignPutFieldsBody,
  type EsignRecipient,
  type EsignRequestDetail,
} from '@firmivra/types';
import { Button, Card, Checkbox, Select } from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { FIELD_TYPE_LABELS } from '../../../../../../../../components/esign/field-labels';
import { closeThumbFiles, PageThumb } from '../../../../../../../../components/esign/page-thumb';
import {
  recipientColor,
  SENDER_COLOR,
} from '../../../../../../../../components/esign/recipient-colors';
import { api } from '../../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../../../lib/query';
import { FIELD_KEYS_ID, FieldBox } from './field-box';
import { DEFAULT_SIZE, duplicate, type FieldDraft, fromField, newKey, toBody } from './field-draft';
import { NextStepLink } from './next-step-link';
import { requestKey, stepHref } from './steps';

/** The palette: what a signer fills in. */
const PALETTE: EsignFieldType[] = [
  'SIGNATURE',
  'INITIALS',
  'DATE_SIGNED',
  'PRINTED_NAME',
  'TEXT',
  'CHECKBOX',
];
/** The widest a page is drawn, in CSS pixels (a letter page at 96 dpi). */
const MAX_PAGE_WIDTH = 816;

/** Step 3: where each signer signs and fills in, page by page. */
export function FieldsStep({ r }: { r: EsignRequestDetail }) {
  const signers = r.recipients.filter((x) => x.kind === 'SIGNER');
  if (signers.length === 0) {
    return (
      <Card className="flex flex-col gap-2">
        <h2 className="font-display text-2xl text-heading">Fields</h2>
        <p className="text-text">Add a signer first, then place their fields.</p>
        <Link href={stepHref(r.id, 'recipients')} className="text-link underline">
          Go to Recipients
        </Link>
      </Card>
    );
  }
  return (
    <>
      {/* Placing fields needs room; a phone shows what is placed. */}
      <Card className="flex flex-col gap-3 md:hidden">
        <h2 className="font-display text-2xl text-heading">Fields</h2>
        <p className="text-text">
          {r.fields.length} {r.fields.length === 1 ? 'field is' : 'fields are'} placed. Use a tablet
          or a computer to place or move fields.
        </p>
        <NextStepLink id={r.id} step="settings" label="Next: Settings" />
      </Card>
      <div className="hidden md:block">
        <Editor r={r} signers={signers} />
      </div>
    </>
  );
}

function Editor({ r, signers }: { r: EsignRequestDetail; signers: EsignRecipient[] }) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState<FieldDraft[]>(() => r.fields.map(fromField));
  const [dirty, setDirty] = useState(false);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [owner, setOwner] = useState(signers[0]?.id ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const framesRef = useRef(new Map<number, HTMLDivElement>());
  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const save = useApiMutation((body: EsignPutFieldsBody) => api.esign.putFields(r.id, body), {
    invalidate: requestKey(r.id),
  });

  useEffect(() => closeThumbFiles, []);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.min(Math.floor(entry?.contentRect.width ?? 0), MAX_PAGE_WIDTH)),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const active = fields.find((f) => f.key === activeKey);
  const ready = r.documents.every((d) => d.scanStatus === 'CLEAN');
  function edit(next: FieldDraft[]) {
    // A save in flight replaces the list with its answer: changes wait for it.
    if (save.isPending) return;
    setFields(next);
    setDirty(true);
    setProblem(null);
  }
  const patch = (key: string, p: Partial<FieldDraft>) =>
    edit(fields.map((f) => (f.key === key ? { ...f, ...p } : f)));
  const remove = (key: string) => {
    const f = fields.find((x) => x.key === key);
    edit(fields.filter((x) => x.key !== key));
    setActiveKey(null);
    // The keyboard stays on the field's page.
    if (f) framesRef.current.get(f.pageIndex)?.focus();
  };
  const copy = (f: FieldDraft) => {
    const c = duplicate(f);
    edit([...fields, c]);
    setActiveKey(c.key);
    setFocusKey(c.key);
  };
  function add(type: EsignFieldType) {
    const size = DEFAULT_SIZE[type];
    const onPage = fields.filter((f) => f.pageIndex === page).length;
    const f: FieldDraft = {
      key: newKey(),
      recipientId: owner,
      type,
      pageIndex: page,
      x: 0.1,
      y: Math.min(0.1 + (onPage % 12) * 0.07, 1 - size.h),
      ...size,
      required: type !== 'CHECKBOX',
      label: '',
      mergeKey: null,
      value: '',
      options: [],
      groupKey: null,
    };
    edit([...fields, f]);
    setActiveKey(f.key);
    framesRef.current.get(page)?.scrollIntoView({ block: 'nearest' });
  }
  function submit() {
    const result = toBody(fields);
    if (!result.ok) {
      setProblem(result.message);
      if (result.key) setActiveKey(result.key);
      return;
    }
    save.mutate(result.body, {
      onSuccess: (detail) => {
        queryClient.setQueryData(requestKey(r.id), detail);
        // The list comes back in the order sent: keep each field's key so focus and selection stay.
        const same = detail.fields.length === fields.length;
        setFields(
          detail.fields.map((f, i) => ({ ...fromField(f), key: (same && fields[i]?.key) || f.id })),
        );
        setDirty(false);
      },
    });
  }
  const colourOf = (f: FieldDraft) => {
    const x = r.recipients.find((s) => s.id === f.recipientId);
    return x
      ? { colour: recipientColor(x.colorIndex), name: x.name }
      : { colour: SENDER_COLOR, name: 'Sender' };
  };

  return (
    <div className="grid grid-cols-[15rem_1fr] items-start gap-6">
      <Card className="sticky top-4 flex flex-col gap-4">
        <h2 className="font-display text-2xl text-heading">Fields</h2>
        <Select
          label="Add fields for"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
          options={signers.map((s) => ({ value: s.id, label: s.name }))}
        />
        <div className="flex flex-col gap-2" role="group" aria-label="Add a field">
          {PALETTE.map((type) => (
            <Button
              key={type}
              variant="secondary"
              disabled={!ready || save.isPending}
              onClick={() => add(type)}
            >
              {FIELD_TYPE_LABELS[type]}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted">
          New fields go on Page {page + 1}. Click a page, or Tab to it, to choose it.
        </p>
        <p id={FIELD_KEYS_ID} className="text-xs text-muted">
          Drag a field to move it and its corner to resize it. With the keyboard: arrows move it
          (Shift for bigger steps), Alt and the arrows resize it, D duplicates it and Delete removes
          it.
        </p>
        {active && (
          <div
            data-testid="field-panel"
            className="flex flex-col gap-3 border-t border-border pt-4"
          >
            <h3 className="font-semibold text-heading">{FIELD_TYPE_LABELS[active.type]}</h3>
            <Select
              label="Filled in by"
              value={active.recipientId ?? ''}
              onChange={(e) => patch(active.key, { recipientId: e.target.value })}
              options={signers.map((s) => ({ value: s.id, label: s.name }))}
            />
            <Checkbox
              label="Required"
              checked={active.required}
              onChange={(e) => patch(active.key, { required: e.target.checked })}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={() => copy(active)}>
                Duplicate
              </Button>
              <Button variant="ghost" onClick={() => remove(active.key)}>
                Remove
              </Button>
            </div>
          </div>
        )}
      </Card>
      <div
        ref={listRef}
        className={`flex min-w-0 flex-col gap-6 ${save.isPending ? 'pointer-events-none' : ''}`}
      >
        {!ready && (
          <p className="text-sm text-muted">Pages show once every file has been checked.</p>
        )}
        {ready &&
          width > 0 &&
          r.pagePlan.map((p, i) => {
            const doc = r.documents.find((d) => d.id === p.documentId);
            if (!doc) return null;
            return (
              <section key={`${p.documentId}:${p.page}`}>
                <p className="mb-2 text-sm text-muted">
                  Page {i + 1}
                  {i === page && ' · new fields go here'}
                </p>
                <div
                  ref={(el) => {
                    if (el) framesRef.current.set(i, el);
                    else framesRef.current.delete(i);
                  }}
                  data-testid="field-page"
                  tabIndex={0}
                  role="group"
                  aria-label={`Page ${i + 1}`}
                  onFocus={() => setPage(i)}
                  className={`relative w-fit ${i === page ? 'outline-2 outline-offset-4 outline-focus' : ''}`}
                  onPointerDown={() => {
                    setPage(i);
                    setActiveKey(null);
                  }}
                >
                  <PageThumb
                    url={api.esign.documentContentUrl(r.id, doc.id)}
                    isPdf={doc.contentType === 'application/pdf'}
                    page={p.page}
                    rotation={p.rotation}
                    size={doc.pageSizes[p.page] ?? { width: 612, height: 792 }}
                    label={`Page ${i + 1}: ${doc.fileName}, page ${p.page + 1}`}
                    width={width}
                  />
                  {fields
                    .filter((f) => f.pageIndex === i)
                    .map((f) => {
                      const { colour, name } = colourOf(f);
                      return (
                        <FieldBox
                          key={f.key}
                          f={f}
                          colour={colour}
                          owner={name}
                          active={f.key === activeKey}
                          focus={f.key === focusKey}
                          frame={() => framesRef.current.get(i)?.getBoundingClientRect()}
                          onSelect={() => {
                            setActiveKey(f.key);
                            setPage(i);
                          }}
                          onChange={(c) => patch(f.key, c)}
                          onRemove={() => remove(f.key)}
                          onDuplicate={() => copy(f)}
                        />
                      );
                    })}
                </div>
              </section>
            );
          })}
        {(problem || save.error) && (
          <p role="alert" className="text-sm text-danger">
            {problem ?? errorMessage(save.error, ESIGN_ERRORS)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!dirty || save.isPending} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save fields'}
          </Button>
          {dirty ? (
            <p className="text-sm text-muted">Save your changes to continue.</p>
          ) : (
            <NextStepLink id={r.id} step="settings" label="Next: Settings" />
          )}
        </div>
        {fields.length === 0 && (
          <p className="text-sm text-muted">
            No fields yet: each signer then gets a signature page at the end.
          </p>
        )}
      </div>
    </div>
  );
}
