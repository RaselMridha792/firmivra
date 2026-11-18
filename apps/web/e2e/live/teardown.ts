import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { request } from '@playwright/test';
import { appUrl, statePath } from './env';

/**
 * After every live run (lead, Nov 18): creating a service publishes its built-in intake form, and
 * LIVE-CHECK services are made by the runs. Archive (never delete) every intake form tied to a
 * LIVE-CHECK service, and log the ids to the private output folder. Never fails the run.
 */
export default async function teardown() {
  const state = statePath('owner');
  if (!existsSync(state)) return;
  const log = join(process.env['LIVE_OUT_DIR'] ?? '.', 'swept-intake-forms.log');
  const ctx = await request.newContext({
    baseURL: `${appUrl}/api/v1/`,
    storageState: state,
    extraHTTPHeaders: { origin: appUrl },
  });
  try {
    await ctx.post('auth/refresh');
    const res = await ctx.get('business/intake-forms');
    if (!res.ok()) return;
    type Form = { id: string; name: string; service?: { name?: string } | string | null };
    const forms = ((await res.json()) as { items?: Form[] }).items ?? [];
    for (const f of forms) {
      const service = typeof f.service === 'string' ? f.service : (f.service?.name ?? '');
      if (!/LIVE-CHECK/.test(service)) continue;
      const done = await ctx.post(`business/intake-forms/${f.id}/archive`);
      appendFileSync(
        log,
        `${new Date().toISOString()} ${f.id} "${f.name}" (${service}) archive ${done.status()}\n`,
      );
    }
  } catch {
    // A sweep that fails leaves the forms for the next run's sweep.
  } finally {
    await ctx.dispose();
  }
}
