// Fix-phase commit message guard (Rasel, Nov 23): a Conventional Commit subject and no
// attribution lines.
import { readFileSync } from 'node:fs';

const message = readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter((line) => !line.startsWith('#'))
  .join('\n');
const subject = message.split('\n')[0] ?? '';
const errors = [];
if (
  !/^Merge /.test(subject) &&
  !/^(feat|fix|test|docs|chore|refactor|perf|ci|build|db|style|revert)(\([^)]+\))?!?: \S/.test(
    subject,
  )
) {
  errors.push(
    `The subject must be a Conventional Commit, e.g. "fix: Payroll F13 ... (Name)". Got: "${subject}"`,
  );
}
if (/co-authored-by:|generated with/i.test(message)) {
  errors.push('Remove the "Co-Authored-By" / "Generated with" lines.');
}
if (errors.length > 0) {
  process.stderr.write(
    `\nCommit blocked by scripts/guard/commit-msg.mjs:\n- ${errors.join('\n- ')}\n\n`,
  );
  process.exit(1);
}
