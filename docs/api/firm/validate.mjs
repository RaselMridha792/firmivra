import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';

// Install the validator outside the workspace dependency graph; see README.md.
const require = createRequire(resolve(process.argv[2] ?? '.local-analysis/contracts/package.json'));
const SwaggerParser = require('@apidevtools/swagger-parser');
const dir = resolve('docs/api/firm');
const ids = new Set();
let count = 0;
for (const file of readdirSync(dir).filter(
  (name) => name.endsWith('.yaml') && name !== 'common.yaml',
)) {
  const api = await SwaggerParser.validate(resolve(dir, file));
  for (const [path, item] of Object.entries(api.paths)) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
      if (ids.has(op.operationId)) throw new Error(`Duplicate operation: ${op.operationId}`);
      ids.add(op.operationId);
      if (!op['x-roles']?.length) throw new Error(`Missing roles: ${path}`);
      for (const status of ['401', '403', '404']) {
        if (!op.responses[status]) throw new Error(`Missing ${status}: ${path}`);
      }
      const schemes = op.security ?? api.security;
      const isAdmin = path.startsWith('/admin/');
      const expected = isAdmin ? 'AdminCookie' : 'FirmCookie';
      const forbidden = isAdmin ? 'FirmCookie' : 'AdminCookie';
      if (
        !schemes?.some((scheme) => expected in scheme) ||
        schemes.some((scheme) => forbidden in scheme)
      ) {
        throw new Error(`Incorrect session cookie: ${path}`);
      }
      if (path.startsWith('/admin/applications') && method !== 'get') {
        throw new Error(`Application action belongs to R4: ${path}`);
      }
      const properties = op.requestBody?.content?.['application/json']?.schema?.properties ?? {};
      const forbiddenFields = ['businessId', 'userId', 'recipientUserId'];
      if (path.startsWith('/portal/')) forbiddenFields.push('clientId');
      if (forbiddenFields.some((field) => field in properties)) {
        throw new Error(`Untrusted context/identity field: ${path}`);
      }
      if (path.startsWith('/portal/') && !op['x-roles'].includes('CLIENT')) {
        throw new Error(`Missing portal client role: ${path}`);
      }
      count++;
    }
  }
  process.stdout.write(`${file}: valid\n`);
}
const root = await SwaggerParser.validate(resolve('docs/api/firm.yaml'));
const rootCount = Object.values(root.paths).reduce(
  (total, item) =>
    total +
    Object.keys(item).filter((key) => ['get', 'post', 'put', 'patch', 'delete'].includes(key))
      .length,
  0,
);
if (rootCount !== count) throw new Error(`Root contract count mismatch: ${rootCount}/${count}`);
process.stdout.write(`firm.yaml: valid; ${count} unique operations\n`);
