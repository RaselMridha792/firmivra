'use client';

import {
  ESIGN_ERRORS,
  type EsignRequestDetail,
  type EsignTemplateDetail,
  type EsignTemplateVisibility,
  SaveEsignTemplateBody,
  SaveEsignTemplateVersionBody,
} from '@firmivra/types';
import { Button, Checkbox, Input, Modal, Select } from '@firmivra/ui';
import Link from 'next/link';
import { useState } from 'react';
import { useFirm } from '../../../../../../../components/firm-context';
import { useMe } from '../../../../../../../components/signed-in';
import { api } from '../../../../../../../lib/api';
import { errorMessage } from '../../../../../../../lib/errors';
import { useApiMutation, useApiQuery } from '../../../../../../../lib/query';
import { TextArea } from '../../../../../setup/_components/fields';

/** Every template query starts with this (the same root as templates/_components/keys.ts, #278). */
const TEMPLATES = ['esign', 'templates'];

type Errors = {
  name?: string;
  description?: string;
  templateId?: string;
  note?: string;
  form?: string;
};
type Save =
  | { kind: 'new'; body: SaveEsignTemplateBody }
  | { kind: 'version'; body: SaveEsignTemplateVersionBody };

/**
 * Save as template: the request's pages, recipients (as roles), fields and settings become a new
 * template the caller owns (private unless shared), or the next version of one they may change.
 * The client's own values are not kept; merge fields stay merge fields. Text the sender typed is
 * dropped unless the sender says it holds nothing of this client.
 */
export function SaveAsTemplate({ r }: { r: EsignRequestDetail }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Save as template
      </Button>
      {/* The dialog mounts when it opens, so it starts fresh every time. */}
      {open && <SaveDialog r={r} onClose={() => setOpen(false)} />}
    </>
  );
}

function SaveDialog({ r, onClose }: { r: EsignRequestDetail; onClose: () => void }) {
  const [name, setName] = useState(r.title);
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<EsignTemplateVisibility>('PRIVATE');
  const [mode, setMode] = useState<Save['kind']>('new');
  const [templateId, setTemplateId] = useState(r.template?.id ?? '');
  const [note, setNote] = useState('');
  const typed = r.fields.some((f) => f.value !== null && f.mergeKey === null);
  const [keep, setKeep] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [saved, setSaved] = useState<{ kind: Save['kind']; t: EsignTemplateDetail } | null>(null);
  const { role } = useFirm();
  const { me } = useMe();
  const templates = useApiQuery([...TEMPLATES, 'list', '', false], () =>
    api.esign.templates.list(),
  );
  // A new version: the template's owner, an Owner or an Admin (a Manager's canEdit isn't enough).
  const mine = (templates.data?.items ?? []).filter(
    (t) => t.canEdit && (role === 'OWNER' || role === 'ADMIN' || t.owner.userId === me.user.id),
  );
  // A request made from a template starts with that one chosen; a choice that leaves the list
  // (archived meanwhile) reads as none.
  const chosen = mine.some((t) => t.id === templateId) ? templateId : '';
  const save = useApiMutation(
    (s: Save) =>
      s.kind === 'new'
        ? api.esign.saveAsTemplate(r.id, s.body)
        : api.esign.saveAsVersion(r.id, s.body),
    { invalidate: TEMPLATES },
  );
  // Not while saving: the result would be lost with the dialog. Modal passes Escape's cancel
  // event, and stopping it keeps the dialog open.
  const leave = (event?: { preventDefault?: () => void }) => {
    if (save.isPending) event?.preventDefault?.();
    else onClose();
  };
  const edit = (field: keyof Errors) => {
    setErrors(({ [field]: _, form: __, ...rest }) => rest);
    save.reset();
  };

  function show(issues: { path: PropertyKey[]; message: string }[]) {
    const next: Errors = {};
    for (const issue of issues) {
      const field = issue.path[0];
      if (field === 'templateId') next.templateId ??= 'Choose the template';
      else if (field === 'name' || field === 'description' || field === 'note') {
        next[field] ??= issue.message;
      } else next.form ??= issue.message;
    }
    setErrors(next);
  }

  function submit() {
    save.reset();
    if (mode === 'new') {
      const parsed = SaveEsignTemplateBody.safeParse({
        name,
        ...(description.trim() && { description }),
        visibility,
        ...(typed && keep && { keepSenderValues: true }),
      });
      if (!parsed.success) return show(parsed.error.issues);
      save.mutate(
        { kind: 'new', body: parsed.data },
        { onSuccess: (t) => setSaved({ kind: 'new', t }) },
      );
    } else {
      const parsed = SaveEsignTemplateVersionBody.safeParse({
        templateId: chosen,
        ...(note.trim() && { note }),
        ...(typed && keep && { keepSenderValues: true }),
      });
      if (!parsed.success) return show(parsed.error.issues);
      save.mutate(
        { kind: 'version', body: parsed.data },
        { onSuccess: (t) => setSaved({ kind: 'version', t }) },
      );
    }
  }

  return (
    <Modal open title="Save as template" onClose={leave}>
      {saved ? (
        <div className="flex max-w-xl flex-col gap-4">
          <p role="status" className="text-sm text-text">
            {saved.kind === 'new'
              ? `${saved.t.name} is saved as a template.`
              : `${saved.t.name} now has version ${saved.t.version}, which new requests use.`}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/firm-sign/templates/${saved.t.id}`} className="text-link">
              Open the template
            </Link>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <form
          noValidate
          className="flex max-w-xl flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm text-muted">
            The pages, roles, fields and settings are kept. The client&apos;s details are not:
            whoever uses the template chooses the people again.
          </p>
          <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
            <Select
              label="Save as"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as Save['kind']);
                setErrors({});
                save.reset();
              }}
              options={[
                { value: 'new', label: 'A new template' },
                { value: 'version', label: 'A new version of a template' },
              ]}
            />
            {mode === 'version' ? (
              <>
                {templates.isError && (
                  <p role="alert" className="text-sm text-danger">
                    {errorMessage(templates.error, ESIGN_ERRORS)}
                  </p>
                )}
                {templates.data && mine.length === 0 && (
                  <p className="text-sm text-muted">
                    There is no template you can add a version to. Save a new one instead.
                  </p>
                )}
                <Select
                  label="Template"
                  value={chosen}
                  error={errors.templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    edit('templateId');
                  }}
                  options={[
                    { value: '', label: 'Choose a template' },
                    ...mine.map((t) => ({
                      value: t.id,
                      label: `${t.name} (version ${t.version})`,
                    })),
                  ]}
                />
                <TextArea
                  label="What changed (optional)"
                  maxLength={500}
                  value={note}
                  error={errors.note}
                  onChange={(e) => {
                    setNote(e.target.value);
                    edit('note');
                  }}
                />
              </>
            ) : (
              <>
                <Input
                  label="Template name"
                  maxLength={200}
                  value={name}
                  error={errors.name}
                  onChange={(e) => {
                    setName(e.target.value);
                    edit('name');
                  }}
                />
                <TextArea
                  label="Description (optional)"
                  maxLength={1000}
                  value={description}
                  error={errors.description}
                  onChange={(e) => {
                    setDescription(e.target.value);
                    edit('description');
                  }}
                />
                <Select
                  label="Who can use it"
                  value={visibility}
                  onChange={(e) => {
                    setVisibility(e.target.value as EsignTemplateVisibility);
                    edit('form');
                  }}
                  options={[
                    { value: 'PRIVATE', label: 'Only its owner' },
                    { value: 'FIRM', label: 'Everyone in the firm' },
                  ]}
                />
              </>
            )}
            {typed && (
              <Checkbox
                label="Keep the text I typed into fields. It holds nothing about this client."
                checked={keep}
                onChange={(e) => {
                  setKeep(e.target.checked);
                  edit('form');
                }}
              />
            )}
          </fieldset>
          {(errors.form || save.error) && (
            <p role="alert" className="text-sm text-danger">
              {errors.form ?? errorMessage(save.error, ESIGN_ERRORS)}
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : mode === 'new' ? 'Save template' : 'Save version'}
            </Button>
            <Button variant="ghost" disabled={save.isPending} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
