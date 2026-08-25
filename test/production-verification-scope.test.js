import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { normalizeEvidenceState, normalizeVerificationScope } from '../src/verification-evidence.js';
import { renderPrBody } from '../src/pr-manager.js';
import { buildAcceptedSpecClauseMap } from '../src/traceability.js';
import { runCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-production-scope-fixture';
const STORY_PATH = `docs/management/stories/active/${STORY_ID}.md`;
const TEST_PATH = 'test/scope-fixture.test.js';
const CASE = 'scope fixture exact case';

async function git(root, args) { return execFileAsync('git', args, { cwd: root }); }

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-production-scope-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await writeFile(path.join(root, 'index.html'), '<title>fixture</title>');
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'scope fixture']);
  const configPath = path.join(root, '.vibepro/config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.artifact_routing = { schema_version: '0.1.0', artifacts: { accepted_spec: { canonical: 'docs/specs/{story_id}.vibepro.json' } } };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(root, path.dirname(STORY_PATH)), { recursive: true });
  await mkdir(path.join(root, 'docs/specs'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, STORY_PATH), `# Scope fixture\n\n## Acceptance Criteria\n- VPVS-FIX-AC-001: production observation is required\n`);
  await writeFile(path.join(root, TEST_PATH), `import test from 'node:test';\ntest('${CASE}', () => {});\n// scope-marker\n`);
  await writeFile(path.join(root, `docs/specs/${STORY_ID}.vibepro.json`), `${JSON.stringify({
    schema_version: '0.1.0', story_id: STORY_ID, clauses: [{
      id: 'VPVS-FIX-C-001', type: 'invariant',
      origin: { story_refs: [{ kind: 'acceptance_criteria', ac_id: 'VPVS-FIX-AC-001' }], test_refs: [{ file: TEST_PATH, case: CASE }] },
      verification: { required_scopes: ['local_test', 'production'] },
      verifiable_by: { test_pattern: [{ file_glob: TEST_PATH, must_contain: 'scope-marker' }] }
    }]
  }, null, 2)}\n`);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'fixture']);
  return root;
}

test('projects local pass and production not_collected as mapped-but-unverified', async () => {
  const root = await setupRepo();
  const observation = { targets: [TEST_PATH], scenarios: [CASE] };
  const map = await buildAcceptedSpecClauseMap(root, {
    storyId: STORY_ID, storyDocPath: STORY_PATH, verificationTrustStatus: 'trusted',
    verification: { recorded: true, commands: [
      { status: 'pass', scope: 'local_test', evidence_state: 'verified', trust_status: 'trusted', observation },
      { status: 'needs_setup', scope: 'production', evidence_state: 'not_collected', trust_status: 'trusted', observation }
    ] }
  });
  const ac = map.acceptance_criteria[0];
  assert.equal(ac.status, 'mapped');
  assert.equal(ac.verification.status, 'mapped-but-unverified');
  assert.equal(ac.verification.scopes.local_test.status, 'verified');
  assert.equal(ac.verification.scopes.production.status, 'not_collected');
  assert.equal(ac.verification_status, 'unverified');
});

test('PR body renders structured AC and production evidence states', () => {
  const body = renderPrBody({
    story: { story_id: STORY_ID, title: 'fixture' }, runtime_identity: { source_kind: 'test', package: { name: 'vibepro', version: '0', root: '.' }, cli: { entrypoint: 'src/cli.js' }, source_git: {}, identity_digest: 'fixture' },
    story_source: { found: false }, spec: { present: true, story_id: STORY_ID, clause_count: 1 }, verification: { recorded: false }, review: {},
    git: { changed_files: [] }, blocking_reasons: [],
    traceability: { acceptance_criteria: [{ id: 'VPVS-FIX-AC-001', text: 'opaque source', status: 'mapped', verification: { status: 'mapped-but-unverified', required_scopes: ['local_test', 'production'], scopes: { local_test: { status: 'verified' }, production: { status: 'not_collected' } } } }] }
  });
  assert.match(body, /\[mapped-but-unverified\]/);
  assert.match(body, /verification\/production: not_collected/);
});

test('verification recorder persists scope and rejects contradictory evidence state', () => {
  assert.equal(normalizeVerificationScope(), 'local_test');
  assert.equal(normalizeEvidenceState(undefined, 'pass'), 'verified');
  assert.equal(normalizeEvidenceState('not_collected', 'needs_setup'), 'not_collected');
  assert.throws(() => normalizeEvidenceState('not_collected', 'pass'), /contradicts/);
});
