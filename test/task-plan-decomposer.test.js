import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { decomposeStoryToTaskPlan } from '../src/task-plan-decomposer.js';
import { analyzeTaskPlan } from '../src/task-plan.js';

const execFileAsync = promisify(execFile);
const CLI = path.join(process.cwd(), 'bin', 'vibepro.js');

function baseStory(overrides = '') {
  return `---
story_id: story-vibepro-task-plan-decomposer-fixture
owner_repository: vibepro
priority: high
conflict_owner: codex-parent
---

# Storyからtask-planを作る

## 受入条件

- AC-1: first acceptance criterion
- AC-2: second acceptance criterion

## allowed_paths

- src/task-plan-decomposer.js
- test/task-plan-decomposer.test.js

## 委任範囲

- implement the decomposer boundary

${overrides}`;
}

test('decompose: two acceptance criteria yield plan_version and no overlap_refs', () => {
  const plan = decomposeStoryToTaskPlan(baseStory(), { repository: 'vibepro' });
  assert.equal(plan.schema_version, '0.2.0');
  assert.match(plan.plan_version, /^plan-[a-f0-9]{12}$/);
  assert.equal('overlap_refs' in plan, false);
  assert.deepEqual(plan.tasks.map((task) => task.task_id), ['AC-1', 'AC-2']);
  assert.equal(plan.tasks[0].purpose, 'AC-1: first acceptance criterion');
  assert.deepEqual(plan.tasks[0].acceptance_criteria, ['AC-1: first acceptance criterion']);
  assert.deepEqual(plan.tasks[0].allowed_paths, ['src/task-plan-decomposer.js', 'test/task-plan-decomposer.test.js']);
});

test('decompose: identical input matches plan_version and AC edits change it', () => {
  const first = decomposeStoryToTaskPlan(baseStory(), { repository: 'vibepro' });
  const second = decomposeStoryToTaskPlan(baseStory(), { repository: 'vibepro' });
  assert.equal(first.plan_version, second.plan_version);

  const changed = decomposeStoryToTaskPlan(
    baseStory().replace('second acceptance criterion', 'changed acceptance criterion'),
    { repository: 'vibepro' }
  );
  assert.notEqual(first.plan_version, changed.plan_version);
});

test('decompose: declared overlap_refs normalize to T3 completion_contract_ref shape', () => {
  const story = `${baseStory()}
## overlap_refs

- shared-contract@1: AC-2, AC-1
`;
  const plan = decomposeStoryToTaskPlan(story, { repository: 'vibepro' });
  assert.deepEqual(plan.overlap_refs, [{
    completion_contract_ref: 'shared-contract@1',
    task_ids: ['AC-1', 'AC-2']
  }]);
  assert.equal('completion_contract' in plan.overlap_refs[0], false);
});

test('decompose: rejects forbidden body field sections', () => {
  assert.throws(
    () => decomposeStoryToTaskPlan(`${baseStory()}\n## completion_contract\n\nsecret body\n`, { repository: 'vibepro' }),
    /forbidden body field section: completion_contract/
  );
});

test('decompose: rejects missing allowed_paths', () => {
  const story = baseStory().replace('## allowed_paths\n\n- src/task-plan-decomposer.js\n- test/task-plan-decomposer.test.js\n', '');
  assert.throws(
    () => decomposeStoryToTaskPlan(story, { repository: 'vibepro' }),
    /missing required story input:.*allowed_paths/
  );
});

test('decompose: overlap_refs do not block task start', () => {
  const story = `${baseStory()}
## overlap_refs

- shared-contract@1: AC-1, AC-2
`;
  const plan = decomposeStoryToTaskPlan(story, { repository: 'vibepro' });
  const analysis = analyzeTaskPlan(plan);
  assert.deepEqual(analysis.ready_stages.start, ['AC-1', 'AC-2']);
});

test('task plan decompose --json prints schema_version 0.2.0 and plan_version', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-decompose-cli-'));
  const storyPath = path.join(root, 'story.md');
  await writeFile(storyPath, baseStory());
  const { stdout } = await execFileAsync(process.execPath, [
    CLI,
    'task',
    'plan',
    'decompose',
    root,
    '--story',
    storyPath,
    '--json'
  ], { cwd: process.cwd() });
  const plan = JSON.parse(stdout);
  assert.equal(plan.schema_version, '0.2.0');
  assert.match(plan.plan_version, /^plan-[a-f0-9]{12}$/);
});
