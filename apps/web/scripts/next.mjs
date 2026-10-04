// Runs `next <command>` with the repo's root .env loaded, so WEB_PORT and API_BASE_URL apply.
// In Docker and AWS there is no .env file and real environment variables are used.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { config } from 'dotenv';

config({ path: '../../.env', quiet: true });
// NODE_ENV in .env is for the API. Next sets it itself (development for dev, production for build/start).
delete process.env.NODE_ENV;

const [command = 'dev', ...rest] = process.argv.slice(2);
const args = [command, ...rest];
if (command === 'dev' || command === 'start') args.push('--port', process.env.WEB_PORT ?? '3000');

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
const child = spawn(process.execPath, [nextBin, ...args], { stdio: 'inherit', env: process.env });
child.on('exit', (code) => process.exit(code ?? 1));
