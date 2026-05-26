import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initWorkspace } from './workspace.js';
import { installCodexInstructions, renderCodexInstall, renderCodexVerify, verifyCodexInstructions } from './codex-manager.js';
import { generateAgentHarnessMap, renderAgentHarnessMapSummary } from './agent-harness-map.js';
import { renderAgentHarnessStatus, scanAgentHarness } from './agent-harness-scanner.js';
import {
  getExploreEvidenceStatus,
  prepareExploreEvidence,
  recordExploreEvidence,
  renderExplorePrepareSummary,
  renderExploreRecordSummary,
  renderExploreStatusSummary
} from './explore-evidence.js';
import { importGraphifyArtifacts } from './graphify-adapter.js';
import { runDiagnosis } from './diagnostic-engine.js';
import {
  captureDesignModernizeScreens,
  createDesignModernizePlan,
  renderCaptureSummary,
  renderDesignModernizePlan
} from './design-modernize.js';
import { assertOutputLanguage, localizedText, normalizeOutputLanguage, setOutputLanguage } from './language.js';
import { listCheckPacks, renderCheckPackSummary, runCheckPack } from './check-packs.js';
import { renderDoctor, runDoctor } from './doctor.js';
import {
  recordSessionLearning,
  renderSessionLearningRecordSummary,
  renderSessionLearningsReviewSummary,
  reviewSessionLearnings
} from './session-learning.js';
import { createBrainbaseImport } from './brainbase-importer.js';
import { publishStatusToNocoDB, syncStoriesFromNocoDB } from './nocodb-story-sync.js';
import { getRepoStatus, renderRepoStatus } from './repo-status.js';
import {
  comparePerformanceMeasurements,
  renderPerformanceSummary,
  runPerformanceMeasurement
} from './performance-measurer.js';
import {
  compareStoryPerformance,
  definePerformanceMetric,
  recordPerformanceRun,
  renderPerformanceDefineSummary,
  renderPerformanceEvidenceSummary,
  renderPerformanceRecordSummary
} from './performance-evidence.js';
import {
  closeAgentReviewLifecycle,
  getAgentReviewStatus,
  prepareAgentReview,
  recordAgentReview,
  renderAgentReviewLifecycleCloseSummary,
  renderAgentReviewLifecycleStartSummary,
  renderAgentReviewPrepareSummary,
  renderAgentReviewRecordSummary,
  renderAgentReviewStatusSummary,
  startAgentReviewLifecycle
} from './agent-review.js';
import { listCheckpointStages, renderCheckpointSummary, runCheckpoint } from './checkpoint-manager.js';
import {
  getExecutionNext,
  getExecutionStatus,
  reconcileExecutionState,
  renderExecutionNextSummary,
  renderExecutionStateSummary,
  startExecution,
  updateExecutionStateFromPrCreate,
  updateExecutionStateFromPrPrepare
} from './execution-state.js';
import { createPullRequest, preparePullRequest, renderPrCreateSummary, renderPrPrepareSummary } from './pr-manager.js';
import { renderFlowVerificationSummary, runFlowVerification } from './flow-verifier.js';
import { recordVerificationEvidence, renderVerificationEvidenceSummary } from './verification-evidence.js';
import {
  getDecisionStatus,
  recordDecision,
  renderDecisionRecordSummary,
  renderDecisionStatusSummary
} from './decision-records.js';
import { buildSpecFingerprint } from './spec-fingerprint.js';
import { validateSpec } from './spec-validator.js';
import { buildSpecDrift, renderDriftMarkdown } from './spec-drift.js';
import {
  readInferredSpec,
  stabilizeClauseIds,
  writeDrift,
  writeDriftMarkdown,
  writeInferredSpec
} from './spec-store.js';
import { buildReportFingerprint } from './report-fingerprint.js';
import { validateReportNarrative } from './report-validator.js';
import {
  readNarrative,
  REPORT_KINDS,
  stabilizeTalkingPointIds,
  writeNarrative
} from './report-store.js';
import {
  addStory,
  archiveStory,
  createStoryPlan,
  createStoryReport,
  deriveStories,
  getStoryRuns,
  getStoryStatus,
  listStories,
  parseStoryOptions,
  readStoryMap,
  renderStoryDeriveSummary,
  renderStoryList,
  renderStoryMap,
  renderStoryPlanSummary,
  renderStoryRuns,
  renderStoryStatus,
  selectStory
} from './story-manager.js';
import {
  createTasksFromPlan,
  createTaskBrief,
  createTaskExecution,
  createTaskHandoff,
  createTaskPlan,
  listTasks,
  renderTaskCreateSummary,
  renderTaskList,
  renderTaskShow,
  showTask
} from './task-manager.js';
import {
  installBundledSkills,
  listBundledSkills,
  renderSkillsInstall,
  renderSkillsList,
  renderSkillsVerify,
  verifyBundledSkills
} from './skills-manager.js';

const execFileAsync = promisify(execFile);

const HELP_EN = `VibePro CLI

VibePro is a Story / Architecture / Spec / Graphify / Gate evidence control plane.
It does not directly rewrite the target repository. It prepares diagnosis, task,
impact, consistency, and PR-gate evidence so humans and AI agents can refactor
with reviewable context.

Conceptual model:
  Story defines user value and acceptance criteria.
  Architecture defines boundaries, responsibility, dependency direction, and ADR needs.
  Spec defines concrete behavior and invariants.
  Graphify expands the investigation scope beyond changed files.
  Gate DAG and split-plan decide whether the PR is reviewable and how to split it.

Typical internal beta flow:
  vibepro init <repo> --story-id <id> --title <title> --view dev --period <period>
  vibepro story diagnose <repo> --id <id> --run-graphify
  vibepro story derive <repo> --run-graphify
  vibepro story plan <repo>
  vibepro task create <repo> --from-plan --id <id>
  vibepro pr prepare <repo> --base <base-branch> --story-id <id>

PR prepare creates pr-body, gate-dag, split-plan, and machine-readable evidence
under .vibepro/pr/<story-id>/ when the target repo is initialized.

Usage:
  vibepro help [command]
  vibepro version
  vibepro --version | -v
  vibepro init [repo] [--story-id <id> --title <title>] [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>] [--language ja|en]
  vibepro config language [repo] --language ja|en
  vibepro doctor [repo] [--fix] [--json]
  vibepro status [repo] [--json]
  vibepro skills list [--json]
  vibepro skills install [repo] [--dry-run] [--force] [--json]
  vibepro skills verify [repo] [--json]
  vibepro codex install [repo] [--dry-run] [--force] [--json]
  vibepro codex verify [repo] [--json]
  vibepro harness status [repo] [--json]
  vibepro harness map [repo] [--json]
  vibepro harness learn [repo] --summary <text> [--kind <kind>] [--source <source>] [--evidence <ref>] [--pattern <text>] [--skill-candidate <text>] [--target <surface>] [--json]
  vibepro harness review-learnings [repo] [--json]
  vibepro graph [repo] [--from <graphify-out>] [--run-graphify]
  vibepro diagnose [repo] [--run-id <id>]
  vibepro check <ui|security|performance|architecture|pr-readiness|launch-readiness|agent-harness|public-discovery|self-dogfood|oss-readiness|all> [repo] [--run-id <id>] [--story-id <id>] [--base <ref>] [--head <ref>] [--measure] [--include-harness] [--include-public-discovery] [--fail-on-findings] [--json]
  vibepro design-modernize plan [repo] --id <story-id> [--product <name>] [--route <path>] [--routes <csv>] [--base-url <url>] [--design-system-id <id>] [--design-system-title <name>] [--design-system-bundle <file>] [--scene-id <id>] [--json]
  vibepro design-modernize capture [repo] --id <story-id> --base-url <url> [--route <path>] [--routes <csv>] [--sample-hotel-id <id>] [--json]
  vibepro verify flow [repo] --base-url <url> [--id <story-id>] [--run-id <id>] [--journey <id>] [--allow-mutation] [--headed] [--basic-auth-env <env>] [--basic-auth <user:pass>] [--json]
  vibepro verify record [repo] --id <story-id> --kind <unit|integration|e2e|typecheck|build> --status <pass|fail|needs_setup> --command <cmd> [--summary <text>] [--artifact <path>] [--json]
  vibepro decision record [repo] --id <story-id> --type <needs_review|noise|waiver|secret_exposure> --summary <text> [--source <gate-or-finding-id>] [--source-status <status>] [--reason <text>] [--artifact <path>] [--reviewer <name>] [--status <open|accepted|rejected|superseded>] [--secret-location <ref> --secret-action <redacted|rotated|revoked|false_positive>] [--from-stdin] [--json]
  vibepro decision status [repo] --id <story-id> [--json]
  vibepro review prepare [repo] --id <story-id> --stage <stage> [--role <role>] [--roles <csv>] [--json]
  vibepro review start [repo] --id <story-id> --stage <stage> --role <role> --agent-system codex|claude_code --agent-id <id> [--timeout-ms <ms>] [--replacement-for <lifecycle-id>] [--json]
  vibepro review close [repo] --id <story-id> --stage <stage> --role <role> --agent-id <id> [--close-reason completed|timeout|replaced|manual_shutdown] [--close-evidence <ref>] [--json]
  vibepro review record [repo] --id <story-id> --stage <stage> --role <role> --status <pass|needs_changes|block> --summary <text> [--finding <severity:id:detail>] [--artifact <path>] [--from-stdin] [--agent-system codex|claude_code|human --execution-mode parallel_subagent|manual_review --agent-id <id>] [--agent-thread-id <id>] [--agent-session-id <id>] [--agent-call-id <id>] [--agent-model <name>] [--agent-transcript <path>] [--agent-closed] [--agent-close-evidence <ref>] [--json]
  vibepro review status [repo] --id <story-id> [--stage <stage>] [--json]
  vibepro checkpoint <story|implementation-start|test-plan|implementation-complete|verification|pr> [repo] [--story-id <id>] [--base <ref>] [--head <ref>] [--task <task-id>] [--group <group-id>] [--json]
  vibepro execute <start|status|next|reconcile> [repo] --story-id <id> [--target pr_create] [--base <ref>] [--json]
  vibepro explore prepare [repo] --id <story-id> [--topic <text>] [--role <role>] [--json]
  vibepro explore record [repo] --id <story-id> --role <role> --status <pass|needs_review|block> --summary <text> [--finding <severity:id:detail>] [--artifact <path>] [--from-stdin] [--agent-system codex|claude_code --execution-mode parallel_subagent --agent-id <id>] [--agent-model <name>] [--agent-transcript <path>] [--json]
  vibepro explore status [repo] --id <story-id> [--json]
  vibepro measure [repo] [--base-url <url>] [--pages <csv>] [--apis <csv>] [--samples <n>] [--build] [--no-typecheck] [--startup-script <name>] [--ready-pattern <regex>] [--startup-timeout <ms>] [--prisma-log <file>] [--command <id=cmd>] [--run-id <id>] [--json]
  vibepro measure compare [repo] --before <performance.json> --after <performance.json> [--json]
  vibepro performance define [repo] --id <story-id> --metric-id <id> --user-story <text> --start-condition <text> --completion-condition <text> [--intermediate-marker <id>] [--timeout-ms <ms>] [--failure-classification <class>] [--evidence-source <server_log|browser_e2e|api_log|client_marker|manual_observation>] [--readiness-kind <server_side|user_perceived|external_dependency|system_internal>] [--comparison-policy <json|name>] [--json]
  vibepro performance record [repo] --id <story-id> --metric-id <id> --label <before|after> --status <completed|blocked|needs_review|timeout|auth_required|resource_unavailable|unknown> [--duration-ms <ms>] [--marker <id=ms>] [--evidence-source <type:ref:summary>] [--completion-condition <text>] [--run-id <id>] [--json]
  vibepro performance compare [repo] --id <story-id> [--metric-id <id>] [--before-label <label>] [--after-label <label>] [--json]
  vibepro story list [repo] [--all]
  vibepro story add [repo] --id <id> --title <title> [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>]
  vibepro story select [repo] --id <id>
  vibepro story archive [repo] --id <id>
  vibepro story runs [repo] [--id <id>]
  vibepro story status [repo] [--id <id>]
  vibepro story report [repo] [--id <id>]
  vibepro story diagnose [repo] --id <id> [--run-graphify] [--run-id <id>]
  vibepro story derive [repo] [--from-run <run-id>] [--run-graphify] [--from <graphify-out>] [--preset <id>] [--json]
  vibepro story map [repo] [--json]
  vibepro story plan [repo] [--limit <n>] [--json]
  vibepro task list [repo] [--id <story-id>]
  vibepro task create [repo] --from-plan [--id <story-id>] [--task <task-id>] [--limit <n>] [--json]
  vibepro task show [repo] --task <task-id> [--id <story-id>]
  vibepro task brief [repo] --task <task-id> [--group <group-id>] [--id <story-id>]
  vibepro task plan [repo] --task <task-id> [--group <group-id>] [--id <story-id>]
  vibepro task handoff [repo] --task <task-id> [--group <group-id>] [--id <story-id>]
  vibepro task execute [repo] --task <task-id> [--group <group-id>] [--id <story-id>] [--base <ref>] [--dry-run-pr] [--json]
  vibepro pr prepare [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <ref>] [--branch <name>] [--max-files <n>] [--stage-timeout-ms <ms>] [--progress] [--strict] [--allow-extra-files] [--language ja|en] [--json]
  vibepro pr create [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <branch>] [--title <title>] [--dry-run] [--allow-needs-verification --verification-waiver <reason>] [--stage-timeout-ms <ms>] [--progress] [--strict] [--allow-extra-files] [--language ja|en] [--json]
  vibepro brainbase [repo] [--sync-stories] [--publish-status] [--dry-run] [--story-id <id>]
  vibepro spec fingerprint [repo] --id <story-id> [--include-instructions] [--json]
  vibepro spec write [repo] --id <story-id> [--from-stdin] [--input <file>] [--caller <name>] [--json]
  vibepro spec show [repo] --id <story-id> [--clause <clause-id>] [--json]
  vibepro spec drift [repo] --id <story-id> [--against <git-ref>] [--json]
  vibepro report fingerprint [repo] --kind <kind> --id <story-id> [--base <ref>] [--task <id>] [--group <id>] [--include-instructions]
  vibepro report write [repo] --kind <kind> --id <story-id> [--from-stdin] [--input <file>] [--caller <name>]
  vibepro report show [repo] --kind <kind> --id <story-id>
`;

const HELP_JA = `VibePro CLI

VibeProは、AI駆動開発のために Story / Architecture / Spec / Gate 証跡をそろえる道標です。
対象リポジトリのコードを直接書き換えるのではなく、診断結果・PR前確認・分割方針・
エージェントへ渡す文脈を .vibepro/ に保存します。

まず人間が使う基本コマンド:
  vibepro init <repo> --language ja --story-id <id> --title <title>
      .vibepro/ を作り、出力言語とStoryを設定します。
  vibepro check pr-readiness <repo> --story-id <id> --base <base-branch>
      PR前に見るべき診断をまとめます。
  vibepro pr prepare <repo> --base <base-branch> --story-id <id>
      pr-body / gate-dag / split-plan / review-cockpit を作ります。
  vibepro review prepare <repo> --id <id> --stage implementation
      Codex / Claude Code の並列サブエージェントへ渡すレビュー依頼を作ります。
  vibepro review record <repo> --id <id> --stage implementation --role <role> --status pass --summary <text> --agent-system codex|claude_code --execution-mode parallel_subagent --agent-id <id> --agent-closed
      required Agent Review Gate を通すレビュー結果を、現在のgit状態・サブエージェント証跡・close済みlifecycleに紐づけて記録します。
      サブエージェントの結果を受け取った後、review record を実行する前にそのサブエージェントを close/shutdown してください。
      人間レビューは監査文脈として記録できますが、required gate のpass代替にはなりません。

.vibepro/ の意味:
  診断・Story・Gate・レビュー証跡を保存する作業台です。アプリ本体の実装とは分けて扱います。
  AIエージェントには .vibepro/pr/<story-id>/pr-body.md と review-cockpit.html を渡すのが基本です。

base branch:
  READMEや例の origin/develop は固定ではありません。リポジトリに合わせて origin/main や main を指定してください。
  init後の案内と pr prepare の出力に候補を表示します。

英語で表示したい場合:
  vibepro init <repo> --language en
  vibepro config language <repo> --language en
  vibepro help --language en

Usage:
  vibepro help [command] [--language ja|en]
  vibepro version
  vibepro --version | -v
  vibepro init [repo] [--story-id <id> --title <title>] [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>] [--language ja|en]
  vibepro config language [repo] --language ja|en
  vibepro doctor [repo] [--fix] [--json]
  vibepro status [repo] [--json]
  vibepro skills list [--json]
  vibepro skills install [repo] [--dry-run] [--force] [--json]
  vibepro skills verify [repo] [--json]
  vibepro codex install [repo] [--dry-run] [--force] [--json]
  vibepro codex verify [repo] [--json]
  vibepro harness status [repo] [--json]
  vibepro harness map [repo] [--json]
  vibepro harness learn [repo] --summary <text> [--kind <kind>] [--source <source>] [--evidence <ref>] [--pattern <text>] [--skill-candidate <text>] [--target <surface>] [--json]
  vibepro harness review-learnings [repo] [--json]
  vibepro graph [repo] [--from <graphify-out>] [--run-graphify]
  vibepro diagnose [repo] [--run-id <id>]
  vibepro check <ui|security|performance|architecture|pr-readiness|launch-readiness|agent-harness|public-discovery|self-dogfood|oss-readiness|all> [repo] [--run-id <id>] [--story-id <id>] [--base <ref>] [--head <ref>] [--measure] [--include-harness] [--include-public-discovery] [--fail-on-findings] [--json]
  vibepro design-modernize plan [repo] --id <story-id> [--product <name>] [--route <path>] [--routes <csv>] [--base-url <url>] [--design-system-id <id>] [--design-system-title <name>] [--design-system-bundle <file>] [--scene-id <id>] [--json]
  vibepro design-modernize capture [repo] --id <story-id> --base-url <url> [--route <path>] [--routes <csv>] [--sample-hotel-id <id>] [--json]
  vibepro verify flow [repo] --base-url <url> [--id <story-id>] [--run-id <id>] [--journey <id>] [--allow-mutation] [--headed] [--basic-auth-env <env>] [--basic-auth <user:pass>] [--json]
  vibepro verify record [repo] --id <story-id> --kind <unit|integration|e2e|typecheck|build> --status <pass|fail|needs_setup> --command <cmd> [--summary <text>] [--artifact <path>] [--json]
  vibepro decision record [repo] --id <story-id> --type <needs_review|noise|waiver|secret_exposure> --summary <text> [--source <gate-or-finding-id>] [--source-status <status>] [--reason <text>] [--artifact <path>] [--reviewer <name>] [--status <open|accepted|rejected|superseded>] [--secret-location <ref> --secret-action <redacted|rotated|revoked|false_positive>] [--from-stdin] [--json]
  vibepro decision status [repo] --id <story-id> [--json]
  vibepro review prepare [repo] --id <story-id> --stage <stage> [--role <role>] [--roles <csv>] [--json]
  vibepro review start [repo] --id <story-id> --stage <stage> --role <role> --agent-system codex|claude_code --agent-id <id> [--timeout-ms <ms>] [--replacement-for <lifecycle-id>] [--json]
  vibepro review close [repo] --id <story-id> --stage <stage> --role <role> --agent-id <id> [--close-reason completed|timeout|replaced|manual_shutdown] [--close-evidence <ref>] [--json]
  vibepro review record [repo] --id <story-id> --stage <stage> --role <role> --status <pass|needs_changes|block> --summary <text> [--finding <severity:id:detail>] [--artifact <path>] [--from-stdin] [--agent-system codex|claude_code|human --execution-mode parallel_subagent|manual_review --agent-id <id>] [--agent-thread-id <id>] [--agent-session-id <id>] [--agent-call-id <id>] [--agent-model <name>] [--agent-transcript <path>] [--agent-closed] [--agent-close-evidence <ref>] [--json]
  vibepro review status [repo] --id <story-id> [--stage <stage>] [--json]
  vibepro execute <start|status|next|reconcile> [repo] --story-id <id> [--target pr_create] [--base <ref>] [--json]
  vibepro checkpoint <story|implementation-start|test-plan|implementation-complete|verification|pr> [repo] [--story-id <id>] [--base <ref>] [--head <ref>] [--task <task-id>] [--group <group-id>] [--json]
  vibepro explore prepare [repo] --id <story-id> [--topic <text>] [--role <role>] [--json]
  vibepro explore record [repo] --id <story-id> --role <role> --status <pass|needs_review|block> --summary <text> [--finding <severity:id:detail>] [--artifact <path>] [--from-stdin] [--agent-system codex|claude_code --execution-mode parallel_subagent --agent-id <id>] [--agent-model <name>] [--agent-transcript <path>] [--json]
  vibepro explore status [repo] --id <story-id> [--json]
  vibepro measure [repo] [--base-url <url>] [--pages <csv>] [--apis <csv>] [--samples <n>] [--build] [--no-typecheck] [--startup-script <name>] [--ready-pattern <regex>] [--startup-timeout <ms>] [--prisma-log <file>] [--command <id=cmd>] [--run-id <id>] [--json]
  vibepro measure compare [repo] --before <performance.json> --after <performance.json> [--json]
  vibepro performance define [repo] --id <story-id> --metric-id <id> --user-story <text> --start-condition <text> --completion-condition <text> [--intermediate-marker <id>] [--timeout-ms <ms>] [--failure-classification <class>] [--evidence-source <server_log|browser_e2e|api_log|client_marker|manual_observation>] [--readiness-kind <server_side|user_perceived|external_dependency|system_internal>] [--comparison-policy <json|name>] [--json]
  vibepro performance record [repo] --id <story-id> --metric-id <id> --label <before|after> --status <completed|blocked|needs_review|timeout|auth_required|resource_unavailable|unknown> [--duration-ms <ms>] [--marker <id=ms>] [--evidence-source <type:ref:summary>] [--completion-condition <text>] [--run-id <id>] [--json]
  vibepro performance compare [repo] --id <story-id> [--metric-id <id>] [--before-label <label>] [--after-label <label>] [--json]
  vibepro story diagnose [repo] --id <id> [--run-graphify] [--run-id <id>]
  vibepro story derive [repo] [--from-run <run-id>] [--run-graphify] [--from <graphify-out>] [--preset <id>] [--json]
  vibepro story plan [repo] [--limit <n>] [--json]
  vibepro task create [repo] --from-plan [--id <story-id>] [--task <task-id>] [--limit <n>] [--json]
  vibepro pr prepare [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <ref>] [--branch <name>] [--max-files <n>] [--stage-timeout-ms <ms>] [--progress] [--strict] [--allow-extra-files] [--language ja|en] [--json]
  vibepro pr create [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <branch>] [--title <title>] [--dry-run] [--allow-needs-verification --verification-waiver <reason>] [--stage-timeout-ms <ms>] [--progress] [--strict] [--allow-extra-files] [--language ja|en] [--json]
  vibepro brainbase [repo] [--sync-stories] [--publish-status] [--dry-run] [--story-id <id>]
  vibepro spec fingerprint [repo] --id <story-id> [--include-instructions] [--json]
  vibepro spec write [repo] --id <story-id> [--from-stdin] [--input <file>] [--caller <name>] [--json]
  vibepro spec show [repo] --id <story-id> [--clause <clause-id>] [--json]
  vibepro spec drift [repo] --id <story-id> [--against <git-ref>] [--json]
`;

export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? null;
  const stderr = io.stderr ?? null;
  const [command, ...rest] = argv;

  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      const language = getOption(rest, '--language') ?? getOption(argv, '--language');
      write(stdout, renderHelp(language));
      return { exitCode: 0, command: 'help' };
    }

    if (command === 'version' || command === '--version' || command === '-v') {
      const version = await readPackageVersion();
      write(stdout, `${version}\n`);
      return { exitCode: 0, command: 'version', version };
    }

    if (command === 'init') {
      const repoRoot = rest[0] ?? process.cwd();
      const language = getOption(rest, '--language');
      if (language) assertOutputLanguage(language);
      const workspace = await initWorkspace(repoRoot, { language: language ?? undefined });
      const outputLanguage = await readConfiguredOutputLanguage(repoRoot, language);
      const baseBranch = await detectBaseBranch(repoRoot);
      write(stdout, renderInitSummary({
        language: outputLanguage,
        workspaceDir: workspace.workspaceDir,
        repoRoot,
        baseBranch
      }));
      const storyId = getOption(rest, '--story-id');
      if (storyId) {
        const storyOptions = {
          ...parseStoryOptions(rest),
          story_id: storyId
        };
        const story = await addStory(repoRoot, storyOptions);
        await selectStory(repoRoot, story.story_id);
        write(stdout, localizedText(outputLanguage, {
          ja: `Storyを追加しました: ${story.story_id}\nStoryを選択しました: ${story.story_id}\n`,
          en: `Story added: ${story.story_id}\nStory selected: ${story.story_id}\n`
        }));
        return { exitCode: 0, command, workspace, story };
      }
      return { exitCode: 0, command, workspace };
    }

    if (command === 'config') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (subcommand === 'language') {
        const result = await setOutputLanguage(repoRoot, getOption(rest, '--language'));
        write(stdout, localizedText(result.language, {
          ja: `人間向け出力言語を設定しました: ${result.language}\n`,
          en: `Output language set: ${result.language}\n`
        }));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown config command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'skills') {
      const subcommand = rest[0] ?? 'list';
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (subcommand === 'list') {
        const skills = await listBundledSkills();
        const result = { skills };
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderSkillsList(skills));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'install') {
        const result = await installBundledSkills(repoRoot, {
          dryRun: hasFlag(rest, '--dry-run'),
          force: hasFlag(rest, '--force')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderSkillsInstall(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'verify') {
        const result = await verifyBundledSkills(repoRoot);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderSkillsVerify(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown skills command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'codex') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (subcommand === 'install') {
        const result = await installCodexInstructions(repoRoot, {
          dryRun: hasFlag(rest, '--dry-run'),
          force: hasFlag(rest, '--force')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderCodexInstall(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'verify') {
        const result = await verifyCodexInstructions(repoRoot);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderCodexVerify(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown codex command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'harness') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === 'status' || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        const result = await scanAgentHarness(repoRoot);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentHarnessStatus(result));
        return { exitCode: 0, command, subcommand: 'status', result };
      }
      if (subcommand === 'map') {
        const result = await generateAgentHarnessMap(repoRoot);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentHarnessMapSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'learn') {
        const result = await recordSessionLearning(repoRoot, {
          id: getOption(rest, '--learning-id') ?? getOption(rest, '--id'),
          kind: getOption(rest, '--kind'),
          summary: getOption(rest, '--summary'),
          source: getOption(rest, '--source'),
          evidence: getOption(rest, '--evidence'),
          pattern: getOption(rest, '--pattern'),
          status: getOption(rest, '--status'),
          skillCandidate: getOption(rest, '--skill-candidate'),
          targets: getOptions(rest, '--target')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderSessionLearningRecordSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'review-learnings') {
        const result = await reviewSessionLearnings(repoRoot);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderSessionLearningsReviewSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown harness command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'graph') {
      const repoRoot = rest[0] ?? process.cwd();
      const sourceDir = getOption(rest, '--from');
      const result = await importGraphifyArtifacts(repoRoot, {
        sourceDir,
        runGraphify: hasFlag(rest, '--run-graphify'),
        env: io.env
      });
      write(stdout, `graphify artifacts imported: ${result.graphifyDir}\n`);
      return { exitCode: 0, command, result };
    }

    if (command === 'doctor') {
      const repoRoot = rest[0] && !rest[0].startsWith('--') ? rest[0] : process.cwd();
      const result = await runDoctor(repoRoot, { fix: hasFlag(rest, '--fix') });
      write(stdout, hasFlag(rest, '--json')
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderDoctor(result));
      return { exitCode: 0, command, result };
    }

    if (command === 'status') {
      const repoRoot = rest[0] && !rest[0].startsWith('--') ? rest[0] : process.cwd();
      const status = await getRepoStatus(repoRoot);
      write(stdout, hasFlag(rest, '--json')
        ? `${JSON.stringify(status, null, 2)}\n`
        : renderRepoStatus(status));
      return { exitCode: 0, command, status };
    }

    if (command === 'diagnose') {
      const repoRoot = rest[0] ?? process.cwd();
      const runId = getOption(rest, '--run-id');
      const result = await runDiagnosis(repoRoot, { runId });
      write(stdout, `diagnosis created: ${result.runDir}\n`);
      return { exitCode: 0, command, result };
    }

    if (command === 'design-modernize') {
      const subcommand = rest[0] ?? 'plan';
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (subcommand === 'plan') {
        const result = await createDesignModernizePlan(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id') ?? 'design-modernize',
          product: getOption(rest, '--product'),
          routes: parseDesignRoutes(rest),
          baseUrl: getOption(rest, '--base-url'),
          designSystemId: getOption(rest, '--design-system-id'),
          designSystemTitle: getOption(rest, '--design-system-title'),
          designSystemBundle: getOption(rest, '--design-system-bundle'),
          sceneId: getOption(rest, '--scene-id'),
          optionalReferenceStatus: process.env.MOONCHILD_MCP_TOKEN ? 'optional_reference_token_present' : 'not_required',
          optionalReferenceNote: process.env.MOONCHILD_MCP_TOKEN
            ? 'Optional reference token is present; external design-system exports may be used as reference input.'
            : 'No external generator token is required; pass --design-system-bundle only when a reference system should constrain the design.'
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.plan, null, 2)}\n`
          : `${renderDesignModernizePlan(result.plan)}\nArtifacts: ${result.outDir}\n`);
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'capture') {
        const result = await captureDesignModernizeScreens(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id') ?? 'design-modernize',
          baseUrl: getOption(rest, '--base-url'),
          routes: parseDesignRoutes(rest),
          sampleHotelId: getOption(rest, '--sample-hotel-id'),
          timeoutMs: parseNumberOption(rest, '--timeout-ms') ?? 30000
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.result, null, 2)}\n`
          : renderCaptureSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown design-modernize command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'check') {
      const packId = rest[0];
      if (!packId || packId === 'list' || packId === '--help' || packId === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        const packs = listCheckPacks();
        const lines = [
          'Available check packs:',
          '',
          ...packs.map((pack) => `- ${pack.id}: ${pack.title} (${pack.checks.join(', ')})`)
        ];
        write(stdout, `${lines.join('\n')}\n`);
        return { exitCode: 0, command, subcommand: packId ?? 'list', packs };
      }
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      const result = await runCheckPack(repoRoot, {
        packId,
        env: io.env,
        runId: getOption(rest, '--run-id'),
        storyId: getOption(rest, '--story-id') ?? getOption(rest, '--id'),
        baseRef: getOption(rest, '--base'),
        headRef: getOption(rest, '--head'),
        strict: hasFlag(rest, '--strict'),
        measure: hasFlag(rest, '--measure'),
        includeHarness: hasFlag(rest, '--include-harness'),
        includePublicDiscovery: hasFlag(rest, '--include-public-discovery'),
        baseUrl: getOption(rest, '--base-url'),
        pages: parseCsvOption(rest, '--pages'),
        apis: parseCsvOption(rest, '--apis'),
        samples: parseNumberOption(rest, '--samples') ?? 5,
        build: hasFlag(rest, '--build'),
        typecheck: !hasFlag(rest, '--no-typecheck'),
        commands: getOptions(rest, '--command'),
        startups: buildStartupOptions(rest),
        prismaLog: getOption(rest, '--prisma-log')
      });
      write(stdout, hasFlag(rest, '--json')
        ? `${JSON.stringify(result.check, null, 2)}\n`
        : renderCheckPackSummary(result));
      const exitCode = hasFlag(rest, '--fail-on-findings') && result.check.status !== 'pass' ? 1 : 0;
      return { exitCode, command, subcommand: packId, result };
    }

    if (command === 'verify') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'flow') {
        const result = await runFlowVerification(repoRoot, {
          baseUrl: getOption(rest, '--base-url'),
          storyId: getOption(rest, '--id'),
          runId: getOption(rest, '--run-id'),
          journeyId: getOption(rest, '--journey'),
          allowMutation: hasFlag(rest, '--allow-mutation'),
          headed: hasFlag(rest, '--headed'),
          basicAuth: getOption(rest, '--basic-auth'),
          basicAuthEnv: getOption(rest, '--basic-auth-env'),
          env: io.env
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.verification, null, 2)}\n`
          : renderFlowVerificationSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'record') {
        const result = await recordVerificationEvidence(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          kind: getOption(rest, '--kind'),
          status: getOption(rest, '--status'),
          command: getOption(rest, '--command'),
          summary: getOption(rest, '--summary'),
          artifact: getOption(rest, '--artifact')
        });
        await reconcileExecutionState(repoRoot, {
          storyId: result.evidence.story_id,
          target: 'pr_create'
        }).catch(() => null);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.evidence, null, 2)}\n`
          : renderVerificationEvidenceSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown verify command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'review') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'prepare') {
        const result = await prepareAgentReview(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          stage: getOption(rest, '--stage'),
          roles: [
            ...getOptions(rest, '--role'),
            ...parseCsvOption(rest, '--roles')
          ]
        });
        await reconcileExecutionState(repoRoot, {
          storyId: result.review?.story_id ?? result.summary?.story_id,
          target: 'pr_create'
        }).catch(() => null);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentReviewPrepareSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'start') {
        const result = await startAgentReviewLifecycle(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          stage: getOption(rest, '--stage'),
          role: getOption(rest, '--role'),
          agentSystem: getOption(rest, '--agent-system') ?? getOption(rest, '--reviewer-system'),
          agentId: getOption(rest, '--agent-id'),
          agentThreadId: getOption(rest, '--agent-thread-id'),
          agentSessionId: getOption(rest, '--agent-session-id'),
          agentCallId: getOption(rest, '--agent-call-id') ?? getOption(rest, '--agent-tool-call-id'),
          agentModel: getOption(rest, '--agent-model'),
          timeoutMs: getOption(rest, '--timeout-ms'),
          replacementFor: getOption(rest, '--replacement-for'),
          lifecycleId: getOption(rest, '--lifecycle-id')
        });
        await reconcileExecutionState(repoRoot, {
          storyId: result.lifecycle.story_id,
          target: 'pr_create'
        }).catch(() => null);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentReviewLifecycleStartSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'close') {
        const result = await closeAgentReviewLifecycle(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          stage: getOption(rest, '--stage'),
          role: getOption(rest, '--role'),
          agentSystem: getOption(rest, '--agent-system') ?? getOption(rest, '--reviewer-system'),
          agentId: getOption(rest, '--agent-id'),
          lifecycleId: getOption(rest, '--lifecycle-id'),
          closeReason: getOption(rest, '--close-reason'),
          closeEvidence: getOption(rest, '--close-evidence')
        });
        await reconcileExecutionState(repoRoot, {
          storyId: result.lifecycle.story_id,
          target: 'pr_create'
        }).catch(() => null);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentReviewLifecycleCloseSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'record') {
        const inputPath = getOption(rest, '--input');
        const stdinText = hasFlag(rest, '--from-stdin')
          ? inputPath
            ? await readFile(path.resolve(inputPath), 'utf8')
            : await readStdin(io.stdin ?? process.stdin)
          : '';
        const result = await recordAgentReview(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          stage: getOption(rest, '--stage'),
          role: getOption(rest, '--role'),
          status: getOption(rest, '--status'),
          summary: getOption(rest, '--summary'),
          findings: getOptions(rest, '--finding'),
          artifacts: getOptions(rest, '--artifact'),
          agentSystem: getOption(rest, '--agent-system') ?? getOption(rest, '--reviewer-system'),
          executionMode: getOption(rest, '--execution-mode'),
          agentId: getOption(rest, '--agent-id'),
          agentRole: getOption(rest, '--agent-role'),
          agentThreadId: getOption(rest, '--agent-thread-id'),
          agentSessionId: getOption(rest, '--agent-session-id'),
          agentCallId: getOption(rest, '--agent-call-id') ?? getOption(rest, '--agent-tool-call-id'),
          agentModel: getOption(rest, '--agent-model'),
          agentTranscript: getOption(rest, '--agent-transcript'),
          agentRequest: getOption(rest, '--agent-request'),
          agentClosed: hasFlag(rest, '--agent-closed') || hasFlag(rest, '--subagent-closed'),
          agentCloseEvidence: getOption(rest, '--agent-close-evidence') ?? getOption(rest, '--subagent-close-evidence'),
          agentCloseNote: getOption(rest, '--agent-close-note') ?? getOption(rest, '--subagent-close-note'),
          recordedBy: getOption(rest, '--recorded-by'),
          stdinText
        });
        await reconcileExecutionState(repoRoot, {
          storyId: result.review?.story_id ?? result.summary?.story_id,
          target: 'pr_create'
        }).catch(() => null);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentReviewRecordSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'status') {
        const result = await getAgentReviewStatus(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          stage: getOption(rest, '--stage')
        });
        await reconcileExecutionState(repoRoot, {
          storyId: result.story_id,
          target: 'pr_create'
        }).catch(() => null);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentReviewStatusSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown review command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'decision') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'record') {
        const result = await recordDecision(repoRoot, {
          storyId: getOption(rest, '--id'),
          type: getOption(rest, '--type'),
          source: getOption(rest, '--source'),
          sourceStatus: getOption(rest, '--source-status'),
          summary: getOption(rest, '--summary'),
          reason: getOption(rest, '--reason'),
          artifact: getOption(rest, '--artifact'),
          reviewer: getOption(rest, '--reviewer'),
          status: getOption(rest, '--status'),
          secretLocation: getOption(rest, '--secret-location'),
          secretAction: getOption(rest, '--secret-action'),
          stdinText: hasFlag(rest, '--from-stdin') ? await readStdin(stdin) : ''
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderDecisionRecordSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'status') {
        const result = await getDecisionStatus(repoRoot, {
          storyId: getOption(rest, '--id')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderDecisionStatusSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown decision command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'checkpoint') {
      const stage = rest[0] && !rest[0].startsWith('--') ? rest[0] : null;
      const repoIndex = stage ? 1 : 0;
      const repoRoot = rest[repoIndex] && !rest[repoIndex].startsWith('--') ? rest[repoIndex] : process.cwd();
      if (!stage || stage === '--help' || stage === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        const result = { checkpoints: listCheckpointStages() };
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderCheckpointList(result));
        return { exitCode: 0, command, subcommand: stage ?? 'help', result };
      }
      const result = await runCheckpoint(repoRoot, {
        stage,
        storyId: getOption(rest, '--story-id') ?? getOption(rest, '--id'),
        taskId: getOption(rest, '--task'),
        groupId: getOption(rest, '--group'),
        baseRef: getOption(rest, '--base'),
        headRef: getOption(rest, '--head'),
        branchName: getOption(rest, '--branch'),
        strict: hasFlag(rest, '--strict'),
        allowExtraFiles: hasFlag(rest, '--allow-extra-files'),
        language: getOption(rest, '--language')
      });
      write(stdout, hasFlag(rest, '--json')
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderCheckpointSummary(result));
      return { exitCode: result.status === 'passed' ? 0 : 2, command, subcommand: stage, result };
    }

    if (command === 'execute') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      const executionOptions = {
        storyId: getOption(rest, '--story-id') ?? getOption(rest, '--id'),
        target: getOption(rest, '--target') ?? 'pr_create',
        baseRef: getOption(rest, '--base'),
        taskId: getOption(rest, '--task'),
        groupId: getOption(rest, '--group')
      };
      if (subcommand === 'start') {
        const result = await startExecution(repoRoot, executionOptions);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.state, null, 2)}\n`
          : renderExecutionStateSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'status') {
        const result = await getExecutionStatus(repoRoot, executionOptions);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.state, null, 2)}\n`
          : renderExecutionStateSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'next') {
        const result = await getExecutionNext(repoRoot, executionOptions);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.next, null, 2)}\n`
          : renderExecutionNextSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'reconcile') {
        const result = await reconcileExecutionState(repoRoot, executionOptions);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.state, null, 2)}\n`
          : renderExecutionStateSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown execute command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'explore') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'prepare') {
        const result = await prepareExploreEvidence(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          topic: getOption(rest, '--topic'),
          roles: getOptions(rest, '--role')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderExplorePrepareSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'record') {
        const inputPath = getOption(rest, '--input');
        const stdinText = hasFlag(rest, '--from-stdin')
          ? inputPath
            ? await readFile(path.resolve(inputPath), 'utf8')
            : await readStdin(io.stdin ?? process.stdin)
          : '';
        const result = await recordExploreEvidence(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          role: getOption(rest, '--role'),
          status: getOption(rest, '--status'),
          summary: getOption(rest, '--summary'),
          findings: getOptions(rest, '--finding'),
          artifacts: getOptions(rest, '--artifact'),
          agentSystem: getOption(rest, '--agent-system'),
          executionMode: getOption(rest, '--execution-mode'),
          agentId: getOption(rest, '--agent-id'),
          agentModel: getOption(rest, '--agent-model'),
          agentTranscript: getOption(rest, '--agent-transcript'),
          recordedBy: getOption(rest, '--recorded-by'),
          stdinText
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderExploreRecordSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'status') {
        const result = await getExploreEvidenceStatus(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderExploreStatusSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown explore command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'measure') {
      const subcommand = rest[0];
      if (subcommand === 'compare') {
        const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
        const result = await comparePerformanceMeasurements(repoRoot, {
          before: getOption(rest, '--before'),
          after: getOption(rest, '--after')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.comparison, null, 2)}\n`
          : result.markdown);
        return { exitCode: 0, command, subcommand, result };
      }
      const repoRoot = rest[0] && !rest[0].startsWith('--') ? rest[0] : process.cwd();
      const result = await runPerformanceMeasurement(repoRoot, {
        runId: getOption(rest, '--run-id'),
        baseUrl: getOption(rest, '--base-url'),
        pages: parseCsvOption(rest, '--pages'),
        apis: parseCsvOption(rest, '--apis'),
        samples: parseNumberOption(rest, '--samples') ?? 5,
        build: hasFlag(rest, '--build'),
        typecheck: !hasFlag(rest, '--no-typecheck'),
        commands: getOptions(rest, '--command'),
        startups: buildStartupOptions(rest),
        prismaLog: getOption(rest, '--prisma-log')
      });
      write(stdout, hasFlag(rest, '--json')
        ? `${JSON.stringify(result.measurement, null, 2)}\n`
        : renderPerformanceSummary(result));
      return { exitCode: 0, command, result };
    }

    if (command === 'performance') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'define') {
        const result = await definePerformanceMetric(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          metricId: getOption(rest, '--metric-id'),
          userStory: getOption(rest, '--user-story'),
          startCondition: getOption(rest, '--start-condition'),
          completionCondition: getOption(rest, '--completion-condition'),
          intermediateMarkers: getOptions(rest, '--intermediate-marker'),
          timeoutMs: parseNumberOption(rest, '--timeout-ms'),
          failureClassifications: getOptions(rest, '--failure-classification'),
          evidenceSources: getOptions(rest, '--evidence-source'),
          comparisonPolicy: getOption(rest, '--comparison-policy'),
          readinessKind: getOption(rest, '--readiness-kind')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.metric, null, 2)}\n`
          : renderPerformanceDefineSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'record') {
        const result = await recordPerformanceRun(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          metricId: getOption(rest, '--metric-id'),
          runId: getOption(rest, '--run-id'),
          label: getOption(rest, '--label'),
          status: getOption(rest, '--status'),
          durationMs: parseNumberOption(rest, '--duration-ms'),
          startedAt: getOption(rest, '--started-at'),
          completedAt: getOption(rest, '--completed-at'),
          completionCondition: getOption(rest, '--completion-condition'),
          markers: getOptions(rest, '--marker'),
          evidenceSources: getOptions(rest, '--evidence-source'),
          notes: getOption(rest, '--notes')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.run, null, 2)}\n`
          : renderPerformanceRecordSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'compare') {
        const result = await compareStoryPerformance(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          metricId: getOption(rest, '--metric-id'),
          beforeLabel: getOption(rest, '--before-label'),
          afterLabel: getOption(rest, '--after-label')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.comparison, null, 2)}\n`
          : renderPerformanceEvidenceSummary(result.comparison));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown performance command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'story') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'list') {
        const result = await listStories(repoRoot, { includeArchived: hasFlag(rest, '--all') });
        write(stdout, renderStoryList(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'add') {
        const story = await addStory(repoRoot, parseStoryOptions(rest));
        write(stdout, `Story added: ${story.story_id}\n`);
        return { exitCode: 0, command, subcommand, story };
      }
      if (subcommand === 'select') {
        const story = await selectStory(repoRoot, getOption(rest, '--id'));
        write(stdout, `Story selected: ${story.story_id}\n`);
        return { exitCode: 0, command, subcommand, story };
      }
      if (subcommand === 'archive') {
        const story = await archiveStory(repoRoot, getOption(rest, '--id'));
        write(stdout, `Story archived: ${story.story_id}\n`);
        return { exitCode: 0, command, subcommand, story };
      }
      if (subcommand === 'runs') {
        const result = await getStoryRuns(repoRoot, getOption(rest, '--id'));
        write(stdout, renderStoryRuns(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'status') {
        const result = await getStoryStatus(repoRoot, getOption(rest, '--id'));
        write(stdout, renderStoryStatus(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'report') {
        const result = await createStoryReport(repoRoot, getOption(rest, '--id'));
        write(stdout, `Story report created: ${result.reportPath}\n`);
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'diagnose') {
        const story = await selectStory(repoRoot, getOption(rest, '--id'));
        write(stdout, `Story selected: ${story.story_id}\n`);
        const graph = await importGraphifyArtifacts(repoRoot, {
          sourceDir: getOption(rest, '--from'),
          runGraphify: hasFlag(rest, '--run-graphify'),
          env: io.env
        });
        write(stdout, `graphify artifacts imported: ${graph.graphifyDir}\n`);
        const diagnosis = await runDiagnosis(repoRoot, { runId: getOption(rest, '--run-id') });
        write(stdout, `diagnosis created: ${diagnosis.runDir}\n`);
        const report = await createStoryReport(repoRoot, story.story_id);
        write(stdout, `Story report created: ${report.reportPath}\n`);
        const status = await getStoryStatus(repoRoot, story.story_id);
        write(stdout, renderStoryStatus(status));
        return { exitCode: 0, command, subcommand, result: { story, graph, diagnosis, report, status } };
      }
      if (subcommand === 'derive') {
        let graph = null;
        if (hasFlag(rest, '--run-graphify') || getOption(rest, '--from')) {
          graph = await importGraphifyArtifacts(repoRoot, {
            sourceDir: getOption(rest, '--from'),
            runGraphify: hasFlag(rest, '--run-graphify'),
            env: io.env
          });
          if (!hasFlag(rest, '--json')) write(stdout, `graphify artifacts imported: ${graph.graphifyDir}\n`);
        }
        const result = await deriveStories(repoRoot, {
          fromRunId: getOption(rest, '--from-run'),
          preset: getOption(rest, '--preset')
        });
        const outputResult = graph ? { ...result, graph } : result;
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.catalog, null, 2)}\n`
          : renderStoryDeriveSummary(result));
        return { exitCode: 0, command, subcommand, result: outputResult };
      }
      if (subcommand === 'map') {
        const result = await readStoryMap(repoRoot);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.catalog, null, 2)}\n`
          : renderStoryMap(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'plan') {
        const result = await createStoryPlan(repoRoot, { limit: parseNumberOption(rest, '--limit') });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.plan, null, 2)}\n`
          : renderStoryPlanSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown story command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'task') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'create') {
        if (!hasFlag(rest, '--from-plan')) throw new Error('task create currently requires --from-plan');
        const result = await createTasksFromPlan(repoRoot, {
          storyId: getOption(rest, '--id'),
          taskId: getOption(rest, '--task'),
          limit: parseNumberOption(rest, '--limit')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderTaskCreateSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'list') {
        const result = await listTasks(repoRoot, { storyId: getOption(rest, '--id') });
        write(stdout, renderTaskList(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'show') {
        const result = await showTask(repoRoot, {
          storyId: getOption(rest, '--id'),
          taskId: getOption(rest, '--task')
        });
        write(stdout, renderTaskShow(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'brief') {
        const result = await createTaskBrief(repoRoot, {
          storyId: getOption(rest, '--id'),
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group')
        });
        write(stdout, `Task briefing created: ${result.artifacts.markdown}\n`);
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'plan') {
        const result = await createTaskPlan(repoRoot, {
          storyId: getOption(rest, '--id'),
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group')
        });
        write(stdout, `Task plan created: ${result.artifacts.markdown}\n`);
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'handoff') {
        const result = await createTaskHandoff(repoRoot, {
          storyId: getOption(rest, '--id'),
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group')
        });
        write(stdout, `Task handoff created: ${result.artifacts.markdown}\n`);
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'execute') {
        const result = await createTaskExecution(repoRoot, {
          storyId: getOption(rest, '--id'),
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group'),
          baseRef: getOption(rest, '--base'),
          dryRunPrCreate: hasFlag(rest, '--dry-run-pr')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.execution, null, 2)}\n`
          : `Task execution session created: ${result.artifacts.markdown}\n`);
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown task command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'pr') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'prepare') {
        const jsonOutput = hasFlag(rest, '--json');
        const progressOutput = jsonOutput || hasFlag(rest, '--progress');
        const result = await preparePullRequest(repoRoot, {
          storyId: getOption(rest, '--story-id'),
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group'),
          baseRef: getOption(rest, '--base'),
          headRef: getOption(rest, '--head'),
          branchName: getOption(rest, '--branch'),
          maxReviewableFiles: parseNumberOption(rest, '--max-files'),
          stageTimeoutMs: parseNumberOption(rest, '--stage-timeout-ms'),
          progressReporter: progressOutput ? (event) => write(stderr, `${renderPrPrepareProgressEvent(event)}\n`) : null,
          strict: hasFlag(rest, '--strict'),
          allowExtraFiles: hasFlag(rest, '--allow-extra-files'),
          language: getOption(rest, '--language')
        });
        write(stdout, jsonOutput
          ? `${JSON.stringify(result.preparation, null, 2)}\n`
          : renderPrPrepareSummary(result));
        await updateExecutionStateFromPrPrepare(repoRoot, result, {
          target: 'pr_create',
          baseRef: getOption(rest, '--base')
        }).catch(() => null);
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'create') {
        const jsonOutput = hasFlag(rest, '--json');
        const progressOutput = jsonOutput || hasFlag(rest, '--progress');
        const result = await createPullRequest(repoRoot, {
          storyId: getOption(rest, '--story-id'),
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group'),
          baseRef: getOption(rest, '--base'),
          prBase: getOption(rest, '--base'),
          headRef: getOption(rest, '--head-ref'),
          headBranch: getOption(rest, '--head'),
          branchName: getOption(rest, '--branch'),
          maxReviewableFiles: parseNumberOption(rest, '--max-files'),
          stageTimeoutMs: parseNumberOption(rest, '--stage-timeout-ms'),
          progressReporter: progressOutput ? (event) => write(stderr, `${renderPrPrepareProgressEvent(event)}\n`) : null,
          title: getOption(rest, '--title'),
          dryRun: hasFlag(rest, '--dry-run'),
          allowNeedsVerification: hasFlag(rest, '--allow-needs-verification'),
          verificationWaiver: getOption(rest, '--verification-waiver'),
          strict: hasFlag(rest, '--strict'),
          allowExtraFiles: hasFlag(rest, '--allow-extra-files'),
          language: getOption(rest, '--language'),
          env: io.env
        });
        write(stdout, jsonOutput
          ? `${JSON.stringify(result.execution, null, 2)}\n`
          : renderPrCreateSummary(result));
        await updateExecutionStateFromPrCreate(repoRoot, result, {
          target: 'pr_create',
          baseRef: getOption(rest, '--base')
        }).catch(() => null);
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown pr command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'brainbase') {
      const repoRoot = rest[0] ?? process.cwd();
      if (hasFlag(rest, '--sync-stories')) {
        const syncResult = await syncStoriesFromNocoDB(repoRoot, {
          env: io.env,
          fetch: io.fetch
        });
        write(stdout, `Portfolio dashboard stories synced: ${syncResult.stories.length}\n`);
      }
      const result = await createBrainbaseImport(repoRoot);
      write(stdout, `Portfolio dashboard import state created: ${result.importStatePath}\n`);
      if (hasFlag(rest, '--publish-status')) {
        const publishResult = await publishStatusToNocoDB(repoRoot, {
          env: io.env,
          fetch: io.fetch,
          dryRun: hasFlag(rest, '--dry-run'),
          storyId: getOption(rest, '--story-id')
        });
        write(stdout, publishResult.dryRun
          ? `Portfolio dashboard story status preview created: ${publishResult.storyId}\n`
          : `Portfolio dashboard story status published: ${publishResult.storyId}\n`);
      }
      return { exitCode: 0, command, result };
    }

    if (command === 'spec') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');

      if (subcommand === 'fingerprint') {
        if (!storyId) throw new Error('--id <story-id> is required for spec fingerprint');
        const fingerprint = await buildSpecFingerprint(repoRoot, {
          storyId,
          includeInstructions: hasFlag(rest, '--include-instructions')
        });
        write(stdout, `${JSON.stringify(fingerprint, null, 2)}\n`);
        return { exitCode: 0, command, subcommand, fingerprint };
      }

      if (subcommand === 'write') {
        if (!storyId) throw new Error('--id <story-id> is required for spec write');
        const inputPath = getOption(rest, '--input');
        const fromStdin = hasFlag(rest, '--from-stdin') || !inputPath;
        const caller = getOption(rest, '--caller') ?? 'unknown';
        const raw = inputPath
          ? await readFile(path.resolve(inputPath), 'utf8')
          : await readStdin(io.stdin ?? process.stdin);
        if (!raw.trim()) throw new Error('spec write received empty input');
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new Error(`spec write: input is not valid JSON: ${error.message}`);
        }
        const validation = await validateSpec(repoRoot, parsed, { expectedStoryId: storyId });
        if (!validation.ok) {
          write(stdout, `${JSON.stringify({ ok: false, errors: validation.errors, warnings: validation.warnings }, null, 2)}\n`);
          return { exitCode: 2, command, subcommand, validation };
        }
        const previousSpec = await readInferredSpec(repoRoot, storyId);
        const seeded = {
          ...parsed,
          schema_version: '0.1.0',
          story_id: storyId,
          generated_at: parsed.generated_at ?? new Date().toISOString(),
          generated_by: {
            caller,
            stage: parsed.generated_by?.stage ?? 'ai_synthesis'
          },
          previous_spec_id: previousSpec ? `${previousSpec.generated_at ?? ''}` : null
        };
        const stabilized = stabilizeClauseIds(seeded, previousSpec);
        await writeInferredSpec(repoRoot, storyId, stabilized);
        write(stdout, `${JSON.stringify({ ok: true, story_id: storyId, clauses: stabilized.clauses.length, warnings: validation.warnings }, null, 2)}\n`);
        return { exitCode: 0, command, subcommand, spec: stabilized };
      }

      if (subcommand === 'show') {
        if (!storyId) throw new Error('--id <story-id> is required for spec show');
        const spec = await readInferredSpec(repoRoot, storyId);
        if (!spec) {
          write(stdout, `${JSON.stringify({ story_id: storyId, found: false }, null, 2)}\n`);
          return { exitCode: 0, command, subcommand, spec: null };
        }
        const clauseId = getOption(rest, '--clause');
        const projection = clauseId
          ? { ...spec, clauses: spec.clauses.filter((entry) => entry.id === clauseId) }
          : spec;
        write(stdout, `${JSON.stringify(projection, null, 2)}\n`);
        return { exitCode: 0, command, subcommand, spec: projection };
      }

      if (subcommand === 'drift') {
        if (!storyId) throw new Error('--id <story-id> is required for spec drift');
        const drift = await buildSpecDrift(repoRoot, {
          storyId,
          againstRef: getOption(rest, '--against')
        });
        await writeDrift(repoRoot, storyId, drift);
        await writeDriftMarkdown(repoRoot, storyId, renderDriftMarkdown(drift));
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(drift, null, 2)}\n`
          : renderDriftMarkdown(drift));
        return { exitCode: 0, command, subcommand, drift };
      }

      write(stderr, `Unknown spec command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'report') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      const kind = getOption(rest, '--kind');
      const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');
      if (!kind || !REPORT_KINDS.has(kind)) {
        throw new Error(`--kind is required (supported: ${[...REPORT_KINDS].join('|')})`);
      }
      if (!storyId) throw new Error('--id <story-id> is required');

      if (subcommand === 'fingerprint') {
        const fingerprint = await buildReportFingerprint(repoRoot, {
          kind,
          storyId,
          baseRef: getOption(rest, '--base'),
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group'),
          branchName: getOption(rest, '--branch'),
          includeInstructions: hasFlag(rest, '--include-instructions')
        });
        write(stdout, `${JSON.stringify(fingerprint, null, 2)}\n`);
        return { exitCode: 0, command, subcommand, fingerprint };
      }

      if (subcommand === 'write') {
        const caller = getOption(rest, '--caller') ?? 'unknown';
        const inputPath = getOption(rest, '--input');
        const raw = inputPath
          ? await readFile(path.resolve(inputPath), 'utf8')
          : await readStdin(io.stdin ?? process.stdin);
        if (!raw.trim()) throw new Error('report write received empty input');
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (error) {
          throw new Error(`report write: input is not valid JSON: ${error.message}`);
        }
        const fingerprint = await buildReportFingerprint(repoRoot, {
          kind,
          storyId,
          baseRef: getOption(rest, '--base'),
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group')
        });
        const validation = await validateReportNarrative(repoRoot, parsed, fingerprint, { expectedStoryId: storyId });
        if (!validation.ok) {
          write(stdout, `${JSON.stringify({ ok: false, errors: validation.errors, warnings: validation.warnings }, null, 2)}\n`);
          return { exitCode: 2, command, subcommand, validation };
        }
        const previousNarrative = await readNarrative(repoRoot, storyId, kind);
        const seeded = {
          ...parsed,
          schema_version: '0.1.0',
          story_id: storyId,
          kind,
          generated_at: parsed.generated_at ?? new Date().toISOString(),
          generated_by: {
            caller,
            stage: parsed.generated_by?.stage ?? 'ai_synthesis'
          },
          previous_report_id: previousNarrative ? (previousNarrative.generated_at ?? null) : null,
          inputs_digest: parsed.inputs_digest ?? fingerprint.inputs_digest
        };
        const stabilized = stabilizeTalkingPointIds(seeded, previousNarrative);
        await writeNarrative(repoRoot, storyId, kind, stabilized);
        write(stdout, `${JSON.stringify({ ok: true, story_id: storyId, kind, slots: stabilized.narrative_slots.length, warnings: validation.warnings }, null, 2)}\n`);
        return { exitCode: 0, command, subcommand, narrative: stabilized };
      }

      if (subcommand === 'show') {
        const narrative = await readNarrative(repoRoot, storyId, kind);
        if (!narrative) {
          write(stdout, `${JSON.stringify({ story_id: storyId, kind, found: false }, null, 2)}\n`);
          return { exitCode: 0, command, subcommand, narrative: null };
        }
        write(stdout, `${JSON.stringify(narrative, null, 2)}\n`);
        return { exitCode: 0, command, subcommand, narrative };
      }

      write(stderr, `Unknown report command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    write(stderr, `Unknown command: ${command}\n\n${renderHelp()}`);
    return { exitCode: 1, command };
  } catch (error) {
    write(stderr, `${error.message}\n`);
    return { exitCode: 1, command };
  }
}

function getOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function renderHelp(language = null) {
  return normalizeOutputLanguage(language) === 'en' ? HELP_EN : HELP_JA;
}

function renderCheckpointList(result) {
  return [
    '# VibePro Checkpoints',
    '',
    ...result.checkpoints.flatMap((checkpoint) => [
      `- ${checkpoint.stage}: ${checkpoint.label}`,
      `  ${checkpoint.description}`
    ]),
    ''
  ].join('\n');
}

function renderInitSummary({ language, workspaceDir, repoRoot, baseBranch }) {
  const prPrepareCommand = `vibepro pr prepare ${shellPath(repoRoot)} --base ${baseBranch ?? '<base-branch>'}`;
  return localizedText(language, {
    ja: [
      `VibePro workspaceを初期化しました: ${workspaceDir}`,
      '',
      '.vibepro/ は診断・Story・PR gate・レビュー証跡を保存する作業台です。アプリ本体の実装とは分けて扱います。',
      `人間向け出力言語: ${language}`,
      `base branch候補: ${baseBranch ?? '未検出。origin/main, origin/develop, main, develop など実リポジトリの既定branchを指定してください。'}`,
      '',
      '次にやること:',
      '1. README全体を読む前に、まず `vibepro help` の「基本コマンド」を確認する',
      `2. PR前の道標を作る: ${prPrepareCommand} --story-id <story-id>`,
      '3. 生成された `.vibepro/pr/<story-id>/review-cockpit.html` と `pr-body.md` を見る',
      '4. AIエージェントには `pr-body.md`, `gate-dag.html`, `split-plan.html` を渡す',
      ''
    ].join('\n'),
    en: [
      `VibePro workspace initialized: ${workspaceDir}`,
      '',
      '.vibepro/ is the workspace for diagnosis, Story, PR gate, and review evidence. It is separate from application source changes.',
      `Human output language: ${language}`,
      `Base branch candidate: ${baseBranch ?? 'not detected. Use the repository default such as origin/main, origin/develop, main, or develop.'}`,
      '',
      'Next steps:',
      '1. Start with `vibepro help` before reading the full README.',
      `2. Create the PR guide: ${prPrepareCommand} --story-id <story-id>`,
      '3. Open `.vibepro/pr/<story-id>/review-cockpit.html` and `pr-body.md`.',
      '4. Hand `pr-body.md`, `gate-dag.html`, and `split-plan.html` to the coding agent.',
      ''
    ].join('\n')
  });
}

async function detectBaseBranch(repoRoot) {
  const root = path.resolve(repoRoot);
  const originHead = await gitOptional(root, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead) return originHead.replace(/^origin\//, 'origin/');
  for (const ref of ['origin/main', 'origin/develop', 'main', 'develop', 'master']) {
    if (await gitRefExists(root, ref)) return ref;
  }
  return null;
}

async function readConfiguredOutputLanguage(repoRoot, fallback = null) {
  try {
    const config = JSON.parse(await readFile(path.join(repoRoot, '.vibepro', 'config.json'), 'utf8'));
    return normalizeOutputLanguage(config?.output?.language ?? fallback);
  } catch {
    return normalizeOutputLanguage(fallback);
  }
}

async function gitRefExists(repoRoot, ref) {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: repoRoot, encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
}

async function gitOptional(repoRoot, args) {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: repoRoot, encoding: 'utf8' });
    return stdout.trim();
  } catch {
    return '';
  }
}

function shellPath(filePath) {
  if (!filePath || filePath === process.cwd()) return '.';
  return /\s/.test(filePath) ? JSON.stringify(filePath) : filePath;
}

function getOptions(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function parseCsvOption(args, name) {
  const value = getOption(args, name);
  if (!value) return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseDesignRoutes(args) {
  return [
    ...parseCsvOption(args, '--routes'),
    ...getOptions(args, '--route')
  ].filter(Boolean);
}

function parseNumberOption(args, name) {
  const value = getOption(args, name);
  if (value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number`);
  return number;
}

function renderPrPrepareProgressEvent(event) {
  const stage = event.stage ?? 'unknown';
  if (event.event === 'stage_start') {
    return event.timeout_ms
      ? `[vibepro pr prepare] start ${stage} timeout_ms=${event.timeout_ms}`
      : `[vibepro pr prepare] start ${stage} timeout_ms=disabled`;
  }
  if (event.event === 'stage_complete') {
    return `[vibepro pr prepare] done ${stage} duration_ms=${event.duration_ms}`;
  }
  if (event.event === 'stage_timeout') {
    return `[vibepro pr prepare] timeout ${stage} duration_ms=${event.duration_ms}: ${event.error}`;
  }
  if (event.event === 'stage_failed') {
    return `[vibepro pr prepare] failed ${stage} duration_ms=${event.duration_ms}: ${event.error}`;
  }
  return `[vibepro pr prepare] ${event.event ?? 'progress'} ${stage}`;
}

function buildStartupOptions(args) {
  const scripts = getOptions(args, '--startup-script');
  const readyPattern = getOption(args, '--ready-pattern');
  const timeoutMs = parseNumberOption(args, '--startup-timeout') ?? 30000;
  return scripts.map((script) => ({
    id: `startup:${script}`,
    script,
    readyPattern,
    timeoutMs
  }));
}

function write(stream, text) {
  if (stream) stream.write(text);
}

async function readStdin(stream) {
  if (!stream || stream.isTTY) return '';
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readPackageVersion() {
  try {
    const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
