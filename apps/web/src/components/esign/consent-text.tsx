import { Fragment, type ReactNode } from 'react';

/** `**bold**` inside a line; everything else is plain text (never HTML). */
function inline(text: string): ReactNode[] {
  // The text never changes under the page, so a running count is a stable key.
  let key = 0;
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .map((part) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4 ? (
        <strong key={key++}>{part.slice(2, -2)}</strong>
      ) : (
        <Fragment key={key++}>{part}</Fragment>
      ),
    );
}

/**
 * A firm's consent or agreement text, from the small Markdown set the firm's editor offers:
 * `#`/`##`/`###` headings, `-` or `*` lists, `**bold**` and paragraphs. Raw HTML is shown as
 * text, so nothing a firm types can run in the signer's browser.
 */
export function ConsentText({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>);
      para = [];
    }
    if (list.length) {
      blocks.push(
        <ul key={blocks.length} className="list-disc pl-6">
          {list.map((item, n) => (
            // Items can repeat; their place in the list is what tells them apart.
            // eslint-disable-next-line @eslint-react/no-array-index-key
            <li key={n}>{inline(item)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const item = /^[-*]\s+(.*)$/.exec(line);
    if (!line) flush();
    else if (heading) {
      flush();
      blocks.push(
        <h3 key={blocks.length} className="text-base font-semibold text-heading">
          {inline(heading[2] ?? '')}
        </h3>,
      );
    } else if (item) {
      if (para.length) flush();
      list.push(item[1] ?? '');
    } else {
      if (list.length) flush();
      para.push(line);
    }
  }
  flush();
  return <div className="flex flex-col gap-3 text-sm text-text">{blocks}</div>;
}
