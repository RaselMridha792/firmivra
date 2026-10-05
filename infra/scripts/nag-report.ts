// Synthesizes all dev stacks without AWS credentials (lookups get placeholders) and prints
// every cdk-nag finding that is not acknowledged. Used while writing src/nag.ts.
import { App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { cdkJsonContext } from '../src/cdk-context';
import { configFor } from '../src/config';
import { addNagSuppressions } from '../src/nag';
import { createStacks } from '../src/stacks';

const app = new App({ context: { ...cdkJsonContext(), env: 'dev' } });
// CLOUDFRONT_DOMAINS=1 checks the configuration without the custom domain (*.cloudfront.net).
const config = configFor(
  'dev',
  process.env['CLOUDFRONT_DOMAINS'] ? { customDomain: undefined } : {},
);
const stacks = createStacks(app, config, process.argv[2]);
Tags.of(app).add('project', 'firmivra');
Tags.of(app).add('env', 'dev');
addNagSuppressions(stacks, config);
Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
try {
  app.synth();
  console.warn('NAG: no unacknowledged findings');
} catch (e) {
  console.warn(String(e instanceof Error ? e.message : e));
}
