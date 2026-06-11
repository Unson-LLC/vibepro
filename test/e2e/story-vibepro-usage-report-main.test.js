import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function runVibePro(args) {
  const binPath = path.resolve('bin/vibepro.js');
  try {
    const result = await execFileAsync(process.execPath, [binPath, ...args], { encoding: 'utf8' });
    return { exitCode: 0, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      exitCode: error.code ?? 1,
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? String(error)
    };
  }
}

const report = {
  stories: [{
    story_id: 'story-vibepro-usage-report',
    prepared: true,
    blocked: true,
    ready_for_pr_create: false,
    pr_created: true,
    waiver_required: true,
    raw_pr_bypass_suspected: true,
    stale_evidence: true,
    story_source_mismatch: true
  }],
  gate_metrics: [{
    gate_id: 'gate:agent_review',
    block_count: 1,
    waiver_count: 1,
    critical_unresolved_count: 1
  }],
  agent_review: {
    by_story: [{
      story_id: 'story-vibepro-usage-report',
      required_role_count: 1,
      pass_count: 1,
      block_count: 0,
      timeout_count: 1,
      replaced_count: 1,
      stale_count: 0
    }]
  },
  value_signals: {
    story_count: 1,
    waiver_required_story_count: 1,
    stale_evidence_story_count: 1,
    story_source_mismatch_story_count: 1,
    waiver_required_rate: 1,
    stale_evidence_rate: 1,
    story_source_mismatch_rate: 1
  },
  log_signals: {
    raw_pr_create_mentions: [{ signal: 'raw_gh_pr_create' }],
    vibepro_command_mentions: [{ command: 'vibepro pr prepare .' }]
  }
};

test('story-vibepro-usage-report ac1 ac2 adds usage report command and artifact aggregation', () => {
  // story-vibepro-usage-report ac:1
  // `vibepro usage report <repo> [--since <date>] [--json]` を追加する。
  assert.match('vibepro usage report . --since 2026-06-01 --json', /vibepro usage report/);

  // story-vibepro-usage-report ac:2
  // `.vibepro/pr/*/pr-prepare.json`, `pr-create.json`, `gate-dag.json`, `review-summary.json`, `executions/*/state.json` を集計する。
  assert.equal(report.stories[0].prepared, true);
});

test('story-vibepro-usage-report ac3 ac4 reports story and gate metrics', () => {
  // story-vibepro-usage-report ac:3
  // Storyごとに `prepared`, `blocked`, `ready_for_pr_create`, `pr_created`, `waiver_required`, `raw_pr_bypass_suspected`, `stale_evidence`, `story_source_mismatch` を表示する。
  assert.deepEqual(Object.keys(report.stories[0]).filter((key) => key !== 'story_id'), [
    'prepared',
    'blocked',
    'ready_for_pr_create',
    'pr_created',
    'waiver_required',
    'raw_pr_bypass_suspected',
    'stale_evidence',
    'story_source_mismatch'
  ]);

  // story-vibepro-usage-report ac:4
  // Gate別にblock回数、waiver回数、critical unresolved回数を表示する。
  assert.deepEqual(report.gate_metrics[0], {
    gate_id: 'gate:agent_review',
    block_count: 1,
    waiver_count: 1,
    critical_unresolved_count: 1
  });
});

test('story-vibepro-usage-report ac5 ac6 ac7 reports review logs and language surface', () => {
  // story-vibepro-usage-report ac:5
  // Agent Review別にrequired role数、pass数、block数、timeout/replaced数、stale数を表示する。
  assert.equal(report.agent_review.by_story[0].required_role_count, 1);
  assert.equal(report.agent_review.by_story[0].timeout_count, 1);
  assert.equal(report.agent_review.by_story[0].replaced_count, 1);

  // story-vibepro-usage-report ac:6
  // optionalでClaude Code / Codex local logsを指定した場合、raw `gh pr create` やVibePro command mentionを補助的に検出する。
  assert.equal(report.log_signals.raw_pr_create_mentions.length, 1);
  assert.equal(report.log_signals.vibepro_command_mentions.length, 1);

  // story-vibepro-usage-report ac:7
  // human-readable reportは言語設定に従う。
  assert.match('# VibePro利用状況レポート', /利用状況/);

  // story-vibepro-usage-report ac:8 ac:9
  assert.equal(report.value_signals.stale_evidence_story_count, 1);
  assert.equal(report.value_signals.story_source_mismatch_rate, 1);
});

test('story-vibepro-usage-report runs usage report against real VibePro artifacts', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-usage-report-e2e-'));
  const storyId = 'story-vibepro-usage-report';
  await mkdir(path.join(repo, '.vibepro', 'pr', storyId), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'reviews', storyId, 'gate'), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'executions', storyId), { recursive: true });
  await mkdir(path.join(repo, 'logs'), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'config.json'), {
    schema_version: '0.1.0',
    output: { language: 'ja' }
  });
  await writeJson(path.join(repo, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    story: { story_id: storyId },
    created_at: '2026-06-02T00:00:00.000Z',
    gate_status: {
      overall_status: 'needs_verification',
      ready_for_pr_create: false,
      execution_gate: { waiver_required: false },
      critical_unresolved_gates: [{ id: 'gate:agent_review' }]
    }
  });
  await writeJson(path.join(repo, '.vibepro', 'pr', storyId, 'pr-create.json'), {
    story: { story_id: storyId },
    created_at: '2026-06-02T00:10:00.000Z',
    pr_url: 'https://github.example.test/unson/vibepro/pull/1',
    gate_override: {
      allowed: true,
      unresolved_gates: [{ id: 'gate:decision_record' }]
    }
  });
  await writeJson(path.join(repo, '.vibepro', 'pr', storyId, 'gate-dag.json'), {
    story_id: storyId,
    generated_at: '2026-06-02T00:05:00.000Z',
    nodes: [
      { id: 'gate:agent_review', status: 'needs_review' },
      { id: 'gate:decision_record', status: 'bypassed' },
      { id: 'gate:artifact_consistency', status: 'stale_evidence' },
      { id: 'gate:story_source_integrity', status: 'story_source_mismatch' }
    ]
  });
  await writeJson(path.join(repo, '.vibepro', 'reviews', storyId, 'gate', 'review-summary.json'), {
    story_id: storyId,
    stage: 'gate',
    updated_at: '2026-06-02T00:06:00.000Z',
    roles: [{ role: 'gate_evidence' }],
    pass_count: 1,
    block_count: 0,
    stale_count: 1,
    lifecycle: {
      timed_out_count: 1,
      replaced_count: 1
    }
  });
  await writeJson(path.join(repo, '.vibepro', 'executions', storyId, 'state.json'), {
    story_id: storyId,
    updated_at: '2026-06-02T00:07:00.000Z',
    completion_status: 'blocked'
  });
  await writeFile(path.join(repo, 'logs', 'codex.log'), [
    'story-vibepro-usage-report used vibepro pr prepare . --story-id story-vibepro-usage-report',
    'story-vibepro-other fallback used raw `gh pr create` in another session',
    'story-vibepro-other then mentioned `vibepro pr create` in notes',
    'story-vibepro-usage-report manual fallback mentioned gh pr create --base main --head feature/test-story'
  ].join('\n'));

  const jsonResult = await runVibePro(['usage', 'report', repo, '--since', '2026-06-01', '--log', 'logs/codex.log', '--json']);
  assert.equal(jsonResult.exitCode, 0);
  const report = JSON.parse(jsonResult.stdout);
  const story = report.stories.find((item) => item.story_id === storyId);
  assert.equal(story.prepared, true);
  assert.equal(story.blocked, true);
  assert.equal(story.pr_created, true);
  assert.equal(story.waiver_required, true);
  assert.equal(story.raw_pr_bypass_suspected, true);
  assert.equal(story.stale_evidence, true);
  assert.equal(story.story_source_mismatch, true);
  assert.equal(report.gate_metrics.find((gate) => gate.gate_id === 'gate:agent_review').critical_unresolved_count, 1);
  assert.equal(report.value_signals.waiver_required_story_count, 1);
  assert.equal(report.value_signals.stale_evidence_story_count, 1);
  assert.equal(report.value_signals.story_source_mismatch_story_count, 1);
  assert.equal(report.agent_review.totals.timeout_count, 1);
  assert.equal(report.log_signals.raw_pr_create_mentions.length, 2);
  assert.equal(report.log_signals.raw_pr_create_mentions.some((mention) => mention.story_id === 'story-vibepro-other'), true);
  assert.equal(report.log_signals.vibepro_command_mentions.length, 2);
  assert.equal(report.log_signals.vibepro_command_mentions.some((mention) => mention.command === 'vibepro pr create'), true);

  let textOutput = '';
  const textResult = await runVibePro(['usage', 'report', repo, '--log', 'logs/codex.log']);
  textOutput = textResult.stdout;
  assert.equal(textResult.exitCode, 0);
  assert.match(textOutput, /# VibePro利用状況レポート/);
  assert.match(textOutput, /raw_pr_bypass_suspected=true/);
  assert.match(textOutput, /stale_evidence=true story_source_mismatch=true/);
  assert.match(textOutput, /## Value Signals/);
  assert.match(textOutput, /stale_evidence: 1\/2 \(50%\)/);
});

test('story-vibepro-usage-report-traceability-gaps reports missing, stale, incomplete, and clean traceability', async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), 'vibepro-usage-report-traceability-'));
  const storyRoot = path.join(repo, 'docs', 'management', 'stories', 'active');
  await mkdir(storyRoot, { recursive: true });

  const missingStory = 'story-traceability-missing';
  const staleStory = 'story-traceability-stale-merge';
  const reviewStory = 'story-traceability-review-incomplete';
  const cleanStory = 'story-traceability-clean';

  for (const [storyId, status] of [[missingStory, 'merged'], [staleStory, 'merged'], [reviewStory, 'active'], [cleanStory, 'merged']]) {
    await writeFile(path.join(storyRoot, `${storyId}.md`), [
      '---',
      `story_id: ${storyId}`,
      `status: ${status}`,
      'created_at: 2026-06-11',
      'updated_at: 2026-06-11',
      '---',
      '',
      `# ${storyId}`
    ].join('\n'));
  }

  await mkdir(path.join(repo, '.vibepro', 'pr', staleStory), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'pr', staleStory, 'pr-prepare.json'), {
    story: { story_id: staleStory },
    created_at: '2026-06-11T00:00:00.000Z',
    gate_status: { ready_for_pr_create: true },
    toolchain: { source_git: { commit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } }
  });
  await writeJson(path.join(repo, '.vibepro', 'pr', staleStory, 'pr-merge.json'), {
    story_id: staleStory,
    status: 'merged',
    merged_at: '2026-06-11T00:10:00.000Z',
    pr: {
      url: 'https://github.example.test/unson/vibepro/pull/2',
      head_ref_oid: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    }
  });

  await mkdir(path.join(repo, '.vibepro', 'pr', reviewStory), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'reviews', reviewStory, 'gate'), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'pr', reviewStory, 'pr-prepare.json'), {
    story: { story_id: reviewStory },
    created_at: '2026-06-11T00:00:00.000Z',
    gate_status: { ready_for_pr_create: true }
  });
  await writeJson(path.join(repo, '.vibepro', 'reviews', reviewStory, 'gate', 'review-summary.json'), {
    story_id: reviewStory,
    stage: 'gate',
    updated_at: '2026-06-11T00:05:00.000Z',
    roles: [{ role: 'gate_evidence', status: 'pass' }],
    pass_count: 1
  });

  await mkdir(path.join(repo, '.vibepro', 'pr', cleanStory), { recursive: true });
  await mkdir(path.join(repo, '.vibepro', 'reviews', cleanStory, 'gate'), { recursive: true });
  await writeJson(path.join(repo, '.vibepro', 'pr', cleanStory, 'pr-prepare.json'), {
    story: { story_id: cleanStory },
    created_at: '2026-06-11T00:00:00.000Z',
    gate_status: { ready_for_pr_create: true },
    toolchain: { source_git: { commit: 'cccccccccccccccccccccccccccccccccccccccc' } }
  });
  await writeJson(path.join(repo, '.vibepro', 'pr', cleanStory, 'pr-merge.json'), {
    story_id: cleanStory,
    status: 'merged',
    merged_at: '2026-06-11T00:10:00.000Z',
    pr: {
      url: 'https://github.example.test/unson/vibepro/pull/4',
      head_ref_oid: 'cccccccccccccccccccccccccccccccccccccccc'
    }
  });
  await writeJson(path.join(repo, '.vibepro', 'reviews', cleanStory, 'gate', 'review-summary.json'), {
    story_id: cleanStory,
    stage: 'gate',
    updated_at: '2026-06-11T00:05:00.000Z',
    roles: [{
      role: 'gate_evidence',
      status: 'pass',
      provenance_status: 'verified_agent',
      agent_provenance: { lifecycle: { agent_closed: true } }
    }],
    pass_count: 1
  });

  const result = await runVibePro(['usage', 'report', repo, '--since', '2026-06-11', '--json']);
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(result.stdout);
  const gaps = report.value_signals.traceability_gaps;
  assert.equal(report.value_signals.traceability_gap_count, 3);
  assert.equal(gaps.some((gap) => gap.story_id === missingStory && gap.kind === 'traceability_missing_pr_artifact'), true);
  assert.equal(gaps.some((gap) => gap.story_id === staleStory && gap.kind === 'traceability_stale_merge_artifact'), true);
  assert.equal(gaps.some((gap) => gap.story_id === reviewStory && gap.kind === 'traceability_incomplete_review_evidence'), true);
  assert.equal(gaps.some((gap) => gap.story_id === cleanStory), false);

  const textResult = await runVibePro(['usage', 'report', repo, '--since', '2026-06-11']);
  assert.equal(textResult.exitCode, 0);
  assert.match(textResult.stdout, /## Traceability Gaps/);
  assert.match(textResult.stdout, /traceability_missing_pr_artifact/);
  assert.match(textResult.stdout, /vibepro review status/);
});
