import assert from 'node:assert/strict';
import test from 'node:test';

import { renderPrMergeHtml } from '../src/html-report.js';
import { renderPrMergeSummary } from '../src/merge-manager.js';
import { projectPublicPrMergeResult } from '../src/merge-public-projection.js';

function mergeFixture() {
  return {
    created_at: '2026-07-17T00:00:00.000Z',
    story: { story_id: 'story-delivery' },
    status: 'merged_externally',
    strategy: 'merge',
    base: 'main',
    dry_run: false,
    delete_branch: false,
    stop_reason: 'delivery_reconciliation_required',
    merge_commit_sha: 'abc123',
    merged_at: '2026-07-17T00:00:00.000Z',
    delivery: { status: 'merged_externally', source: 'github_pr' },
    reconciliation: { status: 'reconciliation_required', reasons: ['gate_not_ready'] },
    pr: { url: 'https://example.test/pr/1', checks: [] },
    preconditions: {
      gate_ready: false,
      clean_worktree: true,
      base_freshness: { status: 'blocked' },
      remote_head_match: { status: 'passed' },
      checks_ready: { status: 'passed' },
      review_policy: { status: 'passed' },
      open_pull_request: { status: 'blocked' }
    },
    artifact_freshness: null,
    commands: [],
    results: [],
    warnings: []
  };
}

test('human merge summary exposes immutable delivery and mutable reconciliation', () => {
  const summary = renderPrMergeSummary(mergeFixture());
  assert.match(summary, /delivery: merged_externally/);
  assert.match(summary, /reconciliation: reconciliation_required/);
  assert.match(summary, /reconciliation_reasons: gate_not_ready/);
  assert.match(summary, /vibepro pr prepare .*story-delivery/);
  assert.match(summary, /vibepro execute merge .*story-delivery/);
});

test('HTML merge report exposes both delivery axes', () => {
  const html = renderPrMergeHtml(mergeFixture());
  assert.match(html, />Delivery</);
  assert.match(html, /merged_externally/);
  assert.match(html, />Reconciliation</);
  assert.match(html, /reconciliation_required/);
  assert.match(html, /gate_not_ready/);
  assert.match(html, /Required Follow-up/);
  assert.match(html, /vibepro pr prepare .*story-delivery/);
  assert.match(html, /vibepro execute merge .*--pr https:\/\/example\.test\/pr\/1/);
});

test('recovery projections retain a selector when no resolved PR URL is available', () => {
  const fixture = mergeFixture();
  fixture.pr = { selector: 'https://example.test/pr/selector-only', checks: [] };
  fixture.delivery.pr_url = 'https://example.test/pr/delivery-fallback';
  assert.match(renderPrMergeSummary(fixture), /--pr https:\/\/example\.test\/pr\/selector-only/);
  assert.match(renderPrMergeHtml(fixture), /--pr https:\/\/example\.test\/pr\/selector-only/);

  delete fixture.pr.selector;
  assert.match(renderPrMergeSummary(fixture), /--pr https:\/\/example\.test\/pr\/delivery-fallback/);
  assert.match(renderPrMergeHtml(fixture), /--pr https:\/\/example\.test\/pr\/delivery-fallback/);
});

test('delivered canonical persistence failure remains actionable in human and HTML projections', () => {
  const failed = {
    ...mergeFixture(),
    status: 'failed',
    stop_reason: 'canonical_audit_persistence_failed',
    delivery: { status: 'merged', source: 'github_pr' },
    reconciliation: { status: 'reconciled', reasons: [] }
  };
  const summary = renderPrMergeSummary(failed);
  const html = renderPrMergeHtml(failed);
  assert.match(summary, /canonical_audit_persistence_failed/);
  assert.match(summary, /vibepro execute merge .*--base main --pr https:\/\/example\.test\/pr\/1/);
  assert.match(html, /Required Follow-up/);
  assert.match(html, /vibepro execute merge .*--base main --pr https:\/\/example\.test\/pr\/1/);
});

test('execution-state sync failure exposes one authoritative recovery action across text and HTML', () => {
  const fixture = mergeFixture();
  const recoveryCommand = 'vibepro execute reconcile . --story-id story-delivery --base main --pr https://example.test/pr/1';
  fixture.stop_reason = 'execution_state_sync_failed';
  fixture.reconciliation.reasons = ['execution_state_sync_failed'];
  fixture.execution_state_sync = {
    status: 'failed',
    reason: 'state write failed',
    recovery_command: recoveryCommand
  };
  fixture.reconciliation_action = {
    status: 'required',
    reason: 'execution_state_sync_failed',
    commands: [
      'vibepro pr prepare . --story-id story-delivery --base main',
      'vibepro execute merge . --story-id story-delivery --base main --pr https://example.test/pr/1'
    ]
  };

  const summary = renderPrMergeSummary(fixture);
  const html = renderPrMergeHtml(fixture);
  assert.match(summary, /reconciliation_action_1: vibepro execute reconcile/);
  assert.doesNotMatch(summary, /vibepro pr prepare/);
  assert.doesNotMatch(summary, /vibepro execute merge/);
  assert.match(html, /vibepro execute reconcile/);
  assert.doesNotMatch(html, /vibepro pr prepare/);
  assert.doesNotMatch(html, /vibepro execute merge/);
});

test('human and HTML projections distinguish persistence conflict and incomplete rollback', () => {
  const fixture = mergeFixture();
  fixture.execution_state_sync = {
    status: 'failed',
    reason: 'execution-state write failed',
    followup_persistence: 'failed',
    persistence_error_details: {
      code: 'merge_followup_transaction_restore_failed',
      cause: 'follow-up persistence failed',
      restore_errors: [{
        artifact_path: '/tmp/pr-merge.json',
        message: 'merge follow-up changed concurrently; newer operator guidance preserved'
      }]
    }
  };

  const summary = renderPrMergeSummary(fixture);
  const html = renderPrMergeHtml(fixture);
  for (const projection of [summary, html]) {
    assert.match(projection, /merge_followup_transaction_restore_failed/);
    assert.match(projection, /rollback[\s\S]{0,120}incomplete/i);
    assert.doesNotMatch(projection, /follow-up persistence failed/);
    assert.doesNotMatch(projection, /changed concurrently/);
    assert.doesNotMatch(projection, /newer operator guidance preserved/);
    assert.doesNotMatch(projection, /\/tmp\/pr-merge\.json/);
  }
});

test('public JSON, text, and HTML replace raw merge warnings with one bounded warning', () => {
  const fixture = mergeFixture();
  fixture.warnings = [
    'Provider JSON response could not be parsed for gh pr view --json secret: Unexpected token',
    'Post-merge base fetch failed: git fetch https://token@example.test/repo.git'
  ];

  const summary = renderPrMergeSummary(fixture);
  const html = renderPrMergeHtml(fixture);
  for (const projection of [summary, html]) {
    assert.match(projection, /Merge processing produced a warning/);
    assert.doesNotMatch(projection, /gh pr view/);
    assert.doesNotMatch(projection, /Unexpected token/);
    assert.doesNotMatch(projection, /token@example/);
    assert.doesNotMatch(projection, /git fetch/);
  }
});

test('public JSON, text, and HTML strip URL credentials and bound reconciliation reasons', () => {
  const fixture = mergeFixture();
  fixture.pr.url = 'https://operator:secret@example.test/pr/1';
  fixture.delivery.pr_url = 'https://delivery:secret@example.test/pr/1';
  fixture.pr_url = 'https://top:secret@example.test/pr/1';
  fixture.reconciliation.reasons = [
    'gate_not_ready',
    'provider_token',
    'internal:secret',
    'raw parser error: secret output'
  ];

  const summary = renderPrMergeSummary(fixture);
  const html = renderPrMergeHtml(fixture);
  for (const projection of [summary, html]) {
    assert.match(projection, /https:\/\/example\.test\/pr\/1/);
    assert.match(projection, /gate_not_ready/);
    assert.match(projection, /merge_reconciliation_required/);
    assert.doesNotMatch(projection, /operator:secret|delivery:secret|top:secret|provider_token|internal:secret|raw parser error/);
  }
});

test('public projection allows only bounded recovery commands and execution-state fields', () => {
  const fixture = mergeFixture();
  fixture.execution_state_sync = {
    status: 'failed',
    reason: 'state write leaked a provider token',
    recovery_command: 'vibepro execute reconcile . --story-id story-delivery --pr https://operator:secret@example.test/pr/1',
    message: 'provider_token=secret',
    details: { stderr: 'secret' }
  };
  fixture.reconciliation_action = {
    status: 'required',
    reason: 'provider_token=secret',
    message: 'raw provider response',
    details: { stderr: 'secret' },
    commands: [
      'vibepro pr prepare . --story-id story-delivery',
      'vibepro execute merge . --story-id story-delivery --pr https://operator:secret@example.test/pr/1',
      'git push https://operator:secret@example.test/repo.git',
      'vibepro execute reconcile . --story-id story-delivery; curl https://example.test/leak',
      'vibepro execute merge . --story-id story-delivery && git push origin main',
      'vibepro pr prepare . --story-id "$(cat /tmp/secret)"'
    ]
  };

  const projected = projectPublicPrMergeResult(fixture);
  assert.deepEqual(projected.reconciliation_action.commands, [
    'vibepro pr prepare . --story-id story-delivery',
    'vibepro execute merge . --story-id story-delivery --pr https://example.test/pr/1'
  ]);
  assert.equal(projected.reconciliation_action.reason, 'merge_reconciliation_required');
  assert.equal(Object.hasOwn(projected.reconciliation_action, 'message'), false);
  assert.equal(Object.hasOwn(projected.reconciliation_action, 'details'), false);
  assert.equal(
    projected.execution_state_sync.recovery_command,
    'vibepro execute reconcile . --story-id story-delivery --pr https://example.test/pr/1'
  );
  assert.equal(projected.execution_state_sync.reason, 'Execution-state synchronization failed after merge processing.');
  assert.equal(Object.hasOwn(projected.execution_state_sync, 'message'), false);
  assert.equal(Object.hasOwn(projected.execution_state_sync, 'details'), false);
  assert.doesNotMatch(JSON.stringify(projected), /operator|secret|git push|provider_token|curl|cat/);
});

test('public projection does not unwrap a domain merge field from a merge result', () => {
  const fixture = mergeFixture();
  fixture.merge = { internal: 'nested domain state' };
  const projected = projectPublicPrMergeResult(fixture);
  assert.equal(projected.status, 'merged_externally');
  assert.deepEqual(projected.merge, { internal: 'nested domain state' });
});
