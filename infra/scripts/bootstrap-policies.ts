// Prints one of the two policies around `cdk deploy` for the AWS CLI (see src/bootstrap-policies.ts):
//   pnpm exec tsx scripts/bootstrap-policies.ts exec     > cfn-exec.json
//   pnpm exec tsx scripts/bootstrap-policies.ts boundary > boundary.json
import { cfnExecPolicy, permissionsBoundary } from '../src/bootstrap-policies';
import { configFor } from '../src/config';

const { account, region } = configFor('dev');
const which = process.argv[2];
const doc =
  which === 'exec'
    ? cfnExecPolicy(account, region)
    : which === 'boundary'
      ? permissionsBoundary(account, region)
      : undefined;
if (!doc) {
  console.error('usage: bootstrap-policies.ts exec|boundary');
  process.exit(1);
}
process.stdout.write(`${JSON.stringify(doc, null, 2)}
`);
