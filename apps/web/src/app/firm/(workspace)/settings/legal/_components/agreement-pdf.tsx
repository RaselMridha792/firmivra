'use client';

import {
  AGREEMENT_ERRORS,
  type AgreementFile,
  type AgreementPdf,
  DOCUMENT_ERRORS,
} from '@firmivra/types';
import { Badge, Button } from '@firmivra/ui';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../../../../../lib/api';
import { errorMessage } from '../../../../../../lib/errors';
import { useApiMutation } from '../../../../../../lib/query';
import { uploadFile } from '../../../../../../lib/upload';

/** The PDF a version will link: the current one kept, or a new upload and its scan. */
export type PdfChoice = Pick<AgreementFile, 'fileId' | 'fileName' | 'sizeBytes' | 'scanStatus'>;

const ERRORS = { ...DOCUMENT_ERRORS, ...AGREEMENT_ERRORS };
const SCAN_POLL_MS = 1500;
const SCAN_TRIES = 40;

export const pdfSize = (bytes: number) =>
  bytes < 1_000_000
    ? `${Math.max(1, Math.round(bytes / 1000))} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;

/** "Download PDF": a 5-minute attachment link to a CLEAN file. */
export function PdfDownload({ pdf }: { pdf: AgreementPdf }) {
  const download = useApiMutation(() => api.agreements.download(pdf.fileId));
  return (
    <span className="flex flex-wrap items-center gap-2 text-sm">
      <Button
        variant="ghost"
        disabled={download.isPending}
        onClick={() =>
          download.mutate(undefined, { onSuccess: (link) => window.location.assign(link.url) })
        }
      >
        Download PDF
      </Button>
      <span className="text-muted">
        {pdf.fileName} · {pdfSize(pdf.sizeBytes)}
      </span>
      {download.error ? (
        <span role="alert" className="text-danger">
          {errorMessage(download.error, ERRORS)}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The version's PDF original: keep the current one, upload a new one (the documents pattern:
 * ticket, PUT, confirm, then wait for the malware scan), or publish without one.
 */
export function PdfPicker({
  value,
  onChange,
}: {
  value: PdfChoice | null;
  onChange: (next: PdfChoice | null) => void;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<'uploading' | 'checking' | null>(null);
  const cancelRef = useRef<AbortController | null>(null);
  useEffect(() => () => cancelRef.current?.abort(), []);

  async function upload(file: File) {
    if (!/\.pdf$/i.test(file.name)) {
      setProblem('Upload a PDF file.');
      return;
    }
    cancelRef.current?.abort();
    const controller = new AbortController();
    cancelRef.current = controller;
    setProblem(null);
    setBusy('uploading');
    try {
      let saved = await uploadFile(file, {
        start: (facts) => api.agreements.createUpload(facts),
        finish: (uploadToken) => api.agreements.confirmUpload({ uploadToken }),
        signal: controller.signal,
      });
      setBusy('checking');
      for (let i = 0; saved.scanStatus === 'PENDING' && i < SCAN_TRIES; i++) {
        await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_MS));
        if (controller.signal.aborted) return;
        saved = await api.agreements.file(saved.fileId);
      }
      onChange(saved);
    } catch (caught) {
      if (!controller.signal.aborted) setProblem(errorMessage(caught, ERRORS));
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }

  const blocked = value && value.scanStatus !== 'CLEAN' && value.scanStatus !== 'PENDING';
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium text-text">PDF original (optional)</p>
      {value ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="min-w-0 break-all text-text">{value.fileName}</span>
          <span className="text-muted">{pdfSize(value.sizeBytes)}</span>
          <Badge tone={value.scanStatus === 'CLEAN' ? 'success' : blocked ? 'danger' : 'warning'}>
            {value.scanStatus === 'CLEAN' ? 'Ready' : blocked ? 'Blocked' : 'Being checked'}
          </Badge>
          <Button variant="ghost" onClick={() => onChange(null)}>
            Remove PDF
          </Button>
        </div>
      ) : null}
      <input
        type="file"
        accept=".pdf,application/pdf"
        aria-label={value ? 'Replace the PDF original' : 'Upload the PDF original'}
        disabled={busy !== null}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
        className="text-sm text-text file:mr-3 file:rounded-control file:border file:border-border file:bg-surface file:px-3 file:py-2 file:text-sm file:text-text"
      />
      {busy ? (
        <p role="status" className="text-sm text-muted">
          {busy === 'uploading' ? 'Uploading…' : 'Checking the PDF…'}
        </p>
      ) : null}
      {blocked ? (
        <p role="alert" className="text-sm text-danger">
          {AGREEMENT_ERRORS.FILE_BLOCKED}
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      ) : null}
    </div>
  );
}
