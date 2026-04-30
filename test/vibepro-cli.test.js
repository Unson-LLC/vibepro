import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { scanApiBoundary } from '../src/api-boundary-scanner.js';
import { runCli } from '../src/cli.js';
import { buildStoryTaskState } from '../src/story-task-generator.js';

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
  const evidence = await readJson(path.join(runDir, 'evidence.json'));
  assert.equal(evidence.graphify.node_count, 2);
  assert.equal(evidence.graphify.edge_count, 2);
  assert.equal(evidence.graphify.edge_source_key, 'links');
  assert.equal(evidence.graphify.extracted_edges.length, 1);
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
const access_token = "runtimeReviewToken123";
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
  assert.equal(evidence.static_site.risk_summary.secret_hits.block, 1);
  assert.equal(evidence.static_site.risk_summary.secret_hits.info, 2);
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
  await writeFile(path.join(repo, 'src', 'app', 'api', 'companies', 'route.ts'), 'export async function GET() { return Response.json([]); }\n');
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
  await writeFile(path.join(repo, 'src', 'lib', 'queue.ts'), `
export function requireQueueAuth(request) {
  return request.headers.get('authorization');
}
export function verifyQueueSignature(signature) {
  return Boolean(signature);
}
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
      { id: 'webhook-route', label: 'stripe webhook', source_file: 'src/app/api/webhooks/stripe/route.ts', community: 10 }
    ],
    links: [
      { source: 'queue-route', target: 'queue-handler', confidence: 'EXTRACTED', relation: 'contains' },
      { source: 'queue-handler', target: 'queue-service', confidence: 'EXTRACTED', relation: 'calls' },
      { source: 'debug-route', target: 'queue-service', confidence: 'INFERRED', relation: 'calls' },
      { source: 'webhook-route', target: 'queue-service', confidence: 'INFERRED', relation: 'calls' }
    ]
  }));
  await writeFile(path.join(graphDir, 'GRAPH_REPORT.md'), '# Graph Report');
  await runCli(['graph', repo, '--from', graphDir]);

  const result = await runCli(['diagnose', repo, '--run-id', '2026-04-28T140000Z']);

  assert.equal(result.exitCode, 0);
  const runDir = path.join(repo, '.vibepro', 'diagnostics', '2026-04-28T140000Z');
  await stat(path.join(runDir, 'architecture-profile.md'));
  await stat(path.join(runDir, 'finding-review.md'));
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
  assert.equal(evidence.check_catalog.applicable_checks.includes('auth-boundary'), true);
  assert.equal(evidence.check_catalog.applicable_checks.includes('static-entry'), false);
  assert.equal(evidence.static_site.secret_hits.some((hit) => hit.file === '.env.local'), true);
  assert.equal(evidence.api_boundary.routes.length, 7);
  assert.equal(evidence.api_boundary.protection_summary.protected_by_middleware, 3);
  assert.equal(evidence.api_boundary.protection_summary.protected_by_route, 1);
  assert.equal(evidence.api_boundary.protection_summary.excluded_by_middleware, 3);
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
  assert.equal(evidence.action_candidates.length, 3);
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
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-API-002'), true);
  assert.equal(evidence.findings.some((finding) => finding.id === 'VP-API-003'), true);
  assert.equal(evidence.finding_review.status, 'needs_review');
  assert.equal(evidence.finding_review.summary.total, evidence.findings.length);
  assert.equal(evidence.finding_review.summary.unreviewed, evidence.findings.length);
  assert.equal(evidence.finding_review.items.find((item) => item.finding_id === 'VP-API-001').suggested_classification, 'implementation_gap');
  assert.equal(evidence.finding_review.items.find((item) => item.finding_id === 'VP-GRAPH-002').suggested_classification, 'detector_gap');
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
  assert.match(summary, /保護状態別/);
  assert.match(summary, /excluded_by_middleware \| 3/);
  assert.match(summary, /## 次アクション候補/);
  assert.match(summary, /VP-ACTION-API-001/);
  assert.match(summary, /Impact/);
  assert.match(summary, /読むファイル/);
  assert.match(summary, /実装手順/);
  assert.match(summary, /修正前ブリーフィング/);
  assert.match(summary, /## 診断レビュー/);
  assert.match(summary, /suggested implementation_gap/);
  assert.match(summary, /方針A/);
  assert.match(summary, /7\(route: 1, node: 2, edge: 2\)/);
  const riskRegister = await readFile(path.join(runDir, 'risk-register.md'), 'utf8');
  assert.match(riskRegister, /## API境界の保護状態/);
  assert.match(riskRegister, /## 診断レビュー分類/);
  assert.match(riskRegister, /VP-API-001 \| unreviewed \| implementation_gap/);
  assert.match(riskRegister, /excluded_by_middleware \| 3/);
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
  assert.match(importSummary, /excluded_by_middleware \| 3/);
  assert.match(importSummary, /## 診断レビュー/);
  assert.match(importSummary, /suggested detector_gap/);
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
  assert.equal(importState.signals.api_boundary.route_count, 7);
  assert.equal(importState.signals.api_boundary.summary.debug, 1);
  assert.equal(importState.signals.api_boundary.protection_summary.excluded_by_middleware, 3);
  assert.equal(importState.signals.finding_review.summary.total, importState.findings.length);
  assert.equal(importState.findings.find((finding) => finding.id === 'VP-API-001').review.suggested_classification, 'implementation_gap');
  assert.equal(importState.signals.tasks.length, 5);
  assert.equal(importState.signals.tasks[0].id, 'VP-TASK-STATIC-002-BLOCK');
  assert.equal(importState.signals.tasks[4].source_id, 'VP-ACTION-API-001');
  assert.equal(importState.signals.action_candidates.length, 3);
  assert.equal(importState.signals.action_candidates[0].mutates_repository, false);
  assert.equal(importState.signals.action_candidates[0].graph_context.matched_route_count, 1);
  assert.equal(importState.signals.action_candidates[0].implementation_plan.read_first_files.some((item) => item.file === 'src/lib/queue.ts'), true);
  assert.equal(importState.signals.action_candidates[0].implementation_plan.pre_fix_briefing.recommended_strategy.id, 'route-level-auth');
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

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    }
  };
}
