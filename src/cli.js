import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initWorkspace } from './workspace.js';
import { installCodexInstructions, renderCodexInstall, renderCodexVerify, verifyCodexInstructions } from './codex-manager.js';
import { generateAgentHarnessMap, renderAgentHarnessMapSummary } from './agent-harness-map.js';
import { renderAgentHarnessStatus, scanAgentHarness } from './agent-harness-scanner.js';
import { importGraphifyArtifacts } from './graphify-adapter.js';
import { runDiagnosis } from './diagnostic-engine.js';
import { assertOutputLanguage, localizedText, normalizeOutputLanguage, setOutputLanguage } from './language.js';
import { listCheckPacks, renderCheckPackSummary, runCheckPack } from './check-packs.js';
import { renderDoctor, runDoctor } from './doctor.js';
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
  getAgentReviewStatus,
  prepareAgentReview,
  recordAgentReview,
  renderAgentReviewPrepareSummary,
  renderAgentReviewRecordSummary,
  renderAgentReviewStatusSummary
} from './agent-review.js';
import { createPullRequest, preparePullRequest, renderPrCreateSummary, renderPrPrepareSummary } from './pr-manager.js';
import { renderFlowVerificationSummary, runFlowVerification } from './flow-verifier.js';
import { recordVerificationEvidence, renderVerificationEvidenceSummary } from './verification-evidence.js';
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
  vibepro graph [repo] [--from <graphify-out>] [--run-graphify]
  vibepro diagnose [repo] [--run-id <id>]
  vibepro check <ui|security|performance|architecture|pr-readiness|launch-readiness|agent-harness|all> [repo] [--run-id <id>] [--story-id <id>] [--base <ref>] [--head <ref>] [--measure] [--include-harness] [--json]
  vibepro verify flow [repo] --base-url <url> [--id <story-id>] [--run-id <id>] [--journey <id>] [--allow-mutation] [--headed] [--basic-auth-env <env>] [--basic-auth <user:pass>] [--json]
  vibepro verify record [repo] --id <story-id> --kind <unit|integration|e2e|typecheck|build> --status <pass|fail|needs_setup> --command <cmd> [--summary <text>] [--artifact <path>] [--json]
  vibepro review prepare [repo] --id <story-id> --stage <stage> [--json]
  vibepro review record [repo] --id <story-id> --stage <stage> --role <role> --status <pass|needs_changes|block> --summary <text> [--finding <severity:id:detail>] [--artifact <path>] [--from-stdin] [--agent-system codex|claude_code --execution-mode parallel_subagent --agent-id <id>] [--agent-thread-id <id>] [--agent-session-id <id>] [--agent-call-id <id>] [--agent-model <name>] [--agent-transcript <path>] [--json]
  vibepro review status [repo] --id <story-id> [--stage <stage>] [--json]
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
  vibepro pr prepare [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <ref>] [--branch <name>] [--max-files <n>] [--strict] [--allow-extra-files] [--language ja|en] [--json]
  vibepro pr create [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <branch>] [--title <title>] [--dry-run] [--allow-needs-verification --verification-waiver <reason>] [--strict] [--allow-extra-files] [--language ja|en] [--json]
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
      サブエージェントや人間に渡すレビュー依頼を作ります。
  vibepro review record <repo> --id <id> --stage implementation --role <role> --status pass --summary <text> --agent-system codex|claude_code --execution-mode parallel_subagent --agent-id <id>
      レビュー結果を現在のgit状態とサブエージェント証跡に紐づけて記録します。

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
  vibepro graph [repo] [--from <graphify-out>] [--run-graphify]
  vibepro diagnose [repo] [--run-id <id>]
  vibepro check <ui|security|performance|architecture|pr-readiness|launch-readiness|agent-harness|all> [repo] [--run-id <id>] [--story-id <id>] [--base <ref>] [--head <ref>] [--measure] [--include-harness] [--json]
  vibepro verify flow [repo] --base-url <url> [--id <story-id>] [--run-id <id>] [--journey <id>] [--allow-mutation] [--headed] [--basic-auth-env <env>] [--basic-auth <user:pass>] [--json]
  vibepro verify record [repo] --id <story-id> --kind <unit|integration|e2e|typecheck|build> --status <pass|fail|needs_setup> --command <cmd> [--summary <text>] [--artifact <path>] [--json]
  vibepro review prepare [repo] --id <story-id> --stage <stage> [--json]
  vibepro review record [repo] --id <story-id> --stage <stage> --role <role> --status <pass|needs_changes|block> --summary <text> [--finding <severity:id:detail>] [--artifact <path>] [--from-stdin] [--agent-system codex|claude_code --execution-mode parallel_subagent --agent-id <id>] [--agent-thread-id <id>] [--agent-session-id <id>] [--agent-call-id <id>] [--agent-model <name>] [--agent-transcript <path>] [--json]
  vibepro review status [repo] --id <story-id> [--stage <stage>] [--json]
  vibepro measure [repo] [--base-url <url>] [--pages <csv>] [--apis <csv>] [--samples <n>] [--build] [--no-typecheck] [--startup-script <name>] [--ready-pattern <regex>] [--startup-timeout <ms>] [--prisma-log <file>] [--command <id=cmd>] [--run-id <id>] [--json]
  vibepro measure compare [repo] --before <performance.json> --after <performance.json> [--json]
  vibepro performance define [repo] --id <story-id> --metric-id <id> --user-story <text> --start-condition <text> --completion-condition <text> [--intermediate-marker <id>] [--timeout-ms <ms>] [--failure-classification <class>] [--evidence-source <server_log|browser_e2e|api_log|client_marker|manual_observation>] [--readiness-kind <server_side|user_perceived|external_dependency|system_internal>] [--comparison-policy <json|name>] [--json]
  vibepro performance record [repo] --id <story-id> --metric-id <id> --label <before|after> --status <completed|blocked|needs_review|timeout|auth_required|resource_unavailable|unknown> [--duration-ms <ms>] [--marker <id=ms>] [--evidence-source <type:ref:summary>] [--completion-condition <text>] [--run-id <id>] [--json]
  vibepro performance compare [repo] --id <story-id> [--metric-id <id>] [--before-label <label>] [--after-label <label>] [--json]
  vibepro story diagnose [repo] --id <id> [--run-graphify] [--run-id <id>]
  vibepro story derive [repo] [--from-run <run-id>] [--run-graphify] [--from <graphify-out>] [--preset <id>] [--json]
  vibepro story plan [repo] [--limit <n>] [--json]
  vibepro task create [repo] --from-plan [--id <story-id>] [--task <task-id>] [--limit <n>] [--json]
  vibepro pr prepare [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <ref>] [--branch <name>] [--max-files <n>] [--strict] [--allow-extra-files] [--language ja|en] [--json]
  vibepro pr create [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <branch>] [--title <title>] [--dry-run] [--allow-needs-verification --verification-waiver <reason>] [--strict] [--allow-extra-files] [--language ja|en] [--json]
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
        runId: getOption(rest, '--run-id'),
        storyId: getOption(rest, '--story-id') ?? getOption(rest, '--id'),
        baseRef: getOption(rest, '--base'),
        headRef: getOption(rest, '--head'),
        strict: hasFlag(rest, '--strict'),
        measure: hasFlag(rest, '--measure'),
        includeHarness: hasFlag(rest, '--include-harness'),
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
      return { exitCode: 0, command, subcommand: packId, result };
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
          stage: getOption(rest, '--stage')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentReviewPrepareSummary(result));
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
          recordedBy: getOption(rest, '--recorded-by'),
          stdinText
        });
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
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result, null, 2)}\n`
          : renderAgentReviewStatusSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown review command: ${subcommand ?? ''}\n\n${renderHelp()}`);
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
        const result = await preparePullRequest(repoRoot, {
          storyId: getOption(rest, '--story-id'),
          taskId: getOption(rest, '--task'),
          groupId: getOption(rest, '--group'),
          baseRef: getOption(rest, '--base'),
          headRef: getOption(rest, '--head'),
          branchName: getOption(rest, '--branch'),
          maxReviewableFiles: parseNumberOption(rest, '--max-files'),
          strict: hasFlag(rest, '--strict'),
          allowExtraFiles: hasFlag(rest, '--allow-extra-files'),
          language: getOption(rest, '--language')
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.preparation, null, 2)}\n`
          : renderPrPrepareSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'create') {
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
          title: getOption(rest, '--title'),
          dryRun: hasFlag(rest, '--dry-run'),
          allowNeedsVerification: hasFlag(rest, '--allow-needs-verification'),
          verificationWaiver: getOption(rest, '--verification-waiver'),
          strict: hasFlag(rest, '--strict'),
          allowExtraFiles: hasFlag(rest, '--allow-extra-files'),
          language: getOption(rest, '--language'),
          env: io.env
        });
        write(stdout, hasFlag(rest, '--json')
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
        write(stdout, `Brainbase stories synced: ${syncResult.stories.length}\n`);
      }
      const result = await createBrainbaseImport(repoRoot);
      write(stdout, `Brainbase import state created: ${result.importStatePath}\n`);
      if (hasFlag(rest, '--publish-status')) {
        const publishResult = await publishStatusToNocoDB(repoRoot, {
          env: io.env,
          fetch: io.fetch,
          dryRun: hasFlag(rest, '--dry-run'),
          storyId: getOption(rest, '--story-id')
        });
        write(stdout, publishResult.dryRun
          ? `Brainbase story status preview created: ${publishResult.storyId}\n`
          : `Brainbase story status published: ${publishResult.storyId}\n`);
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

function parseNumberOption(args, name) {
  const value = getOption(args, name);
  if (value === null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${name} must be a number`);
  return number;
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
