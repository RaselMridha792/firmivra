#!/usr/bin/env node
// CDK app. Usage: pnpm cdk <command> -c env=dev
// The running image tags are parameters of firmivra-dev-app, set only by deploy-dev.yml.
import { App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { configFor } from '../src/config';
import { addNagSuppressions } from '../src/nag';
import { createStacks } from '../src/stacks';

const app = new App();
if (app.node.tryGetContext('imageTag') !== undefined) {
  throw new Error(
    '-c imageTag is gone: the image tags are parameters of firmivra-dev-app (ImageTag, MigrateImageTag), ' +
      'set by deploy-dev.yml. A cdk deploy without --parameters keeps the running images.',
  );
}
const config = configFor(app.node.tryGetContext('env'));

const stacks = createStacks(app, config);

Tags.of(app).add('project', 'firmivra');
Tags.of(app).add('env', config.envName);

addNagSuppressions(stacks, config);
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
