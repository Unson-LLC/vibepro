import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  buildJudgmentDagAdjudicationGate,
  prepareJudgmentAdjudication
} from '../../src/adjudication.js';

const execFileAsync = promisify(execFile);
const CLI_PATH = fileURLToPath(new URL('../../bin/vibepro.js', import.meta.url));
const STORY_ID = 'story-classifier-premise-recovery-e2e';

async function git(repo, args) {
  await execFileAsync('git', args, { cwd: repo });
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-cpr-e2e-'));
  await git(repo, ['init', '-b', 'main']);
  await git(repo, ['config', 'user.email', 'test@example.com']);
  await git(repo, ['config', 'user.name', 'Test User']);
  await writeFile(path.join(repo, 'README.md'), '# Fixture\n');
  await mkdir(path.join(repo, '.vibepro', 'pr', STORY_ID), { recursive: true });
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify({
    schema_version: '0.1.0',
    tool: 'vibepro',
    workspace: '.vibepro',
    brainbase: {
      stories: [{ story_id: STORY_ID, title: 'Classifier premise recovery fixture', ssot: 'local', status: 'active' }],
      current_story_id: STORY_ID
    }
  }, null, 2)}\n`, 'utf8');
  await writeFile(path.join(repo, '.vibepro', 'pr', STORY_ID, 'pr-prepare.json'), `${JSON.stringify({
    git: { changed_files: [{ path: 'src/pipeline.js' }, { path: 'test/pipeline.test.js' }] },
    pr_context: {
      gate_dag: {
        nodes: [{
          id: 'gate:judgment_axis_public_contract',
          type: 'judgment_axis_gate',
          axis: 'public_contract',
          status: 'passed',
          decision_question: 'Does the public contract remain valid?',
          matched_evidence: [{ kind: 'compat_or_output_test', ref: 'npm test' }]
        }]
      },
      engineering_judgment: { route_type: 'agent_workflow' },
      change_classification: { profile: 'standard' }
    }
  }, null, 2)}\n`, 'utf8');
  await git(repo, ['add', '.']);
  await git(repo, ['commit', '-m', 'chore: baseline']);
  return repo;
}

async function headOf(repo) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repo });
  return stdout.trim();
}

// story-vibepro-classifier-premise-recovery ac:1 ac:2 ac:3 ac:4 ac:5 ac:6 ac:7 ac:8 ac:9 ac:10 S-001 S-002
test('CPR-E2E-001 real CLI preserves an unsound verdict, records evidence-backed correction, and requires linked independent re-adjudication', async () => {
  const repo = await makeRepo();
  await mkdir(path.join(repo, 'docs'), { recursive: true });
  await writeFile(path.join(repo, 'docs', 'premise-proof.md'), 'The compatibility output is unchanged.\n', 'utf8');
  const initial = [
    CLI_PATH, 'adjudicate', 'record', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--verdict', 'judged_unsound', '--reason', 'classifier assumed the output changed',
    '--agent-system', 'codex', '--agent-id', 'judge-original'
  ];
  await assert.rejects(() => execFileAsync('node', initial), /--unsound-cause/);
  await execFileAsync('node', [...initial, '--unsound-cause', 'classifier_premise_unsound']);
  let stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  const originalId = stored.events[0].event_id;

  await execFileAsync('node', [
    CLI_PATH, 'adjudicate', 'correct', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--original-verdict-id', originalId,
    '--incorrect-premise', 'public output changed',
    '--corrected-premise', 'public output is unchanged',
    '--reason', 'the compatibility artifact proves the corrected premise',
    '--replacement-evidence', 'docs/premise-proof.md',
    '--agent-system', 'codex', '--agent-id', 'operator'
  ]);
  stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  const correctionId = stored.events[1].event_id;
  let gate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: stored,
    headSha: await headOf(repo)
  });
  assert.equal(gate.status, 'needs_evidence');
  assert.deepEqual(gate.pending_correction_items, ['axis:public_contract']);
  const prepared = await prepareJudgmentAdjudication(repo, { storyId: STORY_ID });
  const request = await readFile(path.join(repo, prepared.artifact), 'utf8');
  assert.match(request, /implementation_unsound/);
  assert.match(request, /classifier_premise_unsound/);
  assert.match(request, new RegExp(correctionId));
  assert.match(request, /generic waiverや設定無効化で代替してはならない/);

  await execFileAsync('node', [
    CLI_PATH, 'adjudicate', 'record', repo,
    '--id', STORY_ID, '--judgment', '--item', 'axis:public_contract',
    '--correction-id', correctionId, '--verdict', 'judged_sound',
    '--reason', 'fresh review confirms the corrected premise and judgment',
    '--agent-system', 'codex', '--agent-id', 'judge-fresh'
  ]);
  stored = JSON.parse(await readFile(path.join(repo, '.vibepro', 'adjudication', STORY_ID, 'judgment-adjudication.json'), 'utf8'));
  assert.deepEqual(stored.events.map((event) => event.type), ['verdict', 'premise_correction', 'verdict']);
  assert.equal(stored.events[2].responds_to_correction_id, correctionId);
  gate = buildJudgmentDagAdjudicationGate({
    storyId: STORY_ID,
    items: [{ id: 'axis:public_contract' }],
    adjudication: stored,
    headSha: await headOf(repo)
  });
  assert.equal(gate.status, 'passed');
});
