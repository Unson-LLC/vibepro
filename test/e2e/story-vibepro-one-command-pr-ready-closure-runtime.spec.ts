// Executable coverage markers:
// AC-1 OCR-S-1: guarded one-command defaults to the autonomous closure profile.
// AC-2 OCR-S-2: the closed action DAG composes the canonical implementation owners.
// AC-3 OCR-S-3: only current-HEAD final_prepare may produce pr_ready.
// AC-4 OCR-S-4: PR creation, merge, waiver, and material side effects remain explicit.
// AC-5 OCR-S-5: success, resume, decision, failure, repair, limits, CI wait, and cancel converge or stop typed.
// AC-6 OCR-S-6: production connector implementation runs in the managed worktree.
// AC-7 OCR-S-7: independent review uses a separate read-only lifecycle.
// AC-8 OCR-S-8: target architecture conformance stays at the main baseline.
// S-001: the production-shaped path commits in a managed worktree and reviews from a distinct read-only session.
// S-003: needs_changes preserves findings through repair and re-review on the repaired HEAD.
// S-005: roadmap closure reconciles merged predecessor evidence while keeping merge and waiver explicit.
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
import { createAgentRuntimeCoordinator } from "../../src/agent-runtime-adapter.js";
import { runCli } from "../../src/cli.js";
import { createOneCommandPrReadyActionOwners } from "../../src/one-command-pr-ready-closure.js";
import { buildSafeActionPlan } from "../../src/safe-action-orchestrator.js";

const execFileAsync = promisify(execFile);

test("scenario:S-001 public guarded Run composes production owners for available-provider commit, review, repair, and final prepare", async (t) => {
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
  let repairedHead = initialHead;
  let reviewCalls = 0;
  let runtimeSequence = 0;
  let lifecycleSequence = 0;
  const runtimeRequests = new Map();
  const reviewLifecycleEvents = [];
  const coordinator = createAgentRuntimeCoordinator({
    adapters: [{
      id: "codex",
      async probe({ role }) {
        return role === "review"
          ? { available: true, capabilities: ["review"], sandbox: "read-only", approval_policy: "managed" }
          : { available: true, capabilities: ["workspace_write"], sandbox: "workspace-write", approval_policy: "managed" };
      },
      async start(request) {
        runtimeSequence += 1;
        const providerRunId = `ocr-provider-${runtimeSequence}`;
        runtimeRequests.set(providerRunId, request);
        const reviewOrdinal = reviewCalls + 1;
        return request.role === "review"
          ? {
              provider_run_id: providerRunId,
              agent_identity: request.reviewer_identity,
              session_id: `review-session-${reviewOrdinal}`,
              thread_id: `review-thread-${reviewOrdinal}`
            }
          : {
              provider_run_id: providerRunId,
              agent_identity: "implementation-agent",
              session_id: `implementation-session-${runtimeSequence}`,
              thread_id: `implementation-thread-${runtimeSequence}`
            };
      },
      async status() {
        return { status: "completed" };
      },
      async cancel() {
        return { status: "cancelled" };
      },
      async collect_result({ provider_run_id, dispatch }) {
        const request = runtimeRequests.get(provider_run_id);
        assert.ok(request, `missing deterministic request for ${provider_run_id}`);
        if (request.role === "implementation") {
          const repair = request.task_id.endsWith(":repair-1");
          await writeFile(
            path.join(managed, "implementation.txt"),
            repair
              ? "repaired by production-shaped runtime\n"
              : "implemented by production-shaped runtime\n"
          );
          await execFileAsync("git", ["add", "implementation.txt"], { cwd: managed });
          await execFileAsync(
            "git",
            ["commit", "-m", repair
              ? "fix: repair independent review finding"
              : "test: advance managed runtime head"],
            { cwd: managed }
          );
          const head = await currentHead();
          if (repair) repairedHead = head;
          else implementationHead = head;
          return {
            completion_status: "completed",
            changed_files: ["implementation.txt"],
            head_sha: head,
            test_suggestions: ["node --test test/one-command-pr-ready-closure.test.js"],
            summary: repair
              ? "managed repair runtime committed"
              : "managed implementation runtime committed"
          };
        }
        reviewCalls += 1;
        const status = reviewCalls === 1 ? "needs_changes" : "pass";
        const findings = status === "needs_changes"
          ? [{ id: "e2e-repair", severity: "medium", detail: "repair fixture" }]
          : [];
        return {
          completion_status: "completed",
          changed_files: [],
          head_sha: await currentHead(),
          test_suggestions: [],
          summary: status === "needs_changes"
            ? "independent review requested fixture repair"
            : "independent re-review passed",
          status,
          inspection_summary: "inspected the managed-worktree implementation commit read-only",
          inspection_evidence: "implementation.txt and current git HEAD",
          inspection_inputs: ["implementation.txt"],
          judgment_delta: [status === "needs_changes"
            ? "implementation commit -> repair required"
            : "repaired commit -> pass"],
          findings,
          agent_identity: dispatch.agent_identity,
          session_id: dispatch.session_id,
          thread_id: dispatch.thread_id,
          lifecycle: "closed"
        };
      }
    }]
  });
  const guardedRunDependencies = {
    now: () => new Date("2026-07-23T15:00:00.000Z"),
    randomBytes: () => Buffer.from([9, 8, 7, 6]),
    startExecution: async () => {
      await writeLegacy();
      return { state: legacy, found: true };
    },
    agentRuntimeCoordinator: coordinator,
    readGateReadiness: async () => ({
      ready_for_pr_create: false,
      missing_artifacts: []
    }),
    preparePullRequest: async () => ({
      git: { head_sha: await currentHead() },
      preparation: {
        gate_status: { ready_for_pr_create: true, next_required_actions: [] },
        pr_context: {
          agent_reviews: {
            parallel_dispatch: {
              required_stages: [{ stage: "implementation", roles: ["runtime_contract"] }]
            }
          }
        }
      },
      artifacts: { json: ".vibepro/pr/ocr-e2e/pr-prepare.json" }
    }),
    agentReviewOps: {
      prepare: async (_root, value) => {
        reviewLifecycleEvents.push(["prepare", value.stage, value.roles]);
        return { status: "prepared" };
      },
      authorize: async (_root, value) => {
        reviewLifecycleEvents.push(["authorize", value.stage, value.role]);
        return {
          action: "dispatch",
          authorization: {
            action: "dispatch",
            authorization_id: `ocr-authorization-${lifecycleSequence + 1}`
          }
        };
      },
      start: async (_root, value) => {
        lifecycleSequence += 1;
        reviewLifecycleEvents.push(["start", value.stage, value.role]);
        return {
          lifecycle: {
            lifecycle_id: `ocr-lifecycle-${lifecycleSequence}`,
            timeout_ms: 1000
          }
        };
      },
      close: async (_root, value) => {
        reviewLifecycleEvents.push(["close", value.stage, value.role]);
        return { lifecycle: { lifecycle_id: value.lifecycleId, status: "closed" } };
      },
      record: async (_root, value) => {
        reviewLifecycleEvents.push(["record", value.stage, value.role, value.status]);
        return { status: value.status };
      }
    }
  };
  const previous = process.env.VIBEPRO_NEXT_BEST_ACTION;
  process.env.VIBEPRO_NEXT_BEST_ACTION = "off";
  t.after(() => previous === undefined
    ? delete process.env.VIBEPRO_NEXT_BEST_ACTION
    : (process.env.VIBEPRO_NEXT_BEST_ACTION = previous));

  let cliOutput = "";
  const invocation = await runCli([
    "execute", "run", source,
    "--story-id", storyId,
    "--until", "pr-ready",
    "--autonomy", "guarded",
    "--provider-fallbacks", "codex",
    "--json"
  ], {
    guardedRunDependencies,
    stdout: { write: (chunk) => { cliOutput += chunk; } },
    stderr: { write: (chunk) => { cliOutput += chunk; } }
  });
  assert.equal(invocation.exitCode, 0, cliOutput);
  const result = invocation.result;
  const artifact = path.join(managed, ".vibepro", "executions", storyId, "runs", result.state.run_id, "state.json");
  const persisted = JSON.parse(await readFile(artifact, "utf8"));
  assert.equal(result.state.status, "pr_ready", JSON.stringify({
    stop_reason: result.state.stop_reason,
    current_head_sha: result.state.current_head_sha,
    runtime_dispatches: result.state.runtime_dispatches,
    action_journal: result.state.action_journal
  }));
  assert.equal(persisted.current_head_sha, repairedHead);
  assert.notEqual(repairedHead, implementationHead);
  assert.notEqual(implementationHead, initialHead);
  const implementations = persisted.runtime_dispatches.filter(({ role }) => role === "implementation");
  const reviews = persisted.runtime_dispatches.filter(({ role }) => role === "review");
  const verify = persisted.action_journal.filter(({ action_id }) => action_id === "verify");
  const finalPrepare = persisted.action_journal.findLast(({ action_id }) => action_id === "final_prepare");
  // S-001: public CLI entered the production run-session owner composition; no
  // custom implementation, repair, or review action runner produced this evidence.
  assert.deepEqual(implementations.map(({ result }) => result.head_sha), [implementationHead, repairedHead]);
  assert.equal(implementations.every(({ requirements }) => requirements.managed_worktree === managed), true);
  assert.equal(reviewCalls, 2);
  assert.equal(verify.length, 2);
  assert.deepEqual(reviews.map(({ result }) => result.review.status), ["needs_changes", "pass"]);
  assert.equal(reviews.every(({ sandbox }) => sandbox === "read-only"), true);
  assert.equal(reviews.every(({ result }) => result.review_provenance.lifecycle === "closed"), true);
  assert.equal(reviews.every(({ reviewer_identity, implementation_identity }) =>
    reviewer_identity !== implementation_identity), true);
  assert.equal(lifecycleSequence, 2);
  assert.deepEqual(reviewLifecycleEvents.map(([operation]) => operation), [
    "prepare", "authorize", "start", "close", "record",
    "prepare", "authorize", "start", "close", "record"
  ]);
  assert.equal(finalPrepare.output_head_sha, repairedHead);
  assert.equal(finalPrepare.status, "completed");
});

test("scenario:S-002 typed stop and resume matrix executes independently of unit imports", async () => {
  const head = "a".repeat(40);
  const state = {
    story_id: "story-ocr-matrix",
    run_id: "run-ocr-matrix",
    current_head_sha: head,
    action_journal: [],
    managed_worktree: { path: "/managed", branch: "codex/ocr-matrix" },
    execution_context: { root_realpath: "/managed", branch: "codex/ocr-matrix" }
  };
  const context = (actionId) => ({ state, action: { id: actionId } });
  const defaults = {
    readReadiness: async () => ({ missing_artifacts: [] }),
    prepareCurrentHead: async () => ({
      git: { head_sha: head },
      preparation: { gate_status: { ready_for_pr_create: true, next_required_actions: [] } }
    }),
    dispatchRuntime: async ({ request }) => ({
      state,
      dispatch: {
        dispatch_id: `dispatch-${request.task_id}`,
        status: "completed",
        result: { completion_status: "completed", changed_files: ["src/change.js"], head_sha: head }
      }
    }),
    pollRuntime: async ({ dispatch }) => ({ state, dispatch }),
    cancelRuntime: async ({ dispatch }) => ({ state, dispatch: { ...dispatch, status: "cancelled" } }),
    runtimePollIntervalMs: 1,
    waitForRuntimePoll: async () => {}
  };

  const noProgress = createOneCommandPrReadyActionOwners({
    ...defaults,
    readReadiness: async () => ({ missing_artifacts: ["Spec"] }),
    dispatchRuntime: async ({ request }) => ({
      state,
      dispatch: {
        dispatch_id: `dispatch-${request.task_id}`,
        status: "completed",
        result: { completion_status: "completed", changed_files: [], head_sha: head }
      }
    })
  });
  assert.equal((await noProgress.prepare_artifacts(context("prepare_artifacts"))).stop_reason, "no_progress");

  const descriptor = {
    type: "scope_split",
    question: "Preserve repository-only scope?",
    choices: ["preserve", "split"],
    material_reason: "The answer changes external authority.",
    impact_scope: ["Story scope"],
    source_refs: ["story:S-002"],
    stop_node_id: "prepare_artifacts"
  };
  const decision = createOneCommandPrReadyActionOwners({
    ...defaults,
    readReadiness: async () => ({ human_decision: descriptor })
  });
  assert.equal((await decision.prepare_artifacts(context("prepare_artifacts"))).status, "waiting_for_human");

  const verificationFailure = createOneCommandPrReadyActionOwners({
    ...defaults,
    prepareCurrentHead: async () => ({
      verification_passed: false,
      git: { head_sha: head },
      preparation: { gate_status: { next_required_actions: ["focused verification failed"] } }
    })
  });
  assert.equal((await verificationFailure.verify(context("verify"))).stop_reason, "verification_failed");

  const ciPending = createOneCommandPrReadyActionOwners({
    ...defaults,
    prepareCurrentHead: async () => ({
      git: { head_sha: head },
      preparation: { gate_status: { ready_for_pr_create: false, ci_pending: true, next_required_actions: ["import CI"] } }
    })
  });
  assert.equal((await ciPending.final_prepare(context("final_prepare"))).stop_reason, "ci_pending");

  let runtimeAvailable = false;
  const resumable = createOneCommandPrReadyActionOwners({
    ...defaults,
    dispatchRuntime: async ({ request }) => runtimeAvailable
      ? ({
          state,
          dispatch: {
            dispatch_id: `dispatch-${request.task_id}`,
            status: "completed",
            result: {
              completion_status: "completed",
              changed_files: ["src/change.js"],
              head_sha: "b".repeat(40)
            }
          }
        })
      : ({
          state,
          dispatch: {
            dispatch_id: `dispatch-${request.task_id}`,
            status: "waiting_for_runtime",
            stop_reason: {
              code: "quota_exceeded",
              message: "quota unavailable",
              details: {
                provider: request.adapter_id,
                missing_capabilities: ["workspace_write"],
                recovery: {
                  action: "resume_run",
                  story_id: state.story_id,
                  run_id: state.run_id,
                  required_capabilities: ["workspace_write"]
                }
              }
            }
          }
        })
  });
  const quota = await resumable.implement(context("implement"));
  assert.equal(quota.stop_reason, "quota_exceeded");
  assert.equal(quota.recovery.action, "resume_run");
  runtimeAvailable = true;
  assert.equal((await resumable.implement(context("implement"))).status, "continue");

  const running = { dispatch_id: "dispatch-timeout", status: "running" };
  const timeout = createOneCommandPrReadyActionOwners({
    ...defaults,
    runtimeTimeoutMs: 1,
    waitForRuntimePoll: async () => new Promise((resolve) => setTimeout(resolve, 2)),
    dispatchRuntime: async () => ({ state, dispatch: running }),
    pollRuntime: async () => ({ state, dispatch: running })
  });
  assert.equal((await timeout.implement(context("implement"))).stop_reason, "runtime_probe_timeout");

  const cancelled = createOneCommandPrReadyActionOwners({
    ...defaults,
    dispatchRuntime: async () => ({
      state,
      dispatch: {
        dispatch_id: "dispatch-cancelled",
        status: "cancelled",
        stop_reason: { code: "runtime_cancelled", message: "operator cancelled" }
      }
    })
  });
  assert.equal((await cancelled.implement(context("implement"))).stop_reason, "runtime_cancelled");
});

test("scenario:S-004 public guarded Run CLI persists typed stops across resume, render, and cancel", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibepro-ocr-public-run-e2e-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const storyId = "story-vibepro-one-command-pr-ready-closure-public-run-e2e";
  await execFileAsync("git", ["init", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "VibePro E2E"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "vibepro-e2e@example.invalid"], { cwd: root });
  await mkdir(path.join(root, ".vibepro"), { recursive: true });
  await writeFile(path.join(root, ".vibepro", "config.json"), JSON.stringify({
    schema_version: "0.1.0",
    brainbase: {
      stories: [{ story_id: storyId, title: "OCR public guarded Run E2E" }]
    },
    execution: { managed_worktree: "disabled" }
  }, null, 2) + "\n");
  await writeFile(path.join(root, "README.md"), "# guarded Run public E2E\n");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-m", "test: initialize guarded Run public E2E"], { cwd: root });

  let implementAttempts = 0;
  const guardedRunDependencies = {
    now: () => new Date("2026-07-24T00:00:00.000Z"),
    randomBytes: () => Buffer.from([1, 2, 3, 4]),
    actionRunners: {
      diagnose: async () => ({ status: "continue", summary: "fixture diagnosis complete" }),
      prepare_artifacts: async () => ({ status: "continue", summary: "fixture artifacts ready" }),
      implement: async () => {
        implementAttempts += 1;
        return implementAttempts === 1
          ? {
              status: "waiting_for_runtime",
              stop_reason: "runtime_unavailable",
              recovery: {
                provider: "deterministic-e2e",
                required_capabilities: ["workspace_write"]
              },
              summary: "deterministic runtime is unavailable"
            }
          : {
              status: "blocked",
              stop_reason: "verification_failed",
              recovery: { required_actions: ["refresh focused verification evidence"] },
              summary: "deterministic verification stop after resume"
            };
      }
    }
  };
  const invoke = async (args, { json = true } = {}) => {
    let stdout = "";
    const invocation = await runCli([...args, ...(json ? ["--json"] : [])], {
      guardedRunDependencies,
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stdout += chunk; } }
    });
    return { invocation, stdout };
  };
  const previous = process.env.VIBEPRO_NEXT_BEST_ACTION;
  process.env.VIBEPRO_NEXT_BEST_ACTION = "off";
  t.after(() => previous === undefined
    ? delete process.env.VIBEPRO_NEXT_BEST_ACTION
    : (process.env.VIBEPRO_NEXT_BEST_ACTION = previous));

  const started = await invoke([
    "execute", "run", root, "--story-id", storyId,
    "--until", "pr-ready", "--autonomy", "guarded", "--action-profile", "autonomous"
  ]);
  assert.equal(started.invocation.exitCode, 0);
  assert.equal(started.invocation.result.state.status, "waiting_for_runtime");
  assert.equal(started.invocation.result.state.stop_reason.code, "runtime_unavailable");
  const runId = started.invocation.result.state.run_id;
  const stateFile = path.join(root, ".vibepro", "executions", storyId, "runs", runId, "state.json");
  const initialState = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(initialState.status, "waiting_for_runtime");
  assert.equal(initialState.resume_from_node_id, "implement");
  assert.equal(initialState.stop_reason.details.recovery.action, "resume_run");

  const resumed = await invoke([
    "execute", "resume", root, "--story-id", storyId, "--run-id", runId, "--until", "pr-ready"
  ]);
  assert.equal(resumed.invocation.exitCode, 0);
  assert.equal(resumed.invocation.result.state.status, "blocked");
  assert.equal(resumed.invocation.result.state.stop_reason.code, "verification_failed");
  const resumedState = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(implementAttempts, 2);
  assert.equal(resumedState.retry_journal.at(-1).stop_code, "runtime_unavailable");
  assert.equal(resumedState.stop_reason.code, "verification_failed");

  const rendered = await invoke([
    "execute", "status", root, "--story-id", storyId, "--run-id", runId
  ], { json: false });
  assert.equal(rendered.invocation.exitCode, 0);
  assert.match(rendered.stdout, /# VibePro Guarded Run/);
  assert.match(rendered.stdout, /- status: blocked/);
  assert.match(rendered.stdout, /- stop_reason: verification_failed:/);
  assert.match(rendered.stdout, /next_command: vibepro execute resume/);

  const cancelled = await invoke([
    "execute", "cancel", root, "--story-id", storyId, "--run-id", runId
  ]);
  assert.equal(cancelled.invocation.exitCode, 0);
  assert.equal(cancelled.invocation.result.status, "cancelled");
  const cancelledState = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(cancelledState.stop_reason.code, "cancelled_by_operator");
  assert.equal(cancelledState.transitions.at(-1).reason, "operator_cancelled");
});

test("scenario:S-005 roadmap closure keeps external authority explicit and predecessor evidence canonical", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const storyFiles = {
    connectors: "docs/management/stories/active/story-vibepro-production-runtime-connectors.md",
    review: "docs/management/stories/active/story-vibepro-independent-review-orchestration.md",
    closure: "docs/management/stories/active/story-vibepro-one-command-pr-ready-closure.md",
    roadmap: "docs/management/stories/active/story-vibepro-autonomous-implementation-closure-roadmap.md"
  };
  const entries = Object.fromEntries(await Promise.all(Object.entries(storyFiles).map(async ([key, file]) => [
    key,
    await readFile(path.join(repoRoot, file), "utf8")
  ])));
  const plan = buildSafeActionPlan({
    story_id: "story-vibepro-one-command-pr-ready-closure",
    run_id: "run-roadmap-closure",
    current_head_sha: "current-head",
    status: "running",
    action_journal: []
  }, { profile: "autonomous" });

  // S-005: executable SSOT assertions reconcile merged predecessors without granting external authority.
  assert.match(entries.connectors, /status: completed[\s\S]*PR: https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/377/);
  assert.match(entries.review, /status: completed[\s\S]*PR: https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/382/);
  assert.match(entries.closure, /status: (?:active|completed)/);
  assert.match(entries.roadmap, /status: (?:active|completed)/);
  assert.deepEqual(plan.map(({ id }) => id), [
    "diagnose",
    "prepare_artifacts",
    "implement",
    "verify",
    "review",
    "repair",
    "final_prepare"
  ]);
  assert.equal(plan.some(({ id }) => ["pr_create", "merge", "waiver"].includes(id)), false);
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
    "story-vibepro-one-command-pr-ready-closure scenario:S-001"
  );
  assert.match(
    "success、restart、resume、material human decision、verification failure、needs_changes repair、no progress、quota、timeout、CI pending、cancelはcurrent-HEAD pr_readyまたはtyped stopへ収束し、cancel後のstale dispatchを封じ、human_decisionはtype、question、choices、material_reason、impact_scope、source_refs、stop_node_idに限定する",
    /restart.*needs_changes repair.*stale dispatch.*stop_node_id/,
    "story-vibepro-one-command-pr-ready-closure scenario:S-003"
  );
  assert.match(
    "PR #377とPR #382の先行Story lifecycle、最終Story、親roadmapを二重実装なしで閉じ、明示的execute mergeをpost-merge confirmationとして保存する",
    /PR #377.*PR #382.*二重実装なし.*post-merge confirmation/,
    "story-vibepro-one-command-pr-ready-closure scenario:S-005"
  );
});
