'use client';

// TP-F07 and CM-F08: rich content as an email shows it (images, fonts, alignment, the button), in
// a frame that runs nothing (sandbox). The HTML comes from the API, cleaned already.

/** A rendered message's HTML as its own small page, for the sandboxed frame. */
export const previewDocument = (html: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:12px;font:14px/1.5 system-ui,sans-serif;color:CanvasText;background:Canvas;overflow-wrap:anywhere}img{max-width:100%;height:auto}a.fv-button{display:inline-block;padding:10px 18px;border-radius:6px;background:LinkText;color:Canvas;font-weight:600;text-decoration:none}</style></head><body>${html}</body></html>`;

/** The content in a sandboxed frame (`data-testid` lets a test read inside it). */
export function HtmlFrame({
  html,
  title,
  className = 'h-80',
  testId = 'preview-body',
}: {
  html: string;
  title: string;
  className?: string;
  testId?: string;
}) {
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={previewDocument(html)}
      className={`w-full rounded-lg border border-divider bg-surface ${className}`}
      data-testid={testId}
    />
  );
}
