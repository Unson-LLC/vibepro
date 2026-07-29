import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

test('story-vibepro-next-best-action-controller acceptance flow replay', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const result = await execFileAsync(process.execPath, [
    '--test',
    'test/next-best-action-controller.test.js',
    'test/guarded-run-session.test.js'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 2 * 1024 * 1024
  });

  assert.match(result.stdout, /# fail 0\b/, 'focused Next Best Action suite must have no failures');
  assert.match(result.stdout, /NBA-S-1 excludes policy, dependency, and classification violations/,
    'ac1 S-001 excludes forbidden or dependency-blocked Safe Actions');
  assert.match(result.stdout, /NBA-S-2 and NBA-S-4 record every metric and preserve unknown costs/,
    'ac2 S-002 records every machine-readable comparison metric');
  assert.match(result.stdout, /NBA-S-3 selection and tie-break are deterministic/,
    'ac3 S-003 keeps selection, tie-break, and reason deterministic');
  assert.match(result.stdout, /NBA-S-2 and NBA-S-4 record every metric and preserve unknown costs/,
    'ac4 S-004 preserves unknown token, time, cost, and risk instead of zero');
  assert.match(result.stdout, /NBA-S-5 reuses a decision when no material state changed/,
    'ac5 S-005 reuses the decision until a material checkpoint delta exists');
  assert.match(result.stdout, /NBA-S-6 prefers a cheap uncertainty reduction before expensive validation/,
    'ac6 S-006 prefers cheaper uncertainty reduction before expensive validation');
  assert.match(result.stdout, /NBA-S-7 two no-progress checkpoints force an explicit escape action/,
    'ac7 S-007 transitions repeated no-progress to an explicit escape action');
  assert.match(result.stdout, /NBA-S-8 decision record contains bounded rationale, not raw transcript/,
    'ac8 S-008 persists bounded metrics and reason codes without raw transcripts');
  assert.match(result.stdout, /GRS-S-9 INV-004 Gate readiness is the only positive pr_ready transition/,
    'ac9 S-009 preserves pr_ready as a terminal state without another controller decision');
  assert.match(result.stdout, /SAO-S-1 SAO-S-4 execute orchestration persists journal and typed stop/,
    'ac9 S-010 preserves cancelled as an idempotent terminal state without re-execution');
  assert.match(result.stdout, /NBA-S-1 controller consumes only dependency-ready Safe Action registry candidates/,
    'registry -> eligibility -> ranking -> bounded decision integration remains executable');
  assert.match(result.stdout, /NBA-S-1 controller rejects non-canonical escape candidate injection/,
    'escape actions remain closed over the canonical authority registry');
  assert.match(result.stdout, /SAO-S-1 SAO-S-4 execute orchestration persists journal and typed stop/,
    'Guarded Run persists and reads back the bounded next-best-action decision');
});
