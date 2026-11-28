'use client';

import {
  ADVISORY_RESOURCE_FILE_MAX_BYTES,
  type AdvisoryResource,
  type AdvisoryResourceFile,
  megabytes,
} from '@firmivra/types';
import {
  Button,
  Checkbox,
  FileDropzone,
  Input,
  Modal,
  Radio,
  Select,
  Textarea,
} from '@firmivra/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../../../../lib/api';
import { uploadFile } from '../../../../../lib/upload';
import { ErrorLine } from './ba-dialogs';
import { BA_KEY, RESOURCE_KIND, errorText } from './ba-shared';

type Kind = AdvisoryResource['kind'];
type Content = 'NONE' | 'LINK' | 'FILE';
const KINDS = Object.keys(RESOURCE_KIND) as Kind[];
/** A link or a video is its link. */
const linkOnly = (kind: Kind) => kind === 'LINK' || kind === 'VIDEO';
const FILE_HINT = `PDF, JPG, PNG, Excel or Word, up to ${megabytes(ADVISORY_RESOURCE_FILE_MAX_BYTES)}`;

/**
 * A-X10 (Q28, Business Advisory Review Two B28): Add Resource and Edit Resource, for Owner and
 * Admin (or the grid's Manage). A resource has a title, category, type, the words sent to the
 * client with it, who it is for, and at most one https link or one uploaded file. A new file is
 * checked for viruses before it can be opened or sent. Editing a built-in resource saves the firm's
 * own copy; the built-in library itself never changes.
 */
export function ResourceDialog({
  resource,
  categories,
  onClose,
  onSaved,
}: {
  /** The resource to edit; none to add one. */
  resource?: AdvisoryResource;
  categories: readonly string[];
  onClose: () => void;
  onSaved: (title: string, file: AdvisoryResourceFile | null) => void;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(resource?.title ?? '');
  const [category, setCategory] = useState(resource?.category ?? '');
  const [kind, setKind] = useState<Kind>(resource?.kind ?? 'GUIDE');
  const [summary, setSummary] = useState(resource?.summary ?? '');
  const [clientFacing, setClientFacing] = useState(resource?.clientFacing ?? true);
  const [content, setContent] = useState<Content>(
    resource?.url ? 'LINK' : resource?.file ? 'FILE' : 'NONE',
  );
  const [url, setUrl] = useState(resource?.url ?? '');
  const [file, setFile] = useState<File>();
  const [percent, setPercent] = useState<number>();
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const shown: Content = linkOnly(kind) ? 'LINK' : content;
  const kept = resource?.file ?? null;
  const ready =
    title.trim() &&
    category &&
    summary.trim() &&
    (shown !== 'LINK' || url.trim()) &&
    (shown !== 'FILE' || file || kept);

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      let attached: AdvisoryResourceFile | null = shown === 'FILE' ? kept : null;
      if (shown === 'FILE' && file) {
        attached = await uploadFile(file, {
          start: (facts) => api.advisory.startResourceFile(facts),
          finish: (uploadToken) => api.advisory.confirmResourceFile({ uploadToken }),
          maxBytes: ADVISORY_RESOURCE_FILE_MAX_BYTES,
          onProgress: setPercent,
        });
      }
      const body = {
        title: title.trim(),
        category,
        kind,
        summary: summary.trim(),
        clientFacing,
        url: shown === 'LINK' ? url.trim() : null,
        fileId: attached?.id ?? null,
      };
      const saved = resource
        ? await api.advisory.updateResource(resource.key, body)
        : await api.advisory.createResource(body);
      await qc.invalidateQueries({ queryKey: [...BA_KEY] });
      onSaved(saved.title, saved.file);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPercent(undefined);
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={resource ? 'Edit Resource' : 'Add Resource'}
      subtitle={
        resource?.source === 'BUILT_IN'
          ? 'A built-in resource: your changes are saved as your firm’s own copy.'
          : 'A guide, checklist, template, video or link for your library.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready || saving} onClick={() => void save()}>
            {percent !== undefined
              ? `Uploading ${percent}%`
              : saving
                ? 'Saving…'
                : resource
                  ? 'Save Changes'
                  : 'Add Resource'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3" data-testid="resource-dialog">
        <ErrorLine text={error} />
        <Input
          label="Title"
          required
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Category"
            required
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            options={[
              { value: '', label: 'Choose a category…' },
              ...[...new Set([...categories, ...(category ? [category] : [])])].map((c) => ({
                value: c,
                label: c,
              })),
            ]}
          />
          <Select
            label="Type"
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
            options={KINDS.map((k) => ({ value: k, label: RESOURCE_KIND[k] ?? k }))}
          />
        </div>
        <Textarea
          label="What the client gets"
          required
          rows={3}
          maxLength={1000}
          hint="Sent to the client with the resource."
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
        />
        <Checkbox
          label="For clients (can be sent to a client)"
          checked={clientFacing}
          onChange={(e) => setClientFacing(e.target.checked)}
        />
        <fieldset className="flex flex-col gap-1" disabled={linkOnly(kind)}>
          <legend className="text-sm font-medium text-heading">Content</legend>
          <div className="flex flex-wrap gap-x-6">
            <Radio
              name="resource-content"
              label="None"
              checked={shown === 'NONE'}
              onChange={() => setContent('NONE')}
            />
            <Radio
              name="resource-content"
              label="Link"
              checked={shown === 'LINK'}
              onChange={() => setContent('LINK')}
            />
            <Radio
              name="resource-content"
              label="Upload a file"
              checked={shown === 'FILE'}
              onChange={() => setContent('FILE')}
            />
          </div>
          {linkOnly(kind) ? (
            <p className="text-xs text-muted">A link or a video is shared as its link.</p>
          ) : null}
        </fieldset>
        {shown === 'LINK' ? (
          <Input
            label="Link address"
            type="url"
            required
            placeholder="https://"
            hint="An https link; it opens in a new tab."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        ) : null}
        {shown === 'FILE' ? (
          <>
            {kept && !file ? (
              <p className="text-sm text-text" data-testid="resource-kept-file">
                Current file: <span className="font-medium text-heading">{kept.fileName}</span>
                {kept.status === 'CHECKING' ? ' (being checked for viruses)' : ''}
                {kept.status === 'BLOCKED' ? ' (failed its security check: upload another)' : ''}
              </p>
            ) : null}
            <FileDropzone
              label={kept ? 'Replace the file' : 'File'}
              multiple={false}
              maxBytes={ADVISORY_RESOURCE_FILE_MAX_BYTES}
              onFiles={(files) => {
                setError(undefined);
                setFile(files[0]);
              }}
              onReject={() => setError(`Use a ${FILE_HINT}.`)}
              hints={[file ? `Chosen: ${file.name}` : FILE_HINT]}
            />
            <p className="text-xs text-muted">
              A new file is checked for viruses before it can be opened or sent.
            </p>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
