import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runCli } from '../src/cli.js';

async function makeRepo() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-test-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>Test</title>');
  return root;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
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

test('diagnose creates a run, evidence, reports, and updates the manifest', async () => {
  const repo = await makeRepo();
  await runCli(['init', repo]);
  const graphDir = path.join(repo, 'graphify-out');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(graphDir, { recursive: true }));
  await writeFile(path.join(graphDir, 'graph.json'), JSON.stringify({
    nodes: [{ id: 'app' }, { id: 'api' }],
    edges: [
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
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.graphify.node_count, 2);
  assert.equal(evidence.graphify.ambiguous_edges.length, 1);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(manifest.latest_run, '2026-04-28T120000Z');
  assert.equal(manifest.runs[0].artifacts.summary, '.vibepro/diagnostics/2026-04-28T120000Z/summary.md');
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
document.body.innerHTML = location.hash;
eval("1+1");
`);
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
  assert.equal(evidence.static_site.external_resources.length > 0, true);
  assert.equal(evidence.static_site.non_static_files.some((item) => item.file === 'server.py'), true);
  assert.equal(evidence.gates[0].status, 'block');
  assert.match(await readFile(path.join(runDir, 'risk-register.md'), 'utf8'), /秘密情報/);
  const manifest = await readJson(path.join(repo, '.vibepro', 'vibepro-manifest.json'));
  assert.equal(
    manifest.runs[0].artifacts.static_site_check,
    '.vibepro/diagnostics/2026-04-28T130000Z/static-site-check-result.md'
  );
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

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}
