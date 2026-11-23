// Fix-phase commit guard (Rasel, Nov 23). It stops, before they are committed, the mistakes that
// cost the team a day: empty commits, text broken by a wrong file encoding, shared instruction
// files, the lead's live specs, unapproved db/infra/.github changes and .env files.
// Never bypass it with --no-verify. Lead: FIRMIVRA_LEAD=1. An approved db/infra/.github task:
// FIRMIVRA_APPROVED=1 (only when the issue says Rasel approved it).
import { execFileSync } from 'node:child_process';

const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
const lead = process.env.FIRMIVRA_LEAD === '1';
const approved = lead || process.env.FIRMIVRA_APPROVED === '1';

// Merging main into a branch stages main's own changes too (its .github, packages/db, ...). Those
// are not the developer's: during a merge, check only what differs from the branch being merged in.
const isMerging = () => {
  try {
    git('rev-parse', '-q', '--verify', 'MERGE_HEAD');
    return true;
  } catch {
    return false;
  }
};
const merging = isMerging();
const against = merging ? ['MERGE_HEAD'] : [];
const staged = git('diff', '--cached', '--name-only', '--diff-filter=ACMRD', ...against)
  .split('\n')
  .filter(Boolean);
const errors = [];
if (staged.length === 0 && !merging) {
  errors.push('Nothing is staged. Empty commits are not allowed: a commit changes code or tests.');
}

const RULES = [
  [/^(AGENTS|CLAUDE)\.md$/, lead, 'shared instructions: only the lead changes them.'],
  [/^apps\/web\/e2e\/live\//, lead, 'the live specs are run and maintained by the lead only.'],
  [
    /^(packages\/db|infra)\/|^\.github\//,
    approved,
    "needs Rasel's written yes. If your issue says it is approved, commit with FIRMIVRA_APPROVED=1.",
  ],
  [/(^|\/)\.env(\.(?!example$)[^/]*)?$/, false, 'a .env file holds secrets: never commit it.'],
];
for (const file of staged) {
  for (const [pattern, allowed, why] of RULES) {
    if (pattern.test(file) && !allowed) errors.push(`${file}: ${why}`);
  }
}

// A UTF-8 file saved as Windows-1252 turns a dash, an ellipsis or a middle dot into 2-3 odd
// characters (the escapes below match them).
// Write files with the editor tool or node, never with PowerShell Set-Content / Out-File.
const BROKEN = /\u00e2\u20ac|\u00c2[\u00a0-\u00bf]|\u00c3[\u0080-\u00bf]/;
let file = '';
let broken = 0;
for (const line of git('diff', '--cached', '-U0', '--no-color', '--no-ext-diff', ...against).split(
  '\n',
)) {
  if (line.startsWith('+++ ')) file = line.slice(6);
  else if (line.startsWith('+') && BROKEN.test(line)) {
    broken += 1;
    if (broken <= 5) errors.push(`${file}: broken text encoding: ${line.slice(1, 120).trim()}`);
  }
}
if (broken > 5) errors.push(`...and ${broken - 5} more lines with broken encoding.`);

if (errors.length > 0) {
  process.stderr.write(
    `\nCommit blocked by scripts/guard/pre-commit.mjs:\n- ${errors.join('\n- ')}\n\n`,
  );
  process.exit(1);
}
