import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The context from cdk.json (feature flags), so tests and the nag report build the same
 * templates as `cdk deploy`.
 */
export function cdkJsonContext(): Record<string, unknown> {
  const cdkJson = JSON.parse(readFileSync(join(__dirname, '..', 'cdk.json'), 'utf8')) as {
    context?: Record<string, unknown>;
  };
  return cdkJson.context ?? {};
}
