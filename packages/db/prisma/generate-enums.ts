// Generates packages/types/src/db-enums.ts: a zod enum for every enum in the Prisma schema, so
// API contracts and screens use exactly the database's values. Run after changing an enum:
//   pnpm --filter @firmivra/db gen:enums
// test/enums.test.ts fails while the generated file is behind the schema. The output already
// follows the repo's Prettier style (single quotes, width 100), so format:check passes.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SCHEMA_PATH = fileURLToPath(new URL('./schema.prisma', import.meta.url));
export const OUTPUT_PATH = fileURLToPath(new URL('../../types/src/db-enums.ts', import.meta.url));
const PRINT_WIDTH = 100;

export interface SchemaEnum {
  name: string;
  doc: string[];
  values: string[];
}

/** Every `enum Name { ... }` block of the schema, in order, with its `///` comment. */
export function parseEnums(schema: string): SchemaEnum[] {
  const block = /((?:^[ \t]*\/\/\/.*\n)*)^enum (\w+) \{\n([\s\S]*?)^\}/gm;
  return [...schema.matchAll(block)].map(([, comment = '', name = '', body = '']) => ({
    name,
    doc: comment
      .split('\n')
      .map((line) => line.trim().replace(/^\/\/\/ ?/, ''))
      .filter(Boolean),
    values: body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('//'))
      .map((line) => line.split(/\s+/)[0] ?? ''),
  }));
}

/** The TypeScript source of packages/types/src/db-enums.ts. */
export function render(schema: string): string {
  const out = [
    '// Generated from packages/db/prisma/schema.prisma by `pnpm --filter @firmivra/db gen:enums`.',
    '// Do not edit by hand: change the enum in the schema, then run the command.',
    "import { z } from 'zod';",
  ];
  for (const { name, doc, values } of parseEnums(schema)) {
    out.push('');
    if (doc.length > 0) out.push(`/** ${doc.join(' ')} */`);
    const quoted = values.map((v) => `'${v}'`);
    const oneLine = `export const ${name} = z.enum([${quoted.join(', ')}]);`;
    if (oneLine.length <= PRINT_WIDTH) {
      out.push(oneLine);
    } else {
      out.push(`export const ${name} = z.enum([`, ...quoted.map((v) => `  ${v},`), ']);');
    }
    out.push(`export type ${name} = z.infer<typeof ${name}>;`);
  }
  return `${out.join('\n')}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  writeFileSync(OUTPUT_PATH, render(schema));
  process.stdout.write(
    `Wrote ${parseEnums(schema).length} enums to packages/types/src/db-enums.ts\n`,
  );
}
