// One-off ECS task on the API image (see create-firm-key.ts):
//   node dist/firm-applications/create-firm-key.cli.js <firm slug> [--check]
import 'reflect-metadata';
import { runCreateFirmKey } from './create-firm-key.js';

process.exitCode = await runCreateFirmKey(process.argv.slice(2), process.env, (line) =>
  process.stdout.write(`${line}\n`),
);
