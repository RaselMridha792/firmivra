import type { ReactNode } from 'react';

// The agreement text the visitor signs, from its Markdown: headings, paragraphs, lists, tables,
// **bold** and links. React escapes every piece of text, so no HTML in the agreement runs, and a
// link opens only for https: and mailto: (any other shows as plain text), as R14's contract says.
// R14's `<Markdown>` (packages/ui, pending) replaces this once it is on main.

const SAFE_LINK = /^(https:\/\/|mailto:)/i;

/** **bold** and [text](url) inside one line. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[1] !== undefined) {
      out.push(<strong key={at}>{m[1]}</strong>);
    } else if (m[2] !== undefined && m[3] !== undefined && SAFE_LINK.test(m[3])) {
      out.push(
        <a key={at} href={m[3]} target="_blank" rel="noopener noreferrer" className="underline">
          {m[2]}
        </a>,
      );
    } else {
      out.push(m[2] ?? m[0]);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Each item with a key from its text (and its count, for a repeated item). */
function keyed<T>(items: readonly T[], text: (item: T) => string) {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const t = text(item);
    const n = (seen.get(t) ?? 0) + 1;
    seen.set(t, n);
    return { item, key: `${n}:${t}` };
  });
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

function Block({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim());
  const first = lines[0]?.trim() ?? '';
  const heading = /^#{1,6}\s+(.*)$/.exec(first);
  if (heading && lines.length === 1) {
    return <p className="mt-2 font-semibold text-heading first:mt-0">{inline(heading[1] ?? '')}</p>;
  }
  if (lines.every((l) => /^\s*\|.*\|\s*$/.test(l))) {
    const rows = lines.filter((l) => !/^\s*\|[\s:|-]+\|\s*$/.test(l)).map(cells);
    const [head, ...body] = rows;
    return (
      <table className="mt-1 w-full border-collapse">
        {head && (
          <thead>
            <tr>
              {keyed(head, (c) => c).map(({ item: c, key }) => (
                <th key={key} className="border border-folder-border px-1 text-left">
                  {inline(c)}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {keyed(body, (row) => row.join('|')).map(({ item: row, key }) => (
            <tr key={key}>
              {keyed(row, (c) => c).map(({ item: c, key: cell }) => (
                <td key={cell} className="border border-folder-border px-1 align-top">
                  {inline(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  const bullet = /^\s*[-*+]\s+(.*)$/;
  const numbered = /^\s*\d+[.)]\s+(.*)$/;
  if (lines.every((l) => bullet.test(l)) || lines.every((l) => numbered.test(l))) {
    const ordered = numbered.test(first);
    const items = lines.map((l) => (ordered ? numbered : bullet).exec(l)?.[1] ?? l);
    const List = ordered ? 'ol' : 'ul';
    return (
      <List className={`mt-1 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}>
        {keyed(items, (t) => t).map(({ item, key }) => (
          <li key={key}>{inline(item)}</li>
        ))}
      </List>
    );
  }
  return (
    <p className="mt-1">
      {keyed(lines, (t) => t).map(({ item: l, key }, i) => (
        <span key={key}>
          {i > 0 && <br />}
          {inline(l.replace(/^#{1,6}\s+/, ''))}
        </span>
      ))}
    </p>
  );
}

export function AgreementText({ body }: { body: string }) {
  // Each block keyed by its text (and its count, for a repeated block).
  const seen = new Map<string, number>();
  const blocks = body
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .filter((b) => b.trim())
    .map((b) => {
      const n = (seen.get(b) ?? 0) + 1;
      seen.set(b, n);
      return { b, key: `${n}:${b}` };
    });
  return (
    <>
      {blocks.map(({ b, key }) => (
        <Block key={key} text={b} />
      ))}
    </>
  );
}
