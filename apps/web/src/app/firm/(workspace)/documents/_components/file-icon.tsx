import { FileDoc, FilePdf, FileXls, type Icon } from '@phosphor-icons/react';

/**
 * The file-type square (icon + colour) by content type, matching the detected type (never an
 * illustrative mockup icon). `--color-file-pdf` and `--color-file-excel` are R34's new tokens
 * (packages/ui/src/styles.css); Word reuses `--color-info`, already the same blue.
 */
const BY_TYPE: Record<string, { Icon: Icon; bg: string }> = {
  'application/pdf': { Icon: FilePdf, bg: 'bg-file-pdf' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    Icon: FileDoc,
    bg: 'bg-info',
  },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    Icon: FileXls,
    bg: 'bg-file-excel',
  },
};
const FALLBACK = { Icon: FilePdf, bg: 'bg-muted' };

export function FileIcon({ contentType }: { contentType: string }) {
  const { Icon: Glyph, bg } = BY_TYPE[contentType] ?? FALLBACK;
  return (
    <span
      className={`inline-flex size-10 shrink-0 items-center justify-center rounded-md ${bg}`}
      aria-hidden="true"
    >
      <Glyph weight="fill" className="size-6 text-on-action" />
    </span>
  );
}
