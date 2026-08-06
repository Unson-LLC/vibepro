import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { runCli } from '../src/cli.js';
import { writeInferredSpec } from '../src/spec-store.js';
import { backfillTraceability, buildTraceabilityClauseMap } from '../src/traceability.js';

const execFileAsync = promisify(execFile);

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const STORY_DOC = '---\nstory_id: story-test-promo\ntitle: Promotion story\n---\n\n# Story\n\n## Background\nTest.\n\n## Acceptance Criteria\n- Touch README only.\n';

async function setupPrepareRepo({ storyDoc = STORY_DOC, spec = null } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-trace-promo-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'vibepro@example.com']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', root, '--story-id', 'story-test-promo', '--title', 'Promotion story']);
  await mkdir(path.join(root, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await writeFile(path.join(root, 'docs', 'management', 'stories', 'active', 'story-test-promo.md'), storyDoc);
  if (spec) await writeInferredSpec(root, 'story-test-promo', spec);
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'init']);
  await git(root, ['switch', '-c', 'feature/promo']);
  await writeFile(path.join(root, 'README.md'), '# Hello\n');
  await git(root, ['add', 'README.md']);
  await git(root, ['commit', '-m', 'feat: add README']);
  return root;
}

function traceabilityPath(root, storyId) {
  return path.join(root, '.vibepro', 'pr', storyId, 'traceability.json');
}

function evidenceRefs(traceability, type) {
  return traceability.evidence.filter((item) => item.type === type).map((item) => item.ref);
}

test('TSPA-CONTRACT-002 explicit Task criteria replace Story criteria only for clause traceability', () => {
  const result = buildTraceabilityClauseMap({
    storyId: 'story-task-scope',
    storyText: [
      '## Acceptance Criteria',
      '- Future live apply completes.',
      '',
      '## Scenarios',
      '- `AUTH-STORY-001`: Future live apply completes.'
    ].join('\n'),
    acceptanceCriteria: ['Current bootstrap validator passes.'],
    changedFiles: [],
    tests: [],
    evidence: []
  });

  assert.equal(result.acceptance_criteria.length, 1);
  assert.equal(result.acceptance_criteria[0].source_text, 'Current bootstrap validator passes.');
  assert.equal(result.acceptance_criteria.some((item) => /Future live apply/.test(item.source_text)), false);
  assert.deepEqual(result.scenario_lineage.story_scenario_ids, []);
  assert.deepEqual(result.scenario_lineage.missing_story_scenario_ids, []);
});

test('configured PR route is the single traceability read and write authority', async () => {
  const root = await setupPrepareRepo();
  const legacy = traceabilityPath(root, 'story-test-promo');
  const legacyBefore = await readFile(legacy, 'utf8');
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.artifact_routing = { artifacts: { pr: { canonical: '.vibepro/routed/{story_id}-pr-prepare.json' } } };
  await writeJson(configPath, config);
  await runCli(['pr', 'prepare', root, '--story-id', 'story-test-promo', '--base', 'main', '--json']);

  const routed = path.join(root, '.vibepro', 'routed', 'story-test-promo-traceability.json');
  assert.equal((await readJson(routed)).story_id, 'story-test-promo');
  assert.equal(await readFile(legacy, 'utf8'), legacyBefore, 'legacy path must not be mutated after route selection');
});

test('traceability backfill recognizes a real artifact at the configured PR authority', async () => {
  const root = await setupPrepareRepo();
  const configPath = path.join(root, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.artifact_routing = { artifacts: { pr: { canonical: '.vibepro/routed/{story_id}-pr-prepare.json' } } };
  await writeJson(configPath, config);
  await mkdir(path.join(root, '.vibepro', 'routed'), { recursive: true });
  await writeJson(path.join(root, '.vibepro', 'routed', 'story-test-promo-pr-create.json'), {
    schema_version: '0.1.0', story: { story_id: 'story-test-promo' }
  });

  const result = await backfillTraceability(root, { dryRun: true, storyId: 'story-test-promo' });
  assert.deepEqual(result.candidates, [], 'routed real PR evidence must suppress speculative backfill');
});

test('clause map keeps unmapped AC and scenario clauses visible', () => {
  const storyText = [
    '# Story',
    '',
    '## Acceptance Criteria',
    '- AC-backed evidence is present.',
    '- Missing clause-specific evidence remains visible.'
  ].join('\n');
  const map = buildTraceabilityClauseMap({
    storyText,
    changedFiles: [],
    tests: [],
    evidence: [{
      type: 'verification_evidence',
      ref: 'test/ac-backed.test.js',
      summary: 'AC-backed evidence is present',
      strength: 'supporting',
      binding_status: 'current',
      artifact_quality: 'verified',
      current_head_sha: 'abc123',
      targets: ['AC-1']
    }],
    scenarioClauses: [{
      id: 'S-001',
      statement: 'Scenario clause needs replay coverage.'
    }]
  });
  assert.equal(map.acceptance_criteria[0].status, 'mapped');
  assert.equal(map.acceptance_criteria[0].mapped_evidence[0].binding_status, 'current');
  assert.equal(map.acceptance_criteria[0].mapped_evidence[0].current_head_sha, 'abc123');
  assert.equal(map.acceptance_criteria[1].status, 'unmapped');
  assert.equal(map.scenario_clauses[0].status, 'unmapped');
});

test('clause map accepts Japanese 受け入れ条件 heading', () => {
  const storyText = [
    '# Story',
    '',
    '## 受け入れ条件',
    '- Journey contextをDesign Modernize planに表示する',
    '- curatedではないhandoffをauthoritativeとして扱わない'
  ].join('\n');
  const map = buildTraceabilityClauseMap({ storyText });
  assert.equal(map.acceptance_criteria.length, 2);
  assert.equal(map.acceptance_criteria[0].id, 'AC-1');
  assert.match(map.acceptance_criteria[0].source_text, /Journey context/);
});

test('broad verification command and artifact paths do not map every AC', () => {
  const storyText = [
    '# Story',
    '',
    '## Acceptance Criteria',
    '- PR body, Gate DAG, and usage report show unmapped counts.',
    '- Generic broad suite must not satisfy this clause.'
  ].join('\n');
  const map = buildTraceabilityClauseMap({
    storyText,
    changedFiles: [],
    tests: [],
    evidence: [{
      type: 'verification_evidence',
      ref: '.vibepro/manual-verification/story/focused.tap',
      summary: 'node --test test/traceability-promotion.test.js test/traceability-usage-report.test.js',
      strength: 'supporting',
      binding_status: 'current',
      artifact_quality: 'unrecognized',
      targets: [
        'node --test test/traceability-promotion.test.js test/traceability-usage-report.test.js',
        '.vibepro/manual-verification/story/focused.tap'
      ]
    }]
  });
  assert.equal(map.acceptance_criteria[0].status, 'unmapped');
  assert.equal(map.acceptance_criteria[1].status, 'unmapped');
});

test('clause map binds explicit AC and scenario ids from test content without prefix collisions', () => {
  const storyId = 'story-vibepro-delivery-reconciliation-state';
  const storyText = [
    '# Story',
    '',
    '## Acceptance Criteria',
    '- First clause.',
    '- Second clause.',
    '- Third clause.',
    '- External delivery preserves expected topology.'
  ].join('\n');
  const map = buildTraceabilityClauseMap({
    storyId,
    storyText,
    changedFiles: [],
    tests: [{
      path: 'test/delivery-reconciliation.test.js',
      content: [
        `test('${storyId}:AC-4 keeps external delivery topology reconciled', () => {});`,
        `test('${storyId}:S-004 records the clean external-delivery scenario', () => {});`,
        "test('AC-40 must not bind AC-4 by prefix', () => {});"
      ].join('\n')
    }],
    scenarioClauses: [
      { id: 'S-004', statement: 'Clean external delivery remains reconciled.' },
      { id: 'S-005', statement: 'Unrelated scenario remains visible.' }
    ]
  });

  assert.equal(map.acceptance_criteria[3].status, 'mapped');
  assert.deepEqual(map.acceptance_criteria[3].mapped_tests, ['test/delivery-reconciliation.test.js']);
  assert.equal(map.scenario_clauses[0].status, 'mapped');
  assert.equal(map.scenario_clauses[1].status, 'unmapped');

  const collisionOnly = buildTraceabilityClauseMap({
    storyId,
    storyText,
    tests: [{ path: 'test/collision.test.js', content: "test('AC-40 only', () => {});" }]
  });
  assert.notEqual(collisionOnly.acceptance_criteria[3].status, 'mapped');
});

test('clause map rejects an unqualified clause id owned by another Story', () => {
  const storyId = 'story-vibepro-delivery-reconciliation-state';
  const map = buildTraceabilityClauseMap({
    storyId,
    storyText: '## Acceptance Criteria\n- AC-4: expected topology remains reconciled.',
    tests: [{
      path: 'test/guarded-run-session.test.js',
      content: "test('GRS-S-4 S-004 AC-4 belongs to guarded run', () => {});"
    }],
    scenarioClauses: [{ id: 'S-004', statement: 'Clean external delivery remains reconciled.' }]
  });

  assert.equal(map.acceptance_criteria[0].status, 'unmapped');
  assert.equal(map.scenario_clauses[0].status, 'unmapped');
});

test('scenario lineage fails closed for missing and unknown Story scenario ids', () => {
  const storyText = [
    '## Scenarios',
    '- `DRS-STORY-S-001`: managed delivery.',
    '- `DRS-STORY-S-002`: external delivery.'
  ].join('\n');
  const missing = buildTraceabilityClauseMap({
    storyText,
    scenarioClauses: [{ id: 'DRS-SCENARIO-001', story_scenario_ids: ['DRS-STORY-S-001'], statement: 'Managed delivery.' }]
  });
  assert.equal(missing.scenario_lineage.status, 'unmapped');
  assert.deepEqual(missing.scenario_lineage.missing_story_scenario_ids, ['DRS-STORY-S-002']);

  const unknown = buildTraceabilityClauseMap({
    storyText,
    scenarioClauses: [{ id: 'DRS-SCENARIO-001', story_scenario_ids: ['DRS-STORY-S-999'], statement: 'Wrong delivery.' }]
  });
  assert.equal(unknown.scenario_clauses[0].status, 'unmapped');
  assert.equal(unknown.scenario_clauses[0].scenario_lineage_status, 'invalid');
  assert.deepEqual(unknown.scenario_lineage.unknown_story_scenario_ids, ['DRS-STORY-S-999']);
});

test('delivery reconciliation scenario lineage preserves the reviewed Story-to-Spec matrix', async () => {
  const storyText = await readFile(new URL('../docs/management/stories/active/story-vibepro-delivery-reconciliation-state.md', import.meta.url), 'utf8');
  const spec = JSON.parse(await readFile(new URL('./fixtures/delivery-reconciliation-scenario-lineage.json', import.meta.url), 'utf8'));
  const scenarios = spec.clauses.filter((clause) => clause.type === 'scenario' && Array.isArray(clause.story_scenario_ids));
  const map = buildTraceabilityClauseMap({ storyText, scenarioClauses: scenarios });
  assert.equal(map.scenario_lineage.status, 'mapped');
  assert.deepEqual(Object.fromEntries(scenarios.map((clause) => [clause.id, clause.story_scenario_ids])), {
    'S-001': ['DRS-STORY-S-003'],
    'S-002': ['DRS-STORY-S-005'],
    'S-003': ['DRS-STORY-S-001'],
    'S-004': ['DRS-STORY-S-002'],
    'S-005': ['DRS-STORY-S-003'],
    'S-006': ['DRS-STORY-UNVERIFIED-004'],
    'S-007': ['DRS-STORY-S-001'],
    'S-008': ['DRS-STORY-S-005'],
    'S-009': ['DRS-STORY-S-005'],
    'S-010': ['DRS-STORY-S-006'],
    'S-011': ['DRS-STORY-S-005'],
    'S-012': ['DRS-STORY-S-005', 'DRS-STORY-TXN-007', 'DRS-STORY-ROUTE-008'],
    'S-013': ['DRS-STORY-RECOVERY-009']
  });
});

test('trace declare rejects merged lifecycle', async () => {
  const root = await setupPrepareRepo();
  const result = await runCli([
    'trace', 'declare', root, '--story-id', 'story-test-promo', '--lifecycle', 'merged', '--json'
  ]);
  assert.notEqual(result.exitCode, 0, 'merged is evidence-backed and must not be manually declarable');
});
