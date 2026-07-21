import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { collectSessionEfficiencyAudit, renderSessionEfficiencyAudit } from '../src/session-efficiency-audit.js';
import { resolveCanonicalRunLineage } from '../src/run-lineage.js';

const execFileAsync = promisify(execFile);
const STORY_ID = 'story-vibepro-explicit-run-attribution-lineage';
const SESSION_ID = '019f-lineage-session';
const HEAD_SHA = 'a'.repeat(40);

test('AC-11 session efficiency audit consumes canonical Run resolution and validation from run-lineage', async () => {
  const source = await readFile(new URL('../src/session-efficiency-audit.js', import.meta.url), 'utf8');

  assert.match(
    source,
    /import\s*{[\s\S]*resolveCanonicalRunLineage[\s\S]*validateRunLineageEnvelope[\s\S]*}\s*from\s*['"]\.\/run-lineage\.js['"]/,
    'session-efficiency-audit must consume the canonical Run boundary from run-lineage'
  );
  assert.doesNotMatch(
    source,
    /\b(?:async\s+)?function\s+(?:resolveCanonicalRunLineage|validateRunLineageEnvelope|validateCanonicalRunAuthority|readCanonicalRunState|resolveRunRepository)\s*\(/,
    'canonical Run resolution/validation functions must not be reintroduced here'
  );
  assert.doesNotMatch(
    source,
    /\b(?:const|let|var)\s+(?:resolveCanonicalRunLineage|validateRunLineageEnvelope|validateCanonicalRunAuthority|readCanonicalRunState|resolveRunRepository)\s*=/,
    'canonical Run resolution/validation functions must remain owned by run-lineage'
  );
});

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

function lineage(runId, storyId = STORY_ID, binding = {}) {
  return {
    schema_version: '0.1.0',
    story_id: storyId,
    run_id: runId,
    dispatch_id: `dispatch-${runId}`,
    worktree_root: binding.worktree_root ?? '/fixture/worktree',
    branch: binding.branch ?? 'codex/lineage',
    head_sha: binding.head_sha ?? HEAD_SHA
  };
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-run-lineage-repo-'));
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'vibepro-run-lineage-codex-'));
  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'vibepro@example.test']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'base.js'), 'export const base = true;\n');
  await git(root, ['add', 'src/base.js']);
  await git(root, ['commit', '-m', 'base']);

  const sessionPath = path.join(codexHome, 'sessions', '2026', '07', '21', `${SESSION_ID}.jsonl`);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const timestamp = '2026-07-21T01:00:00.000Z';
  const entries = [
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'assistant_message',
        role: 'assistant',
        content: 'Read src/session-efficiency-audit.js',
        lineage: lineage('run-alpha')
      }
    },
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'assistant_message',
        role: 'assistant',
        content: 'Read test/session-efficiency-run-lineage.test.js',
        lineage: lineage('run-beta')
      }
    },
    {
      timestamp,
      type: 'event_msg',
      thread_id: 'thread-only-observation',
      payload: {
        type: 'assistant_message',
        role: 'assistant',
        content: 'Read src/without-authoritative-lineage.js'
      }
    }
  ];
  await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  return { root, codexHome };
}

async function writeCanonicalRun(root, {
  runId = 'run-alpha',
  authority = {},
  dispatch = true,
  runtimeDispatches = null
} = {}) {
  const runDir = path.join(root, '.vibepro', 'executions', STORY_ID, 'runs', runId);
  await mkdir(runDir, { recursive: true });
  const state = {
    story_id: STORY_ID,
    run_id: runId,
    current_head_sha: HEAD_SHA,
    execution_context: { root_realpath: root },
    ...authority,
    runtime_dispatches: runtimeDispatches ?? (dispatch ? [{
      dispatch_id: `dispatch-${runId}`,
      lineage: lineage(runId, STORY_ID, {
        worktree_root: authority.worktree_root ?? root,
        branch: authority.branch ?? 'codex/lineage',
        head_sha: authority.current_head_sha ?? HEAD_SHA
      })
    }] : [])
  };
  await writeFile(path.join(runDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

async function writeSessionFile(codexHome, sessionId, entries) {
  const sessionPath = path.join(codexHome, 'sessions', '2026', '07', '21', `${sessionId}.jsonl`);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
}

test('Run lineage module exposes canonical repository resolution for audit consumers', async () => {
  const { root } = await fixture();
  await writeCanonicalRun(root, {
    authority: { worktree_root: root, branch: 'codex/lineage', current_head_sha: HEAD_SHA }
  });

  const resolved = await resolveCanonicalRunLineage(root, root, {
    storyId: STORY_ID,
    runId: 'run-alpha'
  });
  assert.equal(resolved.status, 'available');
  assert.equal(resolved.authority.story_id, STORY_ID);
  assert.equal(resolved.authority.run_id, 'run-alpha');
  assert.equal(resolved.source_artifact, `.vibepro/executions/${STORY_ID}/runs/run-alpha/state.json`);

  const unavailable = await resolveCanonicalRunLineage(root, root, {
    storyId: STORY_ID,
    runId: 'run-missing'
  });
  assert.equal(unavailable.status, 'unavailable');
  assert.match(unavailable.reason, /not found/);
});

test('session efficiency audit preserves embedded-lineage heuristics when no run id is requested', async () => {
  const { root, codexHome } = await fixture();
  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  const attribution = result.lineage_attribution;
  assert.equal(attribution.filter.run_id, null);
  assert.equal(attribution.filter.run_id_filter_applied, false);
  assert.equal(attribution.authoritative_event_count, 2);
  assert.equal(attribution.thread_only_event_count, 1);
  assert.equal(attribution.buckets.story_attributed.event_count, 1);
  assert.equal(attribution.buckets.other_story.event_count, 1);
  assert.equal(attribution.buckets.unattributed.event_count, 1);
  assert.equal(attribution.events.find((event) => event.thread_id)?.bucket, 'unattributed');
  assert.equal(attribution.events.find((event) => event.thread_id)?.run_id, null);
  assert.equal(result.session.lineage_attribution.total_event_count, 3);
});

test('explicit run_id alias fails closed when canonical Run authority is missing', async () => {
  const { root, codexHome } = await fixture();
  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    run_id: 'run-beta',
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  assert.equal(result.lineage_attribution.filter.run_id, 'run-beta');
  assert.equal(result.lineage_attribution.status, 'unavailable');
  assert.equal(result.lineage_attribution.mode, 'canonical_run_authority_required');
  assert.equal(result.lineage_attribution.authoritative_event_count, 0);
  assert.equal(result.lineage_attribution.buckets.story_attributed.event_count, 0);
  assert.equal(result.lineage_attribution.buckets.other_story.event_count, 0);
  assert.equal(result.lineage_attribution.buckets.unattributed.event_count, 3);
  assert.equal(result.lineage_attribution.canonical_run.status, 'unavailable');
  assert.equal(result.cost_breakdown.buckets.every((bucket) => bucket.changed_lines === 0), true);
});

test('canonical Run lineage fails closed when authority is missing required binding fields', async () => {
  const { root, codexHome } = await fixture();
  await writeCanonicalRun(root, { authority: { current_head_sha: undefined }, dispatch: false });

  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    runId: 'run-alpha',
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  assert.equal(result.lineage_attribution.status, 'unavailable');
  assert.equal(result.lineage_attribution.mode, 'canonical_run_authority_required');
  assert.equal(result.lineage_attribution.authoritative_event_count, 0);
  assert.equal(result.lineage_attribution.buckets.story_attributed.event_count, 0);
  assert.equal(result.lineage_attribution.buckets.other_story.event_count, 0);
  assert.equal(result.lineage_attribution.buckets.unattributed.event_count, 3);
  assert.equal(result.lineage_attribution.canonical_run.status, 'unavailable');
  assert.equal(result.lineage_attribution.canonical_run.validated_dispatch_count, undefined);
});

test('explicit run id fails closed when complete authority conflicts with session observations', async () => {
  const { root, codexHome } = await fixture();
  await writeCanonicalRun(root, {
    authority: { worktree_root: root, branch: 'codex/lineage', current_head_sha: HEAD_SHA }
  });

  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    runId: 'run-alpha',
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  assert.equal(result.lineage_attribution.status, 'unavailable');
  assert.equal(result.lineage_attribution.mode, 'canonical_run_authority_required');
  assert.equal(result.lineage_attribution.authoritative_event_count, 0);
  assert.equal(result.lineage_attribution.buckets.story_attributed.event_count, 0);
  assert.equal(result.lineage_attribution.buckets.other_story.event_count, 0);
  assert.equal(result.lineage_attribution.buckets.unattributed.event_count, 3);
  assert.equal(result.lineage_attribution.canonical_run.status, 'unavailable');
  assert.match(result.lineage_attribution.canonical_run.reason, /conflicted with session observation/);
});

test('canonical Run lineage validates complete authority and matching dispatches', async () => {
  const { root, codexHome } = await fixture();
  await writeCanonicalRun(root, {
    authority: { worktree_root: root, branch: 'codex/lineage', current_head_sha: HEAD_SHA }
  });
  const sessionPath = path.join(codexHome, 'sessions', '2026', '07', '21', `${SESSION_ID}.jsonl`);
  await writeFile(sessionPath, `${JSON.stringify({
    timestamp: '2026-07-21T01:00:00.000Z',
    type: 'event_msg',
    lineage: lineage('run-alpha', STORY_ID, { worktree_root: root, branch: 'codex/lineage' })
  })}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    runId: 'run-alpha',
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  assert.equal(result.lineage_attribution.mode, 'canonical_run_artifact_preferred');
  assert.equal(result.lineage_attribution.canonical_run.status, 'available');
  assert.equal(result.lineage_attribution.canonical_run.validated_dispatch_count, 1);
});

test('canonical Run lineage fails closed on conflicting persisted provider identities', async () => {
  const { root, codexHome } = await fixture();
  await writeCanonicalRun(root, {
    authority: { worktree_root: root, branch: 'codex/lineage', current_head_sha: HEAD_SHA },
    runtimeDispatches: [
      {
        dispatch_id: 'dispatch-run-alpha',
        provider_run_id: 'provider-run-conflict',
        provider_session_id: 'provider-session-alpha',
        thread_id: 'provider-thread-alpha',
        lineage: lineage('run-alpha', STORY_ID, { worktree_root: root, branch: 'codex/lineage' })
      },
      {
        dispatch_id: 'dispatch-run-beta',
        provider_run_id: 'provider-run-conflict',
        provider_session_id: 'provider-session-beta',
        thread_id: 'provider-thread-beta',
        lineage: { ...lineage('run-alpha', STORY_ID, { worktree_root: root, branch: 'codex/lineage' }), dispatch_id: 'dispatch-run-beta' }
      }
    ]
  });
  await writeSessionFile(codexHome, SESSION_ID, [{
    timestamp: '2026-07-21T01:00:00.000Z',
    type: 'event_msg',
    lineage: lineage('run-alpha', STORY_ID, { worktree_root: root, branch: 'codex/lineage' }),
    payload: { type: 'assistant_message', content: 'matching canonical observation' }
  }]);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    runId: 'run-alpha',
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  assert.equal(result.lineage_attribution.status, 'unavailable');
  assert.equal(result.lineage_attribution.canonical_run.status, 'unavailable');
  assert.equal(result.lineage_attribution.canonical_run.provider_identity_validation.status, 'degraded');
  assert.equal(result.lineage_attribution.canonical_run.provider_identity_validation.code, 'provider_identity_conflict');
  assert.match(result.lineage_attribution.canonical_run.reason, /provider identity uniqueness validation failed/);
  assert.equal(result.lineage_attribution.authoritative_event_count, 0);
  assert.equal(result.lineage_attribution.buckets.story_attributed.event_count, 0);
  assert.equal(result.lineage_attribution.buckets.other_story.event_count, 0);
  assert.equal(result.lineage_attribution.buckets.unattributed.event_count, 1);
});

test('canonical Run lineage fails closed on provider identities duplicated across persisted Runs', async () => {
  const { root, codexHome } = await fixture();
  await writeCanonicalRun(root, {
    authority: { worktree_root: root, branch: 'codex/lineage', current_head_sha: HEAD_SHA },
    runtimeDispatches: [{
      dispatch_id: 'dispatch-run-alpha',
      adapter_id: 'fixture-runtime',
      provider_run_id: 'provider-run-cross-run',
      lineage: lineage('run-alpha', STORY_ID, { worktree_root: root, branch: 'codex/lineage' })
    }]
  });
  await writeCanonicalRun(root, {
    runId: 'run-beta',
    authority: { worktree_root: root, branch: 'codex/lineage', current_head_sha: HEAD_SHA },
    runtimeDispatches: [{
      dispatch_id: 'dispatch-run-beta',
      adapter_id: 'fixture-runtime',
      provider_run_id: 'provider-run-cross-run',
      lineage: lineage('run-beta', STORY_ID, { worktree_root: root, branch: 'codex/lineage' })
    }]
  });
  await writeSessionFile(codexHome, SESSION_ID, [{
    timestamp: '2026-07-21T01:00:00.000Z',
    type: 'event_msg',
    lineage: lineage('run-alpha', STORY_ID, { worktree_root: root, branch: 'codex/lineage' })
  }]);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    runId: 'run-alpha',
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  assert.equal(result.lineage_attribution.status, 'unavailable');
  assert.equal(result.lineage_attribution.canonical_run.status, 'unavailable');
  assert.equal(result.lineage_attribution.canonical_run.provider_identity_validation.code, 'provider_identity_conflict');
  assert.equal(result.lineage_attribution.authoritative_event_count, 0);
  assert.equal(result.lineage_attribution.buckets.unattributed.event_count, 1);
});

test('canonical Run lineage fails closed when one dispatch is valid and another has invalid lineage', async () => {
  const { root, codexHome } = await fixture();
  await writeCanonicalRun(root, {
    authority: { worktree_root: root, branch: 'codex/lineage', current_head_sha: HEAD_SHA },
    runtimeDispatches: [
      {
        dispatch_id: 'dispatch-run-alpha-valid',
        adapter_id: 'fixture-runtime',
        provider_run_id: 'provider-run-valid',
        lineage: { ...lineage('run-alpha', STORY_ID, { worktree_root: root, branch: 'codex/lineage' }), dispatch_id: 'dispatch-run-alpha-valid' }
      },
      {
        dispatch_id: 'dispatch-run-alpha-invalid',
        adapter_id: 'fixture-runtime',
        provider_run_id: 'provider-run-invalid',
        lineage: { ...lineage('run-alpha', STORY_ID, { worktree_root: root, branch: 'codex/lineage' }), dispatch_id: 'dispatch-run-alpha-invalid', head_sha: undefined }
      }
    ]
  });
  await writeSessionFile(codexHome, SESSION_ID, [{
    timestamp: '2026-07-21T01:00:00.000Z',
    type: 'event_msg',
    lineage: lineage('run-alpha', STORY_ID, { worktree_root: root, branch: 'codex/lineage' })
  }]);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    runId: 'run-alpha',
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  assert.equal(result.lineage_attribution.status, 'unavailable');
  assert.equal(result.lineage_attribution.canonical_run.status, 'unavailable');
  assert.equal(result.lineage_attribution.canonical_run.provider_identity_validation.code, 'invalid_dispatch_lineage');
  assert.equal(result.lineage_attribution.canonical_run.validated_dispatch_count, 1);
  assert.equal(result.lineage_attribution.canonical_run.invalid_dispatches.length, 1);
  assert.equal(result.lineage_attribution.authoritative_event_count, 0);
  assert.equal(result.lineage_attribution.buckets.unattributed.event_count, 1);
});

test('canonical Run lineage deterministically deduplicates one mirrored session event per dispatch', async () => {
  const { root, codexHome } = await fixture();
  await writeCanonicalRun(root, {
    authority: { worktree_root: root, branch: 'codex/lineage', current_head_sha: HEAD_SHA }
  });
  const mirroredLineage = lineage('run-alpha', STORY_ID, { worktree_root: root, branch: 'codex/lineage' });
  await writeSessionFile(codexHome, SESSION_ID, [
    {
      timestamp: '2026-07-21T01:00:00.000Z',
      type: 'event_msg',
      lineage: mirroredLineage,
      payload: { type: 'assistant_message', content: 'mirrored dispatch observation' }
    },
    {
      timestamp: '2026-07-21T01:00:01.000Z',
      type: 'event_msg',
      lineage: mirroredLineage,
      payload: { type: 'assistant_message', content: 'distinct observation for the same dispatch' }
    }
  ]);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    runId: 'run-alpha',
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  assert.equal(result.lineage_attribution.deduplication.method, 'canonical_dispatch_id_preferred_once_per_dispatch');
  assert.equal(result.lineage_attribution.deduplication.duplicate_event_count, 1);
  assert.equal(result.lineage_attribution.deduplication.input_event_count, 3);
  assert.equal(result.lineage_attribution.deduplication.output_event_count, 2);
  assert.equal(result.lineage_attribution.total_event_count, 2);
  assert.equal(result.lineage_attribution.events.filter((event) => event.lineage?.dispatch_id === 'dispatch-run-alpha').length, 2);
});

test('malformed JSONL rows are reported as parse loss and degrade audit readiness', async () => {
  const { root, codexHome } = await fixture();
  const sessionPath = path.join(codexHome, 'sessions', '2026', '07', '21', `${SESSION_ID}.jsonl`);
  const validEntries = [
    {
      timestamp: '2026-07-21T01:00:00.000Z',
      type: 'event_msg',
      payload: { type: 'assistant_message', content: 'valid row' }
    },
    {
      timestamp: '2026-07-21T01:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'assistant_message', content: 'another valid row' }
    }
  ];
  await writeFile(sessionPath, `${JSON.stringify(validEntries[0])}\n{"timestamp":"2026-07-21T01:00:00.500Z", malformed\n${JSON.stringify(validEntries[1])}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  assert.equal(result.session.parse_diagnostics.status, 'degraded');
  assert.equal(result.session.parse_diagnostics.confidence, 'degraded');
  assert.equal(result.session.parse_diagnostics.physical_row_count, 3);
  assert.equal(result.session.parse_diagnostics.parsed_row_count, 2);
  assert.equal(result.session.parse_diagnostics.malformed_row_count, 1);
  assert.equal(result.session.parse_diagnostics.malformed_rows[0].line, 2);
  assert.ok(result.audit_readiness.blockers.includes('session_jsonl_parse_loss'));
  assert.match(renderSessionEfficiencyAudit(result), /session_jsonl_parse: degraded malformed_rows=1 confidence=degraded/);
});

test('AC-6 excludes shared-parent, unattributed, and replayed context from Story token/time/value display', async () => {
  const { root, codexHome } = await fixture();
  const timestamp = '2026-07-21T01:00:00.000Z';
  await writeSessionFile(codexHome, SESSION_ID, [
    {
      timestamp,
      type: 'event_msg',
      payload: {
        type: 'assistant_message',
        role: 'assistant',
        content: 'Read test/session-efficiency-run-lineage.test.js',
        lineage: lineage('run-alpha')
      }
    },
    {
      timestamp,
      type: 'event_msg',
      shared_parent: true,
      payload: {
        type: 'assistant_message',
        role: 'assistant',
        content: 'Read src/shared-parent-context.js',
        run_ids: ['run-alpha', 'run-parent']
      }
    },
    {
      timestamp,
      type: 'event_msg',
      thread_id: 'external-thread-without-lineage',
      payload: {
        type: 'assistant_message',
        role: 'assistant',
        content: 'Read src/unattributed-context.js'
      }
    },
    {
      timestamp,
      type: 'compacted',
      replayed_context: true,
      payload: {
        content: 'Read .vibepro/pr/story-vibepro-explicit-run-attribution-lineage/pr-prepare.json',
        replacement_history: 'replayed prior context'
      }
    }
  ]);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: SESSION_ID,
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });

  const buckets = result.lineage_attribution.buckets;
  assert.equal(result.lineage_attribution.events.map((event) => event.bucket).join(','),
    'story_attributed,shared_parent,unattributed,replayed_context');
  assert.equal(buckets.story_attributed.event_count, 1);
  assert.equal(buckets.shared_parent.event_count, 1);
  assert.equal(buckets.unattributed.event_count, 1);
  assert.equal(buckets.replayed_context.event_count, 1);
  assert.ok(buckets.story_attributed.tokens > 0);
  assert.equal(buckets.story_attributed.time_ms, 0);
  assert.equal(buckets.story_attributed.value, 0);
  assert.ok(buckets.shared_parent.tokens > 0);
  assert.ok(buckets.unattributed.tokens > 0);
  assert.ok(buckets.replayed_context.tokens > 0);
  assert.equal(buckets.story_attributed.tokens,
    result.lineage_attribution.events.find((event) => event.bucket === 'story_attributed').tokens);
  const rendered = renderSessionEfficiencyAudit(result);
  assert.match(rendered, /replayed carryover context/);
  assert.doesNotMatch(rendered, /Story token|Story time|Story value/);
});

test('AC-7 external sessions keep advisory inference and fail unavailable or ambiguous without Thread separation', async () => {
  const { root, codexHome } = await fixture();
  const externalSession = '019f0000-0000-4000-8000-000000000001';
  const externalEntry = {
    timestamp: '2026-07-21T01:00:00.000Z',
    type: 'event_msg',
    payload: { type: 'assistant_message', role: 'assistant', content: `Working on ${STORY_ID}` }
  };
  await writeSessionFile(codexHome, externalSession, [
    { timestamp: externalEntry.timestamp, type: 'session_meta', payload: { session_id: externalSession, cwd: root } },
    externalEntry
  ]);

  const inferred = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });
  assert.equal(inferred.session_selection.status, 'inferred');
  assert.equal(inferred.attribution.mode, 'advisory');
  assert.equal(inferred.attribution.categories.strict, 1);
  assert.equal(inferred.lineage_attribution.authoritative_event_count, 0);
  assert.equal(inferred.lineage_attribution.thread_only_event_count, 0);
  assert.equal(inferred.lineage_attribution.buckets.unattributed.event_count, 0);

  const secondSession = '019f0000-0000-4000-8000-000000000002';
  await writeSessionFile(codexHome, secondSession, [
    { timestamp: externalEntry.timestamp, type: 'session_meta', payload: { session_id: secondSession, cwd: root } },
    externalEntry
  ]);
  const ambiguous = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });
  assert.equal(ambiguous.session_selection.status, 'ambiguous');
  assert.equal(ambiguous.session_id, null);
  assert.equal(ambiguous.lineage_attribution.status, 'unavailable');
  assert.equal(ambiguous.lineage_attribution.thread_only_event_count, 0);

  const unavailable = await collectSessionEfficiencyAudit(root, {
    storyId: STORY_ID,
    sessionId: 'auto',
    inferSession: true,
    codexHome: path.join(os.tmpdir(), 'vibepro-no-sessions-for-lineage'),
    windowStart: '2026-07-21T00:59:00.000Z',
    windowEnd: '2026-07-21T01:01:00.000Z'
  });
  assert.equal(unavailable.session_selection.status, 'unavailable');
  assert.equal(unavailable.lineage_attribution.status, 'unavailable');
  assert.equal(unavailable.lineage_attribution.thread_only_event_count, 0);
});
