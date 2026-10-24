import type { CsvFile } from './csv';

/**
 * Reads the first sheet of an Excel (.xlsx) file in the browser, as the CSV reader does: the
 * header row's cells name the columns and every other non-empty row becomes one record (SM7).
 * No library: an .xlsx is a zip of XML parts, unzipped with the browser's DecompressionStream.
 * Values are the cells' text; a date cell is its Excel day number (see `excelDay`).
 */
export async function readXlsx(data: ArrayBuffer): Promise<CsvFile> {
  const parts = await unzip(data);
  const text = (name: string) => (parts.has(name) ? decode(parts.get(name)!) : null);
  const shared = sharedStrings(text('xl/sharedStrings.xml') ?? '');
  const sheet = text(firstSheetPath(text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels')));
  if (sheet === null) throw new Error('This Excel file has no sheet.');
  const grid = sheetRows(sheet, shared);
  const [head = [], ...body] = grid;
  const headers = head.map((h) => h.trim());
  const rows = body
    .filter((cells) => cells.some((c) => c.trim()))
    .map((cells) => Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()])));
  return { headers: headers.filter(Boolean), rows };
}

/** An Excel day number (1900 date system) as YYYY-MM-DD; other text is returned as it is. */
export function excelDay(value: string): string {
  if (!/^\d{4,5}(\.\d+)?$/.test(value)) return value;
  const days = Math.floor(Number(value));
  // Day 1 is 1900-01-01, and Excel counts a 29 February 1900 that never was: day 60.
  const epoch = Date.UTC(1899, 11, 30);
  return new Date(epoch + days * 86_400_000).toISOString().slice(0, 10);
}

const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

/** The zip's files by name (stored or deflated entries; others are skipped). */
async function unzip(data: ArrayBuffer): Promise<Map<string, Uint8Array>> {
  const bytes = new Uint8Array(data);
  const view = new DataView(data);
  // The end-of-central-directory record is in the last 64 KB + 22 bytes.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflate(raw));
  }
  return files;
}

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([raw as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e: string) =>
    e[0] === '#'
      ? String.fromCodePoint(
          e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)),
        )
      : (ENTITIES[e] ?? whole),
  );
/** The text of every <t> inside a piece of XML, joined (rich text keeps its runs). */
const texts = (xml: string) =>
  [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescape(m[1] ?? '')).join('');

function sharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1] ?? ''));
}

/** The first sheet in the workbook's order, through its relationship; else sheet1. */
function firstSheetPath(workbook: string | null, rels: string | null): string {
  const id = workbook?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = id
    ? (rels?.match(new RegExp(`<Relationship\\b[^>]*Id="${id}"[^>]*Target="([^"]+)"`))?.[1] ??
      rels?.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${id}"`))?.[1])
    : undefined;
  if (!target) return 'xl/worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
}

/** Column letters (A, B, …, AA) to a 0-based index. */
const columnIndex = (ref: string) =>
  [...(ref.match(/^[A-Z]+/)?.[0] ?? 'A')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    let next = 0;
    for (const cell of (row[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? '';
      const inner = cell[2] ?? '';
      const ref = attrs.match(/\br="([A-Z]+)\d*"/)?.[1];
      const index = ref ? columnIndex(ref) : next;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = unescape(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      cells[index] =
        type === 's'
          ? (shared[Number(v)] ?? '')
          : type === 'inlineStr'
            ? texts(inner)
            : type === 'b'
              ? v === '1'
                ? 'TRUE'
                : 'FALSE'
              : v;
      next = index + 1;
    }
    rows.push(Array.from(cells, (c) => c ?? ''));
  }
  return rows;
}
