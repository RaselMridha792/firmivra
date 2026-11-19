import { z } from 'zod';

/**
 * Zod compiles each object schema with `new Function` when the page allows eval, and finds out by
 * trying it once when the first schema is built. Under the Content-Security-Policy (report-only
 * now, enforcing later) that try is reported as an 'unsafe-eval' violation on every page, though
 * Zod catches it and parses without compiling. Jitless mode never tries: it must be set before
 * any schema module runs, which is what this file is for (synchronous, before hydration).
 * Parsing stays correct; only Zod's compiled fast path for objects is left out in the browser.
 */
z.config({ jitless: true });
