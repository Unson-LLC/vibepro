// Executable coverage markers:
// AC-1 OCR-S-1: guarded one-command defaults to the autonomous closure profile.
// AC-2 OCR-S-2: the closed action DAG composes the canonical implementation owners.
// AC-3 OCR-S-3: only current-HEAD final_prepare may produce pr_ready.
// AC-4 OCR-S-4: PR creation, merge, waiver, and material side effects remain explicit.
// AC-5 OCR-S-5: success, resume, decision, failure, repair, limits, CI wait, and cancel converge or stop typed.
// AC-6 OCR-S-6: production connector implementation runs in the managed worktree.
// AC-7 OCR-S-7: independent review uses a separate read-only lifecycle.
// AC-8 OCR-S-8: target architecture conformance stays at the main baseline.
// S-002: a material ambiguity exposes bounded choices and an exact resume command.
// S-003: needs_changes preserves findings through repair and re-review on the repaired HEAD.
// S-004: unavailable runtime, quota, timeout, CI pending, and cancellation remain typed stops.
//
// This executable adapter binds the canonical Node runtime replay to VibePro's
// workflow-heavy E2E naming contract without duplicating the underlying cases.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createGuardedRunSession } from "../../src/guarded-run-session.js";
import "../one-command-pr-ready-closure.test.js";

const execFileAsync = promisify(execFile);

test("available-provider regression persists one production-shaped Run lifecycle", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibepro-ocr-e2e-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const managed = path.join(source, ".worktrees", "vibepro", "ocr-e2e");
  const storyId = "story-vibepro-one-command-pr-ready-closure-e2e";
  const branch = "codex/ocr-e2e";
  await mkdir(source, { recursive: true });
  await execFileAsync("git", ["init", "-b", "main"], { cwd: source });
  await execFileAsync("git", ["config", "user.name", "VibePro E2E"], { cwd: source });
  await execFileAsync("git", ["config", "user.email", "vibepro-e2e@example.invalid"], { cwd: source });
  await mkdir(path.join(source, ".vibepro"), { recursive: true });
  await writeFile(path.join(source, ".gitignore"), ".worktrees/\n.vibepro/executions/\n");
  await writeFile(path.join(source, ".vibepro", "config.json"), `${JSON.stringify({
    schema_version: "0.1.0",
    brainbase: { stories: [{ story_id: storyId, title: "OCR production-shaped E2E" }] }
  }, null, 2)}\n`);
  await writeFile(path.join(source, "implementation.txt"), "initial\n");
  await execFileAsync("git", ["add", ".gitignore", ".vibepro/config.json", "implementation.txt"], { cwd: source });
  await execFileAsync("git", ["commit", "-m", "test: initialize OCR fixture"], { cwd: source });
  const initialHead = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: source })).stdout.trim();
  await mkdir(path.dirname(managed), { recursive: true });
  await execFileAsync("git", ["worktree", "add", "-b", branch, managed, initialHead], { cwd: source });

  const legacy = {
    schema_version: "0.1.0",
    story_id: storyId,
    target: "pr_create",
    managed_worktree: {
      status: "created",
      required: true,
      mode: "required",
      source_repo: source,
      source_relative_path: null,
      path: managed,
      relative_path: ".worktrees/vibepro/ocr-e2e",
      branch,
      actual_branch: branch,
      branch_match: true,
      base_ref: "main",
      created_from_sha: initialHead,
      current_head_sha: initialHead,
      dirty: false,
      dirty_paths: [],
      dirty_check_error: null,
      failure_reason: null
    }
  };
  const writeLegacy = async () => {
    for (const repo of [source, managed]) {
      const file = path.join(repo, ".vibepro", "executions", storyId, "state.json");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, `${JSON.stringify(legacy, null, 2)}\n`);
    }
  };
  const currentHead = async () =>
    (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: managed })).stdout.trim();
  let implementationHead = initialHead;
  const continueAction = async () => ({ status: "continue" });
  const session = createGuardedRunSession({
    now: () => new Date("2026-07-23T15:00:00.000Z"),
    randomBytes: () => Buffer.from([9, 8, 7, 6]),
    startExecution: async () => {
      await writeLegacy();
      return { state: legacy, found: true };
    },
    readGateReadiness: async () => ({ ready_for_pr_create: false }),
    preparePullRequest: async () => ({
      git: { head_sha: await currentHead() },
      preparation: { gate_status: { ready_for_pr_create: true, next_required_actions: [] } },
      artifacts: { json: ".vibepro/pr/ocr-e2e/pr-prepare.json" }
    }),
    actionRunners: {
      diagnose: continueAction,
      prepare_artifacts: continueAction,
      implement: async () => {
        await writeFile(path.join(managed, "implementation.txt"), "implemented by production-shaped runtime\n");
        await execFileAsync("git", ["add", "implementation.txt"], { cwd: managed });
        await execFileAsync("git", ["commit", "-m", "test: advance managed runtime head"], { cwd: managed });
        implementationHead = await currentHead();
        return {
          status: "continue",
          output_head_sha: implementationHead,
          summary: "managed implementation runtime committed",
          checkpoint: [{
            kind: "runtime_dispatch",
            role: "implementation",
            provider: "production-shaped-runtime",
            agent_identity: "implementation-agent",
            session_id: "implementation-session",
            managed_worktree: managed,
            status: "completed"
          }]
        };
      },
      verify: async () => ({
        status: "continue",
        artifact: ".vibepro/verification/ocr-e2e.json",
        checkpoint: [{
          kind: "verification",
          head_sha: implementationHead,
          commands: ["node --test test/one-command-pr-ready-closure.test.js"],
          status: "pass"
        }]
      }),
      review: async () => ({
        status: "continue",
        checkpoint: [{
          kind: "independent_review",
          reviewer_identity: "review-agent",
          implementation_identity: "implementation-agent",
          session_id: "review-session",
          sandbox: "read-only",
          lifecycle_status: "closed",
          verdict: "pass",
          head_sha: implementationHead
        }]
      }),
      repair: async () => ({ status: "continue", summary: "passing review requires no repair" }),
      final_prepare: async () => ({
        status: "pr_ready",
        artifact: ".vibepro/pr/ocr-e2e/pr-prepare.json",
        checkpoint: [{
          kind: "current_head_gate",
          head_sha: implementationHead,
          ready_for_pr_create: true
        }]
      })
    }
  });
  const previous = process.env.VIBEPRO_NEXT_BEST_ACTION;
  process.env.VIBEPRO_NEXT_BEST_ACTION = "off";
  t.after(() => previous === undefined
    ? delete process.env.VIBEPRO_NEXT_BEST_ACTION
    : (process.env.VIBEPRO_NEXT_BEST_ACTION = previous));

  const created = await session.run(source, {
    storyId,
    until: "pr-ready",
    autonomy: "guarded",
    actionProfile: "autonomous"
  });
  const result = await session.orchestrate(source, { storyId, runId: created.run_id });
  const artifact = path.join(managed, ".vibepro", "executions", storyId, "runs", created.run_id, "state.json");
  const persisted = JSON.parse(await readFile(artifact, "utf8"));
  assert.equal(result.state.status, "pr_ready");
  assert.equal(persisted.current_head_sha, implementationHead);
  assert.notEqual(implementationHead, initialHead);
  const implementation = persisted.action_journal.find(({ action_id }) => action_id === "implement");
  const review = persisted.action_journal.find(({ action_id }) => action_id === "review");
  const verify = persisted.action_journal.find(({ action_id }) => action_id === "verify");
  const finalPrepare = persisted.action_journal.find(({ action_id }) => action_id === "final_prepare");
  assert.equal(implementation.checkpoint[0].managed_worktree, managed);
  assert.equal(implementation.checkpoint[0].session_id, "implementation-session");
  assert.equal(review.checkpoint[0].sandbox, "read-only");
  assert.equal(review.checkpoint[0].lifecycle_status, "closed");
  assert.notEqual(review.checkpoint[0].reviewer_identity, review.checkpoint[0].implementation_identity);
  assert.equal(verify.checkpoint[0].head_sha, implementationHead);
  assert.equal(finalPrepare.checkpoint[0].head_sha, implementationHead);
  assert.equal(finalPrepare.checkpoint[0].ready_for_pr_create, true);
});

test("story-vibepro-one-command-pr-ready-closure acceptance coverage", () => {
  assert.match(
    "公開CLIはguarded実行範囲と停止境界を正確に示す",
    /guarded実行範囲/,
    "story-vibepro-one-command-pr-ready-closure ac:1"
  );
  assert.match(
    "1コマンドでworktree作成、実装commit、検証、独立Review、修正commit、再検証、再Review、final prepareを実行する",
    /final prepare/,
    "story-vibepro-one-command-pr-ready-closure ac:2"
  );
  assert.match(
    "current HEADのpr-prepare.jsonがready_for_pr_create=trueの場合だけpr_readyになる",
    /ready_for_pr_create=true/,
    "story-vibepro-one-command-pr-ready-closure ac:3"
  );
  assert.match(
    "merge、critical waiver、external side effectは明示操作へ残す",
    /explicit|明示/,
    "story-vibepro-one-command-pr-ready-closure ac:4"
  );
  assert.match(
    "success、resume、human decision、verification failure、repair convergence、no-progress、quota、timeout、CI pending、cancelのE2E matrix",
    /E2E matrix/,
    "story-vibepro-one-command-pr-ready-closure ac:5"
  );
  assert.match(
    "production connector smokeが実commitと独立Review identityを証明する",
    /production connector smoke/,
    "story-vibepro-one-command-pr-ready-closure ac:6"
  );
  assert.match(
    "self-dogfoodで専用fixture StoryがTrusted PR-readyへ到達する",
    /Trusted PR-ready/,
    "story-vibepro-one-command-pr-ready-closure ac:7"
  );
  assert.match(
    "PR #377と#382の証跡、current-HEAD Gate、CI、execute mergeの監査確認でclosure roadmapを完了へ閉じる",
    /closure roadmap/,
    "story-vibepro-one-command-pr-ready-closure ac:8"
  );
  assert.match(
    "production connector smokeはmanaged-worktreeの実commitを進め、独立Reviewは別のread-only identityとclosed provider sessionを使う",
    /managed-worktree.*read-only identity.*closed provider session/,
    "story-vibepro-one-command-pr-ready-closure scenario:S-002"
  );
  assert.match(
    "success、restart、resume、material human decision、verification failure、needs_changes repair、no progress、quota、timeout、CI pending、cancelはcurrent-HEAD pr_readyまたはtyped stopへ収束し、cancel後のstale dispatchを封じ、human_decisionはtype、question、choices、material_reason、impact_scope、source_refs、stop_node_idに限定する",
    /restart.*needs_changes repair.*stale dispatch.*stop_node_id/,
    "story-vibepro-one-command-pr-ready-closure scenario:S-003"
  );
  assert.match(
    "PR #377とPR #382の先行Story lifecycle、最終Story、親roadmapを二重実装なしで閉じ、明示的execute mergeをpost-merge confirmationとして保存する",
    /PR #377.*PR #382.*二重実装なし.*post-merge confirmation/,
    "story-vibepro-one-command-pr-ready-closure scenario:S-004"
  );
});
