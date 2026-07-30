import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateTaskBoundRepoControl } from '../src/task-bound-repo-control.js';

function taskContext(overrides = {}) {
  return {
    task_state_path: '.vibepro/stories/story-contract/tasks/tasks.json',
    task: {
      id: 'TAR-TASK-01',
      target_groups: [
        {
          id: 'repo-control',
          classification: 'repo_control',
          target_files: ['.github/workflows/release.yml'],
          depends_on: ['runtime']
        },
        {
          id: 'runtime',
          classification: 'runtime',
          target_files: ['src/pr-manager.js'],
          depends_on: []
        }
      ],
      ...overrides
    }
  };
}

test('TAR-INV-001 fail-closed malformed and incomplete Task graphs', () => {
  const changed = ['.github/workflows/release.yml'];
  const cases = [
    null,
    taskContext({ target_groups: 'invalid' }),
    taskContext({
      target_groups: [
        { id: '', classification: 'repo_control', target_files: changed, depends_on: [] }
      ]
    }),
    taskContext({
      target_groups: [
        { id: 'repo-control', target_files: changed, depends_on: [] }
      ]
    }),
    taskContext({
      target_groups: [
        { id: 'repo-control', classification: 42, target_files: changed, depends_on: [] }
      ]
    }),
    taskContext({
      target_groups: [
        { id: 'repo-control', classification: 'repo_control', target_files: 'invalid', depends_on: [] }
      ]
    }),
    taskContext({
      target_groups: [
        { id: 'repo-control', classification: 'repo_control', target_files: changed, depends_on: 'runtime' }
      ]
    }),
    taskContext({
      target_groups: [
        { id: 'duplicate', classification: 'repo_control', target_files: changed, depends_on: [] },
        { id: 'duplicate', classification: 'runtime', target_files: ['src/pr-manager.js'], depends_on: [] }
      ]
    }),
    taskContext({
      target_groups: [
        { id: 'repo-control', classification: 'repo_control', target_files: changed, depends_on: ['missing'] }
      ]
    }),
    taskContext({
      target_groups: [
        { id: 'repo-control', classification: 'repo_control', target_files: [], depends_on: ['runtime'] },
        { id: 'runtime', classification: 'runtime', target_files: ['src/pr-manager.js'], depends_on: [] }
      ]
    }),
    taskContext({
      target_groups: [
        { id: 'runtime', classification: 'runtime', target_files: ['src/pr-manager.js'], depends_on: [] }
      ]
    }),
    taskContext({
      target_groups: [
        { id: 'repo-control-a', classification: 'repo_control', target_files: changed, depends_on: ['runtime'] },
        { id: 'repo-control-b', classification: 'repo_control', target_files: ['.github/workflows/extra.yml'], depends_on: [] },
        { id: 'runtime', classification: 'runtime', target_files: ['src/pr-manager.js'], depends_on: [] }
      ]
    }),
    taskContext({
      target_groups: [
        { id: 'repo-control', classification: 'repo_control', target_files: changed, depends_on: [] },
        { id: 'runtime', classification: 'runtime', target_files: ['src/pr-manager.js'], depends_on: [] }
      ]
    })
  ];

  for (const candidate of cases) {
    const result = evaluateTaskBoundRepoControl({
      taskContext: candidate,
      repoControlFiles: changed
    });
    assert.equal(result.eligible, false);
    assert.equal(result.unsafe_for_atomic_override, true);
    assert.equal(typeof result.reason_code, 'string');
  }
});

test('uncovered extra changed repo-control path remains unsafe', () => {
  const result = evaluateTaskBoundRepoControl({
    taskContext: taskContext(),
    repoControlFiles: [
      '.github/workflows/release.yml',
      '.github/workflows/extra.yml'
    ]
  });

  assert.equal(result.eligible, false);
  assert.equal(result.unsafe_for_atomic_override, true);
  assert.equal(result.reason_code, 'repo_control_path_coverage_mismatch');
});

test('an extra declared and connected repo-control target may remain unchanged', () => {
  const result = evaluateTaskBoundRepoControl({
    taskContext: taskContext({
      target_groups: [
        {
          id: 'repo-control',
          classification: 'repo_control',
          target_files: [
            '.github/workflows/release.yml',
            '.github/workflows/unchanged.yml'
          ],
          depends_on: ['runtime']
        },
        {
          id: 'runtime',
          classification: 'runtime',
          target_files: ['src/pr-manager.js'],
          depends_on: []
        }
      ]
    }),
    repoControlFiles: ['.github/workflows/release.yml']
  });

  assert.equal(result.eligible, true);
});

test('dependency graph connectivity supports indirect and reverse declared edges', () => {
  const cases = [
    [
      {
        id: 'repo-control',
        classification: 'repo_control',
        target_files: ['.github/workflows/release.yml'],
        depends_on: ['contract']
      },
      {
        id: 'contract',
        classification: 'repo_control',
        target_files: ['package.json'],
        depends_on: ['runtime']
      },
      {
        id: 'runtime',
        classification: 'runtime',
        target_files: ['src/pr-manager.js'],
        depends_on: []
      }
    ],
    [
      {
        id: 'repo-control',
        classification: 'repo_control',
        target_files: ['.github/workflows/release.yml'],
        depends_on: []
      },
      {
        id: 'runtime',
        classification: 'runtime',
        target_files: ['src/pr-manager.js'],
        depends_on: ['repo-control']
      }
    ]
  ];

  for (const targetGroups of cases) {
    const result = evaluateTaskBoundRepoControl({
      taskContext: taskContext({ target_groups: targetGroups }),
      repoControlFiles: ['.github/workflows/release.yml']
    });
    assert.equal(result.eligible, true);
    assert.equal(result.unsafe_for_atomic_override, false);
    assert.ok(result.proof.dependency_edges.length > 0);
  }
});

test('TAR-INV-002 exact repository-relative coverage only', () => {
  for (const targetFiles of [['release.yml'], ['.github/workflows/*.yml']]) {
    const result = evaluateTaskBoundRepoControl({
      taskContext: taskContext({
        target_groups: [
          {
            id: 'repo-control',
            classification: 'repo_control',
            target_files: targetFiles,
            depends_on: ['runtime']
          },
          {
            id: 'runtime',
            classification: 'runtime',
            target_files: ['src/pr-manager.js'],
            depends_on: []
          }
        ]
      }),
      repoControlFiles: ['.github/workflows/release.yml']
    });
    assert.equal(result.eligible, false);
    assert.equal(result.reason_code, 'repo_control_path_coverage_mismatch');
  }
});

test('eligible Task proof records exact coverage and dependency evidence', () => {
  const result = evaluateTaskBoundRepoControl({
    taskContext: taskContext(),
    repoControlFiles: ['.github/workflows/release.yml']
  });

  assert.deepEqual(result, {
    eligible: true,
    unsafe_for_atomic_override: false,
    reason_code: 'task_bound_repo_control_connected',
    proof: {
      task_id: 'TAR-TASK-01',
      task_state_path: '.vibepro/stories/story-contract/tasks/tasks.json',
      covered_repo_control_paths: ['.github/workflows/release.yml'],
      repo_control_group_ids: ['repo-control'],
      dependency_edges: [{ from: 'repo-control', to: 'runtime' }]
    }
  });
});
