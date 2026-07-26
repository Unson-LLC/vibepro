import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(repoRoot, 'bin', 'vibepro.js');
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

async function run(args, options = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, args, {
      encoding: 'utf8',
      env: childEnv,
      maxBuffer: 32 * 1024 * 1024,
      ...options
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

async function withInitializedRepo(body) {
  const dir = await mkdtemp(path.join(tmpdir(), 'vibepro-enumeration-'));
  try {
    await execFileAsync('git', ['init', '-q', '.'], { cwd: dir });
    await execFileAsync('git', ['-c', 'user.email=t@example.test', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
    const init = await run([cli, 'init', '.'], { cwd: dir });
    assert.equal(init.code, 0, `vibepro init should succeed: ${init.stderr}`);
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('AC-1 AC-2 flow_replay: the real CLI rejects a malformed enumeration claim at record time and stores a well formed one', async () => {
  await withInitializedRepo(async (dir) => {
    const malformed = await run([
      cli, 'verify', 'record', '.', '--id', 'story-enumeration-e2e', '--kind', 'unit', '--status', 'pass',
      '--command', 'node --test test/a.test.js', '--target', 'src',
      '--scenario', 'enumeration: swept src, skills, docs, scripts, bin and .github'
    ], { cwd: dir });
    assert.notEqual(malformed.code, 0, 'count-free narration must not be recordable');
    const malformedOutput = `${malformed.stdout}${malformed.stderr}`;
    assert.match(malformedOutput, /enumeration_scenario_malformed/);

    const unbalanced = await run([
      cli, 'verify', 'record', '.', '--id', 'story-enumeration-e2e', '--kind', 'unit', '--status', 'pass',
      '--command', 'node --test test/a.test.js', '--target', 'src',
      '--scenario', 'enumeration: grepped foo_bar across src; 9 sites found, 5 updated, 2 unchanged because x'
    ], { cwd: dir });
    assert.notEqual(unbalanced.code, 0, 'counts that do not partition must not be recordable');
    assert.match(`${unbalanced.stdout}${unbalanced.stderr}`, /enumeration_counts_unbalanced/);

    const wellFormed = await run([
      cli, 'verify', 'record', '.', '--id', 'story-enumeration-e2e', '--kind', 'unit', '--status', 'pass',
      '--command', 'node --test test/a.test.js', '--target', 'src',
      '--scenario', 'enumeration: grepped foo_bar across src; 2 sites found, 2 updated, 0 unchanged'
    ], { cwd: dir });
    assert.equal(wellFormed.code, 0, `a well formed claim should record: ${wellFormed.stderr}`);
  });
});

test('AC-3 S-001 S-002 scenario_clause_e2e: the enumeration report over this repository recounts claims against the real tree', async () => {
  const { collectEnumerationCoverage } = await import('../../src/enumeration-evidence.js');

  const truthful = await collectEnumerationCoverage({
    repoRoot,
    baseRef: 'HEAD',
    headRef: 'HEAD',
    verificationEvidence: {
      commands: [{
        kind: 'unit',
        binding: { status: 'current' },
        observation: {
          targets: ['src'],
          // enumeration_coverage_gate genuinely appears three times under src/
          // (the gate node's type and both collector allowlists), so an honest
          // claim over that range must survive the recount.
          scenarios: ['enumeration: grepped enumeration_coverage_gate across src; 3 sites found, 3 updated, 0 unchanged'],
          values: {}
        }
      }]
    }
  });
  const truthfulClaim = truthful.claims.find((claim) => claim.identifier === 'enumeration_coverage_gate');
  assert.ok(truthfulClaim, 'the claim should be parsed out of the evidence');
  assert.equal(truthfulClaim.verified, true, `an honest count should survive the recount: ${truthfulClaim.verification_reason}`);

  const inflated = await collectEnumerationCoverage({
    repoRoot,
    baseRef: 'HEAD',
    headRef: 'HEAD',
    verificationEvidence: {
      commands: [{
        kind: 'unit',
        binding: { status: 'current' },
        observation: {
          targets: ['src'],
          scenarios: ['enumeration: grepped enumeration_coverage_gate across src; 99 sites found, 99 updated, 0 unchanged'],
          values: {}
        }
      }]
    }
  });
  assert.equal(inflated.status, 'failed', 'an inflated count must fail the gate');
  assert.equal(inflated.rejections[0].id, 'enumeration_count_mismatch');
});

test('AC-4 AC-5 S-002 evidence_lifecycle_regression: the unit suite for the enumeration contract passes through the real runner', async () => {
  const result = await run([
    '--test',
    'test/enumeration-coverage-gate.test.js'
  ], { cwd: repoRoot });

  assert.equal(result.code, 0, `enumeration unit suite should pass: ${result.stderr}`);
  assert.match(result.stdout, /fail 0/);
  assert.doesNotMatch(result.stderr, /not ok/);
});
