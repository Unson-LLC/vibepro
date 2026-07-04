import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { deflateSync } from 'node:zlib';

import { runCli } from '../../src/cli.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-ui-journey-e2e-dogfood';

async function git(repo, args) {
  return execFileAsync('git', args, { cwd: repo, encoding: 'utf8' });
}

async function captureRunCli(args) {
  let stdout = '';
  let stderr = '';
  const result = await runCli(args, {
    stdout: { write: (text) => { stdout += text; } },
    stderr: { write: (text) => { stderr += text; } }
  });
  return { ...result, stdout, stderr };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePng(filePath, width, height, rgbaPixels) {
  const pixels = Buffer.from(rgbaPixels);
  assert.equal(pixels.length, width * height * 4);
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(Buffer.concat([
      Buffer.from([0]),
      pixels.subarray(y * width * 4, (y + 1) * width * 4)
    ]));
  }
  await writeFile(filePath, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.concat([uint32(width), uint32(height), Buffer.from([8, 6, 0, 0, 0])])),
    pngChunk('IDAT', deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0))
  ]));
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  return Buffer.concat([uint32(data.length), typeBuffer, data, uint32(crc32(Buffer.concat([typeBuffer, data])))]);
}

function uint32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value >>> 0);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function pathExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function writeStory(repo, fileName, content) {
  const dir = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, fileName), content);
}

function findGate(prepareArtifact, gateId) {
  return prepareArtifact.pr_context.gate_dag.nodes.find((node) => node.id === gateId);
}

test('story-vibepro-ui-journey-e2e-dogfood runs the frozen UI route through VibePro producers', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-ui-dogfood-route-'));
  await mkdir(path.join(repo, 'src', 'components'), { recursive: true });
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'vibepro@example.com']);
  await git(repo, ['config', 'user.name', 'VibePro Test']);
  await runCli(['init', repo, '--story-id', STORY_ID, '--title', 'UI Journey E2E Dogfood']);

  await writeStory(repo, 'story-vibepro-ui-discovery.md', `---
story_id: story-vibepro-ui-discovery
title: Discovery
journey_activity: acquisition
journey_step: discover
release_slice: walking_skeleton
status: active
---
# Discovery

## Acceptance Criteria
- Users can understand the product value before signup
`);
  await writeStory(repo, `${STORY_ID}.md`, `---
story_id: ${STORY_ID}
title: UI Journey E2E Dogfood
journey_activity: activation
journey_step: signup
release_slice: walking_skeleton
status: active
---
# UI Journey E2E Dogfood

## Acceptance Criteria
- UJD-S-1: The story reaches pr prepare with curated Journey context.
- UJD-S-2: Visual QA and Journey context resolve from evidence without waivers.
- UJD-S-3: The route stays on VibePro commands through merge readiness.
- UJD-S-4: The report reconciles the declared dogfood targets.
- UJD-S-5: The frozen route asserts curation, visual evidence, gate resolution, and merge preconditions.
- UJD-S-6: The workflow transition is recorded without stale or waived evidence.
`);
  await writeStory(repo, 'story-vibepro-ui-first-value.md', `---
story_id: story-vibepro-ui-first-value
title: First value
journey_activity: core_usage
journey_step: first-value
release_slice: walking_skeleton
status: active
---
# First value

## Acceptance Criteria
- Users can complete the first useful workflow
`);
  await writeFile(path.join(repo, 'src', 'components', 'Signup.tsx'), 'export function Signup() { return <button>Start</button>; }\n');
  await git(repo, ['add', '-A']);
  await git(repo, ['commit', '-m', 'chore: bootstrap ui journey']);

  const derived = await captureRunCli(['journey', 'derive', repo, '--json']);
  assert.equal(derived.exitCode, 0, derived.stderr);
  const derivedJourney = JSON.parse(derived.stdout);
  assert.equal(derivedJourney.curation_status, 'needs_curated_journey', `${STORY_ID} UJD-S-6 machine-derived Journey context is captured before curation`);

  const handoff = await captureRunCli(['journey', 'handoff', repo]);
  assert.equal(handoff.exitCode, 0, handoff.stderr);
  assert.match(handoff.stdout, /Journey AI Handoff/, `${STORY_ID} UJD-S-6 handoff records the machine-derived workflow state`);

  const judgmentsPath = path.join(repo, 'journey-judgments.json');
  await writeJson(judgmentsPath, {});
  const curated = await captureRunCli(['journey', 'curate', repo, '--input', judgmentsPath, '--json']);
  assert.equal(curated.exitCode, 0, curated.stderr);
  const curatedJourney = JSON.parse(curated.stdout);
  assert.equal(curatedJourney.artifact_kind, 'curated_journey', `${STORY_ID} ac:1 UJD-S-1 curated Journey artifact is written before pr prepare`);
  assert.equal(curatedJourney.authoritative, true, `${STORY_ID} ac:1 UJD-S-1 curated Journey is authoritative`);

  const journeyStatus = await captureRunCli(['journey', 'status', repo, '--json']);
  assert.equal(journeyStatus.exitCode, 0, journeyStatus.stderr);
  const parsedJourneyStatus = JSON.parse(journeyStatus.stdout);
  assert.equal(parsedJourneyStatus.curated, true, `${STORY_ID} ac:1 UJD-S-1 journey status reports curated context`);
  assert.equal(parsedJourneyStatus.artifact_kind, 'curated_journey', `${STORY_ID} ac:1 UJD-S-1 journey status uses curated Journey`);

  await git(repo, ['switch', '-c', 'feature/ui-journey-dogfood']);
  await writeFile(path.join(repo, 'src', 'components', 'Signup.tsx'), 'export function Signup() { return <button>Create account</button>; }\n');
  await mkdir(path.join(repo, 'artifacts', 'visual-current'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'qa', 'baseline'), { recursive: true });
  await writePng(path.join(repo, 'artifacts', 'visual-current', 'signup-route.png'), 1, 1, [42, 80, 120, 255]);
  await writePng(path.join(repo, '.vibepro', 'qa', 'baseline', 'signup-route.png'), 1, 1, [42, 80, 120, 255]);

  const configPath = path.join(repo, '.vibepro', 'config.json');
  const config = await readJson(configPath);
  config.flow_design = {
    runtime_probes: [{
      id: 'signup-route',
      title: 'Signup route',
      path: '/',
      mutates: false,
      steps: [{ action: 'screenshot', name: 'signup-route' }]
    }]
  };
  await writeJson(configPath, config);

  await git(repo, ['add', 'src/components/Signup.tsx']);
  await git(repo, ['commit', '-m', 'feat: update signup journey ui']);

  const visual = await runCli([
    'verify',
    'visual',
    repo,
    '--id',
    STORY_ID,
    '--current-dir',
    'artifacts/visual-current',
    '--qa-id',
    `${STORY_ID}-visual`,
    '--json'
  ]);
  assert.equal(visual.exitCode, 0);
  assert.equal(visual.result.report.status, 'pass', `${STORY_ID} ac:2 UJD-S-2 visual evidence resolves from residual artifacts without waiver`);
  assert.equal(visual.result.report.meanAbsResidualPct, 0, `${STORY_ID} ac:2 UJD-S-2 visual residual is evidence-derived`);
  assert.equal(
    await pathExists(path.join(repo, '.vibepro', 'qa', `${STORY_ID}-visual`, 'visual-residual.json')),
    true,
    `${STORY_ID} UJD-S-6 current-head visual evidence artifact is recorded`
  );

  const prepare = await runCli(['pr', 'prepare', repo, '--base', 'main', '--story-id', STORY_ID, '--allow-extra-files', '--json']);
  assert.equal(prepare.exitCode, 0);
  const prepareArtifact = prepare.result.preparation;
  const journeyGate = findGate(prepareArtifact, 'gate:journey_context');
  const visualGate = findGate(prepareArtifact, 'gate:visual_qa');

  assert.equal(journeyGate.status, 'passed', `${STORY_ID} ac:2 UJD-S-2 gate:journey_context resolves without waiver`);
  assert.equal(journeyGate.curated, true, `${STORY_ID} ac:1 UJD-S-1 pr prepare consumes curated Journey`);
  assert.equal(visualGate.status, 'ready_for_review', `${STORY_ID} ac:2 UJD-S-2 gate:visual_qa resolves from current residual evidence`);
  assert.equal(
    prepareArtifact.gate_status.critical_unresolved_gates.some((gate) => gate.id === 'gate:journey_context' || gate.id === 'gate:visual_qa'),
    false,
    `${STORY_ID} ac:5 UJD-S-5 route regression coverage verifies target gate resolution`
  );
  assert.equal(
    findGate(prepareArtifact, 'gate:dag_connectivity')?.status,
    'passed',
    `${STORY_ID} ac:5 UJD-S-5 Gate DAG stays connected through the final PR decision`
  );
  assert.equal(
    prepareArtifact.pr_context.gate_dag.nodes.some((node) => node.id === 'pr' && node.status === 'pending'),
    true,
    `${STORY_ID} ac:5 UJD-S-5 pr prepare emits the PR decision precondition node`
  );

  const prBody = await readFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-body.md'), 'utf8');
  assert.doesNotMatch(prBody, /gh pr create/, `${STORY_ID} ac:3 UJD-S-3 generated route does not instruct raw gh pr create bypass`);

  const report = await readFile(new URL('../../docs/reference/vibepro-ui-journey-e2e-dogfood.md', import.meta.url), 'utf8');
  assert.match(report, /vibepro execute merge/, `${STORY_ID} ac:3 UJD-S-3 dogfood route is declared as VibePro execute merge`);
  assert.doesNotMatch(report, /gh pr create/, `${STORY_ID} ac:3 UJD-S-3 dogfood route does not document raw gh pr create bypass`);
  assert.match(report, /Manual command count/, `${STORY_ID} ac:4 UJD-S-4 report records measured command count`);
  assert.match(report, /Friction/, `${STORY_ID} ac:4 UJD-S-4 report records friction`);
  assert.match(report, /Workaround/, `${STORY_ID} ac:4 UJD-S-4 report records workarounds`);
  assert.match(report, /Pre-declared Targets/, `${STORY_ID} ac:4 UJD-S-4 report records declared targets`);
  assert.match(report, /Reconciliation/, `${STORY_ID} ac:4 UJD-S-4 report reconciles outcomes against declarations`);
  assert.match(report, /follow-up|residual friction/i, `${STORY_ID} ac:6 UJD-S-6 report records follow-up or accepted residual friction handling`);
});
