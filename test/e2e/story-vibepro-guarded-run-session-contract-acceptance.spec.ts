import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const CONTRACT_TEST = 'test/guarded-run-session.test.js';
const PROCESS_REPLAY_TEST = 'test/e2e/story-vibepro-guarded-run-session-contract-main.test.js';

test('story-vibepro-guarded-run-session-contract acceptance and scenario replay', async () => {
  const { NODE_TEST_CONTEXT: _nodeTestContext, ...childEnv } = process.env;
  const result = await execFileAsync(process.execPath, ['--test', CONTRACT_TEST, PROCESS_REPLAY_TEST], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: childEnv,
    maxBuffer: 4 * 1024 * 1024
  });

  assert.match(result.stdout, /# pass [1-9]\d*\b/, 'focused contract and process-replay suites must pass before acceptance bindings are evaluated');
  assert.match(result.stdout, /# fail 0\b/, 'focused contract and process-replay suites must have no failures');

  const ac1 = 'AC-1 execute run creates a Run with run_id, story_id, target, and autonomy_mode; disabled managed-worktree mode uses the source repository as repository authority';
  assert.match(result.stdout, /repository Run persists guarded defaults and repeated cancel is byte-stable/, ac1);

  const ac2 = 'AC-2 state persists status, stop_reason, attempt, iteration, budget, deadline, last_progress_at, current_head_sha, and pending_decision; malformed nullable fields and missing typed recovery reasons fail without mutation';
  assert.match(result.stdout, /nullable state unions reject canonical and predecessor values without mutation/, ac2);
  assert.match(result.stdout, /recoverable transitions require a fresh typed stop reason without mutation/, ac2);

  const ac3 = 'AC-3 status and resume restore the same Run after restart, including a fingerprint-matched preferred-bootstrap source fallback without requiring extra legacy fields';
  assert.match(result.stdout, /preferred source-fallback Run resumes from its canonical artifact in fresh CLI processes/, ac3);

  const ac4 = 'AC-4 watch displays transitions, cancel records terminal state without new side effects, repeated canonical cancel is byte-stable, and the lifecycle is a closed state machine';
  assert.match(result.stdout, /lifecycle matrix accepts only the closed transition set/, ac4);
  assert.match(result.stdout, /guarded Run survives fresh CLI processes and replays its canonical artifact/, ac4);

  const ac5 = 'AC-5 unknown transitions, stale HEAD, and resume from another worktree are rejected with a typed stop reason';
  assert.match(result.stdout, /resume fails closed on a stale authoritative HEAD without mutating the Run/, ac5);
  assert.match(result.stdout, /resume from another worktree fails closed without mutating either artifact/, ac5);
  assert.match(result.stdout, /unknown persisted status and transition target fail closed without mutation/, ac5);

  const ac6 = 'AC-6 existing execute start, status, next, and reconcile behavior and legacy state artifacts remain compatible';
  assert.match(result.stdout, /CLI success JSON equals persisted Run and legacy status without run-id stays on the legacy route/, ac6);
  assert.match(result.stdout, /execute help advertises guarded commands without removing legacy commands/, ac6);

  const ac7 = 'AC-7 automated tests cover schema migration, restart and resume, cancel, stale HEAD, and legacy compatibility';
  assert.match(result.stdout, /migration changes schema only, corrupt state is quarantined, and future schema is preserved/, ac7);
  assert.match(result.stdout, /guarded Run survives fresh CLI processes and replays its canonical artifact/, ac7);

  const ac8 = 'AC-8 authority, control roots, execution context, implicit selection ordering, unavailable managed binding behavior, and human and JSON error contracts are unique and fail closed';
  assert.match(result.stdout, /implicit Run selection fails closed when any candidate is rejected/, ac8);
  assert.match(result.stdout, /source and managed callers use the same Story creation lock/, ac8);
  assert.match(result.stdout, /human errors expose linked-copy recovery handles and exact repair command/, ac8);

  const ac9 = 'AC-9 path traversal, corrupt JSON, unknown future schema, authority escalation, and Gate bypass fail closed';
  assert.match(result.stdout, /strict ids fail before path composition and CLI emits typed exit-2 JSON/, ac9);
  assert.match(result.stdout, /migration changes schema only, corrupt state is quarantined, and future schema is preserved/, ac9);
  assert.match(result.stdout, /Gate readiness is the only positive pr_ready transition/, ac9);

  const ac10 = 'AC-10 mirror failure returns the committed run_id for repair, retries preserve exactly-once transitions, creation locks share the Git common directory per repository, and partial legacy bootstrap never becomes fallback authority';
  assert.match(result.stdout, /existing mutation commits once across mirror failure and explicit repair/, ac10);
  assert.match(result.stdout, /concurrent linked worktrees share the bootstrap lock before legacy authority exists/, ac10);
  assert.match(result.stdout, /separate Git directories keep bootstrap locks repository-scoped/, ac10);
  assert.match(result.stdout, /partial legacy bootstrap stops Run creation, releases the lock, and makes the next attempt fail closed/, ac10);

  const scenario1 = 'S-001 persisted recoverable Run resumes from an allowed canonical control root with matching authority, Git directory, HEAD, and source-fallback fingerprint';
  assert.match(result.stdout, /source fallback survives restart paths and rejects repair without mutation, but pre-existing unavailable fails closed/, scenario1);

  const scenario2 = 'S-002 linked-copy failure advances existing authority once, returns the created run_id when creation mirror sync fails, and explicit repair restores only the selected mirror';
  assert.match(result.stdout, /existing mutation commits once across mirror failure and explicit repair/, scenario2);

  const scenario4 = 'S-004 watch returns authoritative ordered transitions and repeated cancellation is byte-for-byte unchanged after recognized migration';
  assert.match(result.stdout, /repository Run persists guarded defaults and repeated cancel is byte-stable/, scenario4);

  const scenario5 = 'S-005 recognized predecessor migration changes only schema_version, validates source-fallback authority, and synchronizes managed authority before mirror';
  assert.match(result.stdout, /migration changes schema only, corrupt state is quarantined, and future schema is preserved/, scenario5);
  assert.match(result.stdout, /managed predecessor migration commits authority once and requires explicit mirror repair/, scenario5);

  const scenario6 = 'S-006 corrupt Run JSON is quarantined beside the original artifact and no replacement state is written';
  assert.match(result.stdout, /migration changes schema only, corrupt state is quarantined, and future schema is preserved/, scenario6);

  const scenario7 = 'S-007 an unknown future schema returns unsupported_schema and preserves the artifact byte-for-byte';
  assert.match(result.stdout, /migration changes schema only, corrupt state is quarantined, and future schema is preserved/, scenario7);

  const scenario8 = 'S-008 competing or orphan creation locks fail without mutation, partial legacy bootstrap stops Run creation, and the owned lock is released in finally';
  assert.match(result.stdout, /existing creation lock fails closed without bootstrapping and preserves the lock/, scenario8);
  assert.match(result.stdout, /partial legacy bootstrap stops Run creation, releases the lock, and makes the next attempt fail closed/, scenario8);

  const scenario9 = 'S-009 disabled managed-worktree mode creates a repository-authoritative Run that survives restart and rejects linked-copy repair without mutation';
  assert.match(result.stdout, /repository CLI survives fresh processes and repair is non-mutating/, scenario9);
  assert.match(result.stdout, /guarded Run survives fresh CLI processes and replays its canonical artifact/, scenario9);
});
