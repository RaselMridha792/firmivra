import { Fragment, type ReactNode } from 'react';

/**
 * A message body with the composer's light formatting: **bold**, *italic*, [text](https://…),
 * "- " bullets and "1. " numbered lines. Everything else stays plain text (React escapes it), so
 * a message can never inject markup. Bare https links and email addresses become links.
 */
const INLINE =
  /\*\*(.+?)\*\*|\*([^*\s][^*]*?)\*|\[([^\]]+)\]\((https:\/\/[^\s)]+)\)|(https:\/\/[^\s)]+)|([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/g;

function inline(text: string, base: number): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const at = match.index ?? 0;
    if (at > last) out.push(<Fragment key={`t${base + last}`}>{text.slice(last, at)}</Fragment>);
    const key = `m${base + at}`;
    const [, bold, italic, label, href, url, email] = match;
    if (bold) out.push(<strong key={key}>{bold}</strong>);
    else if (italic) out.push(<em key={key}>{italic}</em>);
    else if (label && href) {
      out.push(
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link underline"
        >
          {label}
        </a>,
      );
    } else if (url) {
      out.push(
        <a
          key={key}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-link underline"
        >
          {url}
        </a>,
      );
    } else if (email) {
      out.push(
        <a key={key} href={`mailto:${email}`} className="text-link hover:underline">
          {email}
        </a>,
      );
    }
    last = at + match[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`t${base + last}`}>{text.slice(last)}</Fragment>);
  return out;
}

interface Block {
  key: number;
  kind: 'p' | 'ul' | 'ol';
  lines: { key: number; text: string }[];
}

function blocks(body: string): Block[] {
  const out: Block[] = [];
  let offset = 0;
  let current: Block | null = null;
  for (const raw of body.split('\n')) {
    const at = offset;
    offset += raw.length + 1;
    const bullet = /^\s*[-•]\s+(.*)$/.exec(raw);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(raw);
    const kind = bullet ? 'ul' : numbered ? 'ol' : raw.trim() ? 'p' : null;
    if (!kind) {
      current = null;
      continue;
    }
    if (!current || current.kind !== kind) {
      current = { key: at, kind, lines: [] };
      out.push(current);
    }
    current.lines.push({ key: at, text: bullet?.[1] ?? numbered?.[1] ?? raw });
  }
  return out;
}

export function FormattedText({ body }: { body: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm text-text">
      {blocks(body).map((block) => {
        if (block.kind === 'ul' || block.kind === 'ol') {
          const List = block.kind;
          return (
            <List
              key={block.key}
              className={`flex flex-col gap-1 pl-5 ${block.kind === 'ul' ? 'list-disc' : 'list-decimal'}`}
            >
              {block.lines.map((line) => (
                <li key={line.key}>{inline(line.text, line.key)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={block.key} className="wrap-anywhere">
            {block.lines.map((line, row) => (
              <Fragment key={line.key}>
                {row ? <br /> : null}
                {inline(line.text, line.key)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
