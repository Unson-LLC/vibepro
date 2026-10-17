import './support/scratch-tmpdir.js';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

import { analyzeTaskPlan, readTrackedTaskPlan, validateTaskPlan } from '../src/task-plan.js';

const execFileAsync = promisify(execFile);

const repository = 'vibepro';
const storyId = 'story-parallel-plan';

function task(taskId, overrides = {}) {
  return {
    task_id: taskId,
    story_id: storyId,
    title: taskId,
    allowed_paths: [`src/${taskId}.js`],
    acceptance_criteria: [`${taskId} is reviewable`],
    depends_on: [],
    status: 'in_progress',
    purpose: `implement ${taskId}`,
    out_of_scope: ['deployment'],
    dependencies: [],
    contracts: [],
    assignment: {
      capabilities: ['javascript'],
      parallel_group: 'parallel',
      adjustable_scope: ['tests']
    },
    integration: {
      order: 1,
      conflict_owner: 'codex-parent'
    },
    ...overrides
  };
}

function plan(tasks, overrides = {}) {
  return {
    schema_version: '0.2.0',
    repository,
    story_id: storyId,
    plan_version: 'plan-1',
    intent: {
      purpose: 'parallel implementation pilot',
      priority: 'high',
      delegated_scope: ['implementation'],
      acceptance_criteria: ['each Task has an explicit boundary']
    },
    tasks,
    ...overrides
  };
}

function target(taskId, targetRepository = repository, targetStoryId = storyId, targetPlanVersion = null) {
  return {
    repository: targetRepository,
    story_id: targetStoryId,
    task_id: taskId,
    ...(targetPlanVersion == null ? {} : { plan_version: targetPlanVersion })
  };
}

function milestoneObservation(taskId, options = {}) {
  return {
    kind: 'milestone',
    target: target(taskId, options.repository ?? repository, options.story_id ?? storyId, options.plan_version ?? null),
    plan_version: options.plan_version ?? 'plan-1',
    milestone: options.milestone ?? 'returned',
    artifact_revision: options.artifact_revision ?? `sha-${taskId}`,
    evidence_ref: options.evidence_ref ?? `evidence-${taskId}`
  };
}

function agreementObservation(taskId, contractRef, options = {}) {
  return {
    kind: 'contract_agreement',
    target: target(taskId, options.repository ?? 'agent-skills', options.story_id ?? 'story-executor', options.plan_version ?? 'external-plan-1'),
    plan_version: options.plan_version ?? 'external-plan-1',
    contract_ref: contractRef,
    artifact_revision: options.artifact_revision ?? `sha-${taskId}`,
    evidence_ref: options.evidence_ref ?? `agreement-${taskId}`
  };
}

test('prerequisite release requires a plan-version-bound artifact observation, regardless of Task.status', () => {
  const input = plan([
    task('foundation', { status: 'completed' }),
    task('feature', {
      dependencies: [{
        kind: 'prerequisite',
        target: target('foundation'),
        milestone: 'returned',
        blocks: ['start']
      }]
    })
  ]);

  const withoutEvidence = analyzeTaskPlan(input);
  assert.equal(withoutEvidence.status, 'partial');
  assert.equal(withoutEvidence.dispatch_ready, false);
  assert.deepEqual(withoutEvidence.blocked_task_ids, ['feature']);
  assert.match(withoutEvidence.diagnostics.find((item) => item.task_ids.includes('feature')).code, /missing_prerequisite_observation/);

  const withEvidence = analyzeTaskPlan(input, {
    observations: [milestoneObservation('foundation')]
  });
  assert.equal(withEvidence.status, 'ready');
  assert.equal(withEvidence.dispatch_ready, true);
  assert.deepEqual(withEvidence.ready_task_ids, ['feature']);
  assert.deepEqual(withEvidence.blocked_task_ids, []);
});

test('interface contract mismatch blocks the affected Task while overlap stays startable', () => {
  const mismatch = plan([
    task('provider', {
      contracts: [{ id: 'development-progress.v1', version: '1', description: 'progress events' }]
    }),
    task('consumer', {
      contracts: [{ id: 'development-progress.v1', version: '2', description: 'consumer expects a newer progress contract' }],
      dependencies: [{
        kind: 'interface',
        target: target('provider'),
        milestone: 'verified',
        blocks: ['verify', 'integrate'],
        contract_ref: 'development-progress.v1@2'
      }]
    })
  ]);
  const mismatchResult = analyzeTaskPlan(mismatch);
  assert.equal(mismatchResult.status, 'partial');
  assert.deepEqual(mismatchResult.blocked_task_ids, ['consumer']);
  assert.ok(mismatchResult.diagnostics.some((item) => item.code === 'unresolved_interface_contract'));
  assert.deepEqual(mismatchResult.ready_stages.start, ['provider']);

  const overlap = plan([
    task('provider'),
    task('consumer', {
      dependencies: [{
        kind: 'overlap',
        target: target('provider'),
        milestone: 'integrated',
        blocks: ['verify', 'integrate']
      }]
    })
  ]);
  const overlapResult = analyzeTaskPlan(overlap);
  assert.equal(overlapResult.status, 'ready');
  assert.deepEqual(overlapResult.blocked_task_ids, []);
  assert.deepEqual(overlapResult.ready_task_ids, ['consumer', 'provider']);
});

test('legacy depends_on remains a start prerequisite when an interface or overlap targets the same Task', () => {
  for (const kind of ['interface', 'overlap']) {
    const consumerOverrides = {
      depends_on: ['provider'],
      dependencies: [{
        kind,
        target: target('provider'),
        milestone: kind === 'interface' ? 'verified' : 'integrated',
        blocks: ['verify', 'integrate'],
        ...(kind === 'interface' ? { contract_ref: 'development-progress.v1@1' } : {})
      }]
    };
    const input = plan([
      task('provider', {
        ...(kind === 'interface' ? {
          contracts: [{ id: 'development-progress.v1', version: '1', description: 'progress events' }]
        } : {})
      }),
      task('consumer', {
        ...consumerOverrides,
        ...(kind === 'interface' ? {
          contracts: [{ id: 'development-progress.v1', version: '1', description: 'progress events' }]
        } : {})
      })
    ]);
    const result = analyzeTaskPlan(input);
    assert.equal(result.dispatch_ready, false, kind);
    assert.deepEqual(result.blocked_task_ids, ['consumer'], kind);
    assert.ok(result.diagnostics.some((item) => item.code === 'missing_prerequisite_observation' && item.task_ids.includes('consumer')), kind);
  }
});

test('external interface agreement permits start before implementation milestone, then requires milestone evidence for verify/integrate', () => {
  const input = plan([
    task('consumer', {
      contracts: [{ id: 'development-progress.v1', version: '1', description: 'consumer expects progress events' }],
      dependencies: [{
        kind: 'interface',
        target: target('executor', 'agent-skills', 'story-executor', 'external-plan-1'),
        milestone: 'verified',
        blocks: ['verify', 'integrate'],
        contract_ref: 'development-progress.v1@1'
      }]
    })
  ]);

  const withoutAgreement = analyzeTaskPlan(input);
  assert.equal(withoutAgreement.dispatch_ready, false);
  assert.deepEqual(withoutAgreement.blocked_task_ids, ['consumer']);
  assert.ok(withoutAgreement.diagnostics.some((item) => item.code === 'unresolved_external_interface_contract'));

  const agreementOnly = analyzeTaskPlan(input, {
    observations: [agreementObservation('executor', 'development-progress.v1@1')]
  });
  assert.equal(agreementOnly.status, 'ready');
  assert.equal(agreementOnly.dispatch_ready, true);
  assert.deepEqual(agreementOnly.blocked_task_ids, []);
  assert.deepEqual(agreementOnly.ready_task_ids, ['consumer']);
  assert.deepEqual(agreementOnly.ready_stages, {
    start: ['consumer'],
    verify: [],
    integrate: []
  });
  assert.ok(agreementOnly.diagnostics.some((item) => item.code === 'missing_integration_observation'));

  const agreementAndMilestone = analyzeTaskPlan(input, {
    observations: [
      agreementObservation('executor', 'development-progress.v1@1'),
      milestoneObservation('executor', {
        repository: 'agent-skills',
        story_id: 'story-executor',
        plan_version: 'external-plan-1',
        milestone: 'verified'
      })
    ]
  });
  assert.equal(agreementAndMilestone.status, 'ready');
  assert.deepEqual(agreementAndMilestone.diagnostics, []);
  assert.deepEqual(agreementAndMilestone.ready_stages, {
    start: ['consumer'],
    verify: ['consumer'],
    integrate: ['consumer']
  });
});

test('external agreement must match the consumer-declared contract version', () => {
  const input = plan([
    task('consumer', {
      contracts: [{ id: 'development-progress.v1', version: '2', description: 'consumer expects v2' }],
      dependencies: [{
        kind: 'interface',
        target: target('executor', 'agent-skills', 'story-executor', 'external-plan-1'),
        milestone: 'verified',
        blocks: ['verify', 'integrate'],
        contract_ref: 'development-progress.v1@2'
      }]
    })
  ]);
  const result = analyzeTaskPlan(input, {
    observations: [agreementObservation('executor', 'development-progress.v1@1')]
  });
  assert.equal(result.dispatch_ready, false);
  assert.deepEqual(result.blocked_task_ids, ['consumer']);
  assert.ok(result.diagnostics.some((item) => item.code === 'unresolved_external_interface_contract'));
});

test('external interface evidence must match the dependency target plan version', () => {
  const input = plan([
    task('consumer', {
      contracts: [{ id: 'development-progress.v1', version: '1', description: 'consumer expects v1' }],
      dependencies: [{
        kind: 'interface',
        target: target('executor', 'agent-skills', 'story-executor', 'external-plan-1'),
        milestone: 'verified',
        blocks: ['verify', 'integrate'],
        contract_ref: 'development-progress.v1@1'
      }]
    })
  ]);
  const result = analyzeTaskPlan(input, {
    observations: [agreementObservation('executor', 'development-progress.v1@1', { plan_version: 'external-plan-2' })]
  });
  assert.equal(result.dispatch_ready, false);
  assert.deepEqual(result.blocked_task_ids, ['consumer']);
  assert.ok(result.diagnostics.some((item) => item.code === 'unresolved_external_interface_contract'));
});

test('cycle analysis reports one canonical cycle even when traversal reaches it repeatedly', () => {
  const input = plan([
    task('a', {
      dependencies: [{ kind: 'prerequisite', target: target('b'), milestone: 'returned', blocks: ['start'] }]
    }),
    task('b', {
      dependencies: [{ kind: 'prerequisite', target: target('a'), milestone: 'returned', blocks: ['start'] }]
    }),
    task('c', {
      dependencies: [{ kind: 'prerequisite', target: target('a'), milestone: 'returned', blocks: ['start'] }]
    })
  ]);
  const result = analyzeTaskPlan(input, {
    observations: [milestoneObservation('a'), milestoneObservation('b')]
  });
  assert.deepEqual(result.cycles, [['a', 'b']]);
  assert.ok(result.diagnostics.some((item) => item.code === 'dependency_cycle'));
  assert.ok(result.blocked_task_ids.includes('a'));
  assert.ok(result.blocked_task_ids.includes('b'));
});

test('schema 0.2 requires delegated scope and out-of-scope string arrays while omitted legacy depends_on stays compatible', () => {
  const input = plan([task('single')]);
  delete input.tasks[0].depends_on;
  const normalized = validateTaskPlan(input);
  assert.deepEqual(normalized.tasks[0].depends_on, []);

  const badIntent = plan([task('single')], {
    intent: {
      purpose: 'parallel implementation pilot',
      priority: 'high',
      delegated_scope: 'implementation',
      acceptance_criteria: ['each Task has an explicit boundary']
    }
  });
  assert.throws(() => validateTaskPlan(badIntent), /delegated_scope must be an array/);

  const badTask = plan([task('single', { out_of_scope: ['deployment', 1] })]);
  assert.throws(() => validateTaskPlan(badTask), /out_of_scope must be an array/);

  const emptyDependencyBlocks = plan([task('single', {
    dependencies: [{
      kind: 'prerequisite',
      target: target('foundation'),
      milestone: 'returned',
      blocks: []
    }]
  })]);
  assert.throws(() => validateTaskPlan(emptyDependencyBlocks), /dependency 0 blocks must be nonempty/);
});

function twoTaskPlan(overlapRefs) {
  return plan([task('alpha'), task('beta')], overlapRefs == null ? {} : { overlap_refs: overlapRefs });
}

test('overlap_refs: absent on a 0.2.0 plan stays omitted after normalization', () => {
  const normalized = validateTaskPlan(twoTaskPlan());
  assert.equal('overlap_refs' in normalized, false);
});

test('overlap_refs: valid entries normalize sorted task_ids and completion_contract_ref order', () => {
  const normalized = validateTaskPlan(twoTaskPlan([
    { completion_contract_ref: 'z-contract@2', task_ids: ['beta', 'alpha'] },
    { completion_contract_ref: 'a-contract@1', task_ids: ['alpha', 'beta'] }
  ]));
  assert.deepEqual(normalized.overlap_refs, [
    { completion_contract_ref: 'a-contract@1', task_ids: ['alpha', 'beta'] },
    { completion_contract_ref: 'z-contract@2', task_ids: ['alpha', 'beta'] }
  ]);
});

test('overlap_refs: rejects a completion_contract body field on an element', () => {
  assert.throws(
    () => validateTaskPlan(twoTaskPlan([{
      completion_contract_ref: 'shared@1',
      task_ids: ['alpha', 'beta'],
      completion_contract: { id: 'shared', version: '1' }
    }])),
    /unknown task plan overlap_refs field: completion_contract/
  );
});

test('overlap_refs: rejects completion_contract_ref without @version', () => {
  assert.throws(
    () => validateTaskPlan(twoTaskPlan([{ completion_contract_ref: 'shared', task_ids: ['alpha', 'beta'] }])),
    /must pin id@version/
  );
});

test('overlap_refs: rejects task_ids that are not in the plan', () => {
  assert.throws(
    () => validateTaskPlan(twoTaskPlan([{ completion_contract_ref: 'shared@1', task_ids: ['alpha', 'missing'] }])),
    /unknown task_id: missing/
  );
});

test('overlap_refs: rejects fewer than two task_ids', () => {
  assert.throws(
    () => validateTaskPlan(twoTaskPlan([{ completion_contract_ref: 'shared@1', task_ids: ['alpha'] }])),
    /at least two task ids/
  );
});

test('overlap_refs: rejects completion_contract_ref when id or version contains whitespace', () => {
  assert.throws(
    () => validateTaskPlan(twoTaskPlan([{ completion_contract_ref: ' id @ 1 ', task_ids: ['alpha', 'beta'] }])),
    /must not contain whitespace/
  );
});

test('overlap_refs: rejects a second ref that would duplicate id@1 after trimming padded whitespace', () => {
  assert.throws(
    () => validateTaskPlan(twoTaskPlan([
      { completion_contract_ref: 'id@1', task_ids: ['alpha', 'beta'] },
      { completion_contract_ref: ' id @ 1 ', task_ids: ['alpha', 'beta'] }
    ])),
    /must not contain whitespace/
  );
});

test('overlap_refs: rejects duplicate completion_contract_ref values', () => {
  assert.throws(
    () => validateTaskPlan(twoTaskPlan([
      { completion_contract_ref: 'shared@1', task_ids: ['alpha', 'beta'] },
      { completion_contract_ref: 'shared@1', task_ids: ['alpha', 'beta'] }
    ])),
    /duplicate task plan overlap_refs completion_contract_ref/
  );
});

test('overlap_refs: rejects plans whose schema_version is not 0.2.0 even when overlap_refs are valid', () => {
  const document = twoTaskPlan([{ completion_contract_ref: 'shared@1', task_ids: ['alpha', 'beta'] }]);
  document.schema_version = '0.1.0';
  assert.throws(() => validateTaskPlan(document), /schema_version must be 0.2.0/);
});

test('overlap_refs: does not block task start; overlap dependencies remain startable', () => {
  const input = plan([
    task('provider'),
    task('consumer', {
      dependencies: [{
        kind: 'overlap',
        target: target('provider'),
        milestone: 'integrated',
        blocks: ['verify', 'integrate']
      }]
    })
  ], {
    overlap_refs: [{ completion_contract_ref: 'brainbase-completion@1', task_ids: ['consumer', 'provider'] }]
  });
  const result = analyzeTaskPlan(input);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.blocked_task_ids, []);
  assert.deepEqual(result.ready_task_ids.sort(), ['consumer', 'provider'].sort());
});

test('tracked task plan input rejects a symlink that resolves outside the repository', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-task-plan-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'vibepro-task-plan-outside-'));
  await writeFile(path.join(outside, 'plan.json'), '{}\n');
  await symlink(path.join(outside, 'plan.json'), path.join(root, 'plan.json'));
  await execFileAsync('git', ['init'], { cwd: root });
  await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: root });
  await execFileAsync('git', ['add', 'plan.json'], { cwd: root });
  await execFileAsync('git', ['commit', '-m', 'track plan link'], { cwd: root });

  await assert.rejects(
    readTrackedTaskPlan(root, 'plan.json'),
    /resolve inside the repository|repository traversal|symlink outside/
  );
});
