#!/usr/bin/env node
// CDK app. Usage: pnpm cdk <command> -c env=dev [-c imageTag=<sha>]
import { App, Tags, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { configFor } from '../src/config';
import { addNagSuppressions } from '../src/nag';
import { createStacks } from '../src/stacks';

const app = new App();
const config = configFor(app.node.tryGetContext('env'));
const imageTag = app.node.tryGetContext('imageTag') as string | undefined;

const stacks = createStacks(app, config, imageTag);

Tags.of(app).add('project', 'firmivra');
Tags.of(app).add('env', config.envName);

addNagSuppressions(stacks, config);
Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
