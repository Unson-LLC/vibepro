// Executable coverage markers:
// AC-1 OCR-S-1: guarded one-command defaults to the autonomous closure profile.
// AC-2 OCR-S-2: the closed action DAG composes the canonical implementation owners.
// AC-3 OCR-S-3: only current-HEAD final_prepare may produce pr_ready.
// AC-4 OCR-S-4: PR creation, merge, waiver, and material side effects remain explicit.
// AC-5 OCR-S-5: success, resume, decision, failure, repair, limits, CI wait, and cancel converge or stop typed.
// AC-6 OCR-S-6: production connector implementation runs in the managed worktree.
// AC-7 OCR-S-7: independent review uses a separate read-only lifecycle.
// AC-8 OCR-S-8: pre-PR closure proves all merged predecessors while the final Story and roadmap remain active.
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
import { startExecution } from "../../src/execution-state.js";
import { createOneCommandPrReadyActionOwners } from "../../src/one-command-pr-ready-closure.js";
import { buildSafeActionPlan } from "../../src/safe-action-orchestrator.js";

const execFileAsync = promisify(execFile);
const normalizedMacPath = (value) => value.replace(/^\/private(?=\/var\/)/, "");

test("scenario:S-001 public guarded Run composes production owners for available-provider commit, review, repair, and final prepare", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibepro-ocr-e2e-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const managed = path.join(root, "managed");
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
    brainbase: { stories: [{ story_id: storyId, title: "OCR production-shaped E2E" }] },
    execution: { managed_worktree: "required" }
  }, null, 2)}\n`);
  await writeFile(
    path.join(source, ".vibepro", "vibepro-manifest.json"),
    `${JSON.stringify({ schema_version: "0.1.0", tool: "vibepro" }, null, 2)}\n`
  );
  await writeFile(path.join(source, "implementation.txt"), "initial\n");
  await execFileAsync(
    "git",
    ["add", ".gitignore", ".vibepro/config.json", ".vibepro/vibepro-manifest.json", "implementation.txt"],
    { cwd: source }
  );
  await execFileAsync("git", ["commit", "-m", "test: initialize OCR fixture"], { cwd: source });
  const initialHead = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: source })).stdout.trim();
  const currentHead = async () =>
    (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: managed })).stdout.trim();
  let implementationHead = initialHead;
  let artifactHead = initialHead;
  let repairedHead = initialHead;
  let reviewCalls = 0;
  let runtimeSequence = 0;
  let lifecycleSequence = 0;
  const runtimeRequests = new Map();
  const reviewLifecycleEvents = [];
  const prepareArtifact = ".vibepro/pr/ocr-e2e/pr-prepare.json";
  const coordinator = createAgentRuntimeCoordinator({
    adapters: [{
      id: "codex",
      async probe({ role }) {
        return role === "review"
          ? { available: true, capabilities: ["review"], sandbox: "read-only", approval_policy: "managed" }
          : {
              available: true,
              capabilities: ["workspace_write", "local_workspace_only"],
              sandbox: "workspace-write",
              approval_policy: "never"
            };
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
          const prepareArtifacts = request.task_id.endsWith(":prepare-artifacts");
          const repair = request.task_id.endsWith(":repair-1");
          const changedFile = prepareArtifacts ? "runtime-artifact.md" : "implementation.txt";
          await writeFile(path.join(managed, changedFile), prepareArtifacts
            ? "# Runtime-created artifact\n"
            : repair
              ? "repaired by production-shaped runtime\n"
              : "implemented by production-shaped runtime\n");
          await execFileAsync("git", ["add", changedFile], { cwd: managed });
          await execFileAsync(
            "git",
            ["commit", "-m", prepareArtifacts
              ? "docs: create diagnosed runtime artifact"
              : repair
                ? "fix: repair independent review finding"
                : "test: advance managed runtime head"],
            { cwd: managed }
          );
          const head = await currentHead();
          if (prepareArtifacts) artifactHead = head;
          else if (repair) repairedHead = head;
          else implementationHead = head;
          return {
            completion_status: "completed",
            changed_files: [changedFile],
            head_sha: head,
            test_suggestions: ["node --test test/one-command-pr-ready-closure.test.js"],
            summary: prepareArtifacts
              ? "managed artifact runtime committed"
              : repair
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
    startExecution: async (repoRoot, options) => startExecution(repoRoot, {
      ...options,
      branchName: branch,
      worktreePath: managed
    }),
    agentRuntimeCoordinator: coordinator,
    readGateReadiness: async () => {
      try {
        await readFile(path.join(managed, "runtime-artifact.md"), "utf8");
        return { ready_for_pr_create: false, missing_artifacts: [] };
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        return {
          ready_for_pr_create: false,
          missing_artifacts: ["runtime-artifact.md"]
        };
      }
    },
    preparePullRequest: async () => {
      const prepared = {
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
        artifacts: { json: prepareArtifact }
      };
      const artifactFile = path.join(managed, prepareArtifact);
      await mkdir(path.dirname(artifactFile), { recursive: true });
      await writeFile(artifactFile, `${JSON.stringify(prepared, null, 2)}\n`);
      return prepared;
    },
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
  assert.equal(
    result.state.action_profile,
    "autonomous",
    "AC-1: the public guarded one-command path defaults to the autonomous closure profile"
  );
  const artifact = path.join(
    result.state.execution_context.root_realpath,
    ".vibepro", "executions", storyId, "runs", result.state.run_id, "state.json"
  );
  const persisted = JSON.parse(await readFile(artifact, "utf8"));
  assert.equal(
    result.state.status,
    "pr_ready",
    `AC-3: only current-HEAD final prepare may produce pr_ready; AC-7: the dedicated self-dogfood fixture reaches pr_ready\n${JSON.stringify({
      stop_reason: result.state.stop_reason,
      current_head_sha: result.state.current_head_sha,
      runtime_dispatches: result.state.runtime_dispatches,
      action_journal: result.state.action_journal
    })}`
  );
  assert.equal(persisted.current_head_sha, repairedHead);
  assert.equal(normalizedMacPath(persisted.managed_worktree.path), normalizedMacPath(managed));
  assert.equal(persisted.managed_worktree.branch, branch);
  assert.equal(normalizedMacPath(persisted.execution_context.root_realpath), normalizedMacPath(managed));
  assert.equal(
    (await execFileAsync("git", ["branch", "--show-current"], { cwd: managed })).stdout.trim(),
    branch
  );
  assert.notEqual(repairedHead, implementationHead);
  assert.notEqual(implementationHead, initialHead);
  const implementations = persisted.runtime_dispatches.filter(({ role }) => role === "implementation");
  const reviews = persisted.runtime_dispatches.filter(({ role }) => role === "review");
  const verify = persisted.action_journal.filter(({ action_id }) => action_id === "verify");
  const finalPrepare = persisted.action_journal.findLast(({ action_id }) => action_id === "final_prepare");
  const persistedPrepare = JSON.parse(await readFile(path.join(managed, prepareArtifact), "utf8"));
  // S-001: public CLI entered the production run-session owner composition; no
  // custom implementation, repair, or review action runner produced this evidence.
  assert.deepEqual(
    implementations.map(({ result }) => result.head_sha),
    [artifactHead, implementationHead, repairedHead],
    "AC-2: the canonical implementation owner closes diagnosed artifacts, implementation, and repair"
  );
  assert.equal(
    implementations.every(({ requirements }) =>
      normalizedMacPath(requirements.managed_worktree) === normalizedMacPath(managed)),
    true,
    "AC-6: production connector mutations are constrained to the managed worktree"
  );
  assert.equal(
    implementations.every(({ requirements, approval_policy }) =>
      requirements.capabilities.includes("local_workspace_only")
      && approval_policy === "never"),
    true,
    "AC-4: every implementation dispatch is pre-authorized only for locally contained side effects"
  );
  assert.equal(reviewCalls, 2);
  assert.equal(verify.length, 2);
  assert.deepEqual(reviews.map(({ result }) => result.review.status), ["needs_changes", "pass"]);
  assert.equal(
    reviews.every(({ sandbox }) => sandbox === "read-only"),
    true,
    "AC-2: independent review runs through a separate read-only lifecycle"
  );
  assert.equal(reviews.every(({ result }) => result.review_provenance.lifecycle === "closed"), true);
  assert.equal(reviews.every(({ reviewer_identity, implementation_identity }) =>
    reviewer_identity !== implementation_identity), true);
  assert.equal(lifecycleSequence, 2);
  assert.deepEqual(reviewLifecycleEvents.map(([operation]) => operation), [
    "prepare", "authorize", "start", "close", "record",
    "prepare", "authorize", "start", "close", "record"
  ]);
  assert.equal(finalPrepare.output_head_sha, repairedHead);
  assert.equal(finalPrepare.artifact, prepareArtifact);
  assert.equal(finalPrepare.status, "completed");
  assert.equal(persistedPrepare.git.head_sha, repairedHead);
  assert.equal(persistedPrepare.preparation.gate_status.ready_for_pr_create, true);
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
  assert.equal(
    (await noProgress.prepare_artifacts(context("prepare_artifacts"))).stop_reason,
    "no_progress",
    "AC-5: no-progress terminates with a typed stop"
  );

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
  assert.equal(
    (await decision.prepare_artifacts(context("prepare_artifacts"))).status,
    "waiting_for_human",
    "AC-5: material decisions stop for explicit human input"
  );

  const verificationFailure = createOneCommandPrReadyActionOwners({
    ...defaults,
    prepareCurrentHead: async () => ({
      verification_passed: false,
      git: { head_sha: head },
      preparation: { gate_status: { next_required_actions: ["focused verification failed"] } }
    })
  });
  assert.equal(
    (await verificationFailure.verify(context("verify"))).stop_reason,
    "verification_failed",
    "AC-5: verification failure remains a typed terminal"
  );

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

test("scenario:S-004 public guarded Run CLI persists runtime, decision, and verification stops through pr_ready", async (t) => {
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
  let verifyAttempts = 0;
  const verificationProof = path.join(root, "verification-proof.txt");
  const guardedRunDependencies = {
    now: () => new Date("2026-07-24T00:00:00.000Z"),
    randomBytes: () => Buffer.from([1, 2, 3, 4]),
    preparePullRequest: async () => ({
      git: {
        head_sha: (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim()
      },
      preparation: {
        gate_status: { ready_for_pr_create: true, next_required_actions: [] }
      },
      artifacts: { json: ".vibepro/pr/public-e2e/pr-prepare.json" }
    }),
    actionRunners: {
      diagnose: async () => ({ status: "continue", summary: "fixture diagnosis complete" }),
      prepare_artifacts: async () => ({ status: "continue", summary: "fixture artifacts ready" }),
      implement: async () => {
        implementAttempts += 1;
        if (implementAttempts === 1) {
          return {
              status: "waiting_for_runtime",
              stop_reason: "runtime_unavailable",
              recovery: {
                provider: "deterministic-e2e",
                required_capabilities: ["workspace_write", "local_workspace_only"]
              },
              summary: "deterministic runtime is unavailable"
            };
        }
        if (implementAttempts === 2) {
          return {
            status: "waiting_for_human",
            stop_reason: "human_decision_required",
            human_decision: {
              type: "scope_split",
              question: "Keep material external side effects outside this Run?",
              choices: ["keep-local", "expand-authority"],
              material_reason: "The answer changes the authority boundary.",
              impact_scope: ["runtime side effects"],
              source_refs: ["story:OCR-S-4"],
              stop_node_id: "implement"
            },
            summary: "explicit authority decision required"
          };
        }
        return {
          status: "continue",
          summary: "deterministic implementation completed"
        };
      },
      verify: async () => {
        verifyAttempts += 1;
        try {
          await readFile(verificationProof, "utf8");
          return { status: "continue", summary: "focused verification refreshed" };
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          return {
            status: "blocked",
            stop_reason: "verification_failed",
            recovery: { required_actions: ["create verification-proof.txt"] },
            summary: "focused verification evidence is missing"
          };
        }
      },
      review: async () => ({ status: "continue", summary: "independent review passed" }),
      repair: async () => ({ status: "continue", summary: "no repair required" }),
      final_prepare: async ({ state }) => ({
        status: "pr_ready",
        artifact: ".vibepro/pr/public-e2e/pr-prepare.json",
        output_head_sha: state.current_head_sha,
        summary: "current HEAD is PR-ready"
      })
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
  assert.equal(initialState.stop_reason.details.provider, "deterministic-e2e");
  assert.deepEqual(
    initialState.stop_reason.details.required_capabilities,
    ["workspace_write", "local_workspace_only"]
  );
  assert.equal(initialState.stop_reason.details.recovery.action, "resume_run");
  assert.equal(initialState.stop_reason.details.recovery.condition.kind, "runtime_available");
  assert.match(initialState.stop_reason.details.recovery.next_command, /vibepro execute resume/);

  const resumed = await invoke([
    "execute", "resume", root, "--story-id", storyId, "--run-id", runId, "--until", "pr-ready"
  ]);
  assert.equal(resumed.invocation.exitCode, 0);
  assert.equal(resumed.invocation.result.state.status, "waiting_for_human");
  assert.equal(resumed.invocation.result.state.stop_reason.code, "human_decision_required");
  const decisionId = resumed.invocation.result.state.pending_decision.decision_id;
  const decided = await invoke([
    "execute", "resume", root, "--story-id", storyId, "--run-id", runId,
    "--decision", decisionId, "--answer", "keep-local", "--answered-by", "e2e-operator",
    "--reflected-in", "README.md",
    "--until", "pr-ready"
  ]);
  assert.equal(decided.invocation.exitCode, 0);
  assert.equal(decided.invocation.result.state.status, "blocked");
  assert.equal(decided.invocation.result.state.stop_reason.code, "verification_failed");
  const decidedState = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(decidedState.human_decision_journal.at(-1).decision_id, decisionId);
  assert.equal(decidedState.human_decision_journal.at(-1).answer, "keep-local");
  assert.deepEqual(decidedState.human_decision_journal.at(-1).reflected_in, ["README.md"]);

  await writeFile(verificationProof, "operator refreshed focused verification evidence\n");
  const verificationResumed = await invoke([
    "execute", "resume", root, "--story-id", storyId, "--run-id", runId, "--until", "pr-ready"
  ]);
  assert.equal(verificationResumed.invocation.exitCode, 0);
  assert.equal(
    verificationResumed.invocation.result.state.status,
    "pr_ready",
    JSON.stringify(verificationResumed.invocation.result.state.stop_reason)
  );
  const resumedState = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(implementAttempts, 3);
  assert.equal(verifyAttempts, 2);
  assert.equal(resumedState.retry_journal.some(({ stop_code }) => stop_code === "runtime_unavailable"), true);
  assert.equal(
    resumedState.action_journal.filter(({ action_id }) => action_id === "verify").length,
    2
  );
  assert.equal(resumedState.stop_reason, null);

  const rendered = await invoke([
    "execute", "status", root, "--story-id", storyId, "--run-id", runId
  ], { json: false });
  assert.equal(rendered.invocation.exitCode, 0);
  assert.match(rendered.stdout, /# VibePro Guarded Run/);
  assert.match(rendered.stdout, /- status: pr_ready/);
});

test("scenario:S-005 roadmap closure keeps external authority explicit and predecessor evidence canonical", async () => {
  const repoRoot = path.resolve(import.meta.dirname, "../..");
  const storyFiles = {
    actionDag: "docs/management/stories/active/story-vibepro-autonomous-action-dag.md",
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

  // AC-8 / S-005: executable SSOT assertions prove either side of the staged
  // closure boundary without treating the Story's own acceptance prose alone
  // as evidence.
  assert.match(entries.actionDag, /status: completed[\s\S]*PR #372: `https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/372`/);
  assert.match(entries.connectors, /status: completed[\s\S]*PR: https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/377/);
  assert.match(entries.review, /status: completed[\s\S]*PR: https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/382/);
  if (/^status: completed$/m.test(entries.closure)) {
    assert.match(entries.roadmap, /^status: completed$/m);
    assert.match(entries.roadmap, /- \[x\] AIC-S-2:/);
    assert.match(entries.roadmap, /- \[x\] AIC-S-3:/);
    assert.match(entries.roadmap, /One-command PR-ready Closure: PR #385/);
    assert.match(entries.closure, /Delivery PR: https:\/\/github\.com\/Unson-LLC\/vibepro\/pull\/385/);
    assert.match(entries.closure, /pre-closure HEAD `926227f945878299770448a03966c17dfa70158d`/);
    assert.match(entries.closure, /Node 20\/22 CI成功を`verify import-ci`で取り込んだ/);
  } else {
    assert.match(
      entries.closure,
      /^status: active$/m,
      "AC-8: the final Story stays active at the pre-PR boundary"
    );
    assert.match(
      entries.roadmap,
      /^status: active$/m,
      "AC-8: the parent roadmap stays active at the pre-PR boundary"
    );
  }
  assert.deepEqual(plan.map(({ id }) => id), [
    "diagnose",
    "prepare_artifacts",
    "implement",
    "verify",
    "review",
    "repair",
    "final_prepare"
  ]);
  assert.equal(
    plan.some(({ id }) => ["pr_create", "merge", "waiver"].includes(id)),
    false,
    "AC-4: PR creation, merge, and waiver remain explicit human operations"
  );
});
