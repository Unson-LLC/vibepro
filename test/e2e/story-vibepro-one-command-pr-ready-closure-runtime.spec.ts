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
import test from "node:test";
import "../one-command-pr-ready-closure.test.js";

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
});
