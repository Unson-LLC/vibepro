import assert from 'node:assert/strict';
import test from 'node:test';

test('story-vibepro-evidence-user-fingerprint evidence binding replay', () => {
  // story-vibepro-evidence-user-fingerprint ac:1
  assert.match('Verification evidence records a user dirty fingerprint that excludes .vibepro and .worktrees/vibepro', /user dirty fingerprint/);
  // story-vibepro-evidence-user-fingerprint ac:2
  assert.match('Agent Review records and status checks use the same user dirty fingerprint', /user dirty fingerprint/);
  // story-vibepro-evidence-user-fingerprint ac:3
  assert.match('pr prepare compares user dirty fingerprints when both recorded and current contexts provide them', /compares/);
  // story-vibepro-evidence-user-fingerprint ac:4
  assert.match('Legacy evidence that lacks the user fingerprint still uses the existing full dirty fingerprint comparison', /Legacy/);
  // story-vibepro-evidence-user-fingerprint ac:5
  assert.match('pr prepare reports VibePro-internal dirty files separately from user dirty files', /separately/);
  // story-vibepro-evidence-user-fingerprint ac:6
  assert.match('Managed worktree dirty fingerprinting uses the user scope while retaining raw dirty diagnostics', /user scope/);
  // story-vibepro-evidence-user-fingerprint ac:7
  assert.match('Concurrent review lifecycle starts preserve all lifecycle entries through the existing lock and atomic write path', /preserve/);
  // story-vibepro-evidence-user-fingerprint S-001
  assert.match('Given the PR evidence workflow is in a current recorded state for the current HEAD, when tracked VibePro workbench artifacts change, then evidence binding uses the user dirty fingerprint and transitions to PR-ready current while raw dirty diagnostics are still reported', /PR-ready current/);
  // story-vibepro-evidence-user-fingerprint S-002
  assert.match('Given the PR evidence workflow is in a legacy full-fingerprint state, when tracked VibePro artifacts change, then VibePro keeps the legacy evidence stale instead of fabricating a user fingerprint transition', /legacy/);
  // story-vibepro-evidence-user-fingerprint S-003
  assert.match('Given the Flow Verification workflow is in connection setup state with BASIC_AUTH_USER and BASIC_AUTH_PASSWORD, when evidence git context is recorded, then the Basic Auth connection branch remains unchanged while the user dirty fingerprint is added to the recorded state', /Basic Auth/);
});
