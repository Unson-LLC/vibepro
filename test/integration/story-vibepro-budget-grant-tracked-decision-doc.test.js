import '../support/scratch-tmpdir.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_BIN = path.join(root, 'bin', 'vibepro.js');

// story-vibepro-budget-grant-tracked-decision-doc: the same flow a real owner
// grant takes — the vibepro binary, a git repo with the repository's actual
// gitignore pattern (.vibepro/* with config.json re-included) — must end with
// the grant reviewable in the tracked diff surface, not only in the ignored
// workspace store.
async function makeGrantRepo({ ignoreDocs = false } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bgt-e2e-'));
  await execFileAsync('git', ['init'], { cwd: repo });
  await writeFile(path.join(repo, '.gitignore'), `.vibepro/*\n!.vibepro/config.json\n${ignoreDocs ? 'docs/\n' : ''}`);
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(repo, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)
  );
  await writeFile(
    path.join(repo, '.vibepro', 'config.json'),
    JSON.stringify({
      schema_version: '0.1.0',
      budgets: {
        delivery_efficiency: { max_subagent_count: 6 },
        delivery_efficiency_by_story: {
          'story-bgt-cli': { max_subagent_count: 10, amendment_reason: 'closure sequence raise' }
        }
      }
    }, null, 2)
  );
  return repo;
}

function grantArgs(repo) {
  return [
    CLI_BIN, 'decision', 'record', repo,
    '--id', 'story-bgt-cli',
    '--type', 'waiver',
    '--status', 'accepted',
    '--source', 'budget:delivery_efficiency:story-bgt-cli',
    '--summary', 'owner approved raising the Story subagent cap to 10',
    '--reason', 'owner approved the raise for the closure sequence',
    '--budget-grantor', 'sato-keigo',
    '--budget-grantor-kind', 'human',
    '--agent-system', 'claude_code',
    '--agent-id', 'agent-bgt-e2e',
    '--json'
  ];
}

test('BGT-E2E-1 the CLI grant flow leaves the grantor, digest, and timestamp on the tracked diff surface', async () => {
  const repo = await makeGrantRepo();
  const { stdout } = await execFileAsync(process.execPath, grantArgs(repo), { cwd: root });
  const result = JSON.parse(stdout);
  const docPath = result.decision.budget_approval.decision_doc;
  assert.match(docPath, /^docs\/management\/decisions\/.*budget-override-story-bgt-cli-[0-9a-f]{8}\.md$/);

  // The document is on the tracked side of the boundary the finding named:
  // check-ignore must NOT match it, while the workspace store stays ignored.
  await assert.rejects(execFileAsync('git', ['check-ignore', docPath], { cwd: repo }));
  await execFileAsync('git', ['check-ignore', '.vibepro/pr/story-bgt-cli/decision-records.json'], { cwd: repo });

  const doc = await readFile(path.join(repo, docPath), 'utf8');
  assert.match(doc, /type: budget_override_approval/);
  assert.match(doc, /approver: sato-keigo/);
  assert.match(doc, new RegExp(`override_digest: ${result.decision.budget_approval.override_digest}`));
  assert.match(doc, new RegExp(`approved_at: ${result.decision.recorded_at}`));
});

test('BGT-E2E-2 negative path: a gitignored document path makes the CLI grant fail with no workspace record', async () => {
  const repo = await makeGrantRepo({ ignoreDocs: true });
  await assert.rejects(
    execFileAsync(process.execPath, grantArgs(repo), { cwd: root }),
    /gitignored/
  );
  const records = await readFile(path.join(repo, '.vibepro', 'pr', 'story-bgt-cli', 'decision-records.json'), 'utf8')
    .catch((error) => error.code);
  assert.equal(records, 'ENOENT', 'expected no workspace record on the negative path');
});
