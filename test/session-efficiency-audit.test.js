import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  collectSessionEfficiencyAudit,
  commitAuditAutomationMemory,
  preflightAuditAutomationMemory,
  renderSessionEfficiencyAudit
} from '../src/session-efficiency-audit.js';
import { buildSessionBoundaryAdvisory, preparePullRequest } from '../src/pr-manager.js';

const execFileAsync = promisify(execFile);
const CLI_BIN = fileURLToPath(new URL('../bin/vibepro.js', import.meta.url));

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function git(cwd, args) {
  return execFileAsync('git', args, { cwd, encoding: 'utf8' });
}

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'vibepro-session-cost-repo-'));
  const codexHome = await mkdtemp(path.join(os.tmpdir(), 'vibepro-session-cost-codex-'));
  const storyId = 'STR-126';
  const sessionId = '019f0405-d790-70e1-882f-a436d8074dcd';

  await git(root, ['init']);
  await git(root, ['config', 'user.email', 'vibepro@example.test']);
  await git(root, ['config', 'user.name', 'VibePro Test']);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'app.js'), 'export const value = 1;\n');
  await git(root, ['add', 'src/app.js']);
  await git(root, ['commit', '-m', 'base']);
  await git(root, ['tag', 'base']);

  await mkdir(path.join(root, 'test'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'specs'), { recursive: true });
  await mkdir(path.join(root, 'docs', 'management', 'audit-artifacts', storyId), { recursive: true });
  await writeFile(path.join(root, 'src', 'app.js'), 'export const value = 2;\nexport const fixed = true;\n');
  await writeFile(path.join(root, 'test', 'app.test.js'), 'import "../src/app.js";\n');
  await writeFile(path.join(root, 'docs', 'specs', 'str-126.md'), '# STR-126\n\nSpec line.\n');
  await writeJson(path.join(root, 'docs', 'management', 'audit-artifacts', storyId, 'audit-bundle.json'), { story_id: storyId });
  await git(root, ['add', 'src/app.js', 'test/app.test.js', 'docs/specs/str-126.md', `docs/management/audit-artifacts/${storyId}/audit-bundle.json`]);
  await git(root, ['commit', '-m', 'story work']);

  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    story: { story_id: storyId },
    gate_status: {
      overall_status: 'needs_verification',
      ready_for_pr_create: false,
      critical_unresolved_gates: [{ id: 'gate:agent_review' }]
    }
  });
  await writeJson(path.join(root, '.vibepro', 'pr', storyId, 'verification-evidence.json'), {
    story_id: storyId,
    updated_at: '2026-06-27T13:54:00.000Z',
    commands: [
      { kind: 'unit', status: 'pass' },
      { kind: 'e2e', status: 'pass' }
    ]
  });

  await writeJson(path.join(codexHome, 'process_manager', 'chat_processes.json'), [{
    conversationId: sessionId,
    cwd: root,
    command: 'npm run start',
    turnId: 'turn-1',
    itemId: 'call-1',
    processId: '123',
    osPid: null,
    startedAtMs: 1782558419000,
    updatedAtMs: 1782558420000
  }]);
  const sessionPath = path.join(codexHome, 'sessions', '2026', '06', '27', `rollout-test-${sessionId}.jsonl`);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  const lines = [
    {
      timestamp: '2026-06-27T13:00:00.000Z',
      type: 'session_meta',
      payload: { session_id: sessionId, id: sessionId, cwd: '/wrong/canonical/root' }
    },
    {
      timestamp: '2026-06-27T13:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', started_at: 1782558001 }
    },
    {
      timestamp: '2026-06-27T13:00:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 100,
            cached_input_tokens: 40,
            output_tokens: 20,
            reasoning_output_tokens: 5,
            total_tokens: 120
          }
        }
      }
    },
    {
      timestamp: '2026-06-27T13:02:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 300,
            cached_input_tokens: 120,
            output_tokens: 70,
            reasoning_output_tokens: 15,
            total_tokens: 370
          }
        }
      }
    },
    {
      timestamp: '2026-06-27T13:02:20.000Z',
      type: 'event_msg',
      payload: { type: 'final_answer' }
    }
  ];
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  return { root, codexHome, storyId, sessionId, sessionPath };
}

async function writeSessionJsonl(codexHome, sessionId, lines) {
  const sessionPath = path.join(codexHome, 'sessions', '2026', '06', '27', `rollout-test-${sessionId}.jsonl`);
  await mkdir(path.dirname(sessionPath), { recursive: true });
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return sessionPath;
}

function sessionLines({ sessionId, cwd = null, storyId = null, firstToken = 100, lastToken = 200 } = {}) {
  return [
    {
      timestamp: '2026-06-27T13:00:00.000Z',
      type: 'session_meta',
      payload: { session_id: sessionId, id: sessionId, ...(cwd ? { cwd } : {}) }
    },
    {
      timestamp: '2026-06-27T13:00:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: firstToken, output_tokens: 20, total_tokens: firstToken + 20 } }
      }
    },
    ...(storyId ? [{
      timestamp: '2026-06-27T13:00:20.000Z',
      type: 'response_item',
      payload: { text: `working on ${storyId}` }
    }] : []),
    {
      timestamp: '2026-06-27T13:02:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: lastToken, output_tokens: 70, total_tokens: lastToken + 70 } }
      }
    },
    {
      timestamp: '2026-06-27T13:02:20.000Z',
      type: 'event_msg',
      payload: { type: 'final_answer' }
    }
  ];
}

test('session efficiency audit uses process-manager worktree and Codex token_count window', async () => {
  const { root, codexHome, storyId, sessionId } = await createFixture();
  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.audit_readiness.status, 'ready');
  assert.equal(result.observed_worktree, root);
  assert.equal(result.observed_worktree_source, 'process_manager');
  assert.equal(result.session.token_accounting.status, 'available');
  assert.equal(result.session.token_accounting.total_tokens, 250);
  assert.equal(result.session.token_accounting.input_tokens, 200);
  assert.equal(result.session.token_accounting.output_tokens, 50);
  assert.equal(result.session.elapsed_time_accounting.status, 'available');
  assert.equal(result.session.elapsed_time_accounting.elapsed_ms, 139000);
  assert.equal(result.story_artifacts.pr_prepare.overall_status, 'needs_verification');
  assert.equal(result.story_artifacts.verification.pass_count, 2);
  assert.equal(result.git.changed_lines.buckets.src.changed_lines > 0, true);
  assert.equal(result.git.changed_lines.buckets.test.changed_lines > 0, true);
  assert.equal(result.git.changed_lines.buckets.story_spec_architecture_docs.changed_lines > 0, true);
  assert.equal(result.git.changed_lines.buckets.audit_artifacts.changed_lines > 0, true);
  assert.equal(result.cost_breakdown.total_tokens, 250);
});

test('session efficiency audit estimates audit artifact token exposure from Codex transcript entries', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const artifactPath = path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json');
  const lines = [
    {
      timestamp: '2026-06-27T13:00:00.000Z',
      type: 'session_meta',
      payload: { session_id: sessionId, id: sessionId, cwd: root }
    },
    {
      timestamp: '2026-06-27T13:00:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 100,
            output_tokens: 20,
            total_tokens: 120
          }
        }
      }
    },
    {
      timestamp: '2026-06-27T13:00:20.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        output: [
          `Command: cat ${artifactPath}`,
          'Output:',
          JSON.stringify({
            story: { story_id: storyId },
            gate_status: {
              overall_status: 'needs_verification',
              critical_unresolved_gates: ['gate:agent_review']
            },
            decision_summary: 'This gate evidence explains why PR creation is blocked until review evidence is refreshed.'
          })
        ].join('\n')
      }
    },
    {
      timestamp: '2026-06-27T13:00:30.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        output: [
          'Command: sed -n 1,40p docs/specs/str-126.md',
          'Output:',
          '# STR-126',
          'Architecture and story handoff notes.'
        ].join('\n')
      }
    },
    {
      timestamp: '2026-06-27T13:02:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: {
          total_token_usage: {
            input_tokens: 300,
            output_tokens: 70,
            total_tokens: 370
          }
        }
      }
    },
    {
      timestamp: '2026-06-27T13:02:20.000Z',
      type: 'event_msg',
      payload: { type: 'final_answer' }
    }
  ];
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  const accounting = result.session.artifact_token_accounting;
  assert.equal(accounting.status, 'available');
  assert.equal(accounting.source, 'codex-session-jsonl-text-estimate');
  assert.equal(accounting.total_session_tokens, 250);
  assert.equal(accounting.buckets.audit_evidence.event_count, 1);
  assert.equal(accounting.buckets.audit_evidence.estimated_tokens > 0, true);
  assert.equal(accounting.buckets.audit_evidence.ratio_of_session_tokens > 0, true);
  assert.equal(accounting.buckets.story_spec_architecture_docs.event_count, 1);
  assert.equal(accounting.top_exposures[0].bucket_id, 'audit_evidence');
  assert.match(accounting.top_exposures[0].sample, /pr-prepare\.json/);
});

test('SCCB-SCENARIO-001 compaction replacement_history text is bucketed as replayed_context, not audit_evidence/test', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const artifactPath = path.join(root, '.vibepro', 'pr', storyId, 'pr-prepare.json');
  const lines = [
    {
      timestamp: '2026-06-27T13:00:00.000Z',
      type: 'session_meta',
      payload: { session_id: sessionId, id: sessionId, cwd: root }
    },
    {
      timestamp: '2026-06-27T13:00:05.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }
      }
    },
    // A real audit_evidence hit from fresh reasoning, unaffected by this fix.
    {
      timestamp: '2026-06-27T13:00:10.000Z',
      type: 'response_item',
      payload: {
        type: 'function_call_output',
        output: `Command: cat ${artifactPath}\nOutput:\n${JSON.stringify({ story: { story_id: storyId } })}`
      }
    },
    // Codex re-quotes prior goal/permissions/audit-artifact text after compaction.
    // This must NOT double-count into audit_evidence/test even though its content
    // mentions .vibepro/ and test/ paths.
    {
      timestamp: '2026-06-27T13:00:20.000Z',
      type: 'compacted',
      payload: {
        message: '',
        replacement_history: [
          {
            type: 'message',
            role: 'developer',
            content: [
              {
                type: 'input_text',
                text: `<permissions instructions>\nGoal: finish ${storyId}. Evidence lives under .vibepro/pr/${storyId}/pr-prepare.json and test/app.test.js. Run npm run test.`
              }
            ]
          }
        ]
      }
    },
    {
      timestamp: '2026-06-27T13:02:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 300, output_tokens: 70, total_tokens: 370 } }
      }
    },
    {
      timestamp: '2026-06-27T13:02:20.000Z',
      type: 'event_msg',
      payload: { type: 'final_answer' }
    }
  ];
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  const accounting = result.session.artifact_token_accounting;
  assert.equal(accounting.status, 'available');
  assert.equal(accounting.buckets.audit_evidence.event_count, 1);
  assert.equal(accounting.buckets.test.event_count, 0);
  assert.equal(accounting.buckets.replayed_context.event_count, 1);
  assert.equal(accounting.buckets.replayed_context.estimated_tokens > 0, true);
  assert.deepEqual(accounting.buckets.replayed_context.matched_signals, ['compaction_replacement_history']);
});

test('SEXP-S-1/2/3/4 classifies provenance, preserves semantic totals, and deduplicates repeated mixed tool output by digest', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const mixedOutput = `Read .vibepro/pr/${storyId}/pr-prepare.json and src/session.js with test/session.test.js`;
  const lines = [
    {
      timestamp: '2026-06-27T13:00:00.000Z',
      type: 'session_meta',
      payload: { session_id: sessionId, id: sessionId, cwd: root }
    },
    {
      timestamp: '2026-06-27T13:00:05.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 500, output_tokens: 50, total_tokens: 550 } } }
    },
    {
      timestamp: '2026-06-27T13:00:10.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', output: mixedOutput }
    },
    {
      timestamp: '2026-06-27T13:00:20.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', output: mixedOutput }
    },
    {
      timestamp: '2026-06-27T13:00:30.000Z',
      type: 'compacted',
      payload: { replacement_history: [{ role: 'developer', content: [{ type: 'input_text', text: `.vibepro/pr/${storyId}/gate-dag.json` }] }] }
    },
    {
      timestamp: '2026-06-27T13:00:40.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', output: 'Read src/fresh-session.js' }
    },
    {
      timestamp: '2026-06-27T13:00:50.000Z',
      type: 'response_item',
      payload: { type: 'assistant_message', role: 'assistant', content: [{ type: 'output_text', text: 'Generated implementation summary for src/generated-session.js' }] }
    },
    {
      timestamp: '2026-06-27T13:01:00.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: `Preserve docs/specs/${storyId}.md as the session constraint` }] }
    },
    {
      timestamp: '2026-06-27T13:01:10.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', output: 'Read src/semantic-session.js then run npm test' }
    },
    {
      timestamp: '2026-06-27T13:01:15.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', output: 'Read src/session.test.js' }
    },
    {
      timestamp: '2026-06-27T13:01:20.000Z',
      type: 'response_item',
      payload: { type: 'function_call_output', output: 'command completed without artifact paths or test signals' }
    }
  ];
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  const accounting = result.session.artifact_token_accounting;
  const mixed = accounting.provenance_buckets.mixed_tool_output;
  assert.equal(mixed.event_count, 4);
  assert.equal(mixed.unique_digest_count, 3);
  assert.equal(mixed.unique_estimated_tokens > 0, true);
  assert.equal(mixed.duplicate_estimated_tokens > 0, true);
  assert.equal(mixed.unique_estimated_tokens > mixed.duplicate_estimated_tokens, true);
  assert.equal(accounting.provenance_buckets.replayed_context.event_count, 1);
  assert.equal(accounting.provenance_buckets.fresh_read.event_count, 1);
  assert.equal(accounting.provenance_buckets.generated_output.event_count, 1);
  assert.equal(accounting.provenance_buckets.world_state.event_count, 1);
  assert.deepEqual(
    Object.keys(accounting.provenance_buckets).sort(),
    ['fresh_read', 'generated_output', 'mixed_tool_output', 'replayed_context', 'world_state']
  );
  assert.equal(accounting.unique_estimated_tokens + accounting.duplicate_estimated_tokens, accounting.classified_estimated_tokens);
  assert.equal(
    Object.values(accounting.buckets).reduce((sum, bucket) => sum + bucket.estimated_tokens, 0),
    accounting.classified_estimated_tokens
  );
  assert.deepEqual(
    accounting.top_exposures[0].semantic_segments.map((segment) => segment.bucket_id).sort(),
    ['audit_evidence', 'src_code', 'test']
  );
  assert.equal(
    accounting.top_exposures[0].semantic_segments.reduce((sum, segment) => sum + segment.estimated_tokens, 0),
    accounting.top_exposures[0].estimated_tokens
  );
  assert.equal(accounting.buckets.audit_evidence.estimated_tokens > 0, true);
  assert.equal(accounting.buckets.src_code.estimated_tokens > 0, true);
  assert.equal(accounting.buckets.test.estimated_tokens > 0, true);
  const semanticMixed = accounting.top_exposures.find((event) => event.sample.includes('semantic-session.js'));
  assert.deepEqual(
    semanticMixed.semantic_segments.map((segment) => segment.bucket_id).sort(),
    ['src_code', 'test']
  );
  assert.equal(
    semanticMixed.semantic_segments.reduce((sum, segment) => sum + segment.estimated_tokens, 0),
    semanticMixed.estimated_tokens
  );
  const semanticMixedText = 'Read src/semantic-session.js then run npm test';
  assert.equal(
    semanticMixed.semantic_segments.reduce((sum, segment) => sum + segment.char_count, 0),
    semanticMixedText.length
  );
  const semanticRanges = semanticMixed.semantic_segments
    .flatMap((segment) => segment.ranges.map((range) => ({ ...range, bucket_id: segment.bucket_id })))
    .sort((left, right) => left.start - right.start);
  assert.equal(semanticRanges[0].start, 0);
  assert.equal(semanticRanges.at(-1).end, semanticMixedText.length);
  for (let index = 1; index < semanticRanges.length; index += 1) {
    assert.equal(semanticRanges[index - 1].end, semanticRanges[index].start);
  }
  const srcRange = semanticRanges.find((range) => range.bucket_id === 'src_code');
  const testRange = semanticRanges.find((range) => range.bucket_id === 'test');
  assert.match(semanticMixedText.slice(srcRange.start, srcRange.end), /src\/semantic-session\.js/);
  assert.match(semanticMixedText.slice(testRange.start, testRange.end), /npm test/);
  const overlappingPathText = 'Read src/session.test.js';
  const overlappingPath = accounting.top_exposures.find((event) => event.sample.includes(overlappingPathText));
  assert.deepEqual(overlappingPath.semantic_segments.map((segment) => segment.bucket_id).sort(), ['src_code', 'test']);
  const overlappingRanges = overlappingPath.semantic_segments
    .flatMap((segment) => segment.ranges.map((range) => ({ ...range, bucket_id: segment.bucket_id })))
    .sort((left, right) => left.start - right.start);
  assert.equal(overlappingRanges[0].start, 0);
  assert.equal(overlappingRanges.at(-1).end, overlappingPathText.length);
  assert.equal(overlappingRanges[0].end, overlappingRanges[1].start);
  const overlappingSrc = overlappingRanges.find((range) => range.bucket_id === 'src_code');
  const overlappingTest = overlappingRanges.find((range) => range.bucket_id === 'test');
  assert.match(overlappingPathText.slice(overlappingSrc.start, overlappingSrc.end), /src\//);
  assert.match(overlappingPathText.slice(overlappingTest.start, overlappingTest.end), /session\.test\.js/);
  assert.equal(
    overlappingPath.semantic_segments.reduce((sum, segment) => sum + segment.estimated_tokens, 0),
    overlappingPath.estimated_tokens
  );
  assert.equal(accounting.unmatched_event_count, 1);
  assert.equal(accounting.unmatched_estimated_tokens > 0, true);
  assert.equal(accounting.carryover_control.status, 'review_required');
  assert.equal(accounting.carryover_control.replayed_context_estimated_tokens > 0, true);
  assert.equal(accounting.top_exposures[0].content_digest.length, 64);
});

test('session efficiency audit infers the matching Codex session from repo cwd and window', async () => {
  const { root, codexHome, storyId, sessionId } = await createFixture();
  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-06-27T13:00:00.000Z',
    windowEnd: '2026-06-27T13:03:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_id, sessionId);
  assert.equal(result.session_selection.status, 'inferred');
  assert.equal(result.session_selection.confidence, 'high');
  assert.equal(result.session_selection.candidates_considered, 1);
  assert.equal(result.session.token_accounting.total_tokens, 250);
  assert.equal(result.audit_readiness.status, 'ready');
});

test('SCATTR-SCENARIO-001 session inference merges split JSONL files for the same session id', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  await writeJson(path.join(codexHome, 'process_manager', 'chat_processes.json'), []);
  await writeFile(sessionPath, `${[
    {
      timestamp: '2026-06-27T13:00:00.000Z',
      type: 'session_meta',
      payload: { session_id: sessionId, id: sessionId, cwd: root }
    },
    {
      timestamp: '2026-06-27T13:00:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }
      }
    },
    {
      timestamp: '2026-06-27T13:00:20.000Z',
      type: 'response_item',
      payload: { text: `working on ${storyId}` }
    }
  ].map((line) => JSON.stringify(line)).join('\n')}\n`);
  const splitSessionPath = path.join(codexHome, 'sessions', '2026', '06', '27', `rollout-split-${sessionId}.jsonl`);
  await writeFile(splitSessionPath, `${[
    {
      timestamp: '2026-06-27T13:02:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 380, output_tokens: 80, total_tokens: 460 } }
      }
    },
    {
      timestamp: '2026-06-27T13:02:20.000Z',
      type: 'event_msg',
      payload: { type: 'final_answer' }
    }
  ].map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-06-27T13:00:00.000Z',
    windowEnd: '2026-06-27T13:03:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_id, sessionId);
  assert.equal(result.session_selection.status, 'inferred');
  assert.equal(result.session_selection.candidates_considered, 1);
  assert.equal(result.session_selection.candidates[0].source_paths.length, 2);
  assert.equal(result.session.source_paths.length, 2);
  assert.equal(result.session.token_accounting.total_tokens, 340);
  assert.equal(result.session.elapsed_time_accounting.elapsed_ms, 180000);
});

test('SCATTR-SCENARIO-001 session inference ignores symlink directories during JSONL discovery', async () => {
  const { root, codexHome, storyId, sessionId } = await createFixture();
  await symlink(path.join(codexHome, 'sessions'), path.join(codexHome, 'sessions', 'loop'), 'dir');

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-06-27T13:00:00.000Z',
    windowEnd: '2026-06-27T13:03:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_id, sessionId);
  assert.equal(result.session_selection.status, 'inferred');
  assert.equal(result.session_selection.candidates_considered, 1);
});

test('SCATTR-SCENARIO-001 session inference bounds discovery to the selected window day directories', async () => {
  const { root, codexHome, storyId, sessionId } = await createFixture();
  const oldSessionPath = path.join(codexHome, 'sessions', '2026', '05', '01', 'rollout-test-019f0405-d790-70e1-882f-a436d8074aaa.jsonl');
  await mkdir(path.dirname(oldSessionPath), { recursive: true });
  await writeFile(
    oldSessionPath,
    `${sessionLines({
      sessionId: '019f0405-d790-70e1-882f-a436d8074aaa',
      cwd: root,
      storyId,
      firstToken: 500,
      lastToken: 900
    }).map((line) => JSON.stringify({ ...line, timestamp: line.timestamp.replace('2026-06-27', '2026-05-01') })).join('\n')}\n`
  );

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-06-27T13:00:00.000Z',
    windowEnd: '2026-06-27T13:03:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_id, sessionId);
  assert.equal(result.session_selection.candidates_considered, 1);
});

test('SCATTR-SCENARIO-002 session cwd from sibling Git worktree still matches canonical repo', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const siblingWorktree = await mkdtemp(path.join(os.tmpdir(), 'vibepro-session-cost-worktree-'));
  await git(root, ['worktree', 'add', '--detach', siblingWorktree, 'HEAD']);
  await writeJson(path.join(codexHome, 'process_manager', 'chat_processes.json'), []);
  await writeFile(sessionPath, `${sessionLines({ sessionId, cwd: siblingWorktree, storyId }).map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-06-27T13:00:00.000Z',
    windowEnd: '2026-06-27T13:03:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_id, sessionId);
  assert.equal(result.session_selection.candidates[0].cwd_matches_repo, true);
  assert.equal(result.observed_worktree_matches_repo, true);
  assert.equal(result.audit_readiness.blockers.includes('session_cwd_mismatch'), false);
});

test('SCATTR-SCENARIO-005 worktree cwd match alone is decisive even without other signals', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const siblingWorktree = await mkdtemp(path.join(os.tmpdir(), 'vibepro-session-cost-worktree-signal-less-'));
  await git(root, ['worktree', 'add', '--detach', siblingWorktree, 'HEAD']);
  await writeJson(path.join(codexHome, 'process_manager', 'chat_processes.json'), []);
  // Only session_meta (cwd) and a non-token/non-final event: no story ref, no
  // token_count/final_answer events, and timestamps outside the requested window.
  const lines = [
    {
      timestamp: '2026-06-27T10:00:00.000Z',
      type: 'session_meta',
      payload: { session_id: sessionId, id: sessionId, cwd: siblingWorktree }
    },
    {
      timestamp: '2026-06-27T10:00:01.000Z',
      type: 'event_msg',
      payload: { type: 'task_started', started_at: 1782558001 }
    }
  ];
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-06-27T13:00:00.000Z',
    windowEnd: '2026-06-27T13:03:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_selection.status, 'inferred');
  assert.equal(result.session_id, sessionId);
  assert.equal(result.session_selection.candidates[0].cwd_matches_repo, true);
  assert.equal(result.session_selection.candidates[0].score, 50);
});

test('SCATTR-SCENARIO-006 cwd under a different repo worktree directory does not match', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const otherRepoWorktreesDir = await mkdtemp(path.join(os.tmpdir(), 'vibepro-session-cost-other-repo-worktrees-'));
  const otherRepoRoot = path.join(otherRepoWorktreesDir, '.worktrees', 'other-project-feature');
  await mkdir(otherRepoRoot, { recursive: true });
  await git(otherRepoRoot, ['init']);
  await git(otherRepoRoot, ['config', 'user.email', 'vibepro@example.test']);
  await git(otherRepoRoot, ['config', 'user.name', 'VibePro Test']);
  await writeJson(path.join(codexHome, 'process_manager', 'chat_processes.json'), []);
  await writeFile(sessionPath, `${sessionLines({ sessionId, cwd: otherRepoRoot, storyId }).map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-06-27T13:00:00.000Z',
    windowEnd: '2026-06-27T13:03:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_selection.candidates[0].cwd_matches_repo, false);
});

test('SCATTR-SCENARIO-003 explicit session from another repo remains partial with cwd mismatch', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const otherRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-session-cost-other-repo-'));
  await git(otherRoot, ['init']);
  await git(otherRoot, ['config', 'user.email', 'vibepro@example.test']);
  await git(otherRoot, ['config', 'user.name', 'VibePro Test']);
  await writeJson(path.join(codexHome, 'process_manager', 'chat_processes.json'), []);
  await writeFile(sessionPath, `${sessionLines({ sessionId, cwd: otherRoot, storyId }).map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_id, sessionId);
  assert.equal(result.observed_worktree, otherRoot);
  assert.equal(result.observed_worktree_source, 'session_meta');
  assert.equal(result.observed_worktree_matches_repo, false);
  assert.equal(result.audit_readiness.status, 'partial');
  assert.equal(result.audit_readiness.blockers.includes('session_cwd_mismatch'), true);
});

test('SCATTR-SCENARIO-004 bounded session window with no events keeps elapsed unavailable', async () => {
  const { root, codexHome, storyId, sessionId } = await createFixture();

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    windowStart: '2026-06-27T12:00:00.000Z',
    windowEnd: '2026-06-27T12:10:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session.window.in_window_event_count, 0);
  assert.equal(result.session.token_accounting.status, 'unavailable');
  assert.equal(result.session.elapsed_time_accounting.status, 'unavailable');
  assert.match(result.session.elapsed_time_accounting.reason, /no events were found/);
  assert.equal(result.attribution.status, 'unavailable');
  assert.match(result.attribution.reason, /No events were found within the selected session window/);
  assert.equal(result.audit_readiness.blockers.includes('elapsed_time_unavailable'), true);
  const rendered = renderSessionEfficiencyAudit(result);
  assert.match(rendered, /attribution: unavailable/);
  assert.match(rendered, /reason=No events were found within the selected session window/);
});

test('SAI-SCENARIO-002 session inference keeps equal top candidates ambiguous without silent selection', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  await writeJson(path.join(codexHome, 'process_manager', 'chat_processes.json'), []);
  await writeFile(sessionPath, `${sessionLines({ sessionId, cwd: root }).map((line) => JSON.stringify(line)).join('\n')}\n`);
  await writeSessionJsonl(
    codexHome,
    '019f0405-d790-70e1-882f-a436d8074dcf',
    sessionLines({ sessionId: '019f0405-d790-70e1-882f-a436d8074dcf', cwd: root, firstToken: 300, lastToken: 500 })
  );

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-06-27T13:00:00.000Z',
    windowEnd: '2026-06-27T13:03:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_id, null);
  assert.equal(result.session_selection.status, 'ambiguous');
  assert.equal(result.session_selection.confidence, 'ambiguous');
  assert.equal(result.session_selection.candidates_considered, 2);
  assert.match(result.session_selection.reason, /multiple session candidates/);
  assert.equal(result.session.token_accounting.status, 'unavailable');
  assert.equal(result.audit_readiness.status, 'partial');
});

test('SAI-SCENARIO-003 session inference keeps low-confidence candidates unavailable', async () => {
  const { root, codexHome, storyId } = await createFixture();
  await writeJson(path.join(codexHome, 'process_manager', 'chat_processes.json'), []);
  await writeFile(path.join(codexHome, 'sessions', '2026', '06', '27', 'rollout-test-019f0405-d790-70e1-882f-a436d8074dcd.jsonl'), '');
  await writeSessionJsonl(
    codexHome,
    '019f0405-d790-70e1-882f-a436d8074ddd',
    sessionLines({ sessionId: '019f0405-d790-70e1-882f-a436d8074ddd' })
  );

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId: 'auto',
    inferSession: true,
    codexHome,
    windowStart: '2026-06-27T13:00:00.000Z',
    windowEnd: '2026-06-27T13:03:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_id, null);
  assert.equal(result.session_selection.status, 'ambiguous');
  assert.equal(result.session_selection.confidence, 'low');
  assert.match(result.session_selection.reason, /confidence threshold/);
  assert.equal(result.session.token_accounting.status, 'unavailable');
  assert.deepEqual(
    Object.keys(result.session.artifact_token_accounting.provenance_buckets).sort(),
    ['fresh_read', 'generated_output', 'mixed_tool_output', 'replayed_context', 'world_state']
  );
  assert.equal(result.session.artifact_token_accounting.carryover_control.status, 'unavailable');
  assert.equal(result.session.artifact_token_accounting.unique_estimated_tokens, null);
  assert.equal(result.audit_readiness.status, 'partial');
});

test('audit session-cost CLI exposes JSON contract for active session cost audits', async () => {
  const { root, codexHome, storyId, sessionId } = await createFixture();
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      CLI_BIN,
      'audit',
      'session-cost',
      root,
      '--story-id',
      storyId,
      '--session-id',
      sessionId,
      '--codex-home',
      codexHome,
      '--base',
      'base',
      '--json'
    ],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  const result = JSON.parse(stdout);
  assert.equal(result.artifact_kind, 'vibepro_session_efficiency_audit');
  assert.equal(result.session.token_accounting.total_tokens, 250);
  assert.equal(result.cost_breakdown.buckets.some((bucket) => bucket.label === 'src/ コード本体'), true);

  const rendered = await execFileAsync(
    process.execPath,
    [CLI_BIN, 'audit', 'session-cost', root, '--story-id', storyId, '--session-id', sessionId, '--codex-home', codexHome, '--base', 'base'],
    { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  );
  assert.match(rendered.stdout, /exposure_dedup: unique=/);
  assert.match(rendered.stdout, /carryover_control:/);
  assert.match(rendered.stdout, /\| mixed_tool_output \|/);

  const help = await execFileAsync(process.execPath, [CLI_BIN, 'help', '--language', 'en'], { cwd: root, encoding: 'utf8' });
  assert.match(help.stdout, /vibepro audit session-cost/);
  assert.match(help.stdout, /--infer-session/);
});

test('AUTCOST-SCENARIO-001 AUTCOST-SCENARIO-003 AUTCOST-SCENARIO-004 AUTCOST-SCENARIO-005 session efficiency audit uses automation memory daily window when explicit bounds are absent', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const automationMemoryPath = path.join(codexHome, 'automations', 'vibepro-value-audit', 'memory.md');
  await mkdir(path.dirname(automationMemoryPath), { recursive: true });
  await writeFile(automationMemoryPath, [
    '# vibepro-value-audit memory',
    '',
    '- 2026-06-28 daily value audit: window was `2026-06-27T13:01:00Z` to `2026-06-27T13:03:00Z`.',
    '- Window cost snapshot: downstream session from `2026-06-27T13:03:00Z` to `2026-06-27T13:05:00Z` should not replace the daily window.',
    ''
  ].join('\n'));
  const lines = [
    {
      timestamp: '2026-06-27T13:00:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } }
      }
    },
    {
      timestamp: '2026-06-27T13:01:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 180, output_tokens: 30, total_tokens: 210 } }
      }
    },
    {
      timestamp: '2026-06-27T13:02:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 300, output_tokens: 70, total_tokens: 370 } }
      }
    },
    {
      timestamp: '2026-06-27T13:04:10.000Z',
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: { total_token_usage: { input_tokens: 900, output_tokens: 100, total_tokens: 1000 } }
      }
    }
  ];
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    automationMemoryPath,
    baseRef: 'base',
    now: '2026-06-28T00:05:00.000Z'
  });

  assert.equal(result.automation_memory.status, 'available');
  assert.equal(result.automation_memory.window_start, '2026-06-27T13:01:00.000Z');
  assert.equal(result.automation_memory.window_end, '2026-06-27T13:03:00.000Z');
  assert.equal(result.session.window.scope, 'bounded');
  assert.equal(result.session.token_accounting.total_tokens, 160);
  assert.equal(result.session.elapsed_time_accounting.status, 'available');
  assert.equal(result.session.elapsed_time_accounting.elapsed_ms, 120000);
  assert.equal(result.cost_breakdown.total_tokens, 160);

  const explicitBounds = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    automationMemoryPath,
    windowStart: '2026-06-27T13:00:00Z',
    windowEnd: '2026-06-27T13:03:00Z',
    baseRef: 'base',
    now: '2026-06-28T00:05:00.000Z'
  });
  assert.equal(explicitBounds.session.window.requested_start, '2026-06-27T13:00:00Z');
  assert.equal(explicitBounds.session.token_accounting.total_tokens, 250);

  const missingMemory = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    automationMemoryPath: path.join(codexHome, 'automations', 'missing', 'memory.md'),
    baseRef: 'base',
    now: '2026-06-28T00:05:00.000Z'
  });
  assert.equal(missingMemory.automation_memory.status, 'unavailable');
  assert.equal(missingMemory.session.token_accounting.status, 'available');
  assert.equal(missingMemory.session.token_accounting.total_tokens, 880);

  const lastRunMemoryPath = path.join(codexHome, 'automations', 'last-run-only', 'memory.md');
  await mkdir(path.dirname(lastRunMemoryPath), { recursive: true });
  await writeFile(lastRunMemoryPath, [
    '# vibepro-value-audit memory',
    '',
    'Last run: 2026-06-27T13:01:00.000Z',
    ''
  ].join('\n'));
  const lastRunFallback = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    automationMemoryPath: lastRunMemoryPath,
    baseRef: 'base',
    now: '2026-06-27T13:03:00.000Z'
  });
  assert.equal(lastRunFallback.automation_memory.status, 'partial');
  assert.equal(lastRunFallback.automation_memory.window_start, '2026-06-27T13:01:00.000Z');
  assert.equal(lastRunFallback.automation_memory.window_end, '2026-06-27T13:03:00.000Z');
  assert.equal(lastRunFallback.session.token_accounting.total_tokens, 160);
});

test('AIL-SCENARIO-002 session efficiency audit uses readable detached story artifacts observed in Codex JSONL', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const detachedRoot = await mkdtemp(path.join(os.tmpdir(), 'vibepro-session-cost-detached-'));
  await writeJson(path.join(detachedRoot, '.vibepro', 'pr', storyId, 'pr-prepare.json'), {
    story: { story_id: storyId },
    gate_status: {
      overall_status: 'ready',
      ready_for_pr_create: true,
      critical_unresolved_gates: []
    }
  });
  await writeJson(path.join(detachedRoot, '.vibepro', 'pr', storyId, 'verification-evidence.json'), {
    story_id: storyId,
    updated_at: '2026-06-27T13:54:00.000Z',
    commands: [
      { kind: 'unit', status: 'pass' },
      { kind: 'typecheck', status: 'pass' }
    ]
  });
  await rm(path.join(root, '.vibepro', 'pr', storyId), { recursive: true, force: true });
  const lines = [
    ...sessionLines({ sessionId, cwd: root, storyId }),
    {
      timestamp: '2026-06-27T13:01:00.000Z',
      type: 'response_item',
      payload: {
        text: `read ${path.join(detachedRoot, '.vibepro', 'pr', storyId, 'verification-evidence.json')}`
      }
    }
  ];
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.story_artifacts.status, 'detached_available');
  assert.equal(result.story_artifacts.lineage.status, 'detached_artifact_found');
  assert.equal(result.story_artifacts.lineage.detached_candidates.length, 1);
  assert.equal(result.story_artifacts.lineage.detached_candidates[0].exists, true);
  assert.equal(result.story_artifacts.pr_prepare.overall_status, 'ready');
  assert.equal(result.story_artifacts.verification.pass_count, 2);
  assert.equal(result.audit_readiness.status, 'ready');
});

test('AIL-SCENARIO-003 session efficiency audit reports observed detached artifacts when temp root is gone', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  await rm(path.join(root, '.vibepro', 'pr', storyId), { recursive: true, force: true });
  const missingRoot = path.join(os.tmpdir(), 'vibepro-missing-detached-root', '.vibepro', 'pr', storyId);
  const lines = [
    ...sessionLines({ sessionId, cwd: root, storyId }),
    {
      timestamp: '2026-06-27T13:01:00.000Z',
      type: 'response_item',
      payload: { text: `cat ${path.join(missingRoot, 'pr-prepare.json')}` }
    }
  ];
  await writeFile(sessionPath, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.story_artifacts.status, 'unavailable');
  assert.equal(result.story_artifacts.lineage.status, 'detached_artifact_observed');
  assert.equal(result.story_artifacts.lineage.detached_candidates[0].exists, false);
  assert.deepEqual(result.audit_readiness.blockers, ['story_artifacts_detached_unavailable']);
});

test('audit memory preflight blocks missing memory unless fallback is explicit and commit readback verifies the window', async () => {
  const { root } = await createFixture();
  const memoryPath = path.join(root, '.vibepro', 'automation-memory.md');

  const missing = await preflightAuditAutomationMemory(root, {
    memoryPath,
    now: '2026-06-27T14:00:00.000Z'
  });
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.fallback_used, false);

  const fallback = await preflightAuditAutomationMemory(root, {
    memoryPath,
    fallbackLastRun: '2026-06-27T13:00:00Z',
    now: '2026-06-27T14:00:00.000Z'
  });
  assert.equal(fallback.status, 'fallback');
  assert.equal(fallback.fallback_used, true);
  assert.equal(fallback.window_start, '2026-06-27T13:00:00.000Z');

  const fallbackHours = await preflightAuditAutomationMemory(root, {
    memoryPath,
    fallbackHours: '2',
    now: '2026-06-27T14:00:00.000Z'
  });
  assert.equal(fallbackHours.status, 'fallback');
  assert.equal(fallbackHours.source, 'fallback_hours');
  assert.equal(fallbackHours.window_start, '2026-06-27T12:00:00.000Z');
  assert.equal(fallbackHours.window_end, '2026-06-27T14:00:00.000Z');

  await mkdir(path.dirname(memoryPath), { recursive: true });
  await writeFile(memoryPath, '# audit notes\n\nOperator note that should remain outside the machine block.\n');

  const committed = await commitAuditAutomationMemory(root, {
    memoryPath,
    lastRun: '2026-06-27T14:00:00Z',
    windowStart: '2026-06-27T13:00:00Z',
    windowEnd: '2026-06-27T14:00:00Z',
    now: '2026-06-27T14:00:00.000Z'
  });
  assert.equal(committed.status, 'committed');
  assert.equal(committed.readback.last_run, '2026-06-27T14:00:00.000Z');

  const memoryText = await readFile(memoryPath, 'utf8');
  assert.match(memoryText, /Operator note that should remain outside the machine block/);

  const ready = await preflightAuditAutomationMemory(root, {
    memoryPath,
    now: '2026-06-27T14:05:00.000Z'
  });
  assert.equal(ready.status, 'ready');
  assert.equal(ready.source, 'automation-memory-daily-window');
  assert.equal(ready.last_run, '2026-06-27T14:00:00.000Z');
  assert.equal(ready.window_start, '2026-06-27T13:00:00.000Z');
  assert.equal(ready.window_end, '2026-06-27T14:00:00.000Z');
});

test('audit memory preflight reports corrupt memory and CLI exits non-zero without fallback', async () => {
  const { root } = await createFixture();
  const memoryPath = path.join(root, '.vibepro', 'automation-memory.md');
  await mkdir(path.dirname(memoryPath), { recursive: true });
  await writeFile(memoryPath, [
    '# vibepro-value-audit memory',
    'Last run: not-a-date',
    'Window = also-bad to still-bad',
    ''
  ].join('\n'));

  const corrupt = await preflightAuditAutomationMemory(root, {
    memoryPath,
    now: '2026-06-27T14:00:00.000Z'
  });
  assert.equal(corrupt.status, 'blocked');
  assert.equal(corrupt.fallback_used, false);
  assert.match(corrupt.reason, /did not contain a parseable/);

  await assert.rejects(
    execFileAsync(process.execPath, [
      CLI_BIN,
      'audit',
      'memory',
      'preflight',
      root,
      '--memory',
      memoryPath,
      '--now',
      '2026-06-27T14:00:00.000Z',
      '--json'
    ], { encoding: 'utf8' }),
    (error) => {
      assert.equal(error.code, 2);
      const output = JSON.parse(error.stdout);
      assert.equal(output.status, 'blocked');
      assert.equal(output.fallback_used, false);
      return true;
    }
  );
});

test('session efficiency audit makes strict attribution primary and degrades mixed-parent readiness', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const originalSession = await readFile(sessionPath, 'utf8');
  const attributionEvents = [
    {
      timestamp: '2026-06-27T13:00:30.000Z',
      type: 'response_item',
      payload: { text: `implementation note for ${storyId}` }
    },
    {
      timestamp: '2026-06-27T13:01:00.000Z',
      type: 'response_item',
      payload: { text: 'follow-up note for STR-999 from a parent session' }
    },
    {
      timestamp: '2026-06-27T13:01:30.000Z',
      type: 'response_item',
      payload: { text: `active branch codex/${storyId.toLowerCase()} in the story worktree` }
    },
    {
      timestamp: '2026-06-27T13:02:00.000Z',
      type: 'response_item',
      payload: { text: `review .vibepro/pr/${storyId}/pr-prepare.json` }
    }
  ];
  await writeFile(
    sessionPath,
    `${originalSession.trimEnd()}\n${attributionEvents.map((entry) => JSON.stringify(entry)).join('\n')}\n`
  );
  const expectedAttributionEventCount = originalSession.trimEnd().split('\n').length + attributionEvents.length;

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session.token_accounting.status, 'available');
  assert.equal(result.attribution.status, 'available');
  assert.equal(result.attribution.target_story_id, storyId);
  assert.deepEqual(result.attribution.detected_story_ids, ['STR-999']);
  assert.equal(result.attribution.detected_story_refs.includes(storyId), true);
  assert.equal(result.attribution.strict_over_associated > 0, true);
  assert.equal(result.attribution.categories.strict >= 3, true);
  assert.equal(result.attribution.categories.other_story > 0, true);
  assert.equal(result.attribution.events.strict_story, result.attribution.categories.strict);
  assert.equal(result.attribution.events.worktree_associated, result.attribution.categories.worktree_associated);
  assert.equal(result.attribution.events.other_story, result.attribution.categories.other_story);
  assert.equal(result.attribution.estimated_tokens.other_story > 0, true);
  assert.equal(result.attribution.mixed_parent, true);
  assert.equal(
    Object.values(result.attribution.categories).reduce((sum, count) => sum + count, 0),
    result.attribution.event_count
  );
  assert.equal(result.attribution.event_count, expectedAttributionEventCount);
  assert.equal(result.attribution.mode, 'strict_primary_with_worktree_upper_bound');
  assert.equal(result.attribution.primary.event_count, result.attribution.categories.strict);
  assert.equal(
    result.attribution.upper_bound.event_count,
    result.attribution.categories.strict + result.attribution.categories.worktree_associated
  );
  assert.equal(result.attribution.attribution_risk, 'low');
  assert.equal(result.audit_readiness.status, 'partial');
  assert.equal(result.audit_readiness.blockers.includes('mixed_parent_session_attribution'), true);
  assert.equal(result.session.token_accounting.total_tokens, 250);
  assert.equal(result.session.token_accounting.input_tokens, 200);
  assert.equal(result.session.token_accounting.cached_input_tokens, 80);
  assert.equal(result.session.token_accounting.output_tokens, 50);
  assert.equal(result.session.token_accounting.reasoning_output_tokens, 10);
  assert.equal(result.session.artifact_token_accounting.estimated_total_tokens > 0, true);
  assert.equal(result.session.artifact_token_accounting.classified_estimated_tokens > 0, true);
  assert.equal(result.session.artifact_token_accounting.buckets.audit_evidence.estimated_tokens > 0, true);
  const repeated = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });
  assert.deepEqual(repeated.attribution, result.attribution);
  const rendered = renderSessionEfficiencyAudit(result);
  assert.match(rendered, /attribution: available/);
  assert.match(rendered, /mixed_parent=true/);
  assert.match(rendered, /attribution_detected_story_ids: STR-999/);
  assert.match(rendered, /mixed_parent_session_attribution/);

  const cli = await execFileAsync(process.execPath, [
    CLI_BIN,
    'audit',
    'session-cost',
    root,
    '--story-id',
    storyId,
    '--session-id',
    sessionId,
    '--codex-home',
    codexHome,
    '--base',
    'base',
    '--json'
  ], { encoding: 'utf8' }).catch((error) => {
    assert.equal(error.code, 2);
    return { stdout: error.stdout };
  });
  const cliResult = JSON.parse(cli.stdout);
  assert.equal(cliResult.attribution.status, 'available');
  assert.equal(cliResult.attribution.mixed_parent, true);
  assert.deepEqual(cliResult.attribution.detected_story_ids, ['STR-999']);
  assert.equal(cliResult.attribution.categories.strict >= 3, true);
  assert.equal(cliResult.audit_readiness.blockers.includes('mixed_parent_session_attribution'), true);
});

test('session efficiency audit applies high risk only to strict-over-associated threshold breach', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const baselineLines = sessionLines({ sessionId, cwd: root });
  await writeFile(sessionPath, `${baselineLines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);
  const baseline = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });
  const lines = sessionLines({ sessionId, cwd: root, storyId });
  await writeFile(sessionPath, `${lines.map((entry) => JSON.stringify(entry)).join('\n')}\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.attribution.mixed_parent, false);
  assert.equal(result.attribution.risk_threshold, 0.5);
  assert.equal(result.attribution.strict_over_associated < result.attribution.risk_threshold, true);
  assert.equal(result.attribution.attribution_risk, 'high');
  const rendered = renderSessionEfficiencyAudit(result);
  assert.match(rendered, /risk=high/);
  assert.equal(result.audit_readiness.blockers.includes('mixed_parent_session_attribution'), false);
  assert.equal(result.session.token_accounting.total_tokens, 150);
  assert.equal(result.session.token_accounting.input_tokens, 100);
  assert.equal(result.session.token_accounting.cached_input_tokens, null);
  assert.equal(result.session.token_accounting.output_tokens, 50);
  assert.equal(result.session.token_accounting.reasoning_output_tokens, null);
  assert.equal(result.session.artifact_token_accounting.estimated_total_tokens, 0);
  assert.equal(result.session.artifact_token_accounting.classified_estimated_tokens, 0);
  for (const field of [
    'status',
    'total_tokens',
    'input_tokens',
    'output_tokens',
    'cached_input_tokens',
    'reasoning_output_tokens',
    'source',
    'reason'
  ]) {
    assert.deepEqual(result.session.token_accounting[field], baseline.session.token_accounting[field]);
  }
  assert.deepEqual(
    result.session.artifact_token_accounting.buckets,
    baseline.session.artifact_token_accounting.buckets
  );
  assert.equal(
    result.session.artifact_token_accounting.estimated_total_tokens,
    baseline.session.artifact_token_accounting.estimated_total_tokens
  );
  assert.equal(
    result.session.artifact_token_accounting.classified_estimated_tokens,
    baseline.session.artifact_token_accounting.classified_estimated_tokens
  );
});

test('session efficiency audit preserves valid rows and accounts malformed JSONL as unattributed', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const baseline = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });
  const original = await readFile(sessionPath, 'utf8');
  await writeFile(sessionPath, `${original}{malformed-json\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.attribution.status, 'available');
  assert.equal(result.attribution.categories.unclassified, baseline.attribution.categories.unclassified + 1);
  assert.equal(result.session.token_accounting.status, 'available');
  assert.equal(
    result.session.artifact_token_accounting.unmatched_event_count,
    baseline.session.artifact_token_accounting.unmatched_event_count + 1
  );
  assert.equal(result.audit_readiness.blockers.includes('session_attribution_unavailable'), false);
});

test('bounded session audit preserves timestamp-less malformed JSONL as unattributed unknown exposure', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  const original = await readFile(sessionPath, 'utf8');
  await writeFile(sessionPath, `${original}{malformed-json\n`);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    windowStart: '2026-06-27T13:00:00.000Z',
    windowEnd: '2026-06-27T14:00:00.000Z',
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.attribution.status, 'available');
  assert.equal(result.attribution.categories.unclassified >= 1, true);
  assert.equal(result.session.artifact_token_accounting.unmatched_event_count >= 1, true);
});

test('session efficiency audit fails attribution closed when a selected JSONL file cannot be read', async () => {
  const { root, codexHome, storyId, sessionId, sessionPath } = await createFixture();
  await chmod(sessionPath, 0o000);

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    sessionId,
    codexHome,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.attribution.status, 'unavailable');
  assert.match(result.attribution.reason, /session JSONL read failed/);
  assert.equal(result.session.token_accounting.status, 'unavailable');
  for (const bucket of Object.values(result.session.artifact_token_accounting.buckets)) {
    assert.equal(bucket.estimated_tokens, null);
    assert.equal(bucket.event_count, null);
  }
  for (const bucket of Object.values(result.session.artifact_token_accounting.provenance_buckets)) {
    assert.equal(bucket.estimated_tokens, null);
    assert.equal(bucket.event_count, null);
    assert.equal(bucket.unique_digest_count, null);
  }
  assert.equal(result.session.artifact_token_accounting.unmatched_event_count, null);
  assert.equal(result.session.artifact_token_accounting.unmatched_estimated_tokens, null);
  assert.match(result.session.token_accounting.reason, /session JSONL read failed/);
  await chmod(sessionPath, 0o600);
});

test('session efficiency audit keeps unavailable attribution explicit when inference selects no session', async () => {
  const { root, storyId } = await createFixture();
  const emptyCodexHome = await mkdtemp(path.join(os.tmpdir(), 'vibepro-empty-codex-'));

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    codexHome: emptyCodexHome,
    inferSession: true,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_id, null);
  assert.equal(result.attribution.status, 'unavailable');
  assert.equal(result.attribution.mode, 'strict_primary_with_worktree_upper_bound');
  assert.equal(result.attribution.attribution_risk, 'unknown');
  assert.match(result.attribution.note, /No selected session JSONL files/);
});

test('SAB-S-6 session efficiency audit returns unavailable attribution when session selection is omitted', async () => {
  const { root, storyId } = await createFixture();

  const result = await collectSessionEfficiencyAudit(root, {
    storyId,
    baseRef: 'base',
    now: '2026-06-27T14:00:00.000Z'
  });

  assert.equal(result.session_id, null);
  assert.equal(result.session_selection.status, 'not_requested');
  assert.equal(result.attribution.status, 'unavailable');
  assert.equal(result.attribution.attribution_risk, 'unknown');
  assert.match(result.attribution.note, /No selected session JSONL files/);
  assert.equal(result.audit_readiness.blockers.includes('session_attribution_unavailable'), true);
});

test('PR preparation session boundary is advisory and delegates mixed-session detection to session-cost', () => {
  const observed = buildSessionBoundaryAdvisory({
    storyId: 'STR-126',
    env: { CODEX_SESSION_ID: 'session-126' },
    git: { current_branch: 'codex/story-126', head_sha: 'a'.repeat(40) }
  });
  const unavailable = buildSessionBoundaryAdvisory({
    storyId: 'STR-126',
    env: {},
    git: { current_branch: 'codex/story-126', head_sha: 'a'.repeat(40) }
  });

  assert.equal(observed.status, 'observed');
  assert.equal(observed.blocking, false);
  assert.equal(observed.session_id, 'session-126');
  assert.match(observed.note, /audit session-cost/);
  assert.equal(unavailable.status, 'not_observed');
  assert.equal(unavailable.blocking, false);
  assert.match(unavailable.note, /--infer-session/);
});

test('PR preparation persists the advisory boundary without claiming mixed-parent detection', async () => {
  const { root, storyId } = await createFixture();
  const observed = await preparePullRequest(root, {
    storyId,
    baseBranch: 'base',
    env: { CODEX_SESSION_ID: 'session-126' },
    progress: false
  });
  const absent = await preparePullRequest(root, {
    storyId,
    baseBranch: 'base',
    env: {},
    progress: false
  });

  assert.equal(observed.preparation.session_boundary.status, 'observed');
  assert.equal(observed.preparation.session_boundary.blocking, false);
  assert.equal(observed.preparation.session_boundary.session_id, 'session-126');
  assert.equal('mixed_parent' in observed.preparation.session_boundary, false);
  assert.match(observed.preparation.session_boundary.note, /audit session-cost/);
  assert.deepEqual(observed.preparation.gate_status, absent.preparation.gate_status);
  assert.deepEqual(observed.preparation.next_commands, absent.preparation.next_commands);
  assert.deepEqual(observed.preparation.verdicts, absent.preparation.verdicts);
});
