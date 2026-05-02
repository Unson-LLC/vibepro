import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { scanApiBoundary } from '../src/api-boundary-scanner.js';
import { runCli } from '../src/cli.js';
import { buildStoryTaskState } from '../src/story-task-generator.js';

const execFileAsync = promisify(execFile);

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-test-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function makeGitRepoWithStory() {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-pr-prepare', '--title', 'PR準備', '--view', 'dev', '--period', '2026-W18']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init test repo']);
  await git(repo, ['switch', '-c', 'feature/test-story']);
  return repo;
}

test('init creates a repo-local VibePro workspace and ignore file', async () => {
  const repo = await makeRepo();

  const result = await runCli(['init', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'init');
  assert.equal((await readJson(path.join(repo, '.vibepro', 'config.json'))).schema_version, '0.1.0');
  assert.equal((await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'))).latest_run, null);
  const ignore = await readFile(path.join(repo, '.vibeproignore'), 'utf8');
  assert.match(ignore, /\.vibepro\/raw\//);
  const gitignore = await readFile(path.join(repo, '.gitignore'), 'utf8');
  assert.match(gitignore, /\.vibepro\/raw\//);
});

test('help command prints discoverable usage', async () => {
  let output = '';

  const result = await runCli(['help'], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'help');
  assert.match(output, /vibepro help \[command\]/);
  assert.match(output, /vibepro story derive \[repo\].*--run-graphify/);
  assert.match(output, /vibepro story derive \[repo\].*--preset <id>/);
});

test('init can bootstrap and select a local story', async () => {
  const repo = await makeRepo();

  const result = await runCli([
    'init',
    repo,
    '--story-id',
    'story-hardening',
    '--title',
    '公開前診断',
    '--view',
    'dev',
    '--period',
    '2026-W18'
  ]);

  assert.equal(result.exitCode, 0);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.current_story_id, 'story-hardening');
  const story = config.brainbase.stories.find((item) => item.story_id === 'story-hardening');
  assert.equal(story.title, '公開前診断');
  assert.equal(story.ssot, 'local');
  assert.equal(story.status, 'active');
  assert.equal(story.view, 'dev');
  assert.equal(story.period, '2026-W18');
});

test('init fails when bootstrapped story already exists', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-hardening', '--title', '公開前診断']);

  const result = await runCli(['init', repo, '--story-id', 'story-hardening', '--title', '公開前診断']);

  assert.equal(result.exitCode, 1);
});

test('doctor reports uninitialized repositories without creating a workspace', async () => {
  const repo = await makeRepo();

  const result = await runCli(['doctor', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.overall_status, 'uninitialized');
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});

test('doctor detects and fixes missing diagnosis evidence references', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, '.vibepro', 'diagnostics', 'ok-run'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'diagnostics', 'ok-run', 'evidence.json'), JSON.stringify({ run_id: 'ok-run' }));
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_run = 'missing-run';
  manifest.latest_run_by_story = {
    'story-alpha': 'missing-run',
    'story-beta': 'ok-run'
  };
  manifest.runs = [
    {
      run_id: 'missing-run',
      story_id: 'story-alpha',
      artifacts: { evidence: '.vibepro/diagnostics/missing-run/evidence.json' }
    },
    {
      run_id: 'ok-run',
      story_id: 'story-beta',
      artifacts: { evidence: '.vibepro/diagnostics/ok-run/evidence.json' }
    }
  ];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const dryRun = await runCli(['doctor', repo]);

  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.overall_status, 'needs_maintenance');
  assert.equal(dryRun.result.checks[0].id, 'VP-DOCTOR-MISSING-EVIDENCE');
  assert.equal(dryRun.result.next_commands.includes(`vibepro doctor ${repo} --fix`), true);
  assert.deepEqual(dryRun.result.next_actions[0], {
    command: `vibepro doctor ${repo} --fix`,
    reason: '存在しない evidence を参照する診断runを管理目録から整理する。',
    expected_after: 'VP-DOCTOR-MISSING-EVIDENCE が消える。',
    safe_to_run: true
  });
  assert.equal((await readJson(manifestPath)).runs.length, 2);

  const fixed = await runCli(['doctor', repo, '--fix', '--json']);

  assert.equal(fixed.exitCode, 0);
  assert.equal(fixed.result.overall_status, 'fixed');
  assert.equal(fixed.result.repairs[0].removed_run_ids.includes('missing-run'), true);
  const after = await readJson(manifestPath);
  assert.equal(after.runs.length, 1);
  assert.equal(after.latest_run, 'ok-run');
  assert.equal(after.latest_run_by_story['story-alpha'], undefined);
  assert.equal(after.latest_run_by_story['story-beta'], 'ok-run');
  await stat(path.join(repo, '.vibepro', 'doctor', 'doctor-result.json'));
});

test('doctor fixes stale story, run, catalog, and graphify references', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-live', '--title', 'Live Story']);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const config = await readJson(configPath);
  config.brainbase.current_story_id = 'story-missing';
  config.brainbase.stories.push({
    story_id: 'story-stale-derived',
    title: 'Stale derived story',
    ssot: 'local',
    status: 'active',
    derived_by: 'vibepro-story-derive'
  });
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const manifest = await readJson(manifestPath);
  manifest.latest_run = 'missing-run';
  manifest.latest_run_by_story = { 'story-live': 'missing-run' };
  manifest.runs = [];
  manifest.artifacts = {
    graphify_json: '.vibepro/graphify/missing-graph.json',
    graphify_report: '.vibepro/graphify/missing-report.md'
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await mkdir(path.join(repo, '.vibepro', 'stories'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'), JSON.stringify({
    story_count: 1,
    stories: [{
      story_id: 'story-derived-new',
      title: 'Derived New Story',
      ssot: 'local',
      status: 'active',
      horizon: 'quarter',
      view: 'business',
      period: null,
      category: 'product'
    }]
  }, null, 2));

  const dryRun = await runCli(['doctor', repo, '--json']);

  assert.equal(dryRun.exitCode, 0);
  assert.equal(dryRun.result.overall_status, 'needs_maintenance');
  const checkIds = dryRun.result.checks.map((check) => check.id);
  assert.equal(checkIds.includes('VP-DOCTOR-CURRENT-STORY-MISSING'), true);
  assert.equal(checkIds.includes('VP-DOCTOR-STALE-LATEST-RUN-REFS'), true);
  assert.equal(checkIds.includes('VP-DOCTOR-MISSING-GRAPHIFY-ARTIFACTS'), true);
  assert.equal(checkIds.includes('VP-DOCTOR-STORY-CATALOG-DRIFT'), true);
  assert.equal(dryRun.result.next_commands.includes(`vibepro story derive ${repo} --run-graphify`), true);
  assert.equal(dryRun.result.next_actions.some((action) => action.command === `vibepro story derive ${repo} --run-graphify` && action.expected_after.includes('story-catalog.json')), true);

  const fixed = await runCli(['doctor', repo, '--fix']);

  assert.equal(fixed.exitCode, 0);
  assert.equal(fixed.result.overall_status, 'fixed');
  const fixedConfig = await readJson(configPath);
  const fixedManifest = await readJson(manifestPath);
  assert.equal(fixedConfig.brainbase.current_story_id, null);
  assert.equal(fixedConfig.brainbase.stories.some((story) => story.story_id === 'story-derived-new'), true);
  assert.equal(fixedConfig.brainbase.stories.find((story) => story.story_id === 'story-stale-derived').status, 'archived');
  assert.equal(fixedManifest.latest_run, null);
  assert.deepEqual(fixedManifest.latest_run_by_story, {});
  assert.equal(fixedManifest.artifacts.graphify_json, undefined);
  assert.equal(fixedManifest.artifacts.graphify_report, undefined);
});

test('doctor reports missing task workflow references without modifying them', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-live', '--title', 'Live Story']);
  const tasksDir = path.join(repo, '.vibepro', 'stories', 'story-live', 'tasks');
  await mkdir(path.join(tasksDir, 'TASK-001'), { recursive: true });
  await writeFile(path.join(tasksDir, 'tasks.json'), JSON.stringify({
    schema_version: '0.1.0',
    story: { story_id: 'story-live', title: 'Live Story' },
    source_run: { run_id: 'story-plan' },
    tasks: [{ id: 'TASK-001', title: 'Task 001', target_groups: [] }]
  }, null, 2));
  await writeFile(path.join(tasksDir, 'TASK-001', 'handoff.json'), JSON.stringify({
    references: {
      briefing_json: '.vibepro/stories/story-live/tasks/TASK-001/briefing.json',
      plan_json: '.vibepro/stories/story-live/tasks/TASK-001/plan.json'
    }
  }, null, 2));

  const result = await runCli(['doctor', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.overall_status, 'needs_maintenance');
  const taskCheck = result.result.checks.find((check) => check.id === 'VP-DOCTOR-MISSING-TASK-WORKFLOW-REFS');
  assert.equal(taskCheck.status, 'manual');
  assert.equal(taskCheck.items.length, 2);
  assert.equal(taskCheck.items[0].repair_command, `vibepro task handoff ${repo} --task TASK-001 --id story-live`);
  assert.equal(result.result.next_commands.includes(`vibepro task handoff ${repo} --task TASK-001 --id story-live`), true);
  assert.equal(result.result.next_actions[0].reason.includes('task workflow成果物'), true);
  assert.equal(result.result.next_actions[0].expected_after, 'VP-DOCTOR-MISSING-TASK-WORKFLOW-REFS が消える。');
});

test('graph imports existing graphify artifacts into the workspace', async () => {
  const repo = await makeRepo();
  const graphSource = path.join(repo, 'graphify-out');
  await runCli(['init', repo]);
  await mkdir(graphSource, { recursive: true });
  await writeFile(path.join(graphSource, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app', label: 'App' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'INFERRED' }]
  }));
  await writeFile(path.join(graphSource, 'GRAPH_REPORT.md'), '# Graph Report\n\n## Important Nodes\n\n- App');

  const result = await runCli(['graph', repo, '--from', graphSource]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'graph');
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes.length, 1);
  assert.match(await readFile(path.join(repo, '.vibepro', 'graphify', 'GRAPH_REPORT.md'), 'utf8'), /Important Nodes/);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'))).artifacts.graphify_json, '.vibepro/graphify/graph.json');
});

test('graph uses graphify-out by default', async () => {
  const repo = await makeRepo();
  const graphSource = path.join(repo, 'graphify-out');
  await mkdir(graphSource, { recursive: true });
  await writeFile(path.join(graphSource, 'graph.json'), JSON.stringify({ nodes: [], edges: [] }));
  await writeFile(path.join(graphSource, 'GRAPH_REPORT.md'), '# Graph Report');

  const result = await runCli(['graph', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes.length, 0);
});

test('graph can run graphify before importing artifacts', async () => {
  const repo = await makeRepo();
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bin-'));
  const graphifyBin = path.join(binDir, 'graphify');
await writeFile(graphifyBin, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.argv[2] !== 'update' || process.argv[3] !== '.') {
  console.error('unexpected graphify args: ' + process.argv.slice(2).join(' '));
  process.exit(1);
}
const outDir = 'graphify-out';
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify({
  nodes: [{ id: 'from-graphify' }],
  edges: []
}));
writeFileSync(path.join(outDir, 'GRAPH_REPORT.md'), '# Generated Graph Report\\n');
`);
  await chmod(graphifyBin, 0o755);

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.graphifyExecuted, true);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes[0].id, 'from-graphify');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.graphify.last_execution.command, 'graphify update .');
});

test('graph reports install guidance when graphify is missing', async () => {
  const repo = await makeRepo();

  const result = await runCli(['graph', repo, '--run-graphify'], {
    env: { ...process.env, PATH: '' }
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.command, 'graph');
});

test('story derive can run graphify before generating the story catalog', async () => {
  const repo = await makeRepo();
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-bin-'));
  const graphifyBin = path.join(binDir, 'graphify');
  await writeFile(graphifyBin, `#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (process.argv[2] !== 'update' || process.argv[3] !== '.') {
  console.error('unexpected graphify args: ' + process.argv.slice(2).join(' '));
  process.exit(1);
}
const outDir = 'graphify-out';
mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'graph.json'), JSON.stringify({
  nodes: [{ id: 'src/app/api/debug/route.ts' }],
  edges: []
}));
writeFileSync(path.join(outDir, 'GRAPH_REPORT.md'), '# Generated Graph Report\\n');
`);
  await chmod(graphifyBin, 0o755);
  await runCli(['init', repo]);

  const result = await runCli(['story', 'derive', repo, '--run-graphify'], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.graph.graphifyExecuted, true);
  assert.equal((await readJson(path.join(repo, '.vibepro', 'graphify', 'graph.json'))).nodes[0].id, 'src/app/api/debug/route.ts');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.graphify.last_execution.command, 'graphify update .');
  await stat(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
});

test('story add list select and archive manage local stories without NocoDB', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const addResult = await runCli([
    'story',
    'add',
    repo,
    '--id',
    'story-local-hardening',
    '--title',
    'ローカル診断強化',
    '--horizon',
    'sprint',
    '--view',
    'dev',
    '--period',
    '2026-W18',
    '--started-at',
    '2026-04-28',
    '--due-at',
    '2026-05-05'
  ]);

  assert.equal(addResult.exitCode, 0);
  const afterAdd = await readJson(path.join(repo, '.vibepro', 'config.json'));
  const localStory = afterAdd.brainbase.stories.find((story) => story.story_id === 'story-local-hardening');
  assert.equal(localStory.title, 'ローカル診断強化');
  assert.equal(localStory.ssot, 'local');
  assert.equal(localStory.status, 'active');
  assert.equal(localStory.period, '2026-W18');

  const selectResult = await runCli(['story', 'select', repo, '--id', 'story-local-hardening']);

  assert.equal(selectResult.exitCode, 0);
  const afterSelect = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(afterSelect.brainbase.current_story_id, 'story-local-hardening');

  let output = '';
  const listResult = await runCli(['story', 'list', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(listResult.exitCode, 0);
  assert.match(output, /\* story-local-hardening/);

  const archiveResult = await runCli(['story', 'archive', repo, '--id', 'story-local-hardening']);

  assert.equal(archiveResult.exitCode, 0);
  const afterArchive = await readJson(path.join(repo, '.vibepro', 'config.json'));
  const archivedStory = afterArchive.brainbase.stories.find((story) => story.story_id === 'story-local-hardening');
  assert.equal(archivedStory.status, 'archived');
  assert.equal(afterArchive.brainbase.current_story_id, null);
});

test('story derive creates a repo-wide story catalog and local stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-existing', '--title', '既存Story', '--view', 'dev', '--period', '2026-W18']);
  await mkdir(path.join(repo, 'docs', 'user_stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhook', 'stripe'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'map'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'hotel'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    dependencies: {
      next: '15.0.0',
      react: '19.0.0',
      'next-auth': '5.0.0',
      '@prisma/client': '6.0.0'
    },
    devDependencies: {
      '@playwright/test': '1.0.0',
      vitest: '3.0.0'
    }
  }));
  await writeFile(path.join(repo, 'docs', 'user_stories', 'active', 'US-001_map_search_display.md'), '# 地図検索でホテルを探せる\n');
  await writeFile(path.join(repo, 'docs', 'features', 'shadow-call-system.md'), '# AI電話代行\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhook', 'stripe', 'route.ts'), 'export function POST() {}\n');
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'map', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'hotel', 'search.ts'), 'export function searchHotels() {}\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.added_count > 0, true);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-us-001-map-search-display'), false);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-shadow-call-system'), false);
  assert.equal(catalog.stories.some((story) => story.title.includes('仕様書')), false);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-hotel-map-search'), true);
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').source.paths.includes('docs/user_stories/active/US-001_map_search_display.md'), true);
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').view, 'business');
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').category, 'product');
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').horizon, 'quarter');
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').period, null);
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').derived.predictions.period.confidence, 'unknown');
  assert.match(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').derived.story_definition.who, /ホテルを探しているユーザー/);
  assert.match(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').derived.story_definition.problem, /画面の行き来/);
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').derived.story_definition.acceptance_focus.some((item) => item.includes('検索条件に一致したホテルのみ')), true);
  assert.match(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').derived.meaning.value_hypothesis, /予約候補/);
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').derived.meaning.user_actor.confidence, 'high');
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').derived.meaning.business_goal.confidence, 'low');
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').derived.meaning.workflow_position.stage, 'discovery');
  assert.equal(catalog.stories.find((story) => story.story_id === 'story-product-hotel-map-search').derived.meaning.workflow_position.after.includes('story-product-hotel-detail-actions'), true);
  assert.equal(catalog.open_questions.some((item) => item.story_id === 'story-product-hotel-map-search' && item.field === 'period'), true);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-shadow-call'), true);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-architecture-api-surface'), true);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-security-auth-boundary'), true);
  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /# Story Map/);
  assert.match(map, /## サマリー/);
  assert.match(map, /## まず確認すること/);
  assert.match(map, /## Story構造/);
  assert.match(map, /## Storyカード/);
  assert.match(map, /誰のため: ホテルを探しているユーザー/);
  assert.match(map, /成果: ユーザーが場所、価格、ホテルの候補を同じ文脈で比較/);
  assert.match(map, /意味づけ:/);
  assert.match(map, /位置づけ: discovery/);
  assert.match(map, /付録: 不明点/);
  assert.match(map, /ホテル検索と地図体験を安定化する/);
  assert.doesNotMatch(map, /AI電話代行 \| product/);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.stories.some((story) => story.story_id === 'story-product-hotel-map-search'), true);
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-hotel-map-search').view, 'business');
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-hotel-map-search').category, 'product');
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-hotel-map-search').period, null);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.artifacts.story_catalog, '.vibepro/stories/story-catalog.json');
  assert.equal(manifest.artifacts.story_map, '.vibepro/stories/story-map.md');
});

test('story derive continues when manifest evidence artifact is missing', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'components', 'hotel'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'hotel', 'HotelDetail.tsx'), 'export function HotelDetail() { return null; }\n');
  const manifestPath = path.join(repo, '.vibepro', 'vibepro-manifest.json');
  const manifest = await readJson(manifestPath);
  manifest.latest_run = 'missing-run';
  manifest.runs = [{
    run_id: 'missing-run',
    story_id: 'story-vibepro-diagnosis-commercialization-roadmap',
    artifacts: {
      evidence: '.vibepro/diagnostics/missing-run/evidence.json'
    }
  }];
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let output = '';

  const result = await runCli(['story', 'derive', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.match(output, /Warnings:/);
  assert.match(output, /診断evidenceが見つからない/);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.run_id, null);
  assert.equal(catalog.source.warnings[0].code, 'missing_evidence');
  assert.equal(catalog.source.warnings[0].run_id, 'missing-run');
  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /警告: missing_evidence/);

  await runCli(['story', 'plan', repo]);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  const cleanupTask = plan.task_candidates.find((task) => task.id === 'story-docs-story-ssot-recovery-missing-evidence-cleanup');
  assert.equal(plan.questions.some((question) => question.field === 'missing_evidence'), true);
  assert.equal(Boolean(cleanupTask), true);
  assert.equal(cleanupTask.story_id, 'story-docs-story-ssot-recovery');
  assert.match(cleanupTask.purpose, /診断evidence/);
  await runCli(['task', 'create', repo, '--from-plan', '--id', 'story-docs-story-ssot-recovery', '--task', 'story-docs-story-ssot-recovery-missing-evidence-cleanup']);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-docs-story-ssot-recovery', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks.some((task) => task.id === 'story-docs-story-ssot-recovery-missing-evidence-cleanup'), true);
});

test('story map renders the generated catalog as markdown and json', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'features', 'article-cms-requirements.md'), '# 記事CMSを整える\n');
  await runCli(['story', 'derive', repo]);
  let markdown = '';
  const markdownResult = await runCli(['story', 'map', repo], {
    stdout: { write: (text) => { markdown += text; } }
  });
  let json = '';
  const jsonResult = await runCli(['story', 'map', repo, '--json'], {
    stdout: { write: (text) => { json += text; } }
  });

  assert.equal(markdownResult.exitCode, 0);
  assert.match(markdown, /Story構造/);
  assert.match(markdown, /Storyカード/);
  assert.match(markdown, /記事とCMS運用を整理する/);
  assert.match(markdown, /SEO流入/);
  assert.match(markdown, /docs\/features\/article-cms-requirements\.md/);
  assert.equal(jsonResult.exitCode, 0);
  assert.equal(JSON.parse(json).stories.some((story) => story.story_id === 'story-product-article-cms-requirements'), false);
  assert.equal(JSON.parse(json).stories.some((story) => story.story_id === 'story-product-content-cms'), true);
  assert.match(JSON.parse(json).stories.find((story) => story.story_id === 'story-product-content-cms').derived.story_definition.business_value, /SEO流入/);
});

test('story plan creates execution priorities from the generated story map', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'detail'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'hotel'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'detail', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'components', 'hotel', 'HotelDetail.tsx'), 'export function HotelDetail() { return null; }\n');
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'detail-page', source_file: 'src/app/(app)/detail/page.tsx', community: 'hotel-detail' },
      { id: 'hotel-detail', source_file: 'src/components/hotel/HotelDetail.tsx', community: 'hotel-detail' },
      { id: 'hotel-api', source_file: 'src/lib/hotel/api.ts', community: 'hotel-detail' }
    ],
    edges: [
      { source: 'detail-page', target: 'hotel-detail' },
      { source: 'hotel-detail', target: 'hotel-api' }
    ]
  }));
  await runCli(['story', 'derive', repo]);

  let output = '';
  const result = await runCli(['story', 'plan', repo, '--limit', '3'], {
    stdout: { write: (text) => { output += text; } }
  });
  let json = '';
  const jsonResult = await runCli(['story', 'plan', repo, '--limit', '2', '--json'], {
    stdout: { write: (text) => { json += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.match(output, /# Story Plan/);
  assert.match(output, /Story実行計画/);
  assert.match(output, /まず確認する質問/);
  assert.match(output, /Source Consistency/);
  assert.match(output, /Spec正本を復元する/);
  const plan = await readJson(path.join(repo, '.vibepro', 'stories', 'story-plan.json'));
  assert.equal(plan.priority_stories.length <= 2, true);
  assert.equal(plan.summary.source_consistency_status, 'needs_recovery');
  assert.equal(plan.source_consistency.needs_recovery_story_count > 0, true);
  assert.equal(plan.questions.some((question) => question.field === 'missing_spec'), true);
  assert.equal(plan.questions.some((question) => question.field === 'source_spec_recovery'), true);
  assert.equal(plan.task_candidates.some((task) => task.id.endsWith('spec-recovery')), true);
  const specRecoveryCandidate = plan.task_candidates.find((task) => task.id === 'story-product-hotel-detail-actions-spec-recovery');
  assert.equal(specRecoveryCandidate.source_recovery.sources.spec.status, 'needs_recovery');
  assert.equal(specRecoveryCandidate.graph_context.matched_node_count > 0, true);
  assert.equal(specRecoveryCandidate.recovery_drafts.some((draft) => draft.kind === 'spec'), true);
  assert.equal(specRecoveryCandidate.recovery_drafts[0].graph_evidence.related_edge_count > 0, true);
  assert.equal(specRecoveryCandidate.recovery_drafts[0].evidence_files.includes('src/lib/hotel/api.ts'), true);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.artifacts.story_plan, '.vibepro/stories/story-plan.json');
  assert.equal(manifest.artifacts.story_plan_markdown, '.vibepro/stories/story-plan.md');
  assert.equal(jsonResult.exitCode, 0);
  assert.equal(JSON.parse(json).priority_stories.length > 0, true);
  assert.equal(JSON.parse(json).priority_stories.length <= 2, true);

  const createResult = await runCli(['task', 'create', repo, '--from-plan', '--id', 'story-product-hotel-detail-actions']);
  assert.equal(createResult.exitCode, 0);
  assert.equal(createResult.result.created_story_count, 1);
  assert.equal(createResult.result.created_task_count > 0, true);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-product-hotel-detail-actions', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks.some((task) => task.id === 'story-product-hotel-detail-actions-spec-recovery'), true);
  assert.equal(tasks.tasks.find((task) => task.id === 'story-product-hotel-detail-actions-spec-recovery').source_type, 'story_plan_candidate');
  assert.equal(tasks.tasks.find((task) => task.id === 'story-product-hotel-detail-actions-spec-recovery').source_recovery.status, 'needs_recovery');
  assert.equal(tasks.tasks.find((task) => task.id === 'story-product-hotel-detail-actions-spec-recovery').graph_context.related_edge_count > 0, true);
  const listResult = await runCli(['task', 'list', repo, '--id', 'story-product-hotel-detail-actions']);
  assert.equal(listResult.exitCode, 0);
  assert.equal(listResult.result.tasks.some((task) => task.id === 'story-product-hotel-detail-actions-spec-recovery'), true);
  const briefResult = await runCli(['task', 'brief', repo, '--id', 'story-product-hotel-detail-actions', '--task', 'story-product-hotel-detail-actions-spec-recovery']);
  assert.equal(briefResult.exitCode, 0);
  assert.equal(briefResult.result.artifacts.markdown, '.vibepro/stories/story-product-hotel-detail-actions/tasks/story-product-hotel-detail-actions-spec-recovery/briefing.md');
  const briefing = await readFile(path.join(repo, '.vibepro', 'stories', 'story-product-hotel-detail-actions', 'tasks', 'story-product-hotel-detail-actions-spec-recovery', 'briefing.md'), 'utf8');
  assert.match(briefing, /Source Recovery/);
  assert.match(briefing, /suggested_path: docs\/specs\/product-hotel-detail-actions.md/);
  assert.match(briefing, /graph: matched=/);
});

test('story plan creates architecture recovery tasks for boundary code without ADR', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'auth', 'session'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'auth', 'session', 'route.ts'), 'export function GET() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'session-route', source_file: 'src/app/api/auth/session/route.ts', community: 'auth-api' },
      { id: 'session-helper', source_file: 'src/lib/auth/session.ts', community: 'auth-api' }
    ],
    edges: [
      { source: 'session-route', target: 'session-helper' }
    ]
  }));
  await runCli(['story', 'derive', repo]);

  let json = '';
  const result = await runCli(['story', 'plan', repo, '--limit', '8', '--json'], {
    stdout: { write: (text) => { json += text; } }
  });

  assert.equal(result.exitCode, 0);
  const plan = JSON.parse(json);
  assert.equal(plan.task_candidates.some((task) => task.id.endsWith('architecture-recovery')), true);
  const task = plan.task_candidates.find((item) => item.id.endsWith('architecture-recovery'));
  assert.equal(task.source_recovery.sources.architecture.status, 'needs_decision');
  assert.equal(task.graph_context.matched_node_count > 0, true);
  assert.equal(task.recovery_drafts.some((draft) => draft.kind === 'architecture'), true);
  assert.equal(task.recovery_drafts[0].suggested_path.startsWith('docs/architecture/ADR-'), true);
  assert.equal(task.recovery_drafts[0].graph_evidence.matched_files.includes('src/lib/auth/session.ts'), true);
});

test('story derive creates stories for code surfaces that have no spec documents', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'detail'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'settings'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'hotel'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'actions'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'crawlers'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'health'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'manager'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'detail', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'settings', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'components', 'hotel', 'HotelDetail.tsx'), 'export function HotelDetail() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'actions', 'hotel_actions.ts'), 'export async function getHotel() {}\n');
  await writeFile(path.join(repo, 'src', 'lib', 'crawlers', 'orchestrator.ts'), 'export async function crawl() {}\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'health', 'route.ts'), 'export function GET() {}\n');
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'manager', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'hotel_detail_file', source_file: 'src/components/hotel/HotelDetail.tsx', label: 'HotelDetail.tsx' },
      { id: 'hotel_detail_component', source_file: 'src/components/hotel/HotelDetail.tsx', label: 'HotelDetail()' },
      { id: 'manager_page_file', source_file: 'src/app/(app)/manager/page.tsx', label: 'page.tsx' },
      { id: 'settings_page_file', source_file: 'src/app/(app)/settings/page.tsx', label: 'page.tsx' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const hotelDetailStory = catalog.stories.find((story) => story.story_id === 'story-product-hotel-detail-actions');
  const crawlerStory = catalog.stories.find((story) => story.story_id === 'story-ops-hotel-data-ingestion');

  assert.equal(Boolean(hotelDetailStory), true);
  assert.equal(hotelDetailStory.source.type, 'code_surface');
  assert.equal(hotelDetailStory.source.paths.includes('src/components/hotel/HotelDetail.tsx'), true);
  assert.equal(hotelDetailStory.derived.open_questions.some((item) => item.field === 'missing_spec'), true);
  assert.match(hotelDetailStory.derived.story_definition.problem, /ホテル詳細/);
  assert.equal(hotelDetailStory.derived.meaning.user_actor.confidence, 'medium');
  assert.equal(hotelDetailStory.derived.meaning.counter_evidence.some((item) => item.includes('コードからの逆算')), true);
  assert.equal(hotelDetailStory.derived.meaning.evidence_by_type.code_evidence.includes('src/components/hotel/HotelDetail.tsx'), true);
  assert.equal(Boolean(crawlerStory), true);
  assert.equal(crawlerStory.source.type, 'code_surface');
  assert.match(crawlerStory.derived.story_definition.business_value, /検索品質/);
  assert.equal(catalog.coverage.status, 'warn');
  assert.equal(catalog.coverage.uncovered.some((item) => item.path === 'src/app/(app)/manager/page.tsx'), false);
  assert.equal(catalog.coverage.uncovered.some((item) => item.path === 'src/app/(app)/settings/page.tsx'), true);
  assert.equal(catalog.coverage.uncovered.some((item) => item.path === 'src/components/hotel/HotelDetail.tsx'), false);

  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /ホテル詳細と予約前アクションを成立させる/);
  assert.match(map, /付録: Graph Coverage/);
  assert.match(map, /src\/app\/\(app\)\/settings\/page\.tsx/);
  assert.match(map, /コード上は機能面が確認できるが、対応するStory、要求、仕様書が見つからない/);
});

test('story derive links local management story docs to code surface stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'detail'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'hotel'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'story-product-hotel-detail-actions.md'), `---
story_id: story-product-hotel-detail-actions
title: ホテル詳細と予約前アクションを成立させる
status: active
view: business
horizon: month
period: 2026Q2
---

# ホテル詳細と予約前アクションを成立させる

ホテル候補を比較して次の行動を決めたいユーザーが、詳細、プラン、問い合わせを同じ流れで判断できるようにする。

## 誰のため

宿泊先を比較しながら、予約前に問い合わせやプラン確認まで進みたい旅行者。

## 課題

ホテル詳細、料金、問い合わせ先が分断されると、旅行者は判断材料を集め直す必要があり予約前に離脱する。

## 望む変化

詳細画面からプラン確認、問い合わせ、外部遷移へ迷わず進める。

## 成果

ホテル詳細が予約前の比較判断と次アクションの中心になる。

## 事業価値

予約導線到達率と問い合わせ発生率の改善につながる。

## 受け入れ基準

- ホテル情報とプランが一貫して表示される
- 問い合わせや外部遷移の失敗時の扱いが決まる
`);
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'detail', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'components', 'hotel', 'HotelDetail.tsx'), 'export function HotelDetail() { return null; }\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const story = catalog.stories.find((item) => item.story_id === 'story-product-hotel-detail-actions');

  assert.equal(Boolean(story), true);
  assert.equal(story.source.paths.includes('docs/management/stories/active/story-product-hotel-detail-actions.md'), true);
  assert.equal(story.view, 'business');
  assert.equal(story.horizon, 'month');
  assert.equal(story.period, '2026Q2');
  assert.equal(story.derived.open_questions.some((item) => item.field === 'missing_spec'), false);
  assert.equal(story.derived.meaning.evidence_by_type.docs_evidence.includes('docs/management/stories/active/story-product-hotel-detail-actions.md'), true);
  assert.equal(story.derived.meaning.user_actor.confidence, 'high');
  assert.equal(story.derived.story_definition.who, '宿泊先を比較しながら、予約前に問い合わせやプラン確認まで進みたい旅行者。');
  assert.match(story.derived.story_definition.problem, /予約前に離脱/);
  assert.match(story.derived.story_definition.want, /迷わず進める/);
  assert.match(story.derived.story_definition.outcome, /次アクションの中心/);
  assert.match(story.derived.story_definition.business_value, /問い合わせ発生率/);
  assert.equal(story.derived.story_definition.acceptance_focus.includes('問い合わせや外部遷移の失敗時の扱いが決まる'), true);
  assert.equal(story.derived.story_definition.source_synthesis.some((item) => item.path === 'docs/management/stories/active/story-product-hotel-detail-actions.md'), true);
});

test('story derive does not create map search story from hotel detail code alone', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'components', 'hotel'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'hotel', 'HotelDetail.tsx'), 'export function HotelDetail() { return null; }\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-hotel-detail-actions'), true);
  assert.equal(catalog.stories.some((story) => story.story_id === 'story-product-hotel-map-search'), false);
});

test('story coverage keeps all uncovered graph files in the catalog', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'unmapped'), { recursive: true });
  const nodes = [];
  for (let index = 0; index < 55; index += 1) {
    await mkdir(path.join(repo, 'src', 'app', '(app)', 'unmapped', String(index)), { recursive: true });
    const filePath = `src/app/(app)/unmapped/${index}/page.tsx`;
    await writeFile(path.join(repo, filePath), 'export default function Page() { return null; }\n');
    nodes.push({ id: `unmapped_${index}`, source_file: filePath, label: 'page.tsx' });
  }
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links: [] }));

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.coverage.totals.uncovered_files, 55);
  assert.equal(catalog.coverage.uncovered.length, 55);
});

test('story derive does not overwrite existing story ids', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-product-hotel-map-search', '--title', '既存の地図検索Story']);
  await mkdir(path.join(repo, 'docs', 'user_stories', 'active'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'user_stories', 'active', 'US-001_map_search_display.md'), '# 新しいタイトル\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.skipped_count >= 1, true);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-hotel-map-search').title, '既存の地図検索Story');
});

test('story derive archives obsolete document-index stories from previous derive runs', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-product-api-specification', '--title', 'Shadow Call API 仕様書']);
  await runCli(['story', 'add', repo, '--id', 'story-product-us-001-map-search-display', '--title', 'US-001: MAP画面での詳細検索結果表示']);
  await mkdir(path.join(repo, '.vibepro', 'stories'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'), JSON.stringify({
    stories: [
      { story_id: 'story-product-api-specification', title: 'Shadow Call API 仕様書' },
      { story_id: 'story-product-us-001-map-search-display', title: 'US-001: MAP画面での詳細検索結果表示' }
    ]
  }));
  await mkdir(path.join(repo, 'docs', 'features'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'features', 'shadow-call-system.md'), '# Shadow Call システム仕様書\n');

  const result = await runCli(['story', 'derive', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.archived_count, 2);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-api-specification').status, 'archived');
  assert.equal(config.brainbase.stories.find((story) => story.story_id === 'story-product-us-001-map-search-display').status, 'archived');
  assert.equal(config.brainbase.stories.some((story) => story.story_id === 'story-product-shadow-call' && story.status === 'active'), true);
});

test('brainbase import uses selected local story and excludes archived stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-active-local', '--title', 'Active Local', '--view', 'dev']);
  await runCli(['story', 'add', repo, '--id', 'story-archived-local', '--title', 'Archived Local', '--view', 'dev']);
  await runCli(['story', 'select', repo, '--id', 'story-active-local']);
  await runCli(['story', 'archive', repo, '--id', 'story-archived-local']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T235900Z']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.story.story_id, 'story-active-local');
  assert.equal(importState.story.ssot, 'local');
  assert.equal(importState.stories.some((story) => story.story_id === 'story-archived-local'), false);
});

test('pr prepare writes PR artifacts for the selected story', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'management', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'feature'), { recursive: true });
  await mkdir(path.join(repo, 'tests', 'unit'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'STR-001-pr-prepare.md'), `---
story_id: STR-001
title: PR準備の文脈を厚くする
source:
  type: bug
  id: BUG-001
  url: https://noco.example.test/bug/1
  title: PR本文に背景が出ない
architecture_docs:
  - path: N/A
    status: not_required
    reason: 既存のPR準備出力の改善で対応できるため
---

# ストーリー: PR準備の文脈を厚くする

## 背景

PR本文がファイル数だけでは、レビュアーがなぜこの変更を読むべきか判断できない。

## 受け入れ基準

- [x] PR本文に背景が入る
- [x] PR本文にADR判断が入る
- [x] PR本文に検証候補が入る
`);
  await writeFile(path.join(repo, 'docs', 'management', 'architecture', 'ADR-001-pr-prepare.md'), '# ADR');
  await writeFile(path.join(repo, 'src', 'feature', 'pr-prepare.js'), 'export const ok = true;\n');
  await writeFile(path.join(repo, 'src', 'feature', 'pr-prepare.test.js'), 'export const ok = true;\n');
  await writeFile(path.join(repo, 'tests', 'unit', 'pr-prepare.test.js'), 'export const ok = true;\n');
  await mkdir(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'tasks.json'), JSON.stringify({
    schema_version: '0.1.0',
    generated_at: '2026-04-30T00:00:00.000Z',
    story: {
      story_id: 'story-pr-prepare',
      title: 'PR準備'
    },
    source_run: {
      run_id: 'story-plan',
      gate_status: 'pass'
    },
    tasks: [{
      id: 'TASK-001',
      source_type: 'story_plan_candidate',
      source_id: 'TASK-001',
      title: 'PR準備Task',
      priority: 'high',
      status: 'todo',
      execution_policy: 'proposal_only',
      mutates_repository: false,
      target_count: 1,
      target_files: ['src/feature/pr-prepare.js'],
      target_routes: [],
      target_groups: [],
      read_first_files: [{ file: 'src/feature/pr-prepare.js', reason: '対象実装' }],
      recommended_strategy: { id: 'task-driven-pr', reason: 'Task/HandoffとPRを接続する' },
      implementation_steps: [],
      acceptance_criteria: ['Task/HandoffがPR本文に入る'],
      graph_context: null,
      pre_fix_briefing: null
    }]
  }));
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'briefing.json'), JSON.stringify({ mode: 'pre_fix_briefing' }));
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'briefing.md'), '# briefing');
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'plan.json'), JSON.stringify({ mode: 'implementation_plan' }));
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'plan.md'), '# plan');
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'handoff.json'), JSON.stringify({ mode: 'implementation_handoff' }));
  await writeFile(path.join(repo, '.vibepro', 'stories', 'story-pr-prepare', 'tasks', 'TASK-001', 'handoff.md'), '# handoff');
  await mkdir(path.join(repo, '.vibepro', 'diagnostics', 'run-refactoring-delta'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'diagnostics', 'run-refactoring-delta', 'evidence.json'), JSON.stringify({
    run_id: 'run-refactoring-delta',
    refactoring_delta: {
      schema_version: '0.1.0',
      status: 'available',
      before_run_id: 'run-before',
      after_run_id: 'run-refactoring-delta',
      summary: {
        total_before: 1,
        total_after: 1,
        improved: 1,
        removed: 0,
        regressed: 0,
        new: 0,
        unchanged: 0
      },
      top_improvements: [{
        key: 'duplicate_query_shape:t_UserInfo.findFirst|top:nextAuthUserId,where|where:nextAuthUserId|select:-|order:-',
        title: 'user identity lookupの重複query形状を共通化する',
        refactoring_intent: 'query_policy',
        before: {
          target_file_count: 5,
          occurrence_count: 8,
          rank: 1,
          score_total: 12
        },
        after: {
          target_file_count: 3,
          occurrence_count: 5,
          rank: 1,
          score_total: 8
        },
        target_files_removed: ['src/features/accounts/actions.ts', 'src/features/groups/actions.ts'],
        target_files_added: [],
        status: 'improved'
      }],
      top_regressions: [],
      top_remaining: [{
        key: 'duplicate_query_shape:t_UserInfo.update|top:Id,data,where|where:Id|select:-|order:-',
        title: 'user identity updateの重複query形状を共通化する',
        refactoring_intent: 'identity_resolution',
        after: {
          target_file_count: 3,
          occurrence_count: 5,
          rank: 2,
          score_total: 10
        },
        target_files_after: ['src/features/accounts/actions.ts', 'src/features/groups/actions.ts', 'src/features/profile/actions.ts'],
        status: 'unchanged'
      }],
      items: []
    }
  }, null, 2));
  const manifestWithDelta = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  manifestWithDelta.latest_run = 'run-refactoring-delta';
  manifestWithDelta.latest_run_by_story = {
    ...(manifestWithDelta.latest_run_by_story ?? {}),
    'story-pr-prepare': 'run-refactoring-delta'
  };
  manifestWithDelta.runs = [{
    run_id: 'run-refactoring-delta',
    story_id: 'story-pr-prepare',
    gate_status: 'pass',
    artifacts: {
      evidence: '.vibepro/diagnostics/run-refactoring-delta/evidence.json'
    }
  }, ...(manifestWithDelta.runs ?? [])];
  await writeFile(path.join(repo, '.vibepro', 'vibepro-manifest.json'), `${JSON.stringify(manifestWithDelta, null, 2)}\n`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: add pr prepare target']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--task', 'TASK-001']);

  assert.equal(result.exitCode, 0);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  assert.equal(prepare.story.story_id, 'story-pr-prepare');
  assert.equal(prepare.task_context.task.id, 'TASK-001');
  assert.equal(prepare.task_context.artifacts.handoff_json, '.vibepro/stories/story-pr-prepare/tasks/TASK-001/handoff.json');
  assert.equal(prepare.scope.status, 'reviewable');
  assert.equal(prepare.file_groups.story_docs.count, 1);
  assert.equal(prepare.file_groups.architecture_docs.count, 1);
  assert.equal(prepare.file_groups.source.count, 1);
  assert.equal(prepare.file_groups.tests.count, 2);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /story-pr-prepare/);
  assert.match(prBody, /## 背景・要求/);
  assert.match(prBody, /PR本文がファイル数だけでは/);
  assert.match(prBody, /ADRあり \(docs\/management\/architecture\/ADR-001-pr-prepare.md\)/);
  assert.match(prBody, /PR本文に背景が入る/);
  assert.match(prBody, /npm test -- --runTestsByPath src\/feature\/pr-prepare.test.js tests\/unit\/pr-prepare.test.js --runInBand/);
  assert.match(prBody, /npm run typecheck/);
  assert.match(prBody, /## 要件整合性/);
  assert.match(prBody, /Requirement Gate: not_applicable/);
  assert.match(prBody, /## Gate DAG/);
  assert.match(prBody, /## Gate Enforcement/);
  assert.match(prBody, /blocked_by_gate/);
  assert.match(prBody, /生の `gh pr create` はVibePro Gateを通らない/);
  assert.match(prBody, /## VibePro refactoring delta/);
  assert.match(prBody, /5ファイル \/ 8出現 -> 3ファイル \/ 5出現/);
  assert.match(prBody, /### 次の候補/);
  assert.match(prBody, /3ファイル \/ 5出現/);
  assert.match(prBody, /## Task \/ Handoff/);
  assert.match(prBody, /TASK-001 PR準備Task/);
  assert.match(prBody, /Task\/HandoffがPR本文に入る/);
  assert.match(prBody, /E2E Gate: needs_setup \(required\) - `npx playwright test`/);
  assert.equal(prepare.pr_context.story_source.requirement_id, 'BUG-001');
  assert.equal(prepare.pr_context.verification_commands.length, 2);
  assert.equal(prepare.pr_context.gate_dag.overall_status, 'needs_verification');
  assert.equal(prepare.pr_context.refactoring_delta.status, 'available');
  assert.equal(prepare.pr_context.refactoring_delta.top_remaining.length, 1);
  assert.equal(prepare.pr_context.gate_dag.summary.acceptance_criteria_count, 3);
  assert.equal(prepare.pr_context.gate_dag.summary.requirement_status, 'not_applicable');
  assert.equal(prepare.pr_context.gate_dag.nodes.some((node) => node.id === 'gate:requirement'), true);
  assert.equal(prepare.pr_context.gate_dag.nodes.some((node) => node.id === 'gate:e2e'), true);
  assert.equal(prepare.pr_context.review_points.some((point) => point.includes('TASK-001')), true);
  const gateDag = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.json'));
  assert.equal(gateDag.model, 'story-acceptance-verification-dag');
  assert.equal(gateDag.edges.some((edge) => edge.from === 'ac:1' && edge.to === 'gate:e2e'), true);
  assert.match(await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'gate-dag.md'), 'utf8'), /VibePro Gate DAG/);
  assert.equal(prepare.next_commands.some((command) => command.startsWith('gh pr create')), false);
  assert.equal(prepare.next_commands.some((command) => command.includes('vibepro pr create')), true);

  // gate guard: flag無しなら needs_verification で拒否される
  let stderrOutput = '';
  const blockedResult = await runCli(['pr', 'create', repo, '--base', 'main', '--task', 'TASK-001', '--dry-run'], {
    stderr: { write: (text) => { stderrOutput += text; } }
  });
  assert.equal(blockedResult.exitCode, 1);
  assert.match(stderrOutput, /Pre-create gate check failed/);
  assert.match(stderrOutput, /needs_verification/);
  assert.match(stderrOutput, /--verification-waiver <reason>/);

  // --allow-needs-verification だけでは通らず、理由付きwaiverを要求する
  let waiverStderrOutput = '';
  const missingWaiverResult = await runCli(['pr', 'create', repo, '--base', 'main', '--task', 'TASK-001', '--dry-run', '--allow-needs-verification'], {
    stderr: { write: (text) => { waiverStderrOutput += text; } }
  });
  assert.equal(missingWaiverResult.exitCode, 1);
  assert.match(waiverStderrOutput, /Pre-create gate waiver missing/);

  // --allow-needs-verification と --verification-waiver を渡せば監査証跡付きで通る
  const createResult = await runCli([
    'pr',
    'create',
    repo,
    '--base',
    'main',
    '--task',
    'TASK-001',
    '--dry-run',
    '--allow-needs-verification',
    '--verification-waiver',
    'UI影響のないPR本文生成テストのためE2Eは対象外'
  ]);
  assert.equal(createResult.exitCode, 0);
  assert.equal(createResult.result.execution.dry_run, true);
  assert.equal(createResult.result.execution.gate_override.allowed, true);
  assert.equal(createResult.result.execution.gate_override.reason, 'UI影響のないPR本文生成テストのためE2Eは対象外');
  assert.equal(createResult.result.execution.task_context.task.id, 'TASK-001');
  assert.equal(createResult.result.execution.base, 'main');
  assert.equal(createResult.result.execution.head, 'feature/test-story');
  assert.equal(createResult.result.execution.commands.some((command) => command.includes('git push -u origin feature/test-story')), true);
  assert.equal(createResult.result.execution.commands.some((command) => command.includes('gh pr create')), true);
  const prCreate = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-create.json'));
  assert.equal(prCreate.mode, 'pr_create');
  assert.equal(prCreate.dry_run, true);
  assert.equal(prCreate.gate_override.allowed, true);
  assert.match(await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-create.md'), 'utf8'), /Gate Override/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.pr_creations['story-pr-prepare'].latest_create, '.vibepro/pr/story-pr-prepare/pr-create.json');

  const remote = await mkdtemp(path.join(os.tmpdir(), 'vibepro-remote-'));
  await git(remote, ['init', '--bare']);
  await git(repo, ['remote', 'add', 'origin', remote]);
  await git(repo, ['push', '-u', 'origin', 'main']);
  const binDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-gh-'));
  const ghBin = path.join(binDir, 'gh');
  await writeFile(ghBin, `#!/usr/bin/env node
if (process.argv[2] !== 'pr' || process.argv[3] !== 'create') {
  console.error('unexpected gh args: ' + process.argv.slice(2).join(' '));
  process.exit(1);
}
console.log('https://github.example.test/unson/vibepro/pull/123');
`);
  await chmod(ghBin, 0o755);
  const actualCreateResult = await runCli([
    'pr',
    'create',
    repo,
    '--base',
    'main',
    '--task',
    'TASK-001',
    '--title',
    'Test PR',
    '--allow-needs-verification',
    '--verification-waiver',
    'fixtureではGitHub作成経路だけを検証する'
  ], {
    env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}` }
  });
  assert.equal(actualCreateResult.exitCode, 0);
  assert.equal(actualCreateResult.result.execution.dry_run, false);
  assert.equal(actualCreateResult.result.execution.pr_url, 'https://github.example.test/unson/vibepro/pull/123');
  assert.equal(actualCreateResult.result.execution.results.length, 2);
});

test('pr prepare flags requirement contradictions from story invariants and code states', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, 'docs', 'management', 'stories', 'active'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(repo, 'docs', 'architecture'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'stripe', 'cancel-subscription'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'management', 'stories', 'active', 'STR-REQ-001-billing-cancel.md'), `---
story_id: STR-REQ-001
title: Stripe cancel keeps premium until period end
architecture_docs:
  - path: docs/architecture/ADR-billing-subscription.md
    status: required
specifications:
  - path: docs/specs/billing-subscription.md
---

# Stripe cancel keeps premium until period end

## 背景

Stripe subscription cancellation must keep premium access until current_period_end.

## 方針

キャンセル予約時は期間終了までプレミアム状態を維持する。

## 受け入れ基準

- [x] premium userType is kept until current_period_end
`);
  await writeFile(path.join(repo, 'docs', 'specs', 'billing-subscription.md'), `# Billing Subscription Spec

## Acceptance Criteria

- Subscription cancellation must keep premium access until current_period_end.
- Missing subscription must never downgrade a premium user before current_period_end.
`);
  await writeFile(path.join(repo, 'docs', 'architecture', 'ADR-billing-subscription.md'), `# Billing Subscription Boundary

## 方針

- Billing route must keep HTTP response mapping separate from subscription state transition policy.
- Subscription state transitions shall be handled in the billing service boundary.
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'stripe', 'cancel-subscription', 'route.ts'), `
export async function POST() {
  if (!subscriptionId) {
    return Response.json({ data: { userType: 1, message: 'free now' } });
  }
  return Response.json({ data: { userType: 2, currentPeriodEnd: '2026-06-01' } });
}
`);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'refactor: split billing cancel route']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main']);

  assert.equal(result.exitCode, 0);
  const prepare = await readJson(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-prepare.json'));
  assert.equal(prepare.pr_context.requirement_consistency.status, 'contradicted');
  assert.equal(prepare.pr_context.requirement_consistency.contradictions.length, 1);
  assert.equal(prepare.pr_context.requirement_consistency.requirement_sources.some((source) => source.kind === 'spec'), true);
  assert.equal(prepare.pr_context.requirement_consistency.requirement_sources.some((source) => source.kind === 'architecture'), true);
  assert.equal(prepare.pr_context.requirement_consistency.invariants.some((invariant) => invariant.source.kind === 'spec'), true);
  assert.equal(prepare.pr_context.requirement_consistency.invariants.some((invariant) => invariant.source.kind === 'architecture'), true);
  assert.equal(prepare.pr_context.gate_dag.summary.requirement_status, 'contradicted');
  assert.equal(prepare.pr_context.gate_dag.nodes.find((node) => node.id === 'gate:requirement').status, 'contradicted');
  assert.equal(prepare.pr_context.risks.some((risk) => risk.includes('Requirement Gate')), true);
  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', 'story-pr-prepare', 'pr-body.md'), 'utf8');
  assert.match(prBody, /Potential Contradiction/);
  assert.match(prBody, /Spec Sources: 1/);
  assert.match(prBody, /Architecture Sources: 1/);
  assert.match(prBody, /Requirement Source: spec:docs\/specs\/billing-subscription.md/);
  assert.match(prBody, /Requirement Source: architecture:docs\/architecture\/ADR-billing-subscription.md/);
  assert.match(prBody, /期間終了までpremium維持/);
});

test('pr prepare does not initialize or dirty an uninitialized PR branch', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: initial app']);
  await git(repo, ['switch', '-c', 'fix/form-zero-cta']);
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'feature.js'), 'export const fixed = true;\n');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'fix: hide zero cta']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', 'story-bug-147']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.preparation.workspace.initialized, false);
  assert.equal(result.result.preparation.workspace.artifact_location, 'temporary');
  assert.equal(result.result.preparation.story.story_id, 'story-bug-147');
  assert.equal(result.result.preparation.scope.status, 'reviewable');
  assert.equal(result.result.artifacts.json.startsWith(repo), false);
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
  await assert.rejects(stat(path.join(repo, '.vibeproignore')), { code: 'ENOENT' });
  const status = await git(repo, ['status', '--porcelain']);
  assert.equal(status.stdout, '');
});

test('pr prepare help does not run diagnostics or initialize the repository', async () => {
  const repo = await makeRepo();

  const result = await runCli(['pr', 'prepare', repo, '--help'], {
    stdout: { write: () => {} }
  });

  assert.equal(result.exitCode, 0);
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});

test('pr prepare recommends a clean branch for broad session diffs', async () => {
  const repo = await makeGitRepoWithStory();
  await mkdir(path.join(repo, '.claude', 'commands'), { recursive: true });
  await writeFile(path.join(repo, '.claude', 'commands', 'commit.md'), '# command');
  for (let index = 0; index < 5; index += 1) {
    await mkdir(path.join(repo, 'src', `feature-${index}`), { recursive: true });
    await writeFile(path.join(repo, 'src', `feature-${index}`, 'index.js'), `export const value = ${index};\n`);
  }
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'feat: broad session work']);

  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--max-files', '3']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.preparation.scope.status, 'needs_clean_branch');
  assert.equal(result.result.preparation.scope.recommended_strategy, 'clean_branch_or_split_pr');
  assert.equal(result.result.preparation.file_groups.repo_control.count, 1);
  assert.match(result.result.preparation.next_commands.join('\n'), /git switch -c feat\/pr-prepare main/);
});

test('story task generator groups admin API routes by domain', () => {
  const taskState = buildStoryTaskState({
    story: { story_id: 'story-admin-hardening', title: '管理API保護' },
    runId: '2026-04-30Tadmin-groups',
    gateStatus: 'block',
    evidence: {
      findings: [],
      action_candidates: [{
        id: 'VP-ACTION-API-001',
        finding_id: 'VP-API-001',
        title: '管理APIの保護境界を修正する',
        severity: 'High',
        execution_policy: 'proposal_only',
        mutates_repository: false,
        implementation_plan: {
          priority: 'high',
          read_first_files: [
            { file: 'src/app/api/admin/queue/status/route.ts', reason: 'queue status' },
            { file: 'src/app/api/admin/queue/obliterate/route.ts', reason: 'queue obliterate' },
            { file: 'src/app/api/admin/users/route.ts', reason: 'users' }
          ],
          acceptance_criteria: ['対象グループごとに保護根拠を確認できる'],
          pre_fix_briefing: {
            recommended_strategy: { id: 'route-level-auth', reason: 'middleware除外の影響を抑える' },
            target_routes: [
              {
                route_path: '/api/admin/queue/status',
                file: 'src/app/api/admin/queue/status/route.ts',
                methods: ['GET'],
                classification: 'admin'
              },
              {
                route_path: '/api/admin/queue/obliterate',
                file: 'src/app/api/admin/queue/obliterate/route.ts',
                methods: ['POST'],
                classification: 'admin'
              },
              {
                route_path: '/api/admin/users',
                file: 'src/app/api/admin/users/route.ts',
                methods: ['GET'],
                classification: 'admin'
              }
            ]
          }
        }
      }]
    }
  });

  const task = taskState.tasks[0];
  assert.equal(task.target_groups.length, 2);
  assert.deepEqual(task.target_groups.map((group) => group.id), ['queue', 'users']);
  assert.equal(task.target_groups.find((group) => group.id === 'queue').route_count, 2);
  assert.equal(task.target_groups.find((group) => group.id === 'users').route_count, 1);
  assert.equal(task.target_groups.find((group) => group.id === 'queue').read_first_files.length, 2);
});

test('api boundary treats authorization header with environment secret as route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'status'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'status', 'route.ts'), `
export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  const apiKey = process.env.SALESTAILOR_API_KEY;
  if (!authHeader || authHeader !== \`Bearer \${apiKey}\`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/admin/queue/status/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('route_auth_reference'), true);
  assert.equal(result.routes[0].risk_hints.includes('privileged_route_unprotected'), false);
});

test('api boundary follows imported auth helper references for route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'deals'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'deals', 'route.ts'), `
import { getUser } from '@/lib/get-user';

export async function GET() {
  const user = await getUser();
  if (!user || user.role !== 'ADMIN') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'get-user'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'get-user.ts'), `
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user;
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/admin/deals/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('route_auth_reference'), true);
  assert.equal(result.routes[0].protection.evidence.includes('imported_auth_helper'), true);
  assert.equal(result.routes[0].risk_hints.includes('privileged_route_unprotected'), false);
});

test('api boundary follows nested imported auth helper references for route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'inquiries'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'inquiries', 'route.ts'), `
import { verifyAdminAuth } from '@/lib/utils/admin-auth';

export async function GET() {
  const authResult = await verifyAdminAuth();
  if (!authResult.success) {
    return authResult.response;
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'utils'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'utils', 'admin-auth.ts'), `
import { getUser } from '@/lib/get-user';

export async function verifyAdminAuth() {
  const sessionUser = await getUser();
  if (!sessionUser || sessionUser.role !== 'ADMIN') {
    return { success: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { success: true, user: sessionUser };
}
`);
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'get-user.ts'), `
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

export async function getUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  return session?.user;
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/admin/inquiries/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('route_auth_reference'), true);
  assert.equal(result.routes[0].protection.evidence.includes('imported_auth_helper'), true);
  assert.equal(result.routes[0].risk_hints.includes('privileged_route_unprotected'), false);
});

test('api boundary follows imported debug access gate helpers for route protection', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'debug', 'session'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'debug', 'session', 'route.ts'), `
import { validateDebugAccess } from '@/lib/api/debug-access';

export async function GET() {
  const access = validateDebugAccess(await auth());
  if (access !== 'allowed') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'api'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'api', 'debug-access.ts'), `
export function validateDebugAccess(session, env = process.env) {
  if (env.NODE_ENV === 'production' || env.DEBUG_API_ENABLED !== 'true') {
    return 'disabled';
  }
  if (!session?.user?.id) {
    return 'unauthorized';
  }
  if (Number(session.user.userType) !== 9) {
    return 'forbidden';
  }
  return 'allowed';
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: ['src/app/api/debug/session/route.ts']
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  assert.equal(result.routes[0].protection.status, 'protected_by_route');
  assert.equal(result.routes[0].protection.evidence.includes('debug_access_gate'), true);
  assert.equal(result.routes[0].protection.evidence.includes('imported_debug_gate_helper'), true);
  assert.equal(result.routes[0].risk_hints.includes('debug_route_exposed'), false);
});

test('api boundary detects webhook signature checks for Svix and token based routes', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhooks', 'resend'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhooks', 'resend', 'route.ts'), `
import { Webhook } from 'svix';

export async function POST(request) {
  const webhook = new Webhook(process.env.RESEND_WEBHOOK_SECRET);
  const payload = await request.text();
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');
  webhook.verify(payload, {
    'svix-id': svixId ?? '',
    'svix-timestamp': svixTimestamp ?? '',
    'svix-signature': svixSignature ?? ''
  });
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhooks', 'timerex'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhooks', 'timerex', 'route.ts'), `
import { verifyTimerexWebhookSignature } from '@/lib/services/timerex';

export async function POST(request) {
  const webhookHeaderName = 'x-timerex-authorization';
  const expectedWebhookToken = process.env.TIMEREX_WEBHOOK_DEFAULT_TOKEN;
  const actualWebhookToken = request.headers.get(webhookHeaderName);
  if (!verifyTimerexWebhookSignature({ actualToken: actualWebhookToken, expectedToken: expectedWebhookToken })) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: [
          'src/app/api/webhooks/resend/route.ts',
          'src/app/api/webhooks/timerex/route.ts'
        ]
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  for (const route of result.routes) {
    assert.equal(route.protection.status, 'protected_by_route');
    assert.equal(route.protection.evidence.includes('webhook_signature_check'), true);
    assert.equal(route.risk_hints.includes('webhook_signature_not_detected'), false);
  }
});

test('api boundary follows imported provider webhook signature helpers', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'src', 'app', 'api', 'openai', 'webhook', 'response'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'openai', 'webhook', 'response', 'route.ts'), `
import { verifyOpenAIWebhook } from '@/lib/api/webhookSecurity';

export async function POST(request) {
  const rawBody = await request.text();
  const verification = await verifyOpenAIWebhook(request, rawBody);
  if (!verification.ok) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'twilio', 'webhook', 'voice'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'twilio', 'webhook', 'voice', 'route.ts'), `
import { verifyTwilioFormWebhook } from '@/lib/api/webhookSecurity';

export async function POST(request) {
  const formData = await request.formData();
  const verification = await verifyTwilioFormWebhook(request, formData);
  if (!verification.ok) {
    return Response.json({ error: 'invalid signature' }, { status: 401 });
  }
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'api'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'api', 'webhookSecurity.ts'), `
export async function verifyOpenAIWebhook(request, rawBody, env = process.env) {
  if (!env.OPENAI_WEBHOOK_SECRET) return { ok: false };
  const headers = Object.fromEntries(request.headers.entries());
  const client = {
    webhooks: {
      verifySignature: async () => true
    }
  };
  await client.webhooks.verifySignature(rawBody, headers, { secret: env.OPENAI_WEBHOOK_SECRET });
  return { ok: true };
}

export async function verifyTwilioFormWebhook(request, formData, env = process.env) {
  const signature = request.headers.get('x-twilio-signature');
  const twilio = {
    validateRequest: () => true
  };
  return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, request.url, Object.fromEntries(formData.entries()))
    ? { ok: true }
    : { ok: false };
}
`);

  const result = await scanApiBoundary(repo, {
    views: {
      runtime: {
        entrypoints: [
          'src/app/api/openai/webhook/response/route.ts',
          'src/app/api/twilio/webhook/voice/route.ts'
        ]
      },
      security: {
        auth_boundaries: []
      }
    }
  });

  for (const route of result.routes) {
    assert.equal(route.classification, 'webhook');
    assert.equal(route.protection.status, 'protected_by_route');
    assert.equal(route.protection.evidence.includes('webhook_signature_check'), true);
    assert.equal(route.protection.evidence.includes('imported_signature_helper'), true);
    assert.equal(route.protection.evidence.includes('imported_webhook_signature_helper'), true);
    assert.equal(route.risk_hints.includes('webhook_signature_not_detected'), false);
  }
});

test('task commands list show and create a pre-fix briefing without mutating repository code', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'status'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'status', 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'obliterate'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'queue', 'obliterate', 'route.ts'), 'export async function POST() { return Response.json({ ok: true }); }\n');
  await writeFile(path.join(repo, 'src', 'middleware.ts'), `
export const config = {
  matcher: ['/((?!api|_next/static).*)']
};
export function middleware() {}
`);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'queue-status', source_file: 'src/app/api/admin/queue/status/route.ts', community: 1 },
      { id: 'queue-obliterate', source_file: 'src/app/api/admin/queue/obliterate/route.ts', community: 1 }
    ],
    links: [{ source: 'queue-status', target: 'queue-obliterate', relation: 'same_domain', confidence: 'INFERRED' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', 'run-task-cli']);

  let listOutput = '';
  const listResult = await runCli(['task', 'list', repo], {
    stdout: { write: (text) => { listOutput += text; } }
  });
  assert.equal(listResult.exitCode, 0);
  assert.match(listOutput, /# Story Tasks/);
  assert.match(listOutput, /VP-TASK-API-001/);
  assert.match(listOutput, /queue\(2\)/);

  let showOutput = '';
  const showResult = await runCli(['task', 'show', repo, '--task', 'VP-TASK-API-001'], {
    stdout: { write: (text) => { showOutput += text; } }
  });
  assert.equal(showResult.exitCode, 0);
  assert.match(showOutput, /## Target Groups/);
  assert.match(showOutput, /queue/);

  const briefResult = await runCli(['task', 'brief', repo, '--task', 'VP-TASK-API-001', '--group', 'queue']);
  assert.equal(briefResult.exitCode, 0);
  assert.equal(briefResult.result.briefing.task.id, 'VP-TASK-API-001');
  assert.equal(briefResult.result.briefing.group.id, 'queue');
  assert.equal(briefResult.result.briefing.mutates_repository, false);
  assert.equal(briefResult.result.artifacts.markdown, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/briefing.md');
  const briefingJson = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'briefing.json'));
  assert.equal(briefingJson.target_routes.length, 2);
  assert.equal(briefingJson.read_first_files.some((item) => item.file === 'src/app/api/admin/queue/status/route.ts'), true);
  assert.equal(briefingJson.guardrails.includes('このCLIは対象リポジトリのコードを修正しない'), true);
  const briefingMarkdown = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'briefing.md'), 'utf8');
  assert.match(briefingMarkdown, /# 修正前ブリーフィング/);
  assert.match(briefingMarkdown, /このCLIは対象リポジトリのコードを修正しない/);
  assert.match(briefingMarkdown, /\/api\/admin\/queue\/status/);

  const planResult = await runCli(['task', 'plan', repo, '--task', 'VP-TASK-API-001', '--group', 'queue']);
  assert.equal(planResult.exitCode, 0);
  assert.equal(planResult.result.plan.mode, 'implementation_plan');
  assert.equal(planResult.result.plan.execution.cli_mutates_repository, false);
  assert.equal(planResult.result.plan.execution.plan_allows_repository_changes, true);
  assert.equal(planResult.result.plan.target_files.length, 2);
  assert.equal(planResult.result.artifacts.markdown, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/plan.md');
  const planJson = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'plan.json'));
  assert.equal(planJson.verification_commands.some((command) => command.command === 'npx vibepro diagnose . --run-id verify-VP-TASK-API-001-queue'), true);
  assert.equal(planJson.rollback_considerations.some((item) => item.includes('対象ファイル単位')), true);
  const planMarkdown = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'plan.md'), 'utf8');
  assert.match(planMarkdown, /# 実装修正計画/);
  assert.match(planMarkdown, /このplanは修正可能な作業計画/);
  assert.match(planMarkdown, /CLI自身は対象リポジトリのコードを変更しない/);

  const handoffResult = await runCli(['task', 'handoff', repo, '--task', 'VP-TASK-API-001', '--group', 'queue']);
  assert.equal(handoffResult.exitCode, 0);
  assert.equal(handoffResult.result.handoff.mode, 'implementation_handoff');
  assert.equal(handoffResult.result.handoff.execution.vibepro_mutates_repository, false);
  assert.equal(handoffResult.result.handoff.execution.recipient_may_mutate_repository, true);
  assert.equal(handoffResult.result.handoff.references.briefing_json, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/briefing.json');
  assert.equal(handoffResult.result.handoff.references.plan_json, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/plan.json');
  assert.equal(handoffResult.result.artifacts.markdown, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/handoff.md');
  const handoffJson = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'handoff.json'));
  assert.equal(handoffJson.target_files.length, 2);
  assert.equal(handoffJson.target_routes[0].protection_status, 'excluded_by_middleware');
  assert.equal(handoffJson.current_protection.route_statuses.excluded_by_middleware, 2);
  assert.equal(handoffJson.expected_fix_signals.includes('対象routeのprotection_statusがprotected_by_routeまたはprotected_by_middlewareになる'), true);
  assert.equal(handoffJson.environment_assumptions.some((item) => item.includes('npx vibepro')), true);
  assert.equal(handoffJson.implementation_instructions.some((item) => item.includes('plan.md')), true);
  assert.equal(handoffJson.prohibited_actions.some((item) => item.includes('対象グループ外')), true);
  const handoffMarkdown = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'handoff.md'), 'utf8');
  assert.match(handoffMarkdown, /# 実装依頼パッケージ/);
  assert.match(handoffMarkdown, /VibeProは実装を実行しない/);
  assert.match(handoffMarkdown, /修正はhandoffを受けた人間\/AIが行う/);
  assert.match(handoffMarkdown, /## 対象route/);
  assert.match(handoffMarkdown, /protection=excluded_by_middleware/);
  assert.match(handoffMarkdown, /## 期待する修正後シグナル/);
  assert.match(handoffMarkdown, /npx vibepro/);

  const executionResult = await runCli(['task', 'execute', repo, '--task', 'VP-TASK-API-001', '--group', 'queue', '--base', 'origin/develop']);
  assert.equal(executionResult.exitCode, 0);
  assert.equal(executionResult.result.execution.mode, 'task_execution_session');
  assert.equal(executionResult.result.execution.execution.vibepro_mutates_repository, false);
  assert.equal(executionResult.result.execution.execution.implementation_agent_may_mutate_repository, true);
  assert.equal(executionResult.result.execution.commands.pr_prepare, 'npx vibepro pr prepare . --story-id story-vibepro-diagnosis-commercialization-roadmap --task VP-TASK-API-001 --group queue --base origin/develop');
  assert.equal(executionResult.result.execution.commands.pr_create, 'npx vibepro pr create . --story-id story-vibepro-diagnosis-commercialization-roadmap --task VP-TASK-API-001 --group queue --base origin/develop');
  assert.equal(executionResult.result.execution.phases.some((phase) => phase.id === 'prepare_pr'), true);
  const executionJson = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'execution.json'));
  assert.equal(executionJson.references.handoff_json, '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/VP-TASK-API-001/groups/queue/handoff.json');
  const executionMarkdown = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'VP-TASK-API-001', 'groups', 'queue', 'execution.md'), 'utf8');
  assert.match(executionMarkdown, /# 実行セッション/);
  assert.match(executionMarkdown, /PR接続/);
});

test('diagnose binds runs to selected story and brainbase prefers the selected story run', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev']);
  await runCli(['story', 'add', repo, '--id', 'story-beta', '--title', 'Beta', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);
  await runCli(['diagnose', repo, '--run-id', 'run-alpha']);
  await runCli(['story', 'select', repo, '--id', 'story-beta']);
  await runCli(['diagnose', repo, '--run-id', 'run-beta']);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  const alphaEvidence = await readJson(path.join(repo, '.vibepro', 'diagnostics', 'run-alpha', 'evidence.json'));
  assert.equal(alphaEvidence.story_id, 'story-alpha');
  assert.equal(alphaEvidence.story.story_id, 'story-alpha');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run, 'run-beta');
  assert.equal(manifest.runs[0].story_id, 'story-beta');
  assert.equal(manifest.runs[1].story_id, 'story-alpha');
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.story.story_id, 'story-alpha');
  assert.equal(importState.latest_run.run_id, 'run-alpha');
  assert.equal(importState.latest_run.story_id, 'story-alpha');
  assert.equal(manifest.brainbase.last_export.story_id, 'story-alpha');
  assert.equal(manifest.brainbase.last_export.latest_run_story_id, 'story-alpha');
});

test('story runs and status show selected story diagnosis history', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev']);
  await runCli(['story', 'add', repo, '--id', 'story-beta', '--title', 'Beta', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);
  await runCli(['diagnose', repo, '--run-id', 'run-alpha']);
  await runCli(['story', 'select', repo, '--id', 'story-beta']);
  await runCli(['diagnose', repo, '--run-id', 'run-beta']);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);

  let runsOutput = '';
  const runsResult = await runCli(['story', 'runs', repo], {
    stdout: { write: (text) => { runsOutput += text; } }
  });

  assert.equal(runsResult.exitCode, 0);
  assert.equal(runsResult.result.story.story_id, 'story-alpha');
  assert.equal(runsResult.result.runs.length, 1);
  assert.match(runsOutput, /run-alpha/);
  assert.doesNotMatch(runsOutput, /run-beta/);

  let statusOutput = '';
  const statusResult = await runCli(['story', 'status', repo], {
    stdout: { write: (text) => { statusOutput += text; } }
  });

  assert.equal(statusResult.exitCode, 0);
  assert.equal(statusResult.result.story.story_id, 'story-alpha');
  assert.equal(statusResult.result.latestRun.run_id, 'run-alpha');
  assert.equal(statusResult.result.findingCount, 0);
  assert.match(statusOutput, /Story ID \| story-alpha/);
  assert.match(statusOutput, /Latest run \| run-alpha/);
  assert.match(statusOutput, /Gate \| pass/);
  assert.match(statusOutput, /Findings \| 0/);
  assert.match(statusOutput, /\.vibepro\/diagnostics\/run-alpha\/evidence.json/);
});

test('story report creates a Story diagnosis report artifact', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev', '--period', '2026-W18']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['story', 'select', repo, '--id', 'story-alpha']);
  await runCli(['diagnose', repo, '--run-id', 'run-alpha']);

  const result = await runCli(['story', 'report', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.story.story_id, 'story-alpha');
  assert.equal(result.result.reportPath.endsWith(path.join('.vibepro', 'stories', 'story-alpha', 'story-report.md')), true);
  const report = await readFile(path.join(repo, '.vibepro', 'stories', 'story-alpha', 'story-report.md'), 'utf8');
  assert.match(report, /# Story診断レポート/);
  assert.match(report, /Story ID \| story-alpha/);
  assert.match(report, /Run ID \| run-alpha/);
  assert.match(report, /Gate \| needs_review/);
  assert.match(report, /graphify nodes \| 2/);
  assert.match(report, /VP-GRAPH-001/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.stories['story-alpha'].latest_report, '.vibepro/stories/story-alpha/story-report.md');
});

test('story diagnose runs the local story workflow in one command', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'add', repo, '--id', 'story-alpha', '--title', 'Alpha', '--view', 'dev']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  let output = '';

  const result = await runCli(['story', 'diagnose', repo, '--id', 'story-alpha', '--run-id', 'run-alpha'], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.result.story.story_id, 'story-alpha');
  assert.equal(result.result.diagnosis.run.run_id, 'run-alpha');
  assert.match(output, /Story selected: story-alpha/);
  assert.match(output, /graphify artifacts imported/);
  assert.match(output, /diagnosis created/);
  assert.match(output, /Story report created/);
  assert.match(output, /# Story Status/);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.equal(config.brainbase.current_story_id, 'story-alpha');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run_by_story['story-alpha'], 'run-alpha');
  assert.equal(manifest.stories['story-alpha'].latest_report, '.vibepro/stories/story-alpha/story-report.md');
});

test('diagnose preserves plan-derived story tasks and writes run tasks separately', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await mkdir(path.join(repo, 'src', 'app', '(app)', 'detail'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'components', 'hotel'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', '(app)', 'detail', 'page.tsx'), 'export default function Page() { return null; }\n');
  await writeFile(path.join(repo, 'src', 'components', 'hotel', 'HotelDetail.tsx'), 'export function HotelDetail() { return null; }\n');
  await mkdir(path.join(repo, '.vibepro', 'graphify'), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'detail', source_file: 'src/components/hotel/HotelDetail.tsx' }],
    edges: [{ source: 'detail', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await runCli(['story', 'derive', repo]);
  await runCli(['story', 'plan', repo]);
  await runCli(['task', 'create', repo, '--from-plan', '--id', 'story-product-hotel-detail-actions']);
  const canonicalTasksPath = path.join(repo, '.vibepro', 'stories', 'story-product-hotel-detail-actions', 'tasks', 'tasks.json');
  const beforeTasks = await readJson(canonicalTasksPath);
  assert.equal(beforeTasks.source_run.run_id, 'story-plan');
  assert.equal(beforeTasks.tasks.some((task) => task.id === 'story-product-hotel-detail-actions-spec-recovery'), true);

  await runCli(['story', 'select', repo, '--id', 'story-product-hotel-detail-actions']);
  await runCli(['diagnose', repo, '--run-id', 'run-detail']);

  const afterTasks = await readJson(canonicalTasksPath);
  assert.equal(afterTasks.source_run.run_id, 'story-plan');
  assert.equal(afterTasks.tasks.some((task) => task.id === 'story-product-hotel-detail-actions-spec-recovery'), true);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.runs[0].artifacts.story_tasks_json, '.vibepro/stories/story-product-hotel-detail-actions/diagnostics/run-detail/tasks.json');
  const runTasks = await readJson(path.join(repo, manifest.runs[0].artifacts.story_tasks_json));
  assert.equal(runTasks.source_run.run_id, 'run-detail');
  assert.equal(runTasks.tasks.some((task) => task.id === 'story-product-hotel-detail-actions-spec-recovery'), false);
});

test('status reports an uninitialized repository without creating a workspace', async () => {
  const repo = await makeRepo();
  let output = '';

  const result = await runCli(['status', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.initialized, false);
  assert.match(output, /# VibePro Status/);
  assert.match(output, /Initialized \| no/);
  assert.match(output, /vibepro init/);
  await assert.rejects(stat(path.join(repo, '.vibepro')), { code: 'ENOENT' });
});

test('status reports initialized repositories with no active stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  await runCli(['story', 'archive', repo, '--id', 'story-vibepro-diagnosis-commercialization-roadmap']);
  let output = '';

  const result = await runCli(['status', repo, '--json'], {
    stdout: { write: (text) => { output += text; } }
  });

  const status = JSON.parse(output);
  assert.equal(result.exitCode, 0);
  assert.equal(status.initialized, true);
  assert.equal(status.active_stories.length, 0);
  assert.match(status.next_commands[0], /story add/);
});

test('status surfaces doctor maintenance before the next workflow command', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-alpha', '--title', 'Alpha']);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.brainbase.current_story_id = 'missing-story';
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runCli(['status', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.doctor.overall_status, 'needs_maintenance');
  assert.equal(result.status.doctor.blocking_check_ids.includes('VP-DOCTOR-CURRENT-STORY-MISSING'), true);
  assert.equal(result.status.doctor.next_actions[0].command, `vibepro doctor ${repo} --fix`);
  assert.equal(result.status.next_commands[0], `vibepro doctor ${repo} --fix`);
  await assert.rejects(stat(path.join(repo, '.vibepro', 'doctor', 'doctor-result.json')), { code: 'ENOENT' });
});

test('status reports repository diagnosis state as text and json', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo, '--story-id', 'story-alpha', '--title', 'Alpha', '--view', 'dev', '--period', '2026-W18']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [{ source: 'app', target: 'api', relation: 'calls', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['story', 'diagnose', repo, '--id', 'story-alpha', '--run-id', 'run-alpha']);
  let output = '';

  const result = await runCli(['status', repo], {
    stdout: { write: (text) => { output += text; } }
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.status.initialized, true);
  assert.equal(result.status.current_story_id, 'story-alpha');
  assert.equal(result.status.latest_run.run_id, 'run-alpha');
  assert.equal(result.status.selected_story_latest_run.run_id, 'run-alpha');
  assert.equal(result.status.gate_status, 'needs_review');
  assert.equal(result.status.finding_count, 1);
  assert.match(output, /Selected Story \| story-alpha/);
  assert.match(output, /Latest Run \| run-alpha/);
  assert.match(output, /Selected Story Latest Run \| run-alpha/);
  assert.match(output, /Gate \| needs_review/);
  assert.match(output, /Findings \| 1/);
  assert.match(output, /story report/);

  let jsonOutput = '';
  const jsonResult = await runCli(['status', repo, '--json'], {
    stdout: { write: (text) => { jsonOutput += text; } }
  });
  const status = JSON.parse(jsonOutput);
  assert.equal(jsonResult.exitCode, 0);
  assert.equal(status.initialized, true);
  assert.equal(status.current_story_id, 'story-alpha');
  assert.equal(status.active_stories[0].story_id, 'story-alpha');
  assert.equal(status.latest_run.run_id, 'run-alpha');
  assert.equal(status.selected_story_latest_run.run_id, 'run-alpha');
  assert.equal(status.artifacts.evidence, '.vibepro/diagnostics/run-alpha/evidence.json');
});

test('diagnose creates a run, evidence, reports, and updates the manifest', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(graphDir, { recursive: true }));
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    links: [
      { source: 'app', target: 'api', relation: 'calls', confidence: 'EXTRACTED' },
      { source: 'api', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }
    ]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T120000Z']);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'diagnose');
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T120000Z');
  await stat(path.join(runDir, 'summary.md'));
  await stat(path.join(runDir, 'risk-register.md'));
  await stat(path.join(runDir, 'requirement-consistency.md'));
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.graphify.node_count, 2);
  assert.equal(evidence.graphify.edge_count, 2);
  assert.equal(evidence.graphify.edge_source_key, 'links');
  assert.equal(evidence.graphify.extracted_edges.length, 1);
  assert.equal(evidence.graphify.ambiguous_edges.length, 1);
  assert.equal(evidence.requirement_consistency.status, 'not_applicable');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run, '2026-04-28T120000Z');
  assert.equal(manifest.runs[0].artifacts.summary, '.vibepro/diagnostics/2026-04-28T120000Z/summary.md');
  assert.equal(manifest.runs[0].artifacts.requirement_consistency, '.vibepro/diagnostics/2026-04-28T120000Z/requirement-consistency.md');
});

test('diagnose creates static site evidence and a static site report under the run directory', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'index.html'), `<!doctype html>
<html>
  <head>
    <script src="https://cdn.example.com/app.js"></script>
  </head>
  <body>
    <script src="./app.js"></script>
  </body>
</html>
`);
  await writeFile(path.join(repo, 'app.js'), `
const apiKey = "sk-123456789012345678901234";
const access_token = "runtimeReviewToken123";
const secret_key = plainsecretvalue;
const api_key = request.headers.get('x-api-key');
const accessToken = body.access_token ?? null;
const callConfig = {
  authToken: twilioAuthToken,
  apiKey: openaiConfig.apiKey!,
  access_token: accessToken
};
FireCrawlApi(api_key=firecrawl_api_key);
document.body.innerHTML = location.hash;
eval("1+1");
`);
  await mkdir(path.join(repo, '.claude', 'skills', 'security-patterns'), { recursive: true });
  await writeFile(path.join(repo, '.claude', 'skills', 'security-patterns', 'SKILL.md'), `
Example:
const apiKey = process.env.EXAMPLE_API_KEY;
element.innerHTML = userInput;
`);
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'security.md'), 'Use API_KEY="st_api_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" in examples only.\n');
  await writeFile(path.join(repo, 'server.py'), 'print("not a static asset")\n');
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: []
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T130000Z']);

  assert.equal(result.exitCode, 0);
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T130000Z');
  await stat(path.join(runDir, 'static-site-check-result.md'));
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.static_site.has_index_html, true);
  assert.equal(evidence.static_site.secret_hits.length > 0, true);
  assert.equal(evidence.static_site.xss_risk_hits.length > 0, true);
  const runtimeSecret = evidence.static_site.secret_hits.find((hit) => hit.file === 'app.js');
  assert.equal(runtimeSecret.confidence, 'high');
  assert.equal(runtimeSecret.source_kind, 'runtime_code');
  assert.equal(runtimeSecret.gate_effect, 'block');
  const skillSecret = evidence.static_site.secret_hits.find((hit) => hit.file === '.claude/skills/security-patterns/SKILL.md');
  assert.equal(skillSecret.confidence, 'low');
  assert.equal(skillSecret.source_kind, 'agent_skill');
  assert.equal(skillSecret.gate_effect, 'info');
  const skillXss = evidence.static_site.xss_risk_hits.find((hit) => hit.file === '.claude/skills/security-patterns/SKILL.md');
  assert.equal(skillXss.confidence, 'low');
  assert.equal(skillXss.gate_effect, 'info');
  const dynamicSecrets = evidence.static_site.secret_hits.filter(
    (hit) => hit.file === 'app.js'
      && /request\.headers|body\.access_token|twilioAuthToken|openaiConfig\.apiKey|accessToken|firecrawl_api_key/.test(hit.excerpt)
  );
  assert.equal(dynamicSecrets.length, 6);
  assert.equal(dynamicSecrets.every((hit) => hit.gate_effect === 'info'), true);
  assert.equal(dynamicSecrets.every((hit) => hit.confidence === 'low'), true);
  const unquotedPlainSecret = evidence.static_site.secret_hits.find((hit) => hit.excerpt.includes('plainsecretvalue'));
  assert.equal(unquotedPlainSecret.gate_effect, 'review');
  assert.equal(unquotedPlainSecret.confidence, 'medium');
  assert.equal(evidence.static_site.risk_summary.secret_hits.block, 1);
  assert.equal(evidence.static_site.risk_summary.secret_hits.info, 8);
  assert.equal(evidence.static_site.risk_summary.xss_risk_hits.review, 2);
  assert.equal(evidence.static_site.risk_summary.xss_risk_hits.info, 1);
  assert.equal(evidence.static_site.external_resources.length > 0, true);
  assert.equal(evidence.static_site.non_static_files.some((item) => item.file === 'server.py'), true);
  assert.equal(evidence.gates[0].status, 'block');
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'tasks.json'));
  assert.equal(tasks.source_run.run_id, '2026-04-28T130000Z');
  assert.equal(tasks.source_run.gate_status, 'block');
  const secretBlockTask = tasks.tasks.find((task) => task.id === 'VP-TASK-STATIC-002-BLOCK');
  const secretReviewTask = tasks.tasks.find((task) => task.id === 'VP-TASK-STATIC-002-REVIEW');
  assert.equal(secretBlockTask.priority, 'critical');
  assert.equal(secretBlockTask.source_type, 'finding');
  assert.equal(secretBlockTask.target_files.includes('app.js'), true);
  assert.equal(secretBlockTask.gate_effect, 'block');
  assert.equal(secretBlockTask.order, 10);
  assert.equal(secretBlockTask.mutates_repository, false);
  assert.equal(secretReviewTask.priority, 'high');
  assert.equal(secretReviewTask.gate_effect, 'review');
  assert.equal(secretReviewTask.target_files.includes('app.js'), true);
  assert.match(await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'tasks.md'), 'utf8'), /VP-TASK-STATIC-002-BLOCK/);
  assert.match(await readFile(path.join(runDir, 'risk-register.md'), 'utf8'), /秘密情報/);
  assert.match(await readFile(path.join(runDir, 'static-site-check-result.md'), 'utf8'), /gate_effect/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(
    manifest.runs[0].artifacts.static_site_check,
    '.vibepro/diagnostics/2026-04-28T130000Z/static-site-check-result.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.story_tasks_json,
    '.vibepro/stories/story-vibepro-diagnosis-commercialization-roadmap/tasks/tasks.json'
  );
});

test('diagnose profiles a Next.js repository and selects applicable checks without static site entry findings', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-nextjs-test-'));
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: { dev: 'next dev', test: 'vitest' },
    dependencies: {
      next: '^15.0.0',
      react: '^19.0.0',
      '@prisma/client': '^6.0.0',
      pg: '^8.0.0'
    },
    devDependencies: {
      typescript: '^5.0.0',
      vitest: '^3.0.0'
    }
  }, null, 2));
  await mkdir(path.join(repo, 'src', 'app', 'api', 'companies'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'route.ts'), `
import { prisma } from '@/lib/db';

export async function GET() {
  const companies = await prisma.company.findMany({
    where: { active: true },
    orderBy: { createdAt: 'desc' }
  });
  return Response.json(companies);
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'accounts', '[id]'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'accounts', '[id]', 'route.ts'), `
import { prisma } from '@/lib/db';
import { auth } from '@/lib/auth';

export async function GET(request, { params }) {
  const session = await auth();
  if (!session) return Response.json({}, { status: 401 });
  const events = await prisma.auditLog.findMany({
    where: { accountId: params.id },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  const account = await prisma.account.findUnique({
    where: { id: params.id }
  });
  if (account.userId !== session.user.id) {
    return Response.json({ error: 'Access denied' }, { status: 403 });
  }
  return Response.json({ events });
}
`);
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'route.test.ts'), 'import test from "node:test";\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'helper.ts'), 'export const helper = true;\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'users'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'users', 'route.ts'), 'export async function GET() { return Response.json([]); }\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'admin', 'webhook-monitor'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'admin', 'webhook-monitor', 'route.ts'), 'export async function GET() { return Response.json([]); }\n');
  await mkdir(path.join(repo, 'src', 'app', 'api', 'debug-env'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'debug-env', 'route.ts'), `
// auth debug endpoint: the word auth alone must not count as protection.
export async function GET() { return Response.json(process.env); }
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'webhooks', 'stripe'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'webhooks', 'stripe', 'route.ts'), `
// TODO: verify signature before handling this webhook.
export async function POST() { return Response.json({ ok: true }); }
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'internal', 'health'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'internal', 'health', 'route.ts'), `
import { auth } from '@/lib/auth';
export async function GET(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({}, { status: 401 });
  return Response.json({ ok: true });
}
`);
  await mkdir(path.join(repo, 'src', 'app', 'api', 'queue', 'status'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'api', 'queue', 'status', 'route.ts'), 'export async function GET() { return Response.json({ ok: true }); }\n');
  await mkdir(path.join(repo, 'src', 'lib'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'db.ts'), 'export const prisma = {};\n');
  await writeFile(path.join(repo, 'src', 'lib', 'queue.ts'), `
export function requireQueueAuth(request) {
  return request.headers.get('authorization');
}
export function verifyQueueSignature(signature) {
  return Boolean(signature);
}
`);
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-alpha.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesAlpha() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-beta.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesBeta() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'mixed-workflow.ts'), `
import { prisma } from '@/lib/db';
import { z } from 'zod';

export async function mixedWorkflow(request) {
  const session = await auth();
  const schema = z.object({ id: z.string() });
  const input = schema.parse(await request.json());
  const company = await prisma.company.findUnique({ where: { id: input.id } });
  await fetch(process.env.WEBHOOK_URL, { method: 'POST', body: JSON.stringify(company) });
  await notifyTeam(session.user.email);
  return company;
}

${Array.from({ length: 155 }, (_, index) => `const workflowLine${index} = ${index};`).join('\n')}
`);
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), `
const api_secret = "runtimeReviewToken123";
export default function Page() { return <main>SalesTailor</main>; }
`);
  await writeFile(path.join(repo, 'src', 'middleware.ts'), `
export const config = {
  matcher: ['/api/admin/:path*', '/api/companies/:path*', '/((?!api|_next/static).*)']
};
export function middleware() {}
`);
  await writeFile(path.join(repo, '.env.local'), 'NEXTAUTH_SECRET=secret_1234567890abcdef\n');
  await writeFile(path.join(repo, 'vercel.json'), JSON.stringify({ framework: 'nextjs' }));
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'queue-route', label: 'queue route', source_file: 'src/app/api/queue/status/route.ts', community: 7 },
      { id: 'queue-handler', label: 'handleQueue()', source_file: 'src/app/api/queue/status/route.ts', community: 7 },
      { id: 'queue-service', label: 'QueueService', source_file: 'src/lib/queue.ts', community: 7 },
      { id: 'debug-route', label: 'debug route', source_file: 'src/app/api/debug-env/route.ts', community: 9 },
      { id: 'webhook-route', label: 'stripe webhook', source_file: 'src/app/api/webhooks/stripe/route.ts', community: 10 },
      { id: 'company-alpha-service', label: 'listActiveCompaniesAlpha()', source_file: 'src/lib/services/company-alpha.ts', community: 11 },
      { id: 'company-beta-service', label: 'listActiveCompaniesBeta()', source_file: 'src/lib/services/company-beta.ts', community: 11 },
      { id: 'company-repository', label: 'prisma.company repository', source_file: 'src/lib/db.ts', community: 11 }
    ],
    links: [
      { source: 'queue-route', target: 'queue-handler', confidence: 'EXTRACTED', relation: 'contains' },
      { source: 'queue-handler', target: 'queue-service', confidence: 'EXTRACTED', relation: 'calls' },
      { source: 'debug-route', target: 'queue-service', confidence: 'INFERRED', relation: 'calls' },
      { source: 'webhook-route', target: 'queue-service', confidence: 'INFERRED', relation: 'calls' },
      { source: 'company-alpha-service', target: 'company-repository', confidence: 'EXTRACTED', relation: 'queries' },
      { source: 'company-beta-service', target: 'company-repository', confidence: 'EXTRACTED', relation: 'queries' }
    ]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T140000Z']);

  assert.equal(result.exitCode, 0);
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T140000Z');
  await stat(path.join(runDir, 'architecture-profile.md'));
  await stat(path.join(runDir, 'finding-review.md'));
  await stat(path.join(runDir, 'refactoring-delta.md'));
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.architecture_profile.app_type, 'web_app');
  assert.equal(evidence.architecture_profile.system_type, 'web_application');
  assert.equal(evidence.architecture_profile.rendering, 'nextjs');
  assert.equal(evidence.architecture_profile.frameworks.includes('nextjs'), true);
  assert.equal(evidence.architecture_profile.has_api_routes, true);
  assert.equal(evidence.architecture_profile.has_database, true);
  assert.equal(evidence.architecture_profile.has_auth, true);
  assert.equal(evidence.architecture_profile.auth.includes('next-middleware'), true);
  assert.deepEqual(Object.keys(evidence.architecture_profile.views), [
    'structure',
    'runtime',
    'data',
    'security',
    'deployment',
    'quality'
  ]);
  assert.equal(evidence.architecture_profile.views.structure.components.includes('api_routes'), true);
  assert.equal(evidence.architecture_profile.views.runtime.entrypoints.includes('src/app/api/companies/route.ts'), true);
  assert.equal(evidence.architecture_profile.views.runtime.entrypoints.includes('src/app/api/companies/route.test.ts'), false);
  assert.equal(evidence.architecture_profile.views.runtime.entrypoints.includes('src/app/api/companies/helper.ts'), false);
  assert.equal(evidence.architecture_profile.views.runtime.server_boundaries.includes('api_routes'), true);
  assert.equal(evidence.architecture_profile.views.data.stores.includes('postgres'), true);
  assert.equal(evidence.architecture_profile.views.data.access_patterns.includes('prisma'), true);
  assert.equal(evidence.architecture_profile.views.security.auth_boundaries.some((item) => item.file === 'src/middleware.ts'), true);
  assert.equal(evidence.architecture_profile.views.security.secret_files.includes('.env.local'), true);
  assert.equal(evidence.architecture_profile.views.deployment.targets.includes('vercel'), true);
  assert.equal(evidence.architecture_profile.views.quality.test_tools.includes('vitest'), true);
  assert.equal(evidence.check_catalog.selected_views.includes('security'), true);
  assert.equal(evidence.check_catalog.selected_views.includes('data'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('api-boundary'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('database-access'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('code-quality'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('auth-boundary'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('static-entry'), false);
  assert.equal(evidence.static_site.secret_hits.some((hit) => hit.file === '.env.local'), true);
  assert.equal(evidence.database_access.unbounded_find_many.length, 1);
  assert.equal(evidence.database_access.unbounded_find_many[0].file, 'src/app/api/companies/route.ts');
  assert.equal(evidence.database_access.unbounded_find_many[0].gate_effect, 'review');
  assert.equal(evidence.code_quality.authorization_order_risks.length, 1);
  assert.equal(evidence.code_quality.authorization_order_risks[0].file, 'src/app/api/accounts/[id]/route.ts');
  assert.equal(evidence.code_quality.duplicate_query_shapes.length, 1);
  assert.equal(evidence.code_quality.duplicate_query_shapes[0].files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(evidence.code_quality.duplicate_query_shapes[0].files.includes('src/lib/services/company-beta.ts'), true);
  assert.equal(evidence.code_quality.responsibility_hotspots.length, 1);
  assert.equal(evidence.code_quality.responsibility_hotspots[0].file, 'src/lib/services/mixed-workflow.ts');
  assert.equal(evidence.refactoring_opportunities.length, 2);
  const dryOpportunity = evidence.refactoring_opportunities.find((opportunity) => opportunity.finding_id === 'VP-DRY-001');
  assert.equal(dryOpportunity.source, 'duplicate_query_shape');
  assert.equal(dryOpportunity.refactoring_intent, 'query_policy');
  assert.equal(dryOpportunity.target_files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(dryOpportunity.target_files.includes('src/lib/services/company-beta.ts'), true);
  assert.match(dryOpportunity.story_blueprint.title, /重複query形状/);
  assert.equal(dryOpportunity.story_blueprint.acceptance_criteria.some((item) => item.includes('VibePro診断')), true);
  assert.equal(dryOpportunity.graph_context.matched_file_count, 2);
  assert.equal(dryOpportunity.graph_context.related_files.includes('src/lib/db.ts'), true);
  assert.equal(dryOpportunity.graph_context.affected_communities[0].id, 11);
  assert.equal(dryOpportunity.graph_context.affected_communities[0].file_count, 2);
  const archOpportunity = evidence.refactoring_opportunities.find((opportunity) => opportunity.finding_id === 'VP-ARCH-001');
  assert.equal(archOpportunity.refactoring_intent, 'responsibility_split');
  assert.equal(archOpportunity.target_files.includes('src/lib/services/mixed-workflow.ts'), true);
  assert.equal(dryOpportunity.rank > 0, true);
  assert.equal(dryOpportunity.score.total > 0, true);
  assert.equal(dryOpportunity.priority_reasons.includes('confidence:medium'), true);
  assert.equal(evidence.refactoring_campaigns.length, 2);
  assert.equal(evidence.refactoring_campaigns[0].rank, 1);
  assert.equal(evidence.refactoring_campaigns.some((campaign) => campaign.recommended_first_opportunity_id === dryOpportunity.id), true);
  assert.equal(evidence.refactoring_delta.status, 'no_baseline');
  const dryCampaign = evidence.refactoring_campaigns.find((campaign) => campaign.opportunity_ids.includes(dryOpportunity.id));
  assert.equal(dryCampaign.story_blueprint.source_opportunity_ids.includes(dryOpportunity.id), true);
  assert.equal(dryCampaign.expected_diagnostic_delta.duplicate_query_shapes, 1);
  assert.equal(evidence.api_boundary.routes.length, 8);
  assert.equal(evidence.api_boundary.protection_summary.protected_by_middleware, 3);
  assert.equal(evidence.api_boundary.protection_summary.protected_by_route, 1);
  assert.equal(evidence.api_boundary.protection_summary.excluded_by_middleware, 4);
  const adminRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/admin/users');
  assert.equal(adminRoute.classification, 'admin');
  assert.equal(adminRoute.protection.status, 'protected_by_middleware');
  assert.equal(adminRoute.protection.evidence.includes('middleware_matcher'), true);
  const adminWebhookMonitorRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/admin/webhook-monitor');
  assert.equal(adminWebhookMonitorRoute.classification, 'admin');
  const publicRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/companies');
  assert.equal(publicRoute.classification, 'public');
  assert.equal(publicRoute.protection.status, 'protected_by_middleware');
  const debugRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/debug-env');
  assert.equal(debugRoute.classification, 'debug');
  assert.equal(debugRoute.protection.status, 'excluded_by_middleware');
  assert.equal(debugRoute.protection.evidence.includes('route_auth_reference'), false);
  assert.equal(debugRoute.risk_hints.includes('debug_route_exposed'), true);
  const webhookRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/webhooks/stripe');
  assert.equal(webhookRoute.classification, 'webhook');
  assert.equal(webhookRoute.protection.evidence.includes('webhook_signature_check'), false);
  assert.equal(webhookRoute.risk_hints.includes('webhook_signature_not_detected'), true);
  const internalRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/internal/health');
  assert.equal(internalRoute.protection.status, 'protected_by_route');
  assert.equal(internalRoute.protection.evidence.includes('route_auth_reference'), true);
  const queueRoute = evidence.api_boundary.routes.find((route) => route.route_path === '/api/queue/status');
  assert.equal(queueRoute.protection.status, 'excluded_by_middleware');
  assert.equal(queueRoute.protection.evidence.includes('middleware_excludes_api'), true);
  assert.equal(queueRoute.risk_hints.includes('privileged_route_unprotected'), true);
  assert.equal(evidence.action_candidates.length, 5);
  const tasks = await readJson(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'tasks', 'tasks.json'));
  assert.equal(tasks.tasks[0].id, 'VP-TASK-STATIC-002-BLOCK');
  assert.equal(tasks.tasks[0].priority, 'critical');
  assert.equal(tasks.tasks[1].id, 'VP-TASK-STATIC-002-REVIEW');
  assert.equal(tasks.tasks[2].source_id, 'VP-ACTION-API-002');
  assert.equal(tasks.tasks[3].source_id, 'VP-ACTION-API-003');
  assert.equal(tasks.tasks[4].source_id, 'VP-ACTION-API-001');
  assert.equal(tasks.tasks[4].recommended_strategy.id, 'route-level-auth');
  assert.equal(tasks.tasks[4].read_first_files.some((item) => item.file === 'src/lib/queue.ts'), true);
  assert.equal(tasks.tasks[4].target_count, tasks.tasks[4].pre_fix_briefing.target_routes.length);
  assert.equal(tasks.tasks[4].target_files.length, tasks.tasks[4].pre_fix_briefing.target_routes.length);
  assert.equal(tasks.tasks[4].target_groups.length, 1);
  assert.equal(tasks.tasks[4].target_groups[0].id, 'queue-status');
  assert.equal(tasks.tasks[4].target_groups[0].route_count, 1);
  assert.equal(tasks.tasks[4].pre_fix_briefing.current_boundary.middleware.excludes_api, true);
  assert.equal(tasks.tasks[6].source_id, 'VP-ACTION-DRY-001');
  assert.equal(tasks.tasks[6].target_files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(tasks.tasks[6].pre_fix_briefing.opportunity.refactoring_intent, 'query_policy');
  assert.equal(tasks.tasks[6].pre_fix_briefing.campaign.id, dryCampaign.id);
  assert.equal(tasks.tasks[6].graph_context.matched_file_count, 2);
  assert.equal(tasks.tasks[6].read_first_files.some((item) => item.file === 'src/lib/db.ts'), true);
  assert.equal(tasks.tasks[6].pre_fix_briefing.investigation_scope.related_files.includes('src/lib/db.ts'), true);
  assert.equal(tasks.tasks[6].recommended_strategy.id, 'extract-shared-boundary');
  assert.equal(tasks.tasks[7].source_id, 'VP-ACTION-ARCH-001');
  assert.equal(tasks.tasks[7].pre_fix_briefing.opportunity.refactoring_intent, 'responsibility_split');
  const apiAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-API-001');
  assert.equal(apiAction.finding_id, 'VP-API-001');
  assert.equal(apiAction.execution_policy, 'proposal_only');
  assert.equal(apiAction.mutates_repository, false);
  assert.equal(apiAction.target_count, 1);
  assert.equal(apiAction.route_examples[0].route_path, '/api/queue/status');
  assert.equal(apiAction.route_examples[0].file, 'src/app/api/queue/status/route.ts');
  assert.equal(apiAction.graph_context.matched_route_count, 1);
  assert.equal(apiAction.graph_context.matched_node_count, 2);
  assert.equal(apiAction.graph_context.related_edge_count, 2);
  assert.equal(apiAction.graph_context.affected_communities[0].id, 7);
  assert.equal(apiAction.graph_context.hub_nodes.some((node) => node.id === 'queue-service'), true);
  assert.equal(apiAction.graph_context.impact_score > 0, true);
  assert.equal(apiAction.implementation_plan.priority, 'high');
  assert.equal(apiAction.implementation_plan.read_first_files[0].file, 'src/app/api/queue/status/route.ts');
  assert.equal(apiAction.implementation_plan.read_first_files.some((item) => item.file === 'src/middleware.ts'), true);
  assert.equal(apiAction.implementation_plan.read_first_files.some((item) => item.file === 'src/lib/queue.ts'), true);
  assert.match(apiAction.implementation_plan.steps[0].detail, /middleware matcher/);
  assert.match(apiAction.implementation_plan.acceptance_criteria.join('\n'), /保護根拠/);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.current_boundary.middleware.excludes_api, true);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.current_boundary.route_protection.excluded_by_middleware, 1);
  const apiAuthHelper = apiAction.implementation_plan.pre_fix_briefing.auth_helpers.find((helper) => helper.file === 'src/lib/queue.ts');
  assert.equal(apiAuthHelper?.functions.includes('requireQueueAuth'), true);
  assert.equal(apiAuthHelper?.functions.includes('verifyQueueSignature'), false);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.target_routes[0].file, 'src/app/api/queue/status/route.ts');
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.target_routes[0].methods.includes('GET'), true);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.strategy_options.length, 2);
  assert.equal(apiAction.implementation_plan.pre_fix_briefing.recommended_strategy.id, 'route-level-auth');
  const debugAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-API-002');
  assert.equal(debugAction.target_count, 1);
  assert.equal(debugAction.graph_context.matched_route_count, 1);
  assert.match(debugAction.implementation_plan.steps.map((step) => step.detail).join('\n'), /削除/);
  assert.equal(debugAction.implementation_plan.pre_fix_briefing.recommended_strategy.id, 'delete-debug-routes');
  const webhookAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-API-003');
  assert.equal(webhookAction.target_count, 1);
  assert.equal(webhookAction.graph_context.matched_route_count, 1);
  assert.match(webhookAction.implementation_plan.acceptance_criteria.join('\n'), /署名検証/);
  assert.equal(webhookAction.implementation_plan.pre_fix_briefing.recommended_strategy.id, 'provider-signature-verification');
  assert.equal(
    webhookAction.implementation_plan.pre_fix_briefing.auth_helpers.some((helper) => helper.file === 'src/lib/queue.ts'),
    false
  );
  const dryAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-DRY-001');
  assert.equal(dryAction.finding_id, 'VP-DRY-001');
  assert.equal(dryAction.scope, 'refactoring');
  assert.equal(dryAction.refactoring_opportunity_id, dryOpportunity.id);
  assert.equal(dryAction.refactoring_campaign_id, dryCampaign.id);
  assert.equal(dryAction.target_files.includes('src/lib/services/company-beta.ts'), true);
  assert.equal(dryAction.story_blueprint.refactoring_intent, 'query_policy');
  assert.equal(dryAction.graph_context.matched_file_count, 2);
  assert.equal(dryAction.graph_context.related_files.includes('src/lib/db.ts'), true);
  assert.equal(dryAction.graph_context.hub_nodes.some((node) => node.id === 'company-repository'), true);
  assert.equal(dryAction.implementation_plan.read_first_files.some((item) => item.file === 'src/lib/db.ts'), true);
  assert.equal(dryAction.implementation_plan.pre_fix_briefing.graph_context.impact_score > 0, true);
  assert.equal(dryAction.implementation_plan.pre_fix_briefing.investigation_scope.cross_community, false);
  assert.equal(dryAction.implementation_plan.pre_fix_briefing.opportunity.id, dryOpportunity.id);
  const archAction = evidence.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-ARCH-001');
  assert.equal(archAction.finding_id, 'VP-ARCH-001');
  assert.equal(archAction.scope, 'refactoring');
  assert.equal(archAction.target_files.includes('src/lib/services/mixed-workflow.ts'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-API-002'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-API-003'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-DB-001'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-SEC-004'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-DRY-001'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-ARCH-001'), true);
  assert.equal(evidence.finding_review.status, 'needs_review');
  assert.equal(evidence.finding_review.summary.total, evidence.findings.length);
  assert.equal(evidence.finding_review.summary.unreviewed, evidence.findings.length);
  assert.equal(evidence.finding_review.items.find((item) => item.finding_id === 'VP-API-001').suggested_classification, 'implementation_gap');
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-GRAPH-002'), false);
  assert.equal(evidence.graphify.quality_notices.find((notice) => notice.id === 'VP-GRAPH-002').level, 'info');
  assert.equal(evidence.finding_review.items.find((item) => item.finding_id === 'VP-API-001').allowed_classifications.includes('false_negative'), true);
  const apiFinding = evidence.findings.find((finding) => finding.id === 'VP-API-001');
  assert.match(apiFinding.detail, /excluded_by_middleware: 1件/);
  assert.match(apiFinding.recommendation, /APIを除外しているmiddleware matcher/);
  assert.equal(apiFinding.graph_context.impact_score, apiAction.graph_context.impact_score);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-STATIC-001'), false);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-STATIC-004'), false);
  const summary = await readFile(path.join(runDir, 'summary.md'), 'utf8');
  assert.match(summary, /## アーキテクチャView/);
  assert.match(summary, /Security \|/);
  assert.doesNotMatch(summary, /静的サイト scanned files/);
  assert.match(summary, /共通スキャン対象/);
  assert.match(summary, /DB未ページング候補/);
  assert.match(summary, /認可前bulk DB候補/);
  assert.match(summary, /重複query形状候補/);
  assert.match(summary, /責務混在候補/);
  assert.match(summary, /リファクタリング機会/);
  assert.match(summary, /リファクタリングcampaign/);
  assert.match(summary, /保護状態別/);
  assert.match(summary, /excluded_by_middleware \| 4/);
  assert.match(summary, /## 次アクション候補/);
  assert.match(summary, /VP-ACTION-API-001/);
  assert.match(summary, /VP-ACTION-DRY-001/);
  assert.match(summary, /VP-ACTION-ARCH-001/);
  assert.match(summary, /Impact/);
  assert.match(summary, /読むファイル/);
  assert.match(summary, /実装手順/);
  assert.match(summary, /修正前ブリーフィング/);
  assert.match(summary, /## 文脈品質ノート/);
  assert.match(summary, /VP-GRAPH-002/);
  assert.match(summary, /## 診断レビュー/);
  assert.match(summary, /## リファクタリング差分/);
  assert.match(summary, /差分は未算出/);
  assert.match(summary, /suggested implementation_gap/);
  assert.match(summary, /方針A/);
  assert.match(summary, /7\(route: 1, node: 2, edge: 2\)/);
  assert.match(summary, /11\(file: 2, node: 2, edge: 2\)/);
  const riskRegister = await readFile(path.join(runDir, 'risk-register.md'), 'utf8');
  assert.match(riskRegister, /## API境界の保護状態/);
  assert.match(riskRegister, /## 診断レビュー分類/);
  assert.match(riskRegister, /VP-API-001 \| unreviewed \| implementation_gap/);
  assert.match(riskRegister, /excluded_by_middleware \| 4/);
  assert.match(riskRegister, /proposal_only/);
  assert.match(riskRegister, /Impact/);
  const findingReview = await readFile(path.join(runDir, 'finding-review.md'), 'utf8');
  assert.match(findingReview, /# VibePro 診断レビュー/);
  assert.match(findingReview, /true_positive/);
  assert.match(findingReview, /false_positive/);
  assert.match(findingReview, /false_negative/);
  assert.match(findingReview, /detector_gap/);
  assert.match(findingReview, /implementation_gap/);
  const storyReport = await runCli(['story', 'report', repo]);
  assert.equal(storyReport.exitCode, 0);
  const report = await readFile(path.join(repo, '.vibepro', 'stories', 'story-vibepro-diagnosis-commercialization-roadmap', 'story-report.md'), 'utf8');
  assert.doesNotMatch(report, /## 静的サイト診断/);
  assert.match(report, /## 共通スキャン/);
  assert.match(report, /## API境界/);
  assert.match(report, /protected_by_route \| 1/);
  assert.match(report, /## 診断レビュー/);
  assert.match(report, /implementation_gap/);
  assert.match(report, /## 次アクション候補/);
  assert.match(report, /## 生成タスク/);
  assert.match(report, /VP-TASK-API-001/);
  assert.match(report, /Impact/);
  assert.match(report, /実装手順/);
  assert.match(report, /修正前ブリーフィング/);
  await runCli(['brainbase', repo]);
  const importSummary = await readFile(path.join(repo, '.vibepro', 'brainbase', 'import-summary.md'), 'utf8');
  assert.doesNotMatch(importSummary, /静的サイト走査ファイル/);
  assert.match(importSummary, /共通スキャン対象/);
  assert.match(importSummary, /## API境界/);
  assert.match(importSummary, /認可前bulk DB候補/);
  assert.match(importSummary, /重複query形状候補/);
  assert.match(importSummary, /責務混在候補/);
  assert.match(importSummary, /リファクタリング機会/);
  assert.match(importSummary, /リファクタリングcampaign/);
  assert.match(importSummary, /リファクタリング差分/);
  assert.match(importSummary, /excluded_by_middleware \| 4/);
  assert.match(importSummary, /## 診断レビュー/);
  assert.doesNotMatch(importSummary, /suggested detector_gap: [1-9]/);
  assert.match(importSummary, /## 次アクション候補/);
  assert.match(importSummary, /## 生成タスク/);
  assert.match(importSummary, /VP-TASK-API-001/);
  assert.match(importSummary, /Impact/);
  assert.match(importSummary, /読むファイル/);
  assert.match(importSummary, /修正前ブリーフィング/);
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.signals.architecture_profile.system_type, 'web_application');
  assert.equal(importState.signals.architecture_profile.views.security.auth_boundaries.length, 1);
  assert.equal(importState.signals.check_catalog.selected_views.includes('runtime'), true);
  assert.equal(importState.signals.api_boundary.route_count, 8);
  assert.equal(importState.signals.api_boundary.summary.debug, 1);
  assert.equal(importState.signals.api_boundary.protection_summary.excluded_by_middleware, 4);
  assert.equal(importState.signals.code_quality.authorization_order_risks_count, 1);
  assert.equal(importState.signals.code_quality.duplicate_query_shapes_count, 1);
  assert.equal(importState.signals.code_quality.responsibility_hotspots_count, 1);
  assert.equal(importState.signals.refactoring_opportunities.length, 2);
  assert.equal(importState.signals.refactoring_opportunities[0].rank > 0, true);
  assert.equal(importState.signals.refactoring_opportunities[0].story_blueprint.source_finding_id, 'VP-DRY-001');
  assert.equal(importState.signals.refactoring_opportunities.find((opportunity) => opportunity.id === dryOpportunity.id).graph_context.matched_file_count, 2);
  assert.equal(importState.signals.refactoring_campaigns.length, 2);
  assert.equal(importState.signals.refactoring_delta.status, 'no_baseline');
  assert.equal(importState.signals.refactoring_campaigns.some((campaign) => campaign.opportunity_ids.includes(dryOpportunity.id)), true);
  assert.equal(importState.signals.refactoring_campaigns.find((campaign) => campaign.opportunity_ids.includes(dryOpportunity.id)).graph_context.related_files.includes('src/lib/db.ts'), true);
  assert.equal(importState.signals.finding_review.summary.total, importState.findings.length);
  assert.equal(importState.signals.graphify.quality_notices.find((notice) => notice.id === 'VP-GRAPH-002').level, 'info');
  assert.equal(importState.findings.find((finding) => finding.id === 'VP-API-001').review.suggested_classification, 'implementation_gap');
  assert.equal(importState.signals.tasks.length, 8);
  assert.equal(importState.signals.tasks[0].id, 'VP-TASK-STATIC-002-BLOCK');
  assert.equal(importState.signals.tasks[4].source_id, 'VP-ACTION-API-001');
  assert.equal(importState.signals.tasks[6].source_id, 'VP-ACTION-DRY-001');
  assert.equal(importState.signals.tasks[7].source_id, 'VP-ACTION-ARCH-001');
  assert.equal(importState.signals.action_candidates.length, 5);
  assert.equal(importState.signals.action_candidates[0].mutates_repository, false);
  assert.equal(importState.signals.action_candidates[0].graph_context.matched_route_count, 1);
  assert.equal(importState.signals.action_candidates[0].implementation_plan.read_first_files.some((item) => item.file === 'src/lib/queue.ts'), true);
  assert.equal(importState.signals.action_candidates[0].implementation_plan.pre_fix_briefing.recommended_strategy.id, 'route-level-auth');
  const importedDryAction = importState.signals.action_candidates.find((candidate) => candidate.id === 'VP-ACTION-DRY-001');
  assert.equal(importedDryAction.refactoring_opportunity_id, dryOpportunity.id);
  assert.equal(importedDryAction.refactoring_campaign_id, dryCampaign.id);
  assert.equal(importedDryAction.story_blueprint.refactoring_intent, 'query_policy');
  assert.equal(importedDryAction.target_files.includes('src/lib/services/company-alpha.ts'), true);
  assert.equal(importedDryAction.graph_context.matched_file_count, 2);
  assert.equal(importedDryAction.implementation_plan.read_first_files.some((item) => item.file === 'src/lib/db.ts'), true);
  assert.equal(importState.findings.find((finding) => finding.id === 'VP-API-001').graph_context.impact_score > 0, true);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(
    manifest.runs[0].artifacts.architecture_profile,
    '.vibepro/diagnostics/2026-04-28T140000Z/architecture-profile.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.finding_review,
    '.vibepro/diagnostics/2026-04-28T140000Z/finding-review.md'
  );
  assert.equal(
    manifest.runs[0].artifacts.refactoring_delta,
    '.vibepro/diagnostics/2026-04-28T140000Z/refactoring-delta.md'
  );
});

test('diagnose records refactoring delta against the previous story run', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-refactoring-delta-test-'));
  await mkdir(path.join(repo, 'src', 'app'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services'), { recursive: true });
  await writeFile(path.join(repo, 'package.json'), JSON.stringify({
    scripts: { dev: 'next dev' },
    dependencies: {
      '@prisma/client': '^5.0.0',
      next: '^14.0.0',
      react: '^18.2.0'
    }
  }));
  await writeFile(path.join(repo, 'src', 'app', 'page.tsx'), 'export default function Page() { return <main>Aitle</main>; }\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-alpha.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesAlpha() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-beta.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesBeta() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-gamma.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesGamma() {
  return prisma.company.findMany({
    where: { active: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
    take: 20
  });
}
`);
  await runCli(['init', repo, '--story-id', 'story-refactoring-delta', '--title', '差分計測']);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const beforeResult = await runCli(['diagnose', repo, '--run-id', 'run-before']);
  assert.equal(beforeResult.exitCode, 0);

  await writeFile(path.join(repo, 'src', 'lib', 'services', 'company-beta.ts'), `
import { prisma } from '@/lib/db';

export async function listActiveCompaniesBeta() {
  return prisma.company.findMany({
    where: { archived: false },
    select: { id: true, displayName: true },
    orderBy: { updatedAt: 'desc' },
    take: 20
  });
}
`);

  const afterResult = await runCli(['diagnose', repo, '--run-id', 'run-after']);
  assert.equal(afterResult.exitCode, 0);
  const afterRunDir = path.join(repo, '.vibepro', 'diagnostics', 'run-after');
  const afterEvidence = await readJson(path.join(afterRunDir, 'evidence.json'));
  assert.equal(afterEvidence.refactoring_delta.status, 'available');
  const improved = afterEvidence.refactoring_delta.top_improvements.find((item) => item.status === 'improved');
  assert.match(improved.key, /company\.findMany/);
  assert.equal(improved.before.target_file_count, 3);
  assert.equal(improved.before.occurrence_count, 3);
  assert.equal(improved.after.target_file_count, 2);
  assert.equal(improved.after.occurrence_count, 2);
  assert.equal(afterEvidence.refactoring_delta.top_remaining[0].key, improved.key);
  assert.equal(afterEvidence.refactoring_delta.top_remaining[0].after.target_file_count, 2);
  const deltaReport = await readFile(path.join(afterRunDir, 'refactoring-delta.md'), 'utf8');
  assert.match(deltaReport, /## 残っている上位候補/);
  assert.match(deltaReport, /3ファイル \/ 3出現/);
  assert.match(deltaReport, /2ファイル \/ 2出現/);
  const summary = await readFile(path.join(afterRunDir, 'summary.md'), 'utf8');
  assert.match(summary, /## リファクタリング差分/);
  assert.match(summary, /3ファイル \/ 3出現 -> 2ファイル \/ 2出現/);
  assert.match(summary, /次の候補/);
});

test('brainbase creates an import state from the latest VibePro manifest run', async () => {
  const repo = await makeRepo();
  await writeFile(path.join(repo, 'app.js'), 'document.body.innerHTML = location.hash;\n');
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'page' }],
    edges: [
      { source: 'app', target: 'page', relation: 'renders', confidence: 'AMBIGUOUS' }
    ]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T150000Z']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  assert.equal(result.command, 'brainbase');
  const importStatePath = path.join(repo, '.vibepro', 'brainbase', 'import-state.json');
  const importSummaryPath = path.join(repo, '.vibepro', 'brainbase', 'import-summary.md');
  await stat(importSummaryPath);
  const importState = await readJson(importStatePath);
  assert.equal(importState.schema_version, '0.1.0');
  assert.equal(importState.story.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.equal(importState.latest_run.run_id, '2026-04-28T150000Z');
  assert.equal(importState.latest_run.gate_status, 'needs_review');
  assert.equal(importState.signals.graphify.node_count, 2);
  assert.equal(importState.signals.graphify.ambiguous_edges_count, 1);
  assert.equal(importState.signals.architecture_profile.app_type, 'static_site');
  assert.equal(importState.signals.check_catalog.applicable_checks.includes('static-entry'), true);
  assert.equal(importState.signals.static_site.xss_risk_hits_count, 1);
  assert.equal(importState.findings.some((finding) => finding.id === 'VP-STATIC-003'), true);
  assert.match(await readFile(importSummaryPath, 'utf8'), /Brainbase 取り込み状態/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.artifacts.brainbase_import_state, '.vibepro/brainbase/import-state.json');
});

test('brainbase import state supports multiple stories with NocoDB horizon, view, period, and dates', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.brainbase = {
    stories: [
      {
        story_id: 'story-vibepro-diagnosis-commercialization-roadmap',
        title: 'M1: VibePro 診断→商用化ロードマップ',
        horizon: 'month',
        view: 'dev',
        period: '2026-04',
        started_at: '2026-04-01',
        due_at: '2026-04-30'
      },
      {
        story_id: 'story-vibepro-brainbase-rollup',
        title: 'Brainbase 横断取り込み',
        horizon: 'quarter',
        view: 'business',
        period: '2026Q2',
        started_at: '2026-04-01',
        due_at: '2026-06-30'
      }
    ]
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T180000Z']);

  const result = await runCli(['brainbase', repo]);

  assert.equal(result.exitCode, 0);
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.stories.length, 2);
  assert.deepEqual(importState.stories.map((story) => story.story_id), [
    'story-vibepro-diagnosis-commercialization-roadmap',
    'story-vibepro-brainbase-rollup'
  ]);
  assert.equal(importState.stories[0].horizon, 'month');
  assert.equal(importState.stories[0].view, 'dev');
  assert.equal(importState.stories[0].period, '2026-04');
  assert.equal(importState.stories[0].started_at, '2026-04-01');
  assert.equal(importState.stories[0].due_at, '2026-04-30');
  assert.equal(importState.stories[1].horizon, 'quarter');
  assert.equal(importState.stories[1].period, '2026Q2');
  assert.equal(importState.story.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.match(await readFile(path.join(repo, '.vibepro', 'brainbase', 'import-summary.md'), 'utf8'), /2026Q2/);
});

test('brainbase sync-stories updates config stories from NocoDB Story records before import', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T210000Z']);
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, token: options.headers['xc-token'] });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '名前', column_name: 'name' },
          { title: 'ステータス', column_name: 'status' },
          { title: 'Horizon', column_name: 'horizon' },
          { title: 'View', column_name: 'view' },
          { title: 'Period', column_name: 'period' },
          { title: '開始日', column_name: 'started_at' },
          { title: '期限日', column_name: 'due_at' }
        ]
      });
    }
    return jsonResponse({
      list: [
        {
          'Story ID': 'story-active-dev',
          '名前': 'Dev Story',
          'ステータス': 'active',
          Horizon: 'sprint',
          View: 'dev',
          Period: '2026-W18',
          '開始日': '2026-04-27',
          '期限日': '2026-05-01'
        },
        {
          'Story ID': 'story-archived',
          '名前': 'Archived Story',
          'ステータス': 'archived',
          Horizon: 'month',
          View: 'business',
          Period: '2026-04',
          '開始日': '2026-04-01',
          '期限日': '2026-04-30'
        },
        {
          'Story ID': 'story-active-business',
          '名前': 'Business Story',
          'ステータス': 'active',
          Horizon: 'quarter',
          View: 'business',
          Period: '2026Q2',
          '開始日': '2026-04-01',
          '期限日': '2026-06-30'
        }
      ],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--sync-stories'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => request.token === 'test-token'), true);
  const config = await readJson(path.join(repo, '.vibepro', 'config.json'));
  assert.deepEqual(config.brainbase.stories.map((story) => story.story_id), [
    'story-active-dev',
    'story-active-business'
  ]);
  assert.equal(config.brainbase.story_source.table_id, 'table-1');
  const importState = await readJson(path.join(repo, '.vibepro', 'brainbase', 'import-state.json'));
  assert.equal(importState.stories.length, 2);
  assert.equal(importState.stories[0].horizon, 'sprint');
  assert.equal(importState.stories[1].period, '2026Q2');
});

test('brainbase publish-status replaces the VibePro diagnosis section in the NocoDB Story description', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: [{ source: 'app', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T230000Z']);
  const requests = [];
  let description = '既存説明\n\n<!-- vibepro:diagnosis-sync:start -->\n古い診断\n<!-- vibepro:diagnosis-sync:end -->\n\n手書きメモ';
  const fakeFetch = async (url, options) => {
    requests.push({ url, method: options.method ?? 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    if ((options.method ?? 'GET') === 'PATCH') {
      description = JSON.parse(options.body).説明;
      return jsonResponse({ Id: 42 });
    }
    return jsonResponse({
      list: [{
        Id: 42,
        'Story ID': 'story-vibepro-diagnosis-commercialization-roadmap',
        '説明': description
      }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  const patch = requests.find((request) => request.method === 'PATCH');
  assert.ok(patch);
  assert.match(patch.url, /\/api\/v1\/db\/data\/noco\/base-1\/table-1\/42$/);
  assert.equal(patch.body.ステータス, undefined);
  assert.match(patch.body.説明, /既存説明/);
  assert.match(patch.body.説明, /手書きメモ/);
  assert.match(patch.body.説明, /VibePro診断同期/);
  assert.match(patch.body.説明, /Gate: needs_review/);
  assert.doesNotMatch(patch.body.説明, /古い診断/);
});

test('brainbase publish-status writes backup and result artifacts after verified NocoDB update', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: [{ source: 'app', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T230500Z']);
  let description = '既存説明\n\n手書きメモ';
  const requests = [];
  const fakeFetch = async (url, options) => {
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method, body });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    if (method === 'PATCH') {
      description = body.説明;
      return jsonResponse({ '番号': 2 });
    }
    return jsonResponse({
      list: [{
        '番号': 2,
        'Story ID': 'story-vibepro-diagnosis-commercialization-roadmap',
        '説明': description
      }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  const patch = requests.find((request) => request.method === 'PATCH');
  assert.ok(patch);
  assert.match(patch.url, /\/2$/);
  const backup = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-backup.json'));
  assert.equal(backup.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.equal(backup.record_id, 2);
  assert.match(backup.existing_description, /手書きメモ/);
  const publishResult = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-result.json'));
  assert.equal(publishResult.verified, true);
  assert.equal(publishResult.description_matches_expected, true);
  assert.equal(publishResult.updated_fields.length, 1);
  assert.equal(publishResult.updated_fields[0], '説明');
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.brainbase.last_publish_result.backup_json, '.vibepro/brainbase/publish-backup.json');
  assert.equal(manifest.brainbase.last_publish_result.result_json, '.vibepro/brainbase/publish-result.json');
});

test('brainbase publish-status dry-run writes preview artifacts without patching NocoDB', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }],
    edges: [{ source: 'app', target: 'unknown', relation: 'depends_on', confidence: 'AMBIGUOUS' }]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T231500Z']);
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, method: options.method ?? 'GET' });
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    return jsonResponse({
      list: [{
        Id: 42,
        'Story ID': 'story-vibepro-diagnosis-commercialization-roadmap',
        '説明': '既存説明'
      }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status', '--dry-run'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(requests.some((request) => request.method === 'PATCH'), false);
  const preview = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-preview.json'));
  assert.equal(preview.dry_run, true);
  assert.equal(preview.story_id, 'story-vibepro-diagnosis-commercialization-roadmap');
  assert.equal(preview.latest_run_id, '2026-04-28T231500Z');
  assert.match(preview.next_description, /Gate: needs_review/);
  assert.match(await readFile(path.join(repo, '.vibepro', 'brainbase', 'publish-preview.md'), 'utf8'), /PATCHは実行していない/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.brainbase.last_publish_preview.preview_json, '.vibepro/brainbase/publish-preview.json');
});

test('brainbase publish-status dry-run can target an explicit story id', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.brainbase.stories = [
    { story_id: 'story-first', title: 'First', ssot: 'NocoDB' },
    { story_id: 'story-target', title: 'Target', ssot: 'NocoDB' }
  ];
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T234000Z']);
  const requestedUrls = [];
  const fakeFetch = async (url) => {
    requestedUrls.push(url);
    if (url.includes('/api/v1/db/meta/tables/')) {
      return jsonResponse({
        columns: [
          { title: 'Story ID', column_name: 'story_id' },
          { title: '説明', column_name: 'description' }
        ]
      });
    }
    return jsonResponse({
      list: [{ Id: 99, 'Story ID': 'story-target', '説明': 'target description' }],
      pageInfo: { isLastPage: true }
    });
  };

  const result = await runCli(['brainbase', repo, '--publish-status', '--dry-run', '--story-id', 'story-target'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: fakeFetch
  });

  assert.equal(result.exitCode, 0);
  assert.equal(requestedUrls.some((url) => url.includes('story-target')), true);
  assert.equal(requestedUrls.some((url) => url.includes('story-first')), false);
  const preview = await readJson(path.join(repo, '.vibepro', 'brainbase', 'publish-preview.json'));
  assert.equal(preview.story_id, 'story-target');
});

test('brainbase publish-status fails when explicit story id is not in import state', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await mkdir(graphDir, { recursive: true });
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({ nodes: [{ id: 'app' }], edges: [] }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);
  await runCli(['diagnose', repo, '--run-id', '2026-04-28T234500Z']);

  const result = await runCli(['brainbase', repo, '--publish-status', '--dry-run', '--story-id', 'missing-story'], {
    env: {
      NOCODB_URL: 'https://noco.example.test',
      NOCODB_TOKEN: 'test-token',
      NOCODB_STORY_BASE_ID: 'base-1',
      NOCODB_STORY_TABLE_ID: 'table-1'
    },
    fetch: async () => {
      throw new Error('fetch should not be called');
    }
  });

  assert.equal(result.exitCode, 1);
});

test('story derive supports modular-web preset for non Next.js layouts', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'cli'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'mcp', 'server'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'core'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'domain', 'task'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'routes'), { recursive: true });
  await writeFile(path.join(repo, 'cli', 'index.js'), 'export function main() {}\n');
  await writeFile(path.join(repo, 'lib', 'services', 'auth-service.js'), 'export class AuthService {}\n');
  await writeFile(path.join(repo, 'mcp', 'server', 'index.js'), 'export function startServer() {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'core', 'event-bus.js'), 'export const eventBus = {};\n');
  await writeFile(path.join(repo, 'public', 'modules', 'domain', 'task', 'task-service.js'), 'export class TaskService {}\n');
  await writeFile(path.join(repo, 'server', 'routes', 'api.js'), 'export default function api() {}\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'cli_index', source_file: 'cli/index.js', label: 'cli/index.js' },
      { id: 'lib_auth', source_file: 'lib/services/auth-service.js', label: 'AuthService' },
      { id: 'mcp_server', source_file: 'mcp/server/index.js', label: 'mcp server' },
      { id: 'web_core', source_file: 'public/modules/core/event-bus.js', label: 'eventBus' },
      { id: 'web_domain_task', source_file: 'public/modules/domain/task/task-service.js', label: 'TaskService' },
      { id: 'server_route', source_file: 'server/routes/api.js', label: 'api route' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo, '--preset', 'modular-web']);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.preset, 'modular-web');
  assert.ok(catalog.coverage.totals.graph_story_relevant_files > 0,
    `expected coverage.relevant_files > 0, got ${catalog.coverage.totals.graph_story_relevant_files}`);
  assert.ok(catalog.coverage.by_role.length > 0,
    `expected by_role to have entries, got ${JSON.stringify(catalog.coverage.by_role)}`);

  const roles = catalog.coverage.by_role.map((entry) => entry.role);
  const expectedAny = ['cli', 'mcp_server', 'web_core', 'web_module', 'domain_service', 'server_route'];
  assert.ok(roles.some((role) => expectedAny.includes(role)),
    `expected modular-web role in ${JSON.stringify(roles)}`);

  const codeSurface = catalog.stories.filter((story) => story.source.type === 'code_surface');
  assert.ok(codeSurface.length >= 1,
    `expected at least 1 code_surface story for modular-web, got ${codeSurface.length}`);
});

test('story derive does not leak next-app product stories into modular-web preset', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'lib', 'services', 'shadow-call'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'services', 'stripe'), { recursive: true });
  await writeFile(path.join(repo, 'lib', 'services', 'shadow-call', 'index.js'), 'export {}\n');
  await writeFile(path.join(repo, 'lib', 'services', 'stripe', 'billing.js'), 'export {}\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'sc', source_file: 'lib/services/shadow-call/index.js', label: 'shadow-call' },
      { id: 'bill', source_file: 'lib/services/stripe/billing.js', label: 'billing' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const aitleProductIds = [
    'story-product-shadow-call',
    'story-product-premium-billing',
    'story-product-hotel-map-search',
    'story-product-content-cms'
  ];
  const leaked = catalog.stories.filter((s) => aitleProductIds.includes(s.story_id));
  assert.equal(leaked.length, 0,
    `next-app product stories must not leak into modular-web preset, found ${JSON.stringify(leaked.map((s) => s.story_id))}`);
});

test('story derive uses salestailor preset without Aitle product story leakage', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'sample-review'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'app', 'api', 'projects', '[projectId]', 'sample-review', 'regenerate'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'prompt-improvement'), { recursive: true });
  await mkdir(path.join(repo, 'src', 'lib', 'services', 'formSubmission'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'app', 'projects', '[projectId]', 'sample-review', 'page.tsx'),
    'export default function Page() { return <main>SalesTailor</main>; }\n');
  await writeFile(path.join(repo, 'src', 'app', 'api', 'projects', '[projectId]', 'sample-review', 'regenerate', 'route.ts'),
    'export async function POST() {}\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'prompt-improvement', 'promptFeedbackService.ts'),
    'export class PromptFeedbackService {}\n');
  await writeFile(path.join(repo, 'src', 'lib', 'services', 'formSubmission', 'formSubmissionOrchestrator.ts'),
    'export class FormSubmissionOrchestrator {}\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'review_page', source_file: 'src/app/projects/[projectId]/sample-review/page.tsx', label: 'SampleReview' },
      { id: 'regen_route', source_file: 'src/app/api/projects/[projectId]/sample-review/regenerate/route.ts', label: 'regenerate' },
      { id: 'feedback', source_file: 'src/lib/services/prompt-improvement/promptFeedbackService.ts', label: 'PromptFeedbackService' },
      { id: 'form', source_file: 'src/lib/services/formSubmission/formSubmissionOrchestrator.ts', label: 'FormSubmissionOrchestrator' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo, '--preset', 'salestailor']);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.preset, 'salestailor');
  const storyIds = catalog.stories.map((story) => story.story_id);
  assert.ok(storyIds.includes('story-salestailor-letter-generation-review'));
  assert.ok(storyIds.includes('story-salestailor-prompt-improvement-loop'));
  assert.ok(storyIds.includes('story-salestailor-contact-form-automation'));
  assert.equal(storyIds.some((id) => id.includes('hotel') || id.includes('shadow-call')), false,
    `salestailor preset must not emit Aitle story ids, got ${JSON.stringify(storyIds)}`);

  const serialized = JSON.stringify(catalog);
  assert.doesNotMatch(serialized, /Aitle|ホテル|旅行|予約/);
});

test('story derive emits story_candidates clustering uncovered files', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  // lib/auth/* and lib/legacy/* match modular-web relevant patterns but NOT
  // codeSurfaceSignatures, so they end up in coverage.uncovered.
  await mkdir(path.join(repo, 'lib', 'auth'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'legacy'), { recursive: true });
  for (let i = 0; i < 5; i += 1) {
    await writeFile(path.join(repo, 'lib', 'auth', `auth${i}.js`), 'export {}\n');
  }
  for (let i = 0; i < 6; i += 1) {
    await writeFile(path.join(repo, 'lib', 'legacy', `legacy${i}.js`), 'export {}\n');
  }

  const nodes = [];
  for (let i = 0; i < 5; i += 1) nodes.push({ id: `auth_${i}`, source_file: `lib/auth/auth${i}.js`, label: `auth${i}` });
  for (let i = 0; i < 6; i += 1) nodes.push({ id: `legacy_${i}`, source_file: `lib/legacy/legacy${i}.js`, label: `legacy${i}` });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links: [] }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.ok(Array.isArray(catalog.story_candidates),
    `catalog.story_candidates must be an array, got ${typeof catalog.story_candidates}`);
  assert.ok(catalog.story_candidates.length >= 2,
    `expected >= 2 candidates from uncovered clusters, got ${catalog.story_candidates.length} (uncovered=${catalog.coverage.totals.uncovered_files})`);

  const authCandidate = catalog.story_candidates.find((c) => c.common_path === 'lib/auth');
  assert.ok(authCandidate, `expected candidate for lib/auth, got ${JSON.stringify(catalog.story_candidates.map((c) => c.common_path))}`);
  assert.equal(authCandidate.role, 'auth');
  assert.equal(authCandidate.file_count, 5);
  assert.equal(authCandidate.confidence, 'medium');
  assert.match(authCandidate.candidate_id, /^candidate-auth-/);
  assert.ok(authCandidate.evidence.length > 0);
  assert.ok(authCandidate.open_questions.length > 0);

  const legacyCandidate = catalog.story_candidates.find((c) => c.common_path === 'lib/legacy');
  assert.ok(legacyCandidate);
  assert.equal(legacyCandidate.role, 'lib_module');
  assert.equal(legacyCandidate.file_count, 6);

  const map = await readFile(path.join(repo, '.vibepro', 'stories', 'story-map.md'), 'utf8');
  assert.match(map, /## Story候補（uncovered cluster）/);
  assert.match(map, /candidate-auth-lib-auth/);
});

test('modular-web preset coveragePatterns absorb broader paths into active stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'cli', 'sub'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'utils'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'controllers'), { recursive: true });
  await writeFile(path.join(repo, 'cli', 'main.js'), 'export {}\n');
  await writeFile(path.join(repo, 'cli', 'sub', 'extra.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'utils', 'helper.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'controllers', 'foo-controller.js'), 'export {}\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'cli_main', source_file: 'cli/main.js', label: 'main' },
      { id: 'cli_extra', source_file: 'cli/sub/extra.js', label: 'extra' },
      { id: 'utils_helper', source_file: 'public/modules/utils/helper.js', label: 'helper' },
      { id: 'foo_ctrl', source_file: 'server/controllers/foo-controller.js', label: 'foo' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.coverage.totals.uncovered_files, 0,
    `expected coveragePatterns to absorb all 4 files, got ${catalog.coverage.totals.uncovered_files} uncovered: ${JSON.stringify(catalog.coverage.uncovered.map((u) => u.path))}`);
  assert.equal(catalog.coverage.totals.coverage_ratio, 1,
    `expected coverage_ratio = 1, got ${catalog.coverage.totals.coverage_ratio}`);
});

test('brainbase preset emits semantically separated active stories', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'brainbase' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'cli'), { recursive: true });
  await mkdir(path.join(repo, 'mcp', 'brainbase', 'src'), { recursive: true });
  await mkdir(path.join(repo, 'mcp', 'jibble', 'src'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'mesh', 'crypto'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'services', 'session-runtime'), { recursive: true });
  await mkdir(path.join(repo, 'server', 'services'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'core'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'app'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'domain', 'nocodb-task'), { recursive: true });
  await mkdir(path.join(repo, 'public', 'modules', 'terminal'), { recursive: true });

  await writeFile(path.join(repo, 'cli', 'main.js'), 'export {}\n');
  await writeFile(path.join(repo, 'mcp', 'brainbase', 'src', 'server.js'), 'export {}\n');
  await writeFile(path.join(repo, 'mcp', 'jibble', 'src', 'index.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'mesh', 'crypto', 'cipher.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'services', 'session-runtime', 'state.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'services', 'terminal-transport-service.js'), 'export {}\n');
  await writeFile(path.join(repo, 'server', 'services', 'github-service.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'core', 'event-bus.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'app', 'home.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'domain', 'nocodb-task', 'service.js'), 'export {}\n');
  await writeFile(path.join(repo, 'public', 'modules', 'terminal', 'view.js'), 'export {}\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'cli', source_file: 'cli/main.js', label: 'cli' },
      { id: 'mcp_bb', source_file: 'mcp/brainbase/src/server.js', label: 'mcp-bb' },
      { id: 'mcp_jb', source_file: 'mcp/jibble/src/index.js', label: 'mcp-jb' },
      { id: 'mesh', source_file: 'server/mesh/crypto/cipher.js', label: 'mesh' },
      { id: 'sess', source_file: 'server/services/session-runtime/state.js', label: 'sess' },
      { id: 'term', source_file: 'server/services/terminal-transport-service.js', label: 'term' },
      { id: 'gh', source_file: 'server/services/github-service.js', label: 'gh' },
      { id: 'core', source_file: 'public/modules/core/event-bus.js', label: 'core' },
      { id: 'portal', source_file: 'public/modules/app/home.js', label: 'portal' },
      { id: 'nocodb', source_file: 'public/modules/domain/nocodb-task/service.js', label: 'nocodb' },
      { id: 'tview', source_file: 'public/modules/terminal/view.js', label: 'tview' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const ids = catalog.stories.map((s) => s.story_id);

  const expected = [
    'story-code-cli-tooling',
    'story-code-mcp-ssot',
    'story-code-mcp-external',
    'story-code-portal-views',
    'story-code-domain-data',
    'story-code-mana-detection',
    'story-code-terminal-runtime',
    'story-code-mesh-network',
    'story-code-external-integrations',
    'story-code-core-platform'
  ];
  for (const id of expected) {
    assert.ok(ids.includes(id), `expected ${id} in active stories, got ${JSON.stringify(ids)}`);
  }

  assert.equal(catalog.coverage.totals.uncovered_files, 0,
    `expected uncovered = 0 with brainbase preset, got ${catalog.coverage.totals.uncovered_files}`);
});

test('story derive surfaces domain subdirectories as separate candidates', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  // Place files under public/modules/domain/{task,session} so they would all
  // be grouped under "public/modules/domain" at depth 3 — but with depth 4
  // tuning, each subdomain should surface as its own candidate.
  await mkdir(path.join(repo, 'lib', 'auth-local'), { recursive: true });
  await mkdir(path.join(repo, 'lib', 'session-local'), { recursive: true });
  for (let i = 0; i < 3; i += 1) {
    await writeFile(path.join(repo, 'lib', 'auth-local', `auth${i}.js`), 'export {}\n');
  }
  for (let i = 0; i < 4; i += 1) {
    await writeFile(path.join(repo, 'lib', 'session-local', `sess${i}.js`), 'export {}\n');
  }

  const nodes = [];
  for (let i = 0; i < 3; i += 1) nodes.push({ id: `a${i}`, source_file: `lib/auth-local/auth${i}.js`, label: `auth${i}` });
  for (let i = 0; i < 4; i += 1) nodes.push({ id: `s${i}`, source_file: `lib/session-local/sess${i}.js`, label: `sess${i}` });
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({ nodes, links: [] }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const paths = catalog.story_candidates.map((c) => c.common_path);

  assert.ok(paths.includes('lib/auth-local'),
    `expected lib/auth-local subdir candidate, got ${JSON.stringify(paths)}`);
  assert.ok(paths.includes('lib/session-local'),
    `expected lib/session-local subdir candidate, got ${JSON.stringify(paths)}`);
});

test('story derive omits singletons from story_candidates', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.story_catalog = { preset: 'modular-web' };
  await writeFile(configPath, JSON.stringify(config, null, 2));

  await mkdir(path.join(repo, 'cli'), { recursive: true });
  await writeFile(path.join(repo, 'cli', 'lonely.js'), 'export {}\n');
  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [{ id: 'lonely', source_file: 'cli/lonely.js', label: 'lonely' }],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  const cliCandidates = catalog.story_candidates.filter((c) => c.role === 'cli');
  assert.equal(cliCandidates.length, 0,
    `singletons must not be emitted as candidates, got ${JSON.stringify(cliCandidates)}`);
});

test('story derive keeps next-app preset behavior when preset is unset', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);

  await mkdir(path.join(repo, 'src', 'components', 'hotel'), { recursive: true });
  await writeFile(path.join(repo, 'src', 'components', 'hotel', 'HotelDetail.tsx'),
    'export function HotelDetail() { return null; }\n');

  await writeFile(path.join(repo, '.vibepro', 'graphify', 'graph.json'), JSON.stringify({
    nodes: [
      { id: 'hotel_detail', source_file: 'src/components/hotel/HotelDetail.tsx', label: 'HotelDetail' }
    ],
    links: []
  }));

  const result = await runCli(['story', 'derive', repo]);
  assert.equal(result.exitCode, 0);

  const catalog = await readJson(path.join(repo, '.vibepro', 'stories', 'story-catalog.json'));
  assert.equal(catalog.source.preset, 'next-app');
  assert.ok(catalog.coverage.totals.graph_story_relevant_files > 0,
    `default preset must keep classifying src/ files as relevant`);
  const roles = catalog.coverage.by_role.map((entry) => entry.role);
  assert.ok(roles.includes('component'),
    `default preset must classify src/components/** as 'component', got ${JSON.stringify(roles)}`);
});

test('pr prepare --strict requires --task option', async () => {
  const repo = await makeGitRepoWithStory();
  let stderrOut = '';
  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--strict'], {
    stderr: { write: (text) => { stderrOut += text; } }
  });
  assert.equal(result.exitCode, 1);
  assert.match(stderrOut, /Strict mode requires --task/);
});

test('pr prepare --strict rejects when task artifacts are missing', async () => {
  const repo = await makeRepo();
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', 'story-strict', '--title', 'Strict Test', '--view', 'dev', '--period', '2026-W18']);
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: init']);
  await git(repo, ['switch', '-c', 'feature/strict']);

  // task list のみ作成（briefing/plan/handoff は未作成）
  const taskDir = path.join(repo, '.vibepro', 'stories', 'story-strict', 'tasks');
  await mkdir(taskDir, { recursive: true });
  await writeFile(path.join(taskDir, 'tasks.json'), JSON.stringify({
    schema_version: '0.1.0',
    story: { story_id: 'story-strict' },
    source_run: { run_id: 'run-1' },
    tasks: [{ id: 'TASK-S1', title: 'strict task', target_files: ['src/index.js'] }]
  }));

  let stderrOut = '';
  const result = await runCli(['pr', 'prepare', repo, '--base', 'main', '--task', 'TASK-S1', '--strict'], {
    stderr: { write: (text) => { stderrOut += text; } }
  });
  assert.equal(result.exitCode, 1);
  assert.match(stderrOut, /Strict mode requires task artifacts/);
  assert.match(stderrOut, /briefing\.md/);
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}
