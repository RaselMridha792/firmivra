// Synthesizes all dev stacks without AWS credentials (lookups get placeholders) and prints
// every cdk-nag finding that is not acknowledged. Used while writing src/nag.ts.
import { App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { cdkJsonContext } from '../src/cdk-context';
import { configFor, DEV_FIRMIVRA_COM } from '../src/config';
import { addNagSuppressions } from '../src/nag';
import { createStacks } from '../src/stacks';

const app = new App({ context: { ...cdkJsonContext(), env: 'dev' } });
// CUSTOM_DOMAIN=1 checks the configuration after the switch to dev.firmivra.com.
const config = configFor(
  'dev',
  process.env['CUSTOM_DOMAIN'] ? { customDomain: DEV_FIRMIVRA_COM } : {},
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
