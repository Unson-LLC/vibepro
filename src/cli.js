import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { getWorkspaceDir, initWorkspace } from './workspace.js';
import { hydrateProcessRecords, processRecordStoreStatus, snapshotProcessRecords, snapshotProcessRecordsFailSoft } from './process-record-store.js';
import { checkGuard, guardStatus, installGuard, parsePrePushRefs, parsePreToolUseInput, readGuardConfig, uninstallGuard } from './guard.js';
import { installCodexInstructions, renderCodexInstall, renderCodexVerify, verifyCodexInstructions } from './codex-manager.js';
import { generateAgentHarnessMap, renderAgentHarnessMapSummary } from './agent-harness-map.js';
import { renderAgentHarnessStatus, scanAgentHarness } from './agent-harness-scanner.js';
import { importGraphifyArtifacts } from './graphify-adapter.js';
import { runDiagnosis } from './diagnostic-engine.js';
import { ArtifactRoutingError, buildArtifactMigrationPlan, resolveArtifactRoute, resolveArtifactRoutes } from './artifact-routing.js';
import { deriveEnvironmentGraph, renderEnvironmentGraphSummary } from './environment-graph.js';
import { assertOutputLanguage, localizedText, normalizeOutputLanguage, resolveHumanOutputLanguage, setOutputLanguage } from './language.js';
import { renderDoctor, runDoctor } from './doctor.js';
import { collectRuntimeInfo } from './runtime-info.js';
import {
  recordSessionLearning,
  renderSessionLearningRecordSummary,
  renderSessionLearningsReviewSummary,
  reviewSessionLearnings
} from './session-learning.js';
import { createBrainbaseImport } from './brainbase-importer.js';
import { publishStatusToNocoDB, syncStoriesFromNocoDB } from './nocodb-story-sync.js';
import { getRepoStatus, renderRepoStatus } from './repo-status.js';
import { collectWorkspaceStatus, renderWorkspaceStatus } from './workspace-status.js';
import {
  getAgentReviewStatus,
  prepareAgentReview,
  recordAgentReview,
  renderAgentReviewPrepareSummary,
  renderAgentReviewRecordSummary,
  renderAgentReviewStatusSummary,
  renderReviewSurfaceViolationSummary,
  readReviewSurfaceViolationSummary
} from './agent-review.js';
import {
  assertManagedWorktreeCommandAllowed,
  buildManagedWorktreeCommandBinding,
  buildManagedWorktreeCommandWarning,
  evaluateManagedWorktreeCommandContext
} from './managed-worktree.js';
import {
  createPullRequest,
  preparePullRequest,
  renderPrCreateSummary,
  renderPrPrepareSummary
} from './pr-manager.js';
import { recordVerificationEvidence, renderVerificationEvidenceSummary } from './verification-evidence.js';
import { importCiEvidence, renderCiImportSummary } from './ci-evidence.js';
import { renderVerificationRunSummary, runVerificationCommand } from './verification-runner.js';
import { evaluateSeniorJudgmentRun, renderSeniorJudgmentSummary } from './senior-judgment-dag.js';
import {
  getDecisionStatus,
  readDecisionRecordsIfExists,
  recordDecision,
  renderDecisionRecordSummary,
  renderDecisionStatusSummary
} from './decision-records.js';
import { sanitizeDiagnostic } from './managed-command-executor.js';
import { buildSpecFingerprint } from './spec-fingerprint.js';
import { validateSpec } from './spec-validator.js';
import { buildSpecDrift, renderDriftMarkdown } from './spec-drift.js';
import {
  assertPreSpecReadinessForFinalSpec,
  recordPreSpecReadiness,
  renderPreSpecReadinessSummary
} from './pre-spec-readiness.js';
import {
  readInferredSpec,
  stabilizeClauseIds,
  writeDraftSpec,
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
  resolveStoryContext,
  selectStory
} from './story-manager.js';
import { backfillTraceability, declareTraceability, renderTraceabilityBackfill } from './traceability.js';
import {
  installBundledSkills,
  lintBundledSkills,
  listBundledSkills,
  renderSkillsInstall,
  renderSkillsLint,
  renderSkillsList,
  renderSkillsVerify,
  verifyBundledSkills
} from './skills-manager.js';

const execFileAsync = promisify(execFile);

const HELP_EN = `VibePro CLI

VibePro is a minimal CLI control plane for Story-driven AI development.
Per docs/management/REBUILD.md ("最小コアのスコープ"), it no longer carries a
Gate DAG, readiness/blocking evaluation, delivery-efficiency budgets, review
lifecycle accounting, or auto-generated audit artifacts. It stores Story,
Spec, verification, review, and PR evidence under .vibepro/ so humans and AI
agents can continue with reviewable context; it does not block PR creation.

Core model:
  Story defines user value and acceptance criteria.
  Spec defines concrete behavior and invariants, with code_refs/test_refs traceability.
  A lightweight review pass (role-based, no lifecycle accounting) records findings.
  PR prepare/create summarize Spec + verification + review evidence into a PR body.

Typical flow:
  vibepro init <repo> --story-id <id> --title <title> --language en
  vibepro story diagnose <repo> --id <id> --run-graphify
  vibepro spec write <repo> --id <id> --draft
  vibepro verify record <repo> --id <id> --kind unit --status pass --command "npm test"
  vibepro review prepare <repo> --id <id> --stage gate
  vibepro review record <repo> --id <id> --stage gate --role <role> --status pass --summary <text>
  vibepro pr prepare <repo> --base <base-branch> --story-id <id>
  vibepro pr create <repo> --base <base-branch> --head <branch> --story-id <id>

pr prepare writes .vibepro/pr/<story-id>/pr-prepare.json (Story + Spec presence +
recorded verification + recorded review, no Gate DAG) and a PR body markdown file.
pr create pushes the current branch and runs \`gh pr create\` (or refreshes an
existing open PR's body); it does not block on any gate.

Usage:
  vibepro help [command]
  vibepro version
  vibepro --version | -v
  vibepro init [repo] [--story-id <id> --title <title>] [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>] [--language ja|en]
  vibepro config language [repo] --language ja|en
  vibepro runtime identity [--json]
  vibepro doctor [repo] [--fix] [--json]
  vibepro status [repo] [--json]
  vibepro workspace status [repo] [--json]
  vibepro store snapshot [repo] --story-id <id> [--json]
  vibepro store hydrate [repo] --story-id <id> [--json]
  vibepro store status [repo] --story-id <id> [--json]
  vibepro skills list [--json]
  vibepro skills install [repo] [--dry-run] [--force] [--json]
  vibepro skills verify [repo] [--json]
  vibepro skills lint [repo] [--json]
  vibepro codex install [repo] [--dry-run] [--force] [--json]
  vibepro codex verify [repo] [--json]
  vibepro harness status [repo] [--json]
  vibepro harness map [repo] [--json]
  vibepro harness learn [repo] --summary <text> [--kind <kind>] [--source <source>] [--evidence <ref>] [--pattern <text>] [--skill-candidate <text>] [--target <surface>] [--json]
  vibepro harness review-learnings [repo] [--json]
  vibepro graph [repo] [--from <graphify-out>] [--run-graphify]
  vibepro env graph [repo] [--json] [--no-write]
  vibepro diagnose [repo] [--run-id <id>]
  vibepro verify run [repo] --id <story-id> --kind <unit|integration|e2e|typecheck|build> [--summary <text>] [--target <path>]... [--scenario <text>]... [--observed <key=value>]... [--timeout-ms <ms>] [--no-progress-deadline-ms <ms>] [--max-output-bytes <bytes>] [--strict-head-binding] [--json] -- <command> [args...]
  vibepro verify record [repo] --id <story-id> --kind <unit|integration|e2e|typecheck|build> --status <pass|fail|needs_setup> --command <cmd> [--summary <text>] [--artifact <path>] [--target <path>]... [--scenario <text>]... [--observed <key=value>]... [--strict-head-binding] [--json]
  vibepro verify import-ci [repo] --id <story-id> [--pr <number>] [--check <name>=<kind>]... [--coverage <check>=<command>::<test-fingerprint>]... [--json]
  vibepro decision record [repo] --id <story-id> --type <needs_review|noise|waiver|secret_exposure|intake_not_applicable> --summary <text> [--source <gate-or-finding-id>] [--source-status <status>] [--reason <text>] [--artifact <path>] [--reviewer <name>] [--status <open|accepted|rejected|superseded>] [--secret-location <ref> --secret-action <redacted|rotated|revoked|false_positive>] [--from-stdin] [--json]
  vibepro decision status [repo] --id <story-id> [--json]
  vibepro judgment evaluate [repo] --id <story-id> --input <input.json> [--json]
  vibepro guard check [repo] [--command <cmd>] [--pre-push <remote>] [--pretooluse] [--story-id <id>] [--json]
  vibepro guard install [repo] [--claude] [--json]
  vibepro guard status [repo] [--json]
  vibepro guard uninstall [repo]
  vibepro review prepare [repo] --id <story-id> --stage <stage> [--role <role>] [--roles <csv>] [--json]
  vibepro review violations [repo] --id <story-id> [--json]
  vibepro review record [repo] --id <story-id> --stage <stage> --role <role> --status <pass|needs_changes|block> --summary <text> [--finding <severity:id:detail>] [--finding-disposition <finding-id:accepted|rejected|duplicate|deferred|false_positive[:reason]>] [--resolved-finding <finding-id:ref>] [--artifact <path>] [--from-stdin] [--agent-system codex|claude_code|human --execution-mode parallel_subagent|manual_review --agent-id <id>] [--agent-thread-id <id>] [--agent-session-id <id>] [--agent-call-id <id>] [--agent-model <name>] [--agent-reasoning-effort low|medium|high] [--agent-cost-tier low|medium|high] [--agent-input-tokens <n>] [--agent-output-tokens <n>] [--agent-total-tokens <n>] [--agent-cost-usd <n>] [--agent-transcript <path>] [--agent-closed] [--agent-close-evidence <ref>] [--reviewer-identity same_session|separate_session|unknown] [--implementation-session-id <id>] [--inspection-summary <text>] [--inspection-evidence <ref>] [--inspection-input <ref>] [--judgment-delta <text>] [--strict-head-binding --strict-head-reason <text>] [--json]
  vibepro review status [repo] --id <story-id> [--stage <stage>] [--all] [--history] [--json]
  vibepro story list [repo] [--all]
  vibepro story add [repo] --id <id> --title <title> [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>]
  vibepro story select [repo] --id <id>
  vibepro story archive [repo] --id <id>
  vibepro story runs [repo] [--id <id>]
  vibepro story status [repo] [--id <id>]
  vibepro story report [repo] [--id <id>]
  vibepro story diagnose [repo] --id <id> [--run-graphify] [--run-id <id>] [--phase design-input|pre-implementation] [--pre-architecture]
  vibepro story derive [repo] [--from-run <run-id>] [--run-graphify] [--from <graphify-out>] [--preset <id>] [--json]
  vibepro story map [repo] [--json]
  vibepro story plan [repo] [--limit <n>] [--json]
  vibepro trace backfill [repo] [--story-id <id>] [--dry-run] [--json]
  vibepro trace declare [repo] --story-id <id> --lifecycle <declared_not_started|unknown> [--reason <text>] [--json]
  vibepro artifacts resolve [repo] --id <story-id> [--feature-slug <slug>] [--json]
  vibepro artifacts migrate [repo] --id <story-id> --dry-run [--feature-slug <slug>] [--json]
  vibepro pr prepare [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <ref>] [--branch <name>] [--language ja|en] [--json]
  vibepro pr create [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <branch>] [--title <title>] [--dry-run] [--language ja|en] [--json]
  vibepro brainbase [repo] [--sync-stories] [--publish-status] [--dry-run] [--story-id <id>]
  vibepro spec fingerprint [repo] --id <story-id> [--include-instructions] [--json]
  vibepro spec readiness [repo] --id <story-id> [--base <ref>] [--json]
  vibepro spec write [repo] --id <story-id> [--from-stdin] [--input <file>] [--caller <name>] [--draft|--final] [--json]
  vibepro spec show [repo] --id <story-id> [--clause <clause-id>] [--json]
  vibepro spec drift [repo] --id <story-id> [--against <git-ref>] [--json]
  vibepro report fingerprint [repo] --kind <kind> --id <story-id> [--base <ref>] [--task <id>] [--group <id>] [--include-instructions]
  vibepro report write [repo] --kind <kind> --id <story-id> [--from-stdin] [--input <file>] [--caller <name>]
  vibepro report show [repo] --kind <kind> --id <story-id>
`;

const HELP_JA = `VibePro CLI

VibeProは、Story起点のAI開発を進めるための最小CLI制御基盤です。
docs/management/REBUILD.md（「最小コアのスコープ」）に従い、Gate DAG・
readiness/blocking判定・delivery-efficiencyバジェット・review lifecycle会計・
audit artifactの自動生成は廃止しました。Story・Spec・検証証跡・レビュー証跡・
PR証跡を .vibepro/ に保存し、人間とAIエージェントが文脈を追える形にしますが、
PR作成をブロックする機構は持ちません。

まず人間が使う基本コマンド:
  vibepro init <repo> --language ja --story-id <id> --title <title>
      .vibepro/ を作り、出力言語とStoryを設定します。
  vibepro story diagnose <repo> --id <id> --run-graphify
      Storyの調査コンテキストを作ります。
  vibepro spec write <repo> --id <id> --draft
      code_refs/test_refsのトレーサビリティを持つSpecを書きます。
  vibepro verify record <repo> --id <id> --kind unit --status pass --command "npm test"
      現在のgit状態で実行した検証証跡を記録します。
  vibepro review prepare <repo> --id <id> --stage gate
      役割別レビュー依頼を作ります（lifecycle会計・予算・authorize儀式は無し）。
  vibepro review record <repo> --id <id> --stage gate --role <role> --status pass --summary <text>
      レビュー結果を記録します。
  vibepro pr prepare <repo> --base <base-branch> --story-id <id>
      Story + Spec有無 + 記録済み検証 + 記録済みレビューを要約し、
      .vibepro/pr/<story-id>/pr-prepare.json とPR本文を作ります。ブロックはしません。
  vibepro pr create <repo> --base <base-branch> --head <branch> --story-id <id>
      現在のブランチをpushし、gh pr create（または既存PRの本文更新）を実行します。

.vibepro/ の意味:
  Story・Spec・検証・レビュー・PR証跡を保存する作業台です。アプリ本体の実装とは分けて扱います。

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
  vibepro runtime identity [--json]
  vibepro doctor [repo] [--fix] [--json]
  vibepro status [repo] [--json]
  vibepro skills list [--json]
  vibepro skills install [repo] [--dry-run] [--force] [--json]
  vibepro skills verify [repo] [--json]
  vibepro skills lint [repo] [--json]
  vibepro codex install [repo] [--dry-run] [--force] [--json]
  vibepro codex verify [repo] [--json]
  vibepro harness status [repo] [--json]
  vibepro harness map [repo] [--json]
  vibepro harness learn [repo] --summary <text> [--kind <kind>] [--source <source>] [--evidence <ref>] [--pattern <text>] [--skill-candidate <text>] [--target <surface>] [--json]
  vibepro harness review-learnings [repo] [--json]
  vibepro graph [repo] [--from <graphify-out>] [--run-graphify]
  vibepro env graph [repo] [--json] [--no-write]
  vibepro diagnose [repo] [--run-id <id>]
  vibepro verify run [repo] --id <story-id> --kind <unit|integration|e2e|typecheck|build> [--summary <text>] [--target <path>]... [--scenario <text>]... [--observed <key=value>]... [--timeout-ms <ms>] [--no-progress-deadline-ms <ms>] [--max-output-bytes <bytes>] [--strict-head-binding] [--json] -- <command> [args...]
  vibepro verify record [repo] --id <story-id> --kind <unit|integration|e2e|typecheck|build> --status <pass|fail|needs_setup> --command <cmd> [--summary <text>] [--artifact <path>] [--target <path>]... [--scenario <text>]... [--observed <key=value>]... [--strict-head-binding] [--json]
  vibepro verify import-ci [repo] --id <story-id> [--pr <number>] [--check <name>=<kind>]... [--coverage <check>=<command>::<test-fingerprint>]... [--json]
  vibepro decision record [repo] --id <story-id> --type <needs_review|noise|waiver|secret_exposure|intake_not_applicable> --summary <text> [--source <gate-or-finding-id>] [--source-status <status>] [--reason <text>] [--artifact <path>] [--reviewer <name>] [--status <open|accepted|rejected|superseded>] [--secret-location <ref> --secret-action <redacted|rotated|revoked|false_positive>] [--from-stdin] [--json]
  vibepro decision status [repo] --id <story-id> [--json]
  vibepro judgment evaluate [repo] --id <story-id> --input <input.json> [--json]
  vibepro guard check [repo] [--command <cmd>] [--pre-push <remote>] [--pretooluse] [--story-id <id>] [--json]
  vibepro guard install [repo] [--claude] [--json]
  vibepro guard status [repo] [--json]
  vibepro guard uninstall [repo]
  vibepro review prepare [repo] --id <story-id> --stage <stage> [--role <role>] [--roles <csv>] [--json]
  vibepro review violations [repo] --id <story-id> [--json]
  vibepro review record [repo] --id <story-id> --stage <stage> --role <role> --status <pass|needs_changes|block> --summary <text> [--finding <severity:id:detail>] [--finding-disposition <finding-id:accepted|rejected|duplicate|deferred|false_positive[:reason]>] [--resolved-finding <finding-id:ref>] [--artifact <path>] [--from-stdin] [--agent-system codex|claude_code|human --execution-mode parallel_subagent|manual_review --agent-id <id>] [--agent-thread-id <id>] [--agent-session-id <id>] [--agent-call-id <id>] [--agent-model <name>] [--agent-reasoning-effort low|medium|high] [--agent-cost-tier low|medium|high] [--agent-input-tokens <n>] [--agent-output-tokens <n>] [--agent-total-tokens <n>] [--agent-cost-usd <n>] [--agent-transcript <path>] [--agent-closed] [--agent-close-evidence <ref>] [--reviewer-identity same_session|separate_session|unknown] [--implementation-session-id <id>] [--inspection-summary <text>] [--inspection-evidence <ref>] [--inspection-input <ref>] [--judgment-delta <text>] [--strict-head-binding --strict-head-reason <text>] [--json]
  vibepro review status [repo] --id <story-id> [--stage <stage>] [--all] [--history] [--json]
  vibepro story diagnose [repo] --id <id> [--run-graphify] [--run-id <id>] [--phase design-input|pre-implementation] [--pre-architecture]
  vibepro story derive [repo] [--from-run <run-id>] [--run-graphify] [--from <graphify-out>] [--preset <id>] [--json]
  vibepro story map [repo] [--json]
  vibepro story plan [repo] [--limit <n>] [--json]
  vibepro trace backfill [repo] [--story-id <id>] [--dry-run] [--json]
  vibepro trace declare [repo] --story-id <id> --lifecycle <declared_not_started|unknown> [--reason <text>] [--json]
  vibepro pr prepare [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <ref>] [--branch <name>] [--language ja|en] [--json]
  vibepro pr create [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <branch>] [--title <title>] [--dry-run] [--language ja|en] [--json]
  vibepro brainbase [repo] [--sync-stories] [--publish-status] [--dry-run] [--story-id <id>]
  vibepro spec fingerprint [repo] --id <story-id> [--include-instructions] [--json]
  vibepro spec readiness [repo] --id <story-id> [--base <ref>] [--json]
  vibepro spec write [repo] --id <story-id> [--from-stdin] [--input <file>] [--caller <name>] [--draft|--final] [--json]
  vibepro spec show [repo] --id <story-id> [--clause <clause-id>] [--json]
  vibepro spec drift [repo] --id <story-id> [--against <git-ref>] [--json]
`;

// Canonical set of top-level commands. Exported so the CLI smoke-test layer can
// assert every command is exercised end-to-end — a missing/broken handler import
// must fail a test before merge, not at runtime (the bug class behind #117/#118).
export const TOP_LEVEL_COMMANDS = [
  'version', 'help', 'init', 'config', 'runtime', 'doctor', 'status', 'graph', 'env',
  'harness', 'skills', 'codex', 'brainbase', 'pr', 'story', 'trace',
  'decision', 'judgment', 'verify', 'review', 'guard', 'spec', 'report',
  'workspace', 'store'
];

// Commands whose success produces durable process records (reviews, verify
// evidence, adjudications, spec, decisions, gate outcomes). After each one,
// records are mirrored to the worktree-independent store so a worktree
// deletion/regeneration can no longer erase them (2026-07-30 incidents).
const AUTO_SNAPSHOT_SUBCOMMANDS = {
  verify: ['run', 'record', 'import-ci'],
  review: ['record'],
  spec: ['write'],
  pr: ['prepare'],
  decision: ['record']
};

async function maybeAutoSnapshotProcessRecords(argv, result, io) {
  const [command, ...rest] = argv;
  const prefixes = AUTO_SNAPSHOT_SUBCOMMANDS[command];
  if (!prefixes || result?.exitCode !== 0) return;
  const subcommand = typeof result.subcommand === 'string' ? result.subcommand : rest[0];
  if (!prefixes.some((prefix) => subcommand === prefix || String(subcommand ?? '').startsWith(`${prefix}-`))) return;
  const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
  const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');
  if (!storyId) return;
  await snapshotProcessRecordsFailSoft({
    repoRoot,
    storyId,
    logger: { warn: (message) => write(io.stderr ?? null, `${message}\n`) }
  });
}

export async function runCli(argv, io = {}) {
  const result = await dispatchCli(argv, io);
  await maybeAutoSnapshotProcessRecords(argv, result, io);
  return result;
}

async function dispatchCli(argv, io = {}) {
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
      if (hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        const language = getOption(rest, '--language');
        write(stdout, renderHelp(language));
        return { exitCode: 0, command: 'help' };
      }
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
      if (subcommand === 'lint') {
        const result = await lintBundledSkills(repoRoot);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderSkillsLint(result));
        return { exitCode: result.overall_status === 'pass' ? 0 : 1, command, subcommand, result };
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
        storyId: getOption(rest, '--id') ?? 'story-default',
        sourceDir,
        runGraphify: hasFlag(rest, '--run-graphify'),
        env: io.env
      });
      write(stdout, `graphify artifacts imported: ${result.graphifyDir}\n`);
      return { exitCode: 0, command, result };
    }

    if (command === 'env') {
      const subcommand = rest[0];
      const repoRoot = rest[1] ?? process.cwd();
      if (subcommand === 'graph') {
        const graph = await deriveEnvironmentGraph(repoRoot, { write: !hasFlag(rest, '--no-write') });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(graph, null, 2)}\n`
          : renderEnvironmentGraphSummary(graph));
        return { exitCode: 0, command, subcommand, result: graph };
      }
      write(stderr, `Unknown env command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'runtime') {
      const subcommand = rest[0];
      if (subcommand !== 'identity') {
        write(stderr, `Unknown runtime command: ${subcommand ?? ''}\n\n${renderHelp()}`);
        return { exitCode: 1, command, subcommand };
      }
      const runtimeIdentity = await collectRuntimeInfo({ env: io.env, purpose: 'observation' });
      write(stdout, hasFlag(rest, '--json')
        ? `${JSON.stringify(runtimeIdentity, null, 2)}\n`
        : `${runtimeIdentity.package.name}@${runtimeIdentity.package.exact_version} ${runtimeIdentity.identity_digest} ${runtimeIdentity.integrity.status}\n`);
      return {
        exitCode: runtimeIdentity.integrity.status === 'trusted' ? 0 : 2,
        command,
        subcommand,
        result: runtimeIdentity
      };
    }

    if (command === 'doctor') {
      const repoRoot = rest[0] && !rest[0].startsWith('--') ? rest[0] : process.cwd();
      const result = await runDoctor(repoRoot, { fix: hasFlag(rest, '--fix'), env: io.env });
      write(stdout, hasFlag(rest, '--json')
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderDoctor(result));
      return { exitCode: result.runtime_identity?.integrity?.status === 'trusted' ? 0 : 2, command, result };
    }

    if (command === 'status') {
      const repoRoot = rest[0] && !rest[0].startsWith('--') ? rest[0] : process.cwd();
      const status = await getRepoStatus(repoRoot);
      write(stdout, hasFlag(rest, '--json')
        ? `${JSON.stringify(status, null, 2)}\n`
        : renderRepoStatus(status));
      return { exitCode: 0, command, status };
    }

    if (command === 'workspace') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (subcommand === 'status') {
        const result = await collectWorkspaceStatus(repoRoot);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderWorkspaceStatus(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown workspace command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command, subcommand };
    }

    if (command === 'store') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');
      const handlers = {
        snapshot: snapshotProcessRecords,
        hydrate: hydrateProcessRecords,
        status: processRecordStoreStatus
      };
      const handler = handlers[subcommand];
      if (!handler) {
        write(stderr, `Unknown store command: ${subcommand}\n\n${renderHelp()}`);
        return { exitCode: 1, command, subcommand };
      }
      const result = await handler({ repoRoot, storyId });
      write(stdout, hasFlag(rest, '--json')
        ? `${JSON.stringify(result, null, 2)}\n`
        : renderProcessRecordStoreResult(subcommand, result));
      return { exitCode: result.status === 'failed' ? 1 : 0, command, subcommand, result };
    }

    if (command === 'diagnose') {
      const repoRoot = rest[0] ?? process.cwd();
      const runId = getOption(rest, '--run-id');
      const language = await resolveHumanOutputLanguage(repoRoot, { language: getOption(rest, '--language') });
      const result = await runDiagnosis(repoRoot, {
        runId,
        language,
        phase: resolveDiagnosisPhaseOption(rest)
      });
      write(stdout, localizedText(language, {
        ja: `診断を作成しました: ${result.runDir}\n`,
        en: `diagnosis created: ${result.runDir}\n`
      }));
      return { exitCode: 0, command, result };
    }

    if (command === 'verify') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      // `verify run` takes the command to execute after `--`; option lookups (including the
      // help probe) must never reach into that argv or a `--help` in the executed command
      // would hijack the CLI.
      const separatorIndex = rest.indexOf('--');
      const verifyArgs = separatorIndex === -1 ? rest : rest.slice(0, separatorIndex);
      const runArgv = separatorIndex === -1 ? [] : rest.slice(separatorIndex + 1);
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(verifyArgs, '--help') || hasFlag(verifyArgs, '-h')) {
        write(stdout, renderHelp(getOption(verifyArgs, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'run') {
        const storyId = getOption(verifyArgs, '--id') ?? getOption(verifyArgs, '--story-id');
        const managedWorktreeContext = await assertManagedWorktreeCommandAllowed(repoRoot, {
          storyId,
          commandName: 'verify run'
        });
        const result = await runVerificationCommand(repoRoot, {
          storyId,
          kind: getOption(verifyArgs, '--kind'),
          status: getOption(verifyArgs, '--status'),
          summary: getOption(verifyArgs, '--summary'),
          targets: getOptions(verifyArgs, '--target'),
          scenarios: getOptions(verifyArgs, '--scenario'),
          observed: getOptions(verifyArgs, '--observed'),
          timeoutMs: getOption(verifyArgs, '--timeout-ms'),
          noProgressDeadlineMs: getOption(verifyArgs, '--no-progress-deadline-ms'),
          maxOutputBytes: getOption(verifyArgs, '--max-output-bytes'),
          strictHeadBinding: hasFlag(verifyArgs, '--strict-head-binding'),
          argv: runArgv,
          env: io.env,
          managedWorktreeContext: buildManagedWorktreeCommandBinding(managedWorktreeContext),
          managedWorktreeWarning: buildManagedWorktreeCommandWarning(managedWorktreeContext)
        });
        write(stdout, hasFlag(verifyArgs, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderVerificationRunSummary(result));
        return { exitCode: result.status === 'pass' ? 0 : 1, command, subcommand, result };
      }
      if (subcommand === 'record') {
        const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');
        const managedWorktreeContext = await assertManagedWorktreeCommandAllowed(repoRoot, {
          storyId,
          commandName: 'verify record'
        });
        const result = await recordVerificationEvidence(repoRoot, {
          storyId,
          kind: getOption(rest, '--kind'),
          status: getOption(rest, '--status'),
          command: getOption(rest, '--command'),
          summary: getOption(rest, '--summary'),
          artifact: getOption(rest, '--artifact'),
          targets: getOptions(rest, '--target'),
          scenarios: getOptions(rest, '--scenario'),
          observed: getOptions(rest, '--observed'),
          strictHeadBinding: hasFlag(rest, '--strict-head-binding'),
          env: io.env,
          managedWorktreeContext: buildManagedWorktreeCommandBinding(managedWorktreeContext),
          managedWorktreeWarning: buildManagedWorktreeCommandWarning(managedWorktreeContext)
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.evidence, null, 2)}\n`
          : renderVerificationEvidenceSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'import-ci') {
        const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');
        const managedWorktreeContext = await assertManagedWorktreeCommandAllowed(repoRoot, {
          storyId,
          commandName: 'verify import-ci'
        });
        const result = await importCiEvidence(repoRoot, {
          storyId,
          pr: getOption(rest, '--pr'),
          checks: getOptions(rest, '--check'),
          coverage: getOptions(rest, '--coverage'),
          env: io.env,
          managedWorktreeContext: buildManagedWorktreeCommandBinding(managedWorktreeContext),
          managedWorktreeWarning: buildManagedWorktreeCommandWarning(managedWorktreeContext)
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderCiImportSummary(result));
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
        const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');
        await assertManagedWorktreeCommandAllowed(repoRoot, {
          storyId,
          commandName: 'review prepare'
        });
        const result = await prepareAgentReview(repoRoot, {
          storyId,
          stage: getOption(rest, '--stage'),
          roles: [
            ...getOptions(rest, '--role'),
            ...parseCsvOption(rest, '--roles')
          ],
          language: getOption(rest, '--language')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentReviewPrepareSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'record') {
        const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');
        const managedWorktreeContext = await assertManagedWorktreeCommandAllowed(repoRoot, {
          storyId,
          commandName: 'review record'
        });
        const inputPath = getOption(rest, '--input');
        const stdinText = hasFlag(rest, '--from-stdin')
          ? inputPath
            ? await readFile(path.resolve(inputPath), 'utf8')
            : await readStdin(io.stdin ?? process.stdin)
          : '';
        const result = await recordAgentReview(repoRoot, {
          storyId,
          stage: getOption(rest, '--stage'),
          role: getOption(rest, '--role'),
          status: getOption(rest, '--status'),
          summary: getOption(rest, '--summary'),
          findings: getOptions(rest, '--finding'),
          findingDispositions: getOptions(rest, '--finding-disposition'),
          resolvedFindings: getOptions(rest, '--resolved-finding'),
          artifacts: getOptions(rest, '--artifact'),
          agentSystem: getOption(rest, '--agent-system') ?? getOption(rest, '--reviewer-system'),
          executionMode: getOption(rest, '--execution-mode'),
          agentId: getOption(rest, '--agent-id'),
          agentRole: getOption(rest, '--agent-role'),
          agentThreadId: getOption(rest, '--agent-thread-id'),
          agentSessionId: getOption(rest, '--agent-session-id'),
          agentCallId: getOption(rest, '--agent-call-id') ?? getOption(rest, '--agent-tool-call-id'),
          agentModel: getOption(rest, '--agent-model'),
          agentReasoningEffort: getOption(rest, '--agent-reasoning-effort'),
          agentCostTier: getOption(rest, '--agent-cost-tier'),
          agentInputTokens: getOption(rest, '--agent-input-tokens'),
          agentOutputTokens: getOption(rest, '--agent-output-tokens'),
          agentTotalTokens: getOption(rest, '--agent-total-tokens'),
          agentCostUsd: getOption(rest, '--agent-cost-usd'),
          agentTranscript: getOption(rest, '--agent-transcript'),
          agentRequest: getOption(rest, '--agent-request'),
          agentClosed: hasFlag(rest, '--agent-closed') || hasFlag(rest, '--subagent-closed'),
          agentCloseEvidence: getOption(rest, '--agent-close-evidence') ?? getOption(rest, '--subagent-close-evidence'),
          agentCloseNote: getOption(rest, '--agent-close-note') ?? getOption(rest, '--subagent-close-note'),
          reviewerIdentity: getOption(rest, '--reviewer-identity'),
          implementationSessionId: getOption(rest, '--implementation-session-id'),
          inspectionSummary: getOption(rest, '--inspection-summary'),
          inspectionEvidence: getOption(rest, '--inspection-evidence'),
          inspectionInputs: getOptions(rest, '--inspection-input'),
          judgmentDeltas: getOptions(rest, '--judgment-delta'),
          strictHeadBinding: hasFlag(rest, '--strict-head-binding'),
          strictHeadReason: getOption(rest, '--strict-head-reason'),
          recordedBy: getOption(rest, '--recorded-by'),
          stdinText,
          managedWorktreeContext: buildManagedWorktreeCommandBinding(managedWorktreeContext),
          managedWorktreeWarning: buildManagedWorktreeCommandWarning(managedWorktreeContext)
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentReviewRecordSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'status') {
        const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');
        const managedWorktreeContext = await evaluateManagedWorktreeCommandContext(repoRoot, {
          storyId,
          commandName: 'review status'
        });
        const result = await getAgentReviewStatus(repoRoot, {
          storyId,
          stage: getOption(rest, '--stage'),
          all: hasFlag(rest, '--all'),
          history: hasFlag(rest, '--history')
        });
        void managedWorktreeContext;
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentReviewStatusSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'violations') {
        const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');
        const result = await readReviewSurfaceViolationSummary(repoRoot, storyId, {
          decisionRecords: await readDecisionRecordsIfExists(repoRoot, storyId)
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderReviewSurfaceViolationSummary(result));
        return { exitCode: result.unacknowledged_count > 0 ? 2 : 0, command, subcommand, result };
      }
      write(stderr, `Unknown review command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'judgment') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'evaluate') {
        const result = await evaluateSeniorJudgmentRun(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          inputPath: getOption(rest, '--input')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderSeniorJudgmentSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown judgment command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command };
    }

    if (command === 'guard') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'check') {
        const bypassReason = process.env.VIBEPRO_GUARD_BYPASS ?? '';
        if (hasFlag(rest, '--pretooluse')) {
          const rawStdin = await readStdin(io.stdin ?? process.stdin);
          const toolCommand = parsePreToolUseInput(rawStdin);
          const result = await checkGuard(repoRoot, { command: toolCommand, bypassReason });
          if (result.decision === 'block') {
            write(stderr, `${result.reason}\n${(result.next_commands ?? []).map((cmd) => `- ${cmd}`).join('\n')}\n`);
            return { exitCode: 2, command, subcommand, result };
          }
          return { exitCode: 0, command, subcommand, result };
        }
        if (hasFlag(rest, '--pre-push')) {
          const prePushRemote = getOption(rest, '--pre-push');
          const config = await readGuardConfig(repoRoot);
          const rawStdin = await readStdin(io.stdin ?? process.stdin);
          const parsed = parsePrePushRefs(rawStdin, config.protected_branches);
          if (parsed.protected_refs.length === 0) {
            return { exitCode: 0, command, subcommand, result: { decision: 'allow', reason: 'no protected-branch refs in this push', ...parsed } };
          }
          const branch = parsed.protected_refs[0].remote_ref.replace('refs/heads/', '');
          const result = await checkGuard(repoRoot, { command: `git push ${prePushRemote || 'origin'} ${branch}`, bypassReason });
          if (result.decision === 'block') {
            write(stderr, `${result.reason}\n${(result.next_commands ?? []).map((cmd) => `- ${cmd}`).join('\n')}\n`);
            return { exitCode: 2, command, subcommand, result };
          }
          write(stdout, hasFlag(rest, '--json') ? `${JSON.stringify(result, null, 2)}\n` : `guard: ${result.decision} (${result.reason})\n`);
          return { exitCode: 0, command, subcommand, result };
        }
        const result = await checkGuard(repoRoot, {
          command: getOption(rest, '--command') ?? '',
          storyId: getOption(rest, '--story-id'),
          bypassReason
        });
        write(hasFlag(rest, '--json') ? stdout : (result.decision === 'block' ? stderr : stdout), hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : `guard: ${result.decision} (${result.reason})\n${result.decision === 'block' ? (result.next_commands ?? []).map((cmd) => `- ${cmd}`).join('\n') + '\n' : ''}`);
        return { exitCode: result.decision === 'block' ? 2 : 0, command, subcommand, result };
      }
      if (subcommand === 'install') {
        const result = await installGuard(repoRoot, { claude: hasFlag(rest, '--claude') });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : [
            result.hook ? `pre-push hook: ${result.hook.status} (${result.hook.path})` : null,
            result.claude ? `claude PreToolUse hook: ${result.claude.status} (${result.claude.path})` : null
          ].filter(Boolean).join('\n') + '\n');
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'uninstall') {
        const result = await uninstallGuard(repoRoot);
        write(stdout, `pre-push hook: ${result.status}\n`);
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'status') {
        const result = await guardStatus(repoRoot);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : [
            `enabled: ${result.enabled}`,
            `pre-push hook: ${result.pre_push_hook}`,
            `claude PreToolUse hook: ${result.claude_pretooluse_hook}`,
            `protected branches: ${result.protected_branches.join(', ')}`,
            `release patterns: ${result.release_pattern_count}`,
            `bypass records: ${result.bypass_count}`
          ].join('\n') + '\n');
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown guard command: ${subcommand ?? ''}\n\n${renderHelp()}`);
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
        const storyId = getOption(rest, '--id');
        const isManagedWorktreeWaiver = getOption(rest, '--type') === 'waiver'
          && getOption(rest, '--source') === 'gate:managed_worktree';
        const managedWorktreeContext = isManagedWorktreeWaiver
          ? await evaluateManagedWorktreeCommandContext(repoRoot, {
            storyId,
            commandName: 'decision record'
          })
          : await assertManagedWorktreeCommandAllowed(repoRoot, {
            storyId,
            commandName: 'decision record'
          });
        const result = await recordDecision(repoRoot, {
          storyId,
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
          stdinText: hasFlag(rest, '--from-stdin') ? await readStdin(io.stdin ?? process.stdin) : '',
          managedWorktreeWarning: buildManagedWorktreeCommandWarning(managedWorktreeContext)
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
          storyId: story.story_id,
          sourceDir: getOption(rest, '--from'),
          runGraphify: hasFlag(rest, '--run-graphify'),
          env: io.env
        });
        write(stdout, `graphify artifacts imported: ${graph.graphifyDir}\n`);
        const diagnosis = await runDiagnosis(repoRoot, {
          runId: getOption(rest, '--run-id'),
          phase: resolveDiagnosisPhaseOption(rest)
        });
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
          const explicitStoryId = getOption(rest, '--id');
          let deriveStoryId = explicitStoryId;
          if (!deriveStoryId) {
            const storyContext = await listStories(repoRoot, { includeArchived: false });
            deriveStoryId = storyContext.current_story_id ?? storyContext.stories[0]?.story_id ?? 'story-default';
            const graphifyRoute = await resolveArtifactRoute(repoRoot, 'graphify', { storyId: deriveStoryId });
            if (deriveStoryId === 'story-default' && /\{(?:story_id|feature_slug)\}/.test(graphifyRoute.canonical.template)) {
              throw new ArtifactRoutingError(
                'unstable_routing_context',
                'story derive requires --id when the Graphify canonical uses {story_id} or {feature_slug}',
                { kind: 'graphify', template: graphifyRoute.canonical.template }
              );
            }
          }
          graph = await importGraphifyArtifacts(repoRoot, {
            storyId: deriveStoryId,
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

    if (command === 'trace') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'backfill') {
        const result = await backfillTraceability(repoRoot, {
          storyId: getOption(rest, '--story-id') ?? getOption(rest, '--id'),
          dryRun: hasFlag(rest, '--dry-run')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderTraceabilityBackfill(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'declare') {
        const result = await declareTraceability(repoRoot, {
          storyId: getOption(rest, '--story-id') ?? getOption(rest, '--id'),
          lifecycle: getOption(rest, '--lifecycle'),
          reason: getOption(rest, '--reason')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : `Traceability declared: ${result.story_id} lifecycle=${result.lifecycle}\n`);
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown trace command: ${subcommand ?? ''}\n\n${renderHelp()}`);
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
        const storyId = getOption(rest, '--story-id') ?? await resolveSelectedStoryId(repoRoot, 'pr prepare');
        await assertManagedWorktreeCommandAllowed(repoRoot, {
          storyId,
          commandName: 'pr prepare'
        });
        const result = await preparePullRequest(repoRoot, {
          storyId,
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group'),
          baseRef: getOption(rest, '--base'),
          headRef: getOption(rest, '--head'),
          branchName: getOption(rest, '--branch'),
          language: getOption(rest, '--language'),
          env: io.env ?? process.env
        });
        write(stdout, jsonOutput
          ? `${JSON.stringify(result.preparation, null, 2)}\n`
          : renderPrPrepareSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'create') {
        const jsonOutput = hasFlag(rest, '--json');
        const storyId = getOption(rest, '--story-id') ?? await resolveSelectedStoryId(repoRoot, 'pr create');
        await assertManagedWorktreeCommandAllowed(repoRoot, {
          storyId,
          commandName: 'pr create'
        });
        const result = await createPullRequest(repoRoot, {
          storyId,
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group'),
          baseRef: getOption(rest, '--base'),
          prBase: getOption(rest, '--base'),
          headRef: getOption(rest, '--head-ref'),
          headBranch: getOption(rest, '--head'),
          branchName: getOption(rest, '--branch'),
          title: getOption(rest, '--title'),
          dryRun: hasFlag(rest, '--dry-run'),
          language: getOption(rest, '--language'),
          env: io.env
        });
        write(stdout, jsonOutput
          ? `${JSON.stringify(result.execution, null, 2)}\n`
          : renderPrCreateSummary(result));
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

    if (command === 'artifacts') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      const storyId = getOption(rest, '--id');
      if (!storyId) throw new Error('--id <story-id> is required for artifacts commands');
      const options = { storyId, featureSlug: getOption(rest, '--feature-slug') };
      if (subcommand === 'resolve') {
        const result = await resolveArtifactRoutes(repoRoot, options);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderArtifactRoutes(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'migrate') {
        if (!hasFlag(rest, '--dry-run')) {
          throw new Error('artifacts migrate currently requires --dry-run; tracked files are never moved implicitly');
        }
        const result = await buildArtifactMigrationPlan(repoRoot, options);
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderArtifactMigrationPlan(result));
        return { exitCode: result.status === 'blocked' ? 2 : 0, command, subcommand, result };
      }
      write(stderr, `Unknown artifacts command: ${subcommand ?? ''}\n\n${renderHelp()}`);
      return { exitCode: 1, command, subcommand };
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

      if (subcommand === 'readiness') {
        if (!storyId) throw new Error('--id <story-id> is required for spec readiness');
        const result = await recordPreSpecReadiness(repoRoot, {
          storyId,
          baseRef: getOption(rest, '--base'),
          headRef: getOption(rest, '--head'),
          branchName: getOption(rest, '--branch'),
          env: io.env
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.readiness, null, 2)}\n`
          : renderPreSpecReadinessSummary(result));
        return { exitCode: result.readiness.status === 'ready' ? 0 : 2, command, subcommand, result };
      }

      if (subcommand === 'write') {
        if (!storyId) throw new Error('--id <story-id> is required for spec write');
        const inputPath = getOption(rest, '--input');
        const fromStdin = hasFlag(rest, '--from-stdin') || !inputPath;
        const caller = getOption(rest, '--caller') ?? 'unknown';
        const draft = hasFlag(rest, '--draft');
        const final = hasFlag(rest, '--final') || !draft;
        if (draft && hasFlag(rest, '--final')) {
          throw new Error('spec write cannot use --draft and --final together');
        }
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
        const preSpecReadiness = final
          ? await assertPreSpecReadinessForFinalSpec(repoRoot, storyId)
          : null;
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
        const artifact = draft
          ? await writeDraftSpec(repoRoot, storyId, stabilized)
          : await writeInferredSpec(repoRoot, storyId, stabilized);
        write(stdout, `${JSON.stringify({
          ok: true,
          story_id: storyId,
          mode: draft ? 'draft' : 'final',
          clauses: stabilized.clauses.length,
          warnings: validation.warnings,
          pre_spec_readiness: preSpecReadiness ? {
            status: preSpecReadiness.status,
            created_at: preSpecReadiness.created_at,
            artifact: `.vibepro/spec/${storyId}/pre-spec-readiness.json`
          } : null,
          artifact
        }, null, 2)}\n`);
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
    if (hasFlag(argv, '--json')) {
      write(stderr, `${JSON.stringify(buildCliErrorPayload(error), null, 2)}\n`);
    } else {
      write(stderr, `${error.message}\n`);
    }
    return { exitCode: 1, command };
  }
}

function renderArtifactRoutes(result) {
  const lines = [`Artifact routes resolved for ${result.variables.story_id}:`, `Profile: ${result.profile ?? 'legacy'}; metadata source: ${result.metadata_source ?? 'derived'}`, `Variables: story_id=${result.variables.story_id}; feature_slug=${result.variables.feature_slug}`];
  for (const [kind, route] of Object.entries(result.routes ?? {})) {
    lines.push(`- ${kind}: ownership=${route.canonical.ownership ?? 'legacy'}; canonical=${route.canonical.relative_path}; canonical-writer=${route.canonical_writer ?? route.writer ?? 'owner'}; read-authority=${route.canonical.relative_path}`);
    for (const projection of route.projections ?? []) {
      lines.push(`  projection: ownership=${projection.ownership ?? (projection.generated ? 'generated' : 'legacy')}; path=${projection.relative_path}; renderer=${projection.renderer ? `${projection.renderer.id}@${projection.renderer.version}` : '-'}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderArtifactMigrationPlan(result) {
  const lines = [
    `Artifact migration plan for ${result.story_id}: ${result.status}`,
    `Profile: ${result.profile ?? 'legacy'}; feature_slug=${result.feature_slug ?? '-'}`,
    `Profile change: ${result.profile_change?.from ?? 'legacy'} -> ${result.profile_change?.to ?? result.profile ?? 'legacy'}; required=${result.profile_change?.required ? 'yes' : 'no'}; reason=${result.profile_change?.reason ?? '-'}`,
    `Dry run: ${result.dry_run ? 'yes' : 'no'}; edits performed: ${result.edits_performed}`
  ];
  for (const item of result.items ?? []) {
    lines.push(`- ${item.kind}: action=${item.action}; reason=${item.reason ?? '-'}; collision=${item.collision ? 'yes' : 'no'}; ownership=${item.ownership ?? 'legacy'}; canonical-writer=${item.canonical_writer ?? '-'}; renderer=${item.renderer ?? '-'}; route=${item.source ?? '-'} -> ${item.destination ?? '-'}`);
    for (const projection of item.projection_items ?? []) {
      lines.push(`  projection: action=${projection.action}; reason=${projection.reason ?? '-'}; ownership=${projection.ownership ?? 'legacy'}; renderer=${projection.renderer ?? '-'}; path=${projection.path}`);
    }
  }
  for (const unresolved of result.unresolved ?? []) {
    lines.push(`- blocked: ${unresolved.code}: ${unresolved.message}`);
  }
  for (const risk of result.overwrite_risks ?? []) {
    lines.push(`- overwrite-risk: ${risk.code}: ${risk.message}; path=${risk.path}`);
  }
  return `${lines.join('\n')}\n`;
}

export function buildCliErrorPayload(error) {
  return {
    ok: false,
    error: serializeCliError(error)
  };
}

function serializeCliError(error, seen = new Set()) {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
      code: null,
      cause: null,
      cause_details: null,
      restore_error: null,
      restore_errors: []
    };
  }
  if (seen.has(error)) {
    return {
      message: error.message,
      code: error.code ?? null,
      cause: '[circular error cause]',
      cause_details: null,
      restore_error: error.restore_error ?? null,
      restore_errors: error.restore_errors ?? []
    };
  }
  seen.add(error);
  const cause = error.cause instanceof Error ? error.cause : null;
  return {
    message: error.message,
    code: error.code ?? null,
    cause: cause?.message ?? null,
    cause_details: cause ? serializeCliError(cause, seen) : null,
    restore_error: error.restore_error ?? null,
    restore_errors: error.restore_errors ?? []
  };
}

export function serializeOutcomeCommandError(error) {
  return sanitizeOutcomeErrorValue(error.toJSON());
}

function sanitizeOutcomeErrorValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeOutcomeErrorValue);
  if (typeof value === 'string') return sanitizeDiagnostic(value, { maxBytes: 4096 });
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => ![
      'stdout', 'stderr', 'output', 'command', 'commands', 'args', 'env',
      'results', 'worktree_path', 'primary'
    ].includes(key))
    .map(([key, child]) => [key, sanitizeOutcomeErrorValue(child)]));
}

export function renderOutcomeCommandError(error) {
  const safeError = serializeOutcomeCommandError(error);
  const details = safeError;
  const sources = details.eligible_outcome_sources;
  const lines = [`${safeError.error_id}: ${safeError.message}`];
  if (details.ledger_path) lines.push(`ledger: ${details.ledger_path} digest=${details.ledger_digest ?? 'unknown'}`);
  if (Array.isArray(details.candidates)) {
    lines.push(`trace candidates: total=${details.candidate_count ?? details.candidates.length} returned=${details.candidates.length} omitted=${details.omitted_count ?? 0} truncated=${details.truncated === true}`);
    for (const candidate of details.candidates) {
      const selector = candidate.decision_trace_id
        ? `trace=${candidate.decision_trace_id}`
        : `collision-group=${candidate.collision_group} trace-source-ref=${candidate.trace_source_ref}`;
      lines.push(`- ${selector} parent-revision=${candidate.parent_revision_fingerprint}`);
    }
  }
  if (sources) {
    lines.push(`eligible sources: total=${sources.total_count ?? 0} returned=${sources.returned_count ?? sources.entries?.length ?? 0} omitted=${sources.omitted_count ?? 0} truncated=${sources.truncated === true}`);
    for (const source of sources.entries ?? []) lines.push(`- ${source.ref} (${source.kind}, digest=${source.digest})`);
  }
  if (details.verification_failure) lines.push(`authority verification: ${details.verification_failure}`);
  if (details.persistence) lines.push(...renderPersistenceFailure(details.persistence));
  if (details.ledger_postcondition) {
    lines.push(`ledger postcondition: status=${details.ledger_postcondition.status ?? 'unknown'} expected-digest=${details.ledger_postcondition.expected_digest ?? 'unknown'} observed-digest=${details.ledger_postcondition.observed_digest ?? 'unknown'}`);
  }
  if (details.reconciliation) {
    lines.push(`reconciliation: status=${details.reconciliation.status ?? 'unknown'} artifact-status=${details.reconciliation.artifact_status ?? 'unknown'} artifact=${details.reconciliation.artifact_path ?? 'unknown'}`);
  }
  if (details.original_error) {
    lines.push(`original failure: code=${details.original_error.code ?? 'unknown'} message=${details.original_error.message ?? 'unknown'}`);
    if (details.original_error.persistence) {
      lines.push(...renderPersistenceFailure(details.original_error.persistence)
        .map((line) => `original ${line}`));
    }
    if (details.original_error.ledger_postcondition) {
      lines.push(`original ledger postcondition: status=${details.original_error.ledger_postcondition.status ?? 'unknown'} expected-digest=${details.original_error.ledger_postcondition.expected_digest ?? 'unknown'} observed-digest=${details.original_error.ledger_postcondition.observed_digest ?? 'unknown'}`);
    }
    if (details.original_error.reconciliation) {
      lines.push(`original reconciliation: status=${details.original_error.reconciliation.status ?? 'unknown'} artifact-status=${details.original_error.reconciliation.artifact_status ?? 'unknown'} artifact=${details.original_error.reconciliation.artifact_path ?? 'unknown'}`);
    }
  }
  if (details.recovery) lines.push(`recovery: ${details.recovery}`);
  return `${lines.join('\n')}\n`;
}

export function renderOutcomeCommandResult(result, { subcommand } = {}) {
  const lines = [
    `outcome ${subcommand ?? 'command'}: ${result.status ?? 'completed'}`,
    `story: ${result.story_id ?? 'unknown'}`
  ];
  if (subcommand === 'record') {
    const selector = result.resolved_selector ?? {};
    if (selector.decision_trace_id) lines.push(`trace: ${selector.decision_trace_id}`);
    else if (selector.collision_group || selector.trace_source_ref) {
      lines.push(`trace: collision-group=${selector.collision_group ?? 'unknown'} source-ref=${selector.trace_source_ref ?? 'unknown'}`);
    }
    lines.push(`parent revision: ${result.parent_revision_fingerprint ?? 'unknown'}`);
    lines.push(`observation: ${result.artifact_path ?? 'unknown'} digest=${result.artifact_digest ?? 'unknown'}`);
    lines.push(`producer: ${result.producer ?? 'unknown'}`);
    if (result.resolved_source) {
      lines.push(`source: ${result.resolved_source.ref ?? 'unknown'} kind=${result.resolved_source.kind ?? 'unknown'} digest=${result.resolved_source.digest ?? 'unknown'}`);
    }
  } else if (subcommand === 'refresh') {
    lines.push(`ledger: ${result.ledger_path ?? 'unknown'} digest=${result.ledger_digest ?? 'unknown'}`);
    lines.push(`observations: ${result.observation_count ?? 0}`);
    lines.push(`canonical bundle: ${result.canonical_bundle ?? 'unknown'}`);
    if (result.persistence) {
      lines.push(`persistence: status=${result.persistence.status ?? 'unknown'} commit=${result.persistence.commit_sha ?? 'unknown'}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function renderPersistenceFailure(persistence) {
  const primary = persistence.primary ?? {};
  const failure = primary.failure ?? persistence.failure ?? {};
  const postcondition = persistence.push_postcondition ?? {};
  const cleanup = persistence.cleanup ?? {};
  const lines = [
    `persistence: status=${persistence.status ?? 'unknown'} reason=${persistence.reason ?? 'unknown'} pushed=${persistence.pushed === true}`
  ];
  if (persistence.primary) {
    lines.push(`primary failure: status=${primary.status ?? 'unknown'} reason=${primary.reason ?? 'unknown'} stage=${failure.stage ?? 'unknown'} command-status=${failure.status ?? 'unknown'} kind=${failure.failure_kind ?? 'unknown'}`);
  }
  lines.push(
    `push postcondition: status=${postcondition.status ?? 'not_checked'} remote-sha=${postcondition.remote_sha ?? 'unknown'}`,
    `cleanup: status=${cleanup.status ?? 'unknown'} attempted=${cleanup.attempted === true} removed=${cleanup.removed === true}`
  );
  lines.push(`recovery: ${persistenceRecoveryGuidance(persistence)}`);
  return lines;
}

function persistenceRecoveryGuidance(persistence) {
  const actions = [];
  const postcondition = persistence.push_postcondition?.status;
  const cleanup = persistence.cleanup ?? {};
  if (postcondition === 'indeterminate') actions.push('verify the remote branch before retrying');
  else if (persistence.pushed === true || postcondition === 'applied') actions.push('treat the canonical revision as applied and do not replay the push');
  else actions.push(`resolve ${persistence.primary?.reason ?? persistence.reason ?? 'the persistence failure'} and retry outcome refresh`);
  if (cleanup.attempted === true && cleanup.removed !== true) {
    actions.push('inspect and remove the temporary worktree if it remains');
  }
  return actions.join('; ');
}

function renderOutcomeHelp(subcommand = null, language = null) {
  const english = normalizeOutputLanguage(language) === 'en';
  if (subcommand === 'record') {
    return english
      ? `VibePro outcome record\n\nUsage:\n  vibepro outcome record [repo] --id <story-id> (--trace <id>|--collision-group <id> --trace-source-ref <ref>) --parent-revision <fingerprint> --status <observed|not_applicable> --producer <identity> [--source <managed-ref>] [--value-json <json>|--reason <text>] [--json]\n\nStatus inputs:\n  observed requires --value-json <json>.\n  not_applicable requires --reason <text>.\n\nFlow:\n  vibepro usage report . --json -> choose trace/collision, parent revision, and one eligible source -> vibepro outcome record -> vibepro outcome refresh\n`
      : `VibePro outcome record\n\n使い方:\n  vibepro outcome record [repo] --id <story-id> (--trace <id>|--collision-group <id> --trace-source-ref <ref>) --parent-revision <fingerprint> --status <observed|not_applicable> --producer <identity> [--source <managed-ref>] [--value-json <json>|--reason <text>] [--json]\n\nstatusごとの必須入力:\n  observed には --value-json <json> が必要です。\n  not_applicable には --reason <text> が必要です。\n\n操作フロー:\n  vibepro usage report . --json -> trace/collision、parent revision、eligible sourceを1つ選択 -> vibepro outcome record -> vibepro outcome refresh\n`;
  }
  if (subcommand === 'refresh') {
    return english
      ? `VibePro outcome refresh\n\nUsage:\n  vibepro outcome refresh [repo] --id <story-id> [--base <ref>] [--json]\n\nEffect:\n  Rebuilds the decision outcome ledger and persists a canonical revision after verified merge authority.\n\nOperator flow:\n  Inspect bounded selectors and the ledger digest with vibepro usage report . --json or vibepro pr prepare . --story-id <story-id> --view gate-evidence. Record an observation with vibepro outcome record, then run outcome refresh. Verify the routed pr-create.json, pr-merge.json, and decision-outcome-ledger.json artifacts when merge authority is rejected.\n\nResults:\n  promoted: a new canonical revision was pushed.\n  already_present: the canonical revision was already present.\n  reconciliation_required: verify the canonical revision and rerun this command.\n\nRecovery and rollback:\n  Follow the bounded recovery field on failure. Verify the remote postcondition before retrying; restore the reported recovery snapshot when rollback is incomplete.\n`
      : `VibePro outcome refresh\n\n使い方:\n  vibepro outcome refresh [repo] --id <story-id> [--base <ref>] [--json]\n\n作用:\n  検証済みmerge authorityに基づきdecision outcome ledgerを再構築し、canonical revisionを永続化します。\n\n操作フロー:\n  vibepro usage report . --json または vibepro pr prepare . --story-id <story-id> --view gate-evidence でbounded selectorとledger digestを確認し、vibepro outcome recordで観測を記録してからoutcome refreshを実行します。merge authorityが拒否された場合はrouted pr-create.json、pr-merge.json、decision-outcome-ledger.jsonを確認します。\n\n結果:\n  promoted: 新しいcanonical revisionをpushしました。\n  already_present: canonical revisionは既に存在します。\n  reconciliation_required: canonical revisionを確認して、このコマンドを再実行してください。\n\n復旧とrollback:\n  失敗時はboundedなrecovery欄に従います。再実行前にremote postconditionを確認し、rollback未完了時は表示されたrecovery snapshotから復元してください。\n`;
  }
  return english
    ? `VibePro Outcome\n\nCommands:\n  vibepro outcome record   Record a downstream outcome observation.\n  vibepro outcome refresh  Rebuild and persist the canonical outcome revision.\n\nRun a command with --help for its exact options.\n`
    : `VibePro Outcome\n\nコマンド:\n  vibepro outcome record   downstream outcome observationを記録します。\n  vibepro outcome refresh  canonical outcome revisionを再構築して永続化します。\n\n各コマンドの正確なオプションは --help で確認できます。\n`;
}

function resolveDiagnosisPhaseOption(args) {
  if (hasFlag(args, '--pre-architecture')) return 'design-input';
  return getOption(args, '--phase');
}

function getOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  return args[index + 1] ?? null;
}

function renderProcessRecordStoreResult(subcommand, result) {
  if (result.status === 'failed') {
    return `store ${subcommand} failed: ${result.reason}\n`;
  }
  const lines = [`store ${subcommand}: ${result.status}`, `store root: ${result.store_root}`];
  if (subcommand === 'status') {
    lines.push(
      `in sync: ${result.in_sync}`,
      `missing in store: ${result.missing_in_store}`,
      `missing in local: ${result.missing_in_local}`,
      `stale in store: ${result.stale_in_store}`,
      `stale in local: ${result.stale_in_local}`,
      `conflicts: ${result.conflicts}`
    );
  } else {
    lines.push(`copied: ${result.copied.length}`, `merged: ${result.merged.length}`, `conflicts: ${result.conflicts.length}`, `skipped (newer destination): ${result.skipped_newer_destination.length}`);
  }
  return `${lines.join('\n')}\n`;
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

function renderGateCheckSummary(result, { ciMode = false } = {}) {
  if (result.status === 'error') {
    return `# VibePro Gate Check\n\n- status: error\n- error: ${result.error}\n`;
  }
  const lines = [
    '# VibePro Gate Check',
    '',
    `- story: ${result.story_id ?? '-'}`,
    `- status: ${result.status}`,
    `- overall_status: ${result.overall_status}`,
    `- ready_for_pr_create: ${result.ready_for_pr_create ? 'yes' : 'no'}`,
    `- unresolved gates: ${result.unresolved_gate_count ?? 0}`,
    `- critical unresolved gates: ${result.critical_unresolved_gate_count ?? 0}`,
    ''
  ];
  if (!ciMode) {
    lines.splice(2, 0, '- note: run with --ci for the CI-blessed invocation (same evaluation, exit-code contract intended for CI enforcement)');
  }
  if ((result.unresolved_gates ?? []).length > 0) {
    lines.push('## Blocking Gates', '');
    for (const gate of result.unresolved_gates) {
      lines.push(`- ${gate.id}: ${gate.status} - ${gate.reason ?? 'unresolved'}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

function renderInitSummary({ language, workspaceDir, repoRoot, baseBranch }) {
  const base = baseBranch ?? '<base-branch>';
  const storyDiagnoseCommand = `vibepro story diagnose ${shellPath(repoRoot)} --id <story-id> --run-graphify`;
  const verifyRecordCommand = `vibepro verify record ${shellPath(repoRoot)} --id <story-id> --kind unit --status pass --command "npm test"`;
  const reviewPrepareCommand = `vibepro review prepare ${shellPath(repoRoot)} --id <story-id> --stage gate`;
  const prPrepareCommand = `vibepro pr prepare ${shellPath(repoRoot)} --base ${base}`;
  return localizedText(language, {
    ja: [
      `VibePro workspaceを初期化しました: ${workspaceDir}`,
      '',
      '.vibepro/ はStory・Spec・検証証跡・レビュー証跡・PR証跡を保存する作業台です。アプリ本体の実装とは分けて扱います。Gate DAGやPR作成をブロックする機構は持ちません。',
      `人間向け出力言語: ${language}`,
      `base branch候補: ${baseBranch ?? '未検出。origin/main, origin/develop, main, develop など実リポジトリの既定branchを指定してください。'}`,
      '',
      '次にやること:',
      '1. README全体を読む前に、まず `vibepro help` の「基本コマンド」を確認する',
      `2. Storyの調査コンテキストを作る: ${storyDiagnoseCommand}`,
      `3. 現在のgit状態で実行した検証証跡を記録する: ${verifyRecordCommand}`,
      `4. 役割別レビュー依頼を作る: ${reviewPrepareCommand}`,
      `5. Story + Spec有無 + 記録済み検証 + 記録済みレビューを要約したPR本文を作る: ${prPrepareCommand} --story-id <story-id>`,
      ''
    ].join('\n'),
    en: [
      `VibePro workspace initialized: ${workspaceDir}`,
      '',
      '.vibepro/ is the workspace for Story, Spec, verification, review, and PR evidence. It is separate from application source changes. It carries no Gate DAG or PR-creation-blocking machinery.',
      `Human output language: ${language}`,
      `Base branch candidate: ${baseBranch ?? 'not detected. Use the repository default such as origin/main, origin/develop, main, or develop.'}`,
      '',
      'Next steps:',
      '1. Start with `vibepro help` before reading the full README.',
      `2. Create the Story investigation context: ${storyDiagnoseCommand}`,
      `3. Record verification evidence for the current git state: ${verifyRecordCommand}`,
      `4. Create the role-based review request: ${reviewPrepareCommand}`,
      `5. Summarize Story + Spec presence + recorded verification + recorded review into a PR body: ${prPrepareCommand} --story-id <story-id>`,
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

async function resolveSelectedStoryId(repoRoot, commandName = 'task execute') {
  const config = JSON.parse(await readFile(path.join(getWorkspaceDir(repoRoot), 'config.json'), 'utf8'));
  const { currentStory } = resolveStoryContext(config);
  if (!currentStory?.story_id) {
    throw new Error(`${commandName} requires --id <story-id> or a configured current story`);
  }
  return currentStory.story_id;
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

function parseNumberOption(args, name) {
  const value = getOption(args, name);
  if (value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number`);
  return number;
}

function parseAllowedPathsOption(value) {
  if (!value) return undefined;
  const parsed = value.split(',').map((item) => item.trim()).filter(Boolean);
  return parsed.length > 0 ? parsed : undefined;
}

function write(stream, text) {
  if (stream) stream.write(text);
}

async function resolveGitHead(repoRoot) {
  const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return stdout.trim();
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
