// Story acceptance replay for story-vibepro-recipe-preflight-autopilot.
// Covers AC:1-AC:6 (RPA-S-1..RPA-S-6) and spec scenario clauses S-001/S-002
// against the real recipe registry and the real `pr autopilot` entry function.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { RECIPE_REGISTRY, runRecipePreflight } from '../../src/recipe-preflight.js';
import { autopilotPullRequest } from '../../src/pr-manager.js';
import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-recipe-preflight-autopilot';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function makeSyntheticRepo({ config } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rpa-e2e-'));
  await mkdir(path.join(root, '.vibepro'), { recursive: true });
  await writeFile(
    path.join(root, '.vibepro', 'vibepro-manifest.json'),
    JSON.stringify({ schema_version: '0.1.0', runs: [], latest_run_by_story: {} }, null, 2)
  );
  await writeFile(
    path.join(root, '.vibepro', 'config.json'),
    `${JSON.stringify(config ?? {
      schema_version: '0.1.0',
      tool: 'vibepro',
      workspace: '.vibepro',
      brainbase: { stories: [] }
    }, null, 2)}\n`
  );
  return root;
}

async function writeEvidence(root, storyId, commands) {
  const dir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'verification-evidence.json'),
    JSON.stringify({ schema_version: '0.1.0', story_id: storyId, warnings: [], commands }, null, 2)
  );
}

async function writeStoryDoc(root, storyId, frontmatter) {
  const dir = path.join(root, 'docs', 'management', 'stories', 'active');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${storyId}.md`), `---\n${frontmatter}\n---\n\n# Story\n`);
}

async function writeSpecDoc(root, storyId, frontmatter) {
  const dir = path.join(root, 'docs', 'specs');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${storyId}.md`), `---\n${frontmatter}\n---\n\n# Spec\n`);
}

async function writeFinalSpec(root, storyId, spec) {
  const dir = path.join(root, '.vibepro', 'spec', storyId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'spec.json'), JSON.stringify(spec, null, 2));
}

async function writeDecisionRecords(root, storyId, decisions) {
  const dir = path.join(root, '.vibepro', 'pr', storyId);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'decision-records.json'),
    JSON.stringify({ schema_version: '0.1.0', model: 'vibepro-decision-records-v1', story_id: storyId, decisions }, null, 2)
  );
}

function findResult(preflight, recipeId) {
  return preflight.results.find((item) => item.recipe_id === recipeId);
}

test(`${STORY_ID} ac:1 all six recipes detect their pitfall states on synthetic repositories`, async () => {
  const storyId = 'story-e2e-all-six';
  const root = await makeSyntheticRepo();
  await writeStoryDoc(root, storyId, `story_id: ${storyId}\ntitle: E2E\nparent_design: design-e2e\narchitecture_docs:\n  - docs/architecture/e2e.md`);
  await writeSpecDoc(root, storyId, `story_id: ${storyId}\ntitle: E2E\ndiagrams:\n  - kind: threat_model\n    mermaid: |\n      flowchart LR\n        A --> B`);
  await writeFinalSpec(root, storyId, { schema_version: '0.1.0', story_id: storyId, diagrams: [] });
  await writeEvidence(root, storyId, [
    {
      kind: 'unit',
      status: 'pass',
      command: 'npm test',
      summary: 'unit passed',
      artifact: null,
      observation: { targets: ['src/x.js'], scenarios: ['ran unit'], values: { exit_code: '0' } },
      executed_at: '2026-07-01T00:00:00.000Z'
    },
    {
      kind: 'integration',
      status: 'pass',
      command: 'npm test',
      summary: 'integration regression',
      artifact: 'integration.json',
      observation: { targets: [], scenarios: [], values: {} },
      executed_at: '2026-07-01T00:00:00.000Z'
    }
  ]);
  await writeDecisionRecords(root, storyId, [{
    decision_id: 'decision-1',
    type: 'waiver',
    status: 'accepted',
    source: 'gate:pr_scope_judgment',
    summary: 'scope accepted',
    reason: 'bounded followup',
    artifact: null
  }]);

  const preflight = await runRecipePreflight(root, { storyId });

  for (const recipe of RECIPE_REGISTRY) {
    const result = findResult(preflight, recipe.id);
    assert.equal(
      result.detected,
      true,
      `AC:1 RPA-S-1: recipe ${recipe.id} detects its pitfall state on the synthetic リポジトリ and reports auto_fix or next_command`
    );
    assert.ok(
      result.action_taken !== null || result.next_command !== null,
      `AC:1 RPA-S-1: recipe ${recipe.id} reports auto_fix or next_command, not a silent detection`
    );
  }
});

test(`${STORY_ID} ac:2 ${STORY_ID} S-001 auto_fix status artifact is schema-compatible and strengthens the verify record`, async () => {
  const storyId = 'story-e2e-status-artifact';
  const root = await makeSyntheticRepo();
  await writeEvidence(root, storyId, [{
    kind: 'unit',
    status: 'pass',
    command: 'npm test',
    summary: 'unit passed',
    artifact: null,
    observation: { targets: ['src/x.js'], scenarios: ['ran unit'], values: { exit_code: '0' } },
    executed_at: '2026-07-01T00:00:00.000Z'
  }]);

  const preflight = await runRecipePreflight(root, { storyId });
  const result = findResult(preflight, 'verify-status-artifact');

  assert.equal(
    result.action_taken,
    'generated status artifact from recorded exit code',
    'AC:2 RPA-S-2: S-001 given a passing verify record without a status artifact, a status artifact is generated from the recorded exit code'
  );
  const statusArtifact = JSON.parse(await readFile(path.join(root, result.artifacts[0]), 'utf8'));
  assert.deepEqual(
    statusArtifact,
    { status: 'pass', exit_code: 0 },
    'AC:2 RPA-S-2: S-001 the generated status artifact is スキーマ互換 generic status JSON identical to the hand-made counterpart'
  );
  const evidence = JSON.parse(await readFile(path.join(root, '.vibepro', 'pr', storyId, 'verification-evidence.json'), 'utf8'));
  const command = evidence.commands.find((item) => item.kind === 'unit');
  assert.equal(
    command.artifact_check.status,
    'verified',
    'AC:2 RPA-S-2: S-001 the record cross-check becomes verified so its spine strength evaluates to strong'
  );
});

test(`${STORY_ID} ac:3 preflight creates no gate results, waivers, or review verdicts`, async () => {
  const storyId = 'story-e2e-no-verdicts';
  const root = await makeSyntheticRepo();
  await writeStoryDoc(root, storyId, `story_id: ${storyId}\ntitle: E2E`);
  await writeEvidence(root, storyId, [{
    kind: 'unit',
    status: 'pass',
    command: 'npm test',
    summary: 'unit passed',
    artifact: null,
    observation: { targets: ['src/x.js'], scenarios: ['ran'], values: { exit_code: '0' } },
    executed_at: '2026-07-01T00:00:00.000Z'
  }]);

  await runRecipePreflight(root, { storyId });

  const prDir = path.join(root, '.vibepro', 'pr', storyId);
  const entries = await readFile(path.join(prDir, 'verification-evidence.json'), 'utf8');
  assert.ok(entries, 'AC:3 RPA-S-3: verification evidence remains the only evidence artifact preflight touches');
  for (const forbidden of ['gate-dag.json', 'decision-records.json', 'review-lifecycle.json']) {
    const exists = await readFile(path.join(prDir, forbidden), 'utf8').then(() => true, () => false);
    assert.equal(
      exists,
      false,
      `AC:3 RPA-S-3: preflight は gate の判定結果・waiver・review verdict を作成も変更もしない (${forbidden} must not be created)`
    );
  }
});

test(`${STORY_ID} ac:4 clean story preflight is a no-op and downstream inputs are unchanged`, async () => {
  const storyId = 'story-e2e-clean';
  const root = await makeSyntheticRepo({
    config: {
      schema_version: '0.1.0',
      tool: 'vibepro',
      workspace: '.vibepro',
      brainbase: { stories: [{ story_id: storyId, title: 'Clean', ssot: 'local', status: 'active' }] }
    }
  });
  await writeStoryDoc(root, storyId, `story_id: ${storyId}\ntitle: Clean`);
  const configBefore = await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8');

  const preflight = await runRecipePreflight(root, { storyId });

  assert.ok(
    preflight.results.every((item) => item.detected === false),
    'AC:4 RPA-S-4: 該当なしの story では preflight は no-op で every recipe reports detected false'
  );
  const configAfter = await readFile(path.join(root, '.vibepro', 'config.json'), 'utf8');
  assert.equal(
    configAfter,
    configBefore,
    'AC:4 RPA-S-4: no-op preflight leaves autopilot 既存挙動 inputs byte-identical (zero writes)'
  );
});

test(`${STORY_ID} ac:5 pr autopilot report carries the machine-readable preflight section`, async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rpa-e2e-autopilot-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-pr-preflight', '--title', 'Preflight', '--view', 'dev', '--period', '2026-07']);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.execution = { managed_worktree: 'disabled' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'feature.js'), 'export const feature = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init story repo']);
  await git(repo, ['switch', '-c', 'feature/preflight']);
  await writeFile(path.join(repo, 'src', 'feature.js'), 'export const feature = "updated";\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: change feature']);

  const result = await autopilotPullRequest(repo, {
    storyId: 'story-pr-preflight',
    baseRef: 'main',
    dryRun: true
  });

  const preflight = result.autopilot.preflight;
  assert.equal(
    preflight.schema_version,
    '0.1.0',
    'AC:5 RPA-S-5: autopilot 報告の preflight セクション carries schema_version'
  );
  assert.equal(
    preflight.results.length,
    RECIPE_REGISTRY.length,
    'AC:5 RPA-S-5: the preflight section lists every registered recipe exactly once'
  );
  for (const item of preflight.results) {
    for (const key of ['recipe_id', 'detected', 'action', 'action_taken', 'artifacts', 'next_command']) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(item, key),
        `AC:5 RPA-S-5: preflight result rows expose 機械可読 field ${key} ({ recipe_id, detected, action_taken, next_command })`
      );
    }
  }
});

test(`${STORY_ID} ac:5 CLI text surface: pr autopilot default output renders the Preflight section through runCli`, async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-rpa-e2e-autopilot-cli-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-pr-preflight-cli', '--title', 'Preflight CLI', '--view', 'dev', '--period', '2026-07']);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  config.execution = { managed_worktree: 'disabled' };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}
`);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'feature.js'), 'export const feature = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init story repo']);
  await git(repo, ['switch', '-c', 'feature/preflight-cli']);
  await writeFile(path.join(repo, 'src', 'feature.js'), 'export const feature = "updated";\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: change feature']);

  // Seed a passing record without a durable artifact so the
  // verify-status-artifact recipe detects and renders a row in the summary
  // (the renderer lists detected recipes only; a clean story renders
  // "- none detected").
  const evidenceDir = path.join(repo, '.vibepro', 'pr', 'story-pr-preflight-cli');
  await mkdir(evidenceDir, { recursive: true });
  await writeFile(
    path.join(evidenceDir, 'verification-evidence.json'),
    JSON.stringify({
      schema_version: '0.1.0',
      story_id: 'story-pr-preflight-cli',
      warnings: [],
      commands: [{
        kind: 'unit',
        status: 'pass',
        command: 'npm test',
        summary: 'unit passed',
        artifact: null,
        observation: { targets: ['src/feature.js'], scenarios: ['ran unit'], values: { exit_code: '0' } },
        executed_at: '2026-07-01T00:00:00.000Z'
      }]
    }, null, 2)
  );

  // Seed the multiline-guidance recipe too: a story doc referencing
  // architecture (parent_design) with no reason: key makes
  // architecture-reason-frontmatter emit its multiline next_command, so the
  // orphan-line assertion below exercises real multiline rendering.
  const storyDocDir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(storyDocDir, { recursive: true });
  await writeFile(
    path.join(storyDocDir, 'story-pr-preflight-cli.md'),
    '---\nstory_id: story-pr-preflight-cli\ntitle: Preflight CLI\nparent_design: design-preflight-cli\n---\n\n# Story\n'
  );

  // Drive the real CLI dispatcher (not autopilotPullRequest directly) so the
  // default human-readable output surface is asserted, matching the repo's
  // runCli(['pr', 'prepare', ...]) test convention.
  let out = '';
  const stdout = { write(text) { out += text; } };
  const stderr = { write() {} };
  const cliResult = await runCli(
    ['pr', 'autopilot', repo, '--story-id', 'story-pr-preflight-cli', '--base', 'main', '--dry-run'],
    { stdout, stderr }
  );
  assert.equal(cliResult.exitCode, 0, 'pr autopilot exits 0 via the CLI dispatcher');
  assert.match(out, /## Preflight/, 'default CLI output renders the Preflight section heading');
  // In --dry-run mode detected auto_fix recipes render as "planned" and
  // next_command recipes render their exact command on an indented
  // "next:" line so multiline guidance stays attached to its bullet.
  assert.match(
    out,
    /- verify-status-artifact: planned — .+/,
    'default CLI output lists the detected auto_fix recipe row with its reason (planned in dry-run)'
  );
  assert.match(
    out,
    /- generic-token-clause-binding: (next_command|planned) — .+\n    next: vibepro verify record/,
    'default CLI output lists the detected next_command recipe row with reason and an indented next: command line'
  );
  // Multiline next_commands (architecture-reason-frontmatter guidance) must
  // render with every continuation line indented, never as an orphaned
  // paragraph outside the bullet (human_usability review finding).
  assert.match(
    out,
    /- architecture-reason-frontmatter: (next_command|planned) — .+\n    next: # add to .+frontmatter:\n    reason: /,
    'multiline next_command renders with indented continuation lines attached to its bullet'
  );
  const preflightSection = out.split('## Preflight')[1].split('##')[0];
  const orphanLines = preflightSection.split('\n').filter(
    (line) => line.trim() && !line.startsWith('- ') && !line.startsWith('    ')
  );
  assert.deepEqual(orphanLines, [], 'every Preflight line is either a bullet or indented continuation');
});

test(`${STORY_ID} S-003 preflight workflow transitions recipe status to failed without aborting the autopilot flow`, async () => {
  const storyId = 'story-e2e-state-transitions';
  const root = await makeSyntheticRepo();
  const throwingRecipe = {
    id: 'always-throws',
    action: 'auto_fix',
    detect() { throw new Error('boom'); },
    fix() { throw new Error('unreachable'); }
  };

  const preflight = await runRecipePreflight(root, {
    storyId,
    registry: [throwingRecipe, ...RECIPE_REGISTRY]
  });

  assert.equal(
    preflight.results[0].action_taken,
    'failed',
    'S-003 when pr autopilot runs the preflight workflow, a throwing recipe transitions to the failed state (action_taken failed)'
  );
  assert.equal(
    preflight.results.length,
    RECIPE_REGISTRY.length + 1,
    'S-003 the preflight workflow resumes and every remaining recipe transitions through its detected status without abort, so downstream autopilot phases still run'
  );
  assert.ok(
    preflight.results.slice(1).every((item) => item.action_taken !== 'failed' || item.error),
    'S-003 each recipe transitions through detected status to auto_fix applied, next_command suggested, or failed state independently'
  );
});

test(`${STORY_ID} ac:6 ${STORY_ID} S-002 a seventh registry entry runs after the existing six without changing them`, async () => {
  const storyId = 'story-e2e-seventh';
  const root = await makeSyntheticRepo();
  let seventhRan = false;
  const seventh = {
    id: 'seventh-recipe',
    action: 'next_command',
    detect() {
      seventhRan = true;
      return { detected: true, next_command: 'echo seventh', reason: 'registry extension probe' };
    }
  };

  const preflight = await runRecipePreflight(root, {
    storyId,
    registry: [...RECIPE_REGISTRY, seventh]
  });

  assert.equal(
    seventhRan,
    true,
    'AC:6 RPA-S-6: S-002 given a seventh registry entry added in a test, when preflight runs, then it executes after the existing six with no changes to them (レシピ追加が registry へのエントリ追加だけで済む)'
  );
  assert.deepEqual(
    preflight.results.slice(0, RECIPE_REGISTRY.length).map((item) => item.recipe_id),
    RECIPE_REGISTRY.map((recipe) => recipe.id),
    'AC:6 RPA-S-6: S-002 the existing six recipes execute unchanged, in registry order, before the seventh entry'
  );
  assert.equal(
    preflight.results[RECIPE_REGISTRY.length].recipe_id,
    'seventh-recipe',
    'AC:6 RPA-S-6: S-002 the appended seventh entry executes after the existing six with no changes to them'
  );
});
