import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { resolveArtifactRoute } from '../src/artifact-routing.js';
import { evaluateVerificationEvidenceTrust } from '../src/pr-manager.js';
import { buildAcceptedSpecClauseMap, buildTraceability } from '../src/traceability.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-accepted-spec-traceability-fixture';
const STORY_PATH = `docs/management/stories/active/${STORY_ID}.md`;
const TEST_PATH = 'test/accepted-spec-lineage-fixture.test.js';
const EXTRA_TEST_PATH = 'test/accepted-spec-negative-fixture.test.js';

async function git(root, args) {
  return execFileAsync('git', args, { cwd: root, encoding: 'utf8' });
}

function acId(index) {
  return `ASTR-FIX-AC-${String(index).padStart(3, '0')}`;
}

function caseName(index) {
  return `ASTR-FIX-S-${index} resolves ${acId(index)} from the exact HEAD test blob`;
}

function storyText() {
  return [
    '---',
    `story_id: ${STORY_ID}`,
    'title: accepted spec traceability fixture',
    '---',
    '',
    '# Fixture',
    '',
    '## Acceptance Criteria',
    ...Array.from({ length: 12 }, (_, offset) => `- ${acId(offset + 1)}: clause ${offset + 1} is traceable`),
    ''
  ].join('\n');
}

function testBlob() {
  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    '',
    ...Array.from({ length: 12 }, (_, offset) => {
      const index = offset + 1;
      const marker = index <= 9 ? `ASTR-FIX-PATTERN-${index}` : `scenario-${index}`;
      return `test('${caseName(index)}', () => assert.ok('${marker}'));`;
    }),
    ''
  ].join('\n');
}

function acceptedSpec(overrides = {}) {
  const clauses = Array.from({ length: 12 }, (_, offset) => {
    const index = offset + 1;
    const clause = {
      id: `ASTR-FIX-C-${String(index).padStart(3, '0')}`,
      type: index <= 9 ? 'invariant' : 'scenario',
      statement: `Clause ${index} is traceable to its stable AC and exact test case.`,
      origin: {
        story_refs: [{ kind: 'acceptance_criteria', ac_id: acId(index) }],
        test_refs: [{ file: TEST_PATH, case: caseName(index) }]
      }
    };
    if (index <= 9) {
      clause.verifiable_by = {
        test_pattern: [{ file_glob: TEST_PATH, must_contain: `ASTR-FIX-PATTERN-${index}` }]
      };
    }
    return clause;
  });
  return {
    schema_version: '0.1.0',
    story_id: STORY_ID,
    generated_by: { caller: 'test', stage: 'ai_synthesis' },
    clauses,
    ...overrides
  };
}

async function setupRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-accepted-spec-lineage-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Fixture</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', STORY_ID, '--title', 'accepted spec traceability fixture']);
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.artifact_routing = {
    schema_version: '0.1.0',
    artifacts: {
      accepted_spec: { canonical: 'docs/specs/{story_id}.vibepro.json' }
    }
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init fixture']);
  await mkdir(path.join(root, path.dirname(STORY_PATH)), { recursive: true });
  await mkdir(path.join(root, path.dirname(TEST_PATH)), { recursive: true });
  await writeFile(path.join(root, STORY_PATH), storyText());
  await writeFile(path.join(root, TEST_PATH), testBlob());
  await writeFile(path.join(root, EXTRA_TEST_PATH), '// ASTR-FIX-FORBIDDEN-MARKER\n');
  const route = await resolveArtifactRoute(root, 'accepted_spec', { storyId: STORY_ID });
  await mkdir(path.dirname(route.canonical.absolute_path), { recursive: true });
  await writeFile(route.canonical.absolute_path, `${JSON.stringify(acceptedSpec(), null, 2)}\n`);
  await git(root, ['add', STORY_PATH, TEST_PATH, EXTRA_TEST_PATH, route.canonical.relative_path]);
  await git(root, ['commit', '-m', 'add exact HEAD lineage fixture']);
  return { root, specPath: route.canonical.relative_path };
}

test('Issue #454 projects 12 accepted-spec clauses and provenance identically to all PR artifacts', async () => {
  const { root, specPath } = await setupRepo();
  const result = await runCli(['pr', 'prepare', root, '--story-id', STORY_ID, '--base', 'HEAD~1', '--json']);
  assert.equal(result.exitCode, 0, result.stderr);

  const artifactDir = path.join(root, '.vibepro', 'pr', STORY_ID);
  const preparation = JSON.parse(await readFile(path.join(artifactDir, 'pr-prepare.json'), 'utf8'));
  const traceability = JSON.parse(await readFile(path.join(artifactDir, 'traceability.json'), 'utf8'));
  const body = await readFile(path.join(artifactDir, 'pr-body.md'), 'utf8');
  const clauses = preparation.traceability.acceptance_criteria;

  assert.equal(clauses.length, 12);
  assert.equal(clauses.filter((item) => item.lineage_status === 'resolved').length, 12);
  assert.ok(clauses.every((item) => item.status === 'mapped'));
  assert.ok(clauses.every((item) => item.mapping_source === 'accepted_spec'));
  assert.ok(clauses.every((item) => item.mapped_tests.length === 1 && typeof item.mapped_tests[0] === 'string'));
  assert.ok(clauses.every((item) => item.mapped_test_provenance[0].case));
  assert.deepEqual(traceability.acceptance_criteria, clauses);
  assert.deepEqual(traceability.accepted_spec_lineage, preparation.traceability.accepted_spec_lineage);
  assert.equal(preparation.traceability.accepted_spec_lineage.spec_path, specPath);
  assert.match(preparation.traceability.accepted_spec_lineage.spec_blob_oid, /^[0-9a-f]{40,64}$/);
  assert.match(body, /accepted-spec lineage: resolved/);
  assert.match(body, new RegExp(`${specPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*[0-9a-f]{7,}`));
  assert.match(body, /ASTR-FIX-C-012/);
  assert.match(body, new RegExp(TEST_PATH.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body, new RegExp(caseName(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(body, new RegExp(clauses[0].mapped_test_provenance[0].blob_oid));
  assert.match(body, new RegExp(preparation.traceability.accepted_spec_lineage.head_sha));
  assert.match(body, new RegExp(preparation.traceability.accepted_spec_lineage.story_blob_oid));
  assert.match(body, new RegExp(clauses[0].mapped_test_provenance[0].head_sha));
});

test('Issue #454 lineage resolver fails closed with explicit reasons and keeps verification separate', async () => {
  const { root, specPath } = await setupRepo();
  const baseline = acceptedSpec();

  const cases = [
    ['unknown_story_ac', (spec) => { spec.clauses[0].origin.story_refs[0].ac_id = 'UNKNOWN-AC'; }],
    ['test_file_missing', (spec) => { spec.clauses[0].origin.test_refs[0].file = 'test/missing.test.js'; }],
    ['test_case_missing', (spec) => { spec.clauses[0].origin.test_refs[0].case = 'missing exact case'; }],
    ['test_pattern_failed', (spec) => {
      delete spec.clauses[0].verifiable_by.test_pattern[0].must_contain;
      spec.clauses[0].verifiable_by.test_pattern[0].must_cover = 'missing-pattern';
    }],
    ['test_pattern_failed', (spec) => {
      spec.clauses[0].verifiable_by.test_pattern[0] = {
        file_glob: 'test/accepted-spec-*-fixture.test.js',
        must_not_contain: 'ASTR-FIX-FORBIDDEN-MARKER'
      };
    }],
    ['test_pattern_missing', (spec) => { delete spec.clauses[0].verifiable_by; }]
  ];

  for (const [reason, mutate] of cases) {
    const spec = structuredClone(baseline);
    mutate(spec);
    await writeFile(path.join(root, specPath), `${JSON.stringify(spec, null, 2)}\n`);
    await git(root, ['add', specPath]);
    await git(root, ['commit', '-m', `fixture ${reason}`]);
    const map = await buildAcceptedSpecClauseMap(root, {
      storyId: STORY_ID,
      storyDocPath: STORY_PATH,
      verification: { recorded: false, commands: [] }
    });
    assert.equal(map.accepted_spec_lineage.status, 'invalid', reason);
    assert.ok(map.accepted_spec_lineage.reason_codes.includes(reason), reason);
    assert.ok(map.accepted_spec_lineage.failures.some((failure) => failure.reason_codes.includes(reason)), reason);
    assert.equal(map.acceptance_criteria.find((item) => item.id === acId(1))?.status, 'unmapped', reason);
  }

  const current = await readFile(path.join(root, specPath), 'utf8');
  await writeFile(path.join(root, specPath), `${current}\n`);
  const diverged = await buildAcceptedSpecClauseMap(root, {
    storyId: STORY_ID,
    storyDocPath: STORY_PATH,
    verification: { recorded: false, commands: [] }
  });
  assert.equal(diverged.accepted_spec_lineage.status, 'invalid');
  assert.ok(diverged.accepted_spec_lineage.reason_codes.includes('accepted_spec_diverged_from_head'));

  await writeFile(path.join(root, specPath), current);
  const untrusted = await buildAcceptedSpecClauseMap(root, {
    storyId: STORY_ID,
    storyDocPath: STORY_PATH,
    verification: { recorded: true, commands: [{ status: 'pass' }] },
    verificationTrustStatus: 'untrusted'
  });
  const unaffected = untrusted.acceptance_criteria.find((item) => item.id === acId(2));
  assert.equal(unaffected.lineage_status, 'resolved');
  assert.equal(unaffected.verification_status, 'untrusted');
  assert.ok(unaffected.reason_codes.includes('verification_evidence_untrusted'));

  const positiveGlob = structuredClone(baseline);
  positiveGlob.clauses[0].verifiable_by.test_pattern[0] = {
    file_glob: 'test/accepted-spec-*-fixture.test.js',
    must_contain: 'ASTR-FIX-PATTERN-1',
    must_cover: 'ASTR-FIX-PATTERN-1'
  };
  await writeFile(path.join(root, specPath), `${JSON.stringify(positiveGlob, null, 2)}\n`);
  await git(root, ['add', specPath]);
  await git(root, ['commit', '-m', 'fixture positive multi-file pattern']);
  const positiveMap = await buildAcceptedSpecClauseMap(root, {
    storyId: STORY_ID,
    storyDocPath: STORY_PATH,
    verification: { recorded: false, commands: [] }
  });
  assert.equal(positiveMap.accepted_spec_lineage.status, 'resolved');
});

test('Issue #462 resolves test.each and it.each cases without weakening exact case matching', async () => {
  const { root, specPath } = await setupRepo();
  const testEachCase = 'parameterized test.each resolves the exact template';
  const itEachCase = 'parameterized it.each resolves the exact template';
  await writeFile(path.join(root, TEST_PATH), [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    '',
    `test.each(contract.cases)('${testEachCase}', () => assert.ok('ASTR-FIX-PATTERN-1'));`,
    `it.each(fixture.cases)(\`${itEachCase}\`, () => assert.ok('ASTR-FIX-PATTERN-2'));`,
    "test('ordinary test remains resolvable', () => assert.ok('ASTR-FIX-PATTERN-3'));",
    "it('ordinary it remains resolvable', () => assert.ok('ASTR-FIX-PATTERN-4'));",
    ''
  ].join('\n'));

  const spec = acceptedSpec();
  spec.clauses = spec.clauses.slice(0, 5);
  spec.clauses[0].origin.test_refs[0].case = testEachCase;
  spec.clauses[1].origin.test_refs[0].case = itEachCase;
  spec.clauses[2].origin.test_refs[0].case = 'ordinary test remains resolvable';
  spec.clauses[3].origin.test_refs[0].case = 'ordinary it remains resolvable';
  spec.clauses[4].origin.test_refs[0].case = 'parameterized test.each resolves a different template';
  for (const [index, clause] of spec.clauses.entries()) {
    clause.verifiable_by.test_pattern[0].must_contain = `ASTR-FIX-PATTERN-${Math.min(index + 1, 4)}`;
  }
  await writeFile(path.join(root, specPath), `${JSON.stringify(spec, null, 2)}\n`);
  await git(root, ['add', TEST_PATH, specPath]);
  await git(root, ['commit', '-m', 'add parameterized test fixture']);

  const map = await buildAcceptedSpecClauseMap(root, {
    storyId: STORY_ID,
    storyDocPath: STORY_PATH,
    verification: { recorded: false, commands: [] }
  });

  for (const id of [acId(1), acId(2), acId(3), acId(4)]) {
    assert.equal(map.acceptance_criteria.find((item) => item.id === id)?.lineage_status, 'resolved', id);
  }
  const mismatch = map.acceptance_criteria.find((item) => item.id === acId(5));
  assert.equal(mismatch?.lineage_status, 'invalid');
  assert.ok(mismatch?.reason_codes.includes('test_case_missing'));
});

test('Issue #454 resolves routing from target HEAD and trusts only exact computed evidence', async () => {
  const { root, specPath } = await setupRepo();
  const configPath = path.join(root, '.vibepro', 'config.json');
  const dirtyConfig = JSON.parse(await readFile(configPath, 'utf8'));
  dirtyConfig.artifact_routing.artifacts.accepted_spec.canonical = 'dirty/{story_id}.json';
  await writeFile(configPath, `${JSON.stringify(dirtyConfig, null, 2)}\n`);

  const map = await buildAcceptedSpecClauseMap(root, {
    storyId: STORY_ID,
    storyDocPath: STORY_PATH,
    verification: { recorded: false, commands: [] }
  });
  assert.equal(map.accepted_spec_lineage.spec_path, specPath);
  assert.equal(map.accepted_spec_lineage.status, 'resolved');

  const headSha = (await git(root, ['rev-parse', 'HEAD'])).stdout.trim();
  const command = {
    status: 'pass',
    evidence_source: 'runner_direct',
    artifact_check: { status: 'verified' },
    observation_check: { status: 'recorded' },
    git_context: { head_sha: headSha },
    content_binding: {
      model: 'vibepro-content-scoped-evidence-freshness-v1',
      mode: 'strict_head',
      recorded_head_sha: headSha
    },
    computed_observation: {
      values: {
        exit_code: '0',
        head_sha: headSha,
        head_sha_before: headSha,
        head_sha_after: headSha,
        timed_out: 'false',
        log_truncated: 'false',
        output_limit_exceeded: 'false',
        tree_mutated_during_run: 'false',
        head_moved_during_run: 'false',
        worktree_changed_during_run: 'false'
      }
    }
  };
  const verification = { recorded: true, commands: [command] };
  assert.equal(await evaluateVerificationEvidenceTrust(root, verification, headSha), 'trusted');
  command.computed_observation.values.head_sha = 'stale';
  assert.equal(await evaluateVerificationEvidenceTrust(root, verification, headSha), 'untrusted');
  command.computed_observation.values.head_sha = headSha;
  command.evidence_source = 'self_reported';
  assert.equal(await evaluateVerificationEvidenceTrust(root, verification, headSha), 'untrusted');
  command.evidence_source = 'runner_direct';
  command.computed_observation.values.tree_mutated_during_run = 'true';
  assert.equal(await evaluateVerificationEvidenceTrust(root, verification, headSha), 'untrusted');
});

test('Issue #454 keeps legacy heuristic behavior when accepted-spec is absent', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-accepted-spec-absent-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await writeFile(path.join(root, 'README.md'), '# no spec\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'init']);
  const map = await buildAcceptedSpecClauseMap(root, {
    storyId: STORY_ID,
    storyDocPath: STORY_PATH,
    verification: { recorded: false, commands: [] }
  });
  assert.equal(map, null);

  const route = await resolveArtifactRoute(root, 'accepted_spec', { storyId: STORY_ID });
  await mkdir(path.dirname(route.canonical.absolute_path), { recursive: true });
  await writeFile(route.canonical.absolute_path, `${JSON.stringify(acceptedSpec(), null, 2)}\n`);
  const untracked = await buildAcceptedSpecClauseMap(root, {
    storyId: STORY_ID,
    storyDocPath: STORY_PATH,
    verification: { recorded: false, commands: [] }
  });
  assert.equal(untracked.accepted_spec_lineage.status, 'invalid');
  assert.ok(untracked.accepted_spec_lineage.reason_codes.includes('accepted_spec_not_in_head'));

  const existing = { accepted_spec_lineage: { status: 'resolved', head_sha: 'stale' } };
  const preserved = buildTraceability(existing, {
    storyId: STORY_ID,
    source: { type: 'story' },
    lifecycle: { status: 'active' }
  });
  assert.deepEqual(preserved.accepted_spec_lineage, existing.accepted_spec_lineage);

  const cleared = buildTraceability(existing, {
    storyId: STORY_ID,
    source: { type: 'story' },
    lifecycle: { status: 'active' },
    acceptedSpecLineage: null
  });
  assert.equal(cleared.accepted_spec_lineage, null);
});
