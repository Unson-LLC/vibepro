import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { curateJourneyMap, deriveJourneyMap } from '../src/journey-map.js';

function storyDoc({ id, step, activity = 'activation', slice = 'walking_skeleton', tags = null, createdAt }) {
  return [
    '---',
    `story_id: ${id}`,
    `title: ${id}`,
    `created_at: ${createdAt}`,
    `journey_activity: ${activity}`,
    `journey_step: ${step}`,
    `release_slice: ${slice}`,
    tags ? `tags: ${tags}` : null,
    '---',
    '',
    `# ${id}`,
    ''
  ].filter((line) => line !== null).join('\n');
}

async function setupRepo({ journeyConfig = null } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-journey-scope-'));
  await mkdir(path.join(repo, 'docs', 'stories'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro'), { recursive: true });
  const stories = [
    { id: 'journey9-connect', step: 'agent-connect-request', tags: '[journey-9]', createdAt: '2026-10-15T16:00:01+09:00' },
    { id: 'journey9-approve', step: 'agent-approve', tags: 'journey-9, agents', createdAt: '2026-10-15T16:00:02+09:00' },
    { id: 'j9-notify-slack', step: 'agent-approval-notify', slice: 'next_slice', createdAt: '2026-10-15T16:00:03+09:00' },
    { id: 'billing-pay', step: 'pay', activity: 'monetization', createdAt: '2026-10-15T16:00:04+09:00' },
    { id: 'signup-basic', step: 'signup', createdAt: '2026-10-15T16:00:05+09:00' }
  ];
  for (const story of stories) {
    await writeFile(path.join(repo, 'docs', 'stories', `${story.id}.md`), storyDoc(story));
  }
  const config = { schema_version: '0.1.0', current_story_id: null };
  if (journeyConfig) config.journey = { journeys: { 'agent-registration': journeyConfig } };
  await writeFile(path.join(repo, '.vibepro', 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return repo;
}

async function writeInput(repo, value) {
  const inputPath = path.join(repo, 'judgments.json');
  await writeFile(inputPath, `${JSON.stringify(value, null, 2)}\n`);
  return inputPath;
}

test('JSC-1 derive without journey config keeps all Stories and the inferred walking skeleton', async () => {
  const repo = await setupRepo();
  const { journey } = await deriveJourneyMap(repo, { journeyId: 'agent-registration' });
  assert.equal(journey.scope, undefined);
  assert.equal(journey.source_story_ids.length, 5);
  assert.deepEqual(journey.walking_skeleton.required_step_ids, ['discover', 'signup', 'first-value']);
});

test('JSC-2 derive scope by Story tag and ID prefix limits source Stories', async () => {
  const repo = await setupRepo({ journeyConfig: { scope: { story_tags: ['journey-9'], story_id_prefixes: ['j9-'] } } });
  const { journey } = await deriveJourneyMap(repo, { journeyId: 'agent-registration' });
  assert.deepEqual(journey.scope, { story_tags: ['journey-9'], story_id_prefixes: ['j9-'], story_ids: [] });
  assert.deepEqual([...journey.source_story_ids].sort(), ['j9-notify-slack', 'journey9-approve', 'journey9-connect']);
  const optionScoped = await deriveJourneyMap(repo, { journeyId: 'agent-registration', scope: { story_ids: ['billing-pay'] } });
  assert.deepEqual(optionScoped.journey.source_story_ids, ['billing-pay']);
});

test('JSC-3 configured walking-skeleton required steps replace the default only when configured', async () => {
  const repo = await setupRepo({
    journeyConfig: {
      scope: { story_tags: ['journey-9'], story_id_prefixes: ['j9-'] },
      walking_skeleton: { required_step_ids: ['agent-connect-request', 'agent-approval-notify', 'agent-approve'] }
    }
  });
  const { journey } = await deriveJourneyMap(repo, { journeyId: 'agent-registration' });
  assert.deepEqual(journey.walking_skeleton.required_step_ids, ['agent-connect-request', 'agent-approval-notify', 'agent-approve']);
  assert.deepEqual(journey.walking_skeleton.covered_step_ids.sort(), ['agent-approval-notify', 'agent-approve', 'agent-connect-request']);
  const skeleton = journey.release_slices.find((slice) => slice.slice_id === 'walking_skeleton');
  assert.deepEqual(skeleton.required_step_ids, ['agent-connect-request', 'agent-approval-notify', 'agent-approve']);
  const other = await deriveJourneyMap(repo, { journeyId: 'default-product-journey' });
  assert.deepEqual(other.journey.walking_skeleton.required_step_ids, ['discover', 'signup', 'first-value']);
});

test('JSC-4 curate adds a step without a Story and a curated open question', async () => {
  const repo = await setupRepo({
    journeyConfig: {
      scope: { story_tags: ['journey-9'] },
      walking_skeleton: { required_step_ids: ['agent-connect-request', 'agent-approve'] }
    }
  });
  await deriveJourneyMap(repo, { journeyId: 'agent-registration' });
  const inputPath = await writeInput(repo, {
    add_steps: [{
      activity_id: 'activation',
      step_id: 'agent-task-readback',
      label: '任せた仕事を AI が読み返す',
      after_step_id: 'agent-approve',
      walking_skeleton_required: true,
      reason: 'Director proposal (d)'
    }],
    add_open_questions: [{ id: 'story:agent-task-readback', question: 'agent-task-readback を満たす Story はまだない。', step_id: 'agent-task-readback' }]
  });
  const { journey, artifacts } = await curateJourneyMap(repo, { journeyId: 'agent-registration', inputPath });
  assert.equal(artifacts.json, '.vibepro/journeys/agent-registration.json');
  const activation = journey.backbone.find((activity) => activity.activity_id === 'activation');
  const stepIds = activation.steps.map((step) => step.step_id);
  assert.equal(stepIds[stepIds.indexOf('agent-approve') + 1], 'agent-task-readback');
  const added = activation.steps.find((step) => step.step_id === 'agent-task-readback');
  assert.deepEqual(added.story_ids, []);
  assert.equal(added.curation.source, 'curation');
  assert.ok(journey.walking_skeleton.required_step_ids.includes('agent-task-readback'));
  assert.ok(journey.walking_skeleton.gaps.some((gap) => gap.step_id === 'agent-task-readback'));
  const question = journey.open_questions.find((item) => item.id === 'story:agent-task-readback');
  assert.equal(question.source, 'curation');
  assert.equal(question.curation, null);
  assert.deepEqual(journey.curation.added_open_questions, ['story:agent-task-readback']);
  const written = JSON.parse(await readFile(path.join(repo, '.vibepro', 'journeys', 'agent-registration.json'), 'utf8'));
  assert.equal(written.curation_status, 'curated');
});

test('JSC-5 curate rejects malformed additions, duplicate question ids and a scope change since derive', async () => {
  const repo = await setupRepo({ journeyConfig: { scope: { story_tags: ['journey-9'] } } });
  const { journey } = await deriveJourneyMap(repo, { journeyId: 'agent-registration' });
  const bad = await writeInput(repo, { add_steps: [{ step_id: 'x' }] });
  await assert.rejects(curateJourneyMap(repo, { journeyId: 'agent-registration', inputPath: bad }), /requires activity_id/);
  const existingId = journey.open_questions[0]?.id;
  if (existingId) {
    const dup = await writeInput(repo, {
      open_questions: Object.fromEntries(journey.open_questions.map((q) => [q.id, { status: 'deferred', reason: 'later' }])),
      add_open_questions: [{ id: existingId, question: 'dup' }]
    });
    await assert.rejects(curateJourneyMap(repo, { journeyId: 'agent-registration', inputPath: dup }), /already exists/);
  }
  const ok = await writeInput(repo, { open_questions: Object.fromEntries(journey.open_questions.map((q) => [q.id, { status: 'deferred', reason: 'later' }])) });
  await assert.rejects(
    curateJourneyMap(repo, { journeyId: 'agent-registration', inputPath: ok, scope: { story_ids: ['billing-pay'] } }),
    /scope differs/
  );
});
