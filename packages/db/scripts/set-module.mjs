// Turns a module on or off for one firm (r0_esign's module switch). Ops run it as the migrate role
// (the database owner): business_settings.enabled_modules changes only through
// app_set_business_module, which the app role cannot run. It writes the firm's audit row
// (module.enabled or module.disabled) with the reason.
//   DATABASE_URL=<owner url> MODULE_CHANGE=lvp:esign:on MODULE_REASON="Beta start" \
//     node packages/db/scripts/set-module.mjs
// Prints only ids and module names.
import pg from 'pg';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const change = /^([a-z0-9]+(?:-[a-z0-9]+)*):(esign|calculators):(on|off)$/.exec(
  required('MODULE_CHANGE'),
);
if (!change) throw new Error('MODULE_CHANGE must be <slug>:<esign|calculators>:<on|off>');
const [, slug, module, onOff] = change;
const reason = required('MODULE_REASON');

const client = new pg.Client({ connectionString: required('DATABASE_URL') });
await client.connect();
try {
  await client.query('BEGIN');
  await client.query(`SELECT set_config('app.scope', 'platform', true)`);
  const firm = await client.query('SELECT id FROM businesses WHERE slug = $1', [slug]);
  if (firm.rowCount !== 1) throw new Error('No firm has that slug');
  const id = firm.rows[0].id;
  const { rows } = await client.query('SELECT app_set_business_module($1, $2, $3, $4) AS modules', [
    id,
    module,
    onOff === 'on',
    reason,
  ]);
  await client.query('COMMIT');
  process.stdout.write(`Firm ${id}: modules now [${rows[0].modules.join(', ')}]\n`);
} catch (error) {
  await client.query('ROLLBACK').catch(() => {});
  throw error;
} finally {
  await client.end();
}
