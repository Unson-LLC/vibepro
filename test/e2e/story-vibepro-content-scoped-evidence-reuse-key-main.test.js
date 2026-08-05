import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const childEnv = { ...process.env };
delete childEnv.NODE_TEST_CONTEXT;

const STORY = 'story-vibepro-content-scoped-evidence-reuse-key';

test(`${STORY} ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 (CRK-S-1 / CRK-S-2 / CRK-S-3 / CRK-S-4 / CRK-S-5 / CRK-S-6) executes the content-scoped evidence reuse key behavior`, async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    '--test',
    'test/evidence-summary-reuse.test.js'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 10 * 1024 * 1024
  });

  assert.doesNotMatch(stderr, /not ok|Warning:/);

  // story-vibepro-content-scoped-evidence-reuse-key ac:1
  // ac:1 (CRK-S-1 / INV-001): head_sha/head_ref and wall-clock verification
  // timestamps are excluded from the evidence-reuse key; an unrelated head
  // change with no intersecting role surface stays a hit. This test also
  // pins one of CRK-S-6's three named contract behaviors: identical content
  // at a different head_sha remains a hit.
  assert.match(stdout, /CRK-S-1 ERM-CONTRACT-001 ERM-CONTRACT-002 an unrelated head change with no intersecting role surface is a hit, not stale/);

  // story-vibepro-content-scoped-evidence-reuse-key ac:2
  // ac:2 (CRK-S-2 / S-001): a fix commit touching only one role's inspected
  // surface misses only that role's reuse. This test also pins another of
  // CRK-S-6's three named contract behaviors: an inspected-surface change
  // misses only the intersecting role.
  assert.ok(stdout.includes("CRK-S-2 a fix commit touching only one role's inspected surface misses only that role's reuse"));
  // ac:2 (CRK-S-2 / S-001) consumption-side coverage: a role with no
  // evidence-reuse baseline must not be treated as spuriously fresh.
  assert.match(stdout, /CRK-S-2 consumption a role with no evidence-reuse baseline is not treated as spuriously fresh/);

  // story-vibepro-content-scoped-evidence-reuse-key ac:3
  // ac:3 (CRK-S-3 / INV-002): a strict_head role (set via
  // agent_reviews.roles.<role>.freshness_mode, never a hardcoded role-name
  // list) still misses on any head change, while a content_surface role with
  // unchanged content hits.
  assert.match(stdout, /CRK-S-3 a strict_head role misses on head change while a content_surface role with unchanged content hits/);

  // story-vibepro-content-scoped-evidence-reuse-key ac:4
  // story-vibepro-content-scoped-evidence-reuse-key ac:6
  // ac:4 (CRK-S-4 / INV-003) and ac:6 (CRK-S-6 / C-002): spec fingerprint
  // drift invalidates every role's reuse, not only the aggregate status.
  // This is the third of CRK-S-6's three named contract behaviors: spec
  // drift causes every role to miss.
  assert.ok(stdout.includes("CRK-S-4 CRK-S-6 spec fingerprint drift invalidates every role's reuse, not only the aggregate status"));

  // story-vibepro-content-scoped-evidence-reuse-key ac:5
  // ac:5 (CRK-S-5 / C-001): evidence-reuse.json records reconstructable
  // per-role hit/miss reasons.
  assert.match(stdout, /CRK-S-5 role_reuse records reconstructable per-role hit\/miss reasons in evidence-reuse\.json/);

  assert.match(stdout, /fail 0/);
});
