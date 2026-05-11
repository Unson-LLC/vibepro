import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initWorkspace } from './workspace.js';
import { importGraphifyArtifacts } from './graphify-adapter.js';
import { runDiagnosis } from './diagnostic-engine.js';
import { renderDoctor, runDoctor } from './doctor.js';
import { createBrainbaseImport } from './brainbase-importer.js';
import { publishStatusToNocoDB, syncStoriesFromNocoDB } from './nocodb-story-sync.js';
import { getRepoStatus, renderRepoStatus } from './repo-status.js';
import {
  comparePerformanceMeasurements,
  renderPerformanceSummary,
  runPerformanceMeasurement
} from './performance-measurer.js';
import { createPullRequest, preparePullRequest, renderPrCreateSummary, renderPrPrepareSummary } from './pr-manager.js';
import { renderFlowVerificationSummary, runFlowVerification } from './flow-verifier.js';
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

const HELP = `VibePro CLI

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
  vibepro pr prepare <repo> --base origin/develop --story-id <id>

PR prepare creates pr-body, gate-dag, split-plan, and machine-readable evidence
under .vibepro/pr/<story-id>/ when the target repo is initialized.

Usage:
  vibepro help [command]
  vibepro version
  vibepro --version | -v
  vibepro init [repo] [--story-id <id> --title <title>] [--horizon <value>] [--view <value>] [--period <value>] [--started-at <date>] [--due-at <date>]
  vibepro doctor [repo] [--fix] [--json]
  vibepro status [repo] [--json]
  vibepro graph [repo] [--from <graphify-out>] [--run-graphify]
  vibepro diagnose [repo] [--run-id <id>]
  vibepro verify flow [repo] --base-url <url> [--id <story-id>] [--run-id <id>] [--journey <id>] [--allow-mutation] [--headed] [--basic-auth-env <env>] [--basic-auth <user:pass>] [--json]
  vibepro measure [repo] [--base-url <url>] [--pages <csv>] [--apis <csv>] [--samples <n>] [--build] [--no-typecheck] [--startup-script <name>] [--ready-pattern <regex>] [--startup-timeout <ms>] [--prisma-log <file>] [--command <id=cmd>] [--run-id <id>] [--json]
  vibepro measure compare [repo] --before <performance.json> --after <performance.json> [--json]
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
  vibepro pr prepare [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <ref>] [--branch <name>] [--max-files <n>] [--strict] [--allow-extra-files] [--json]
  vibepro pr create [repo] [--story-id <id>] [--task <task-id>] [--group <group-id>] [--base <ref>] [--head <branch>] [--title <title>] [--dry-run] [--allow-needs-verification --verification-waiver <reason>] [--strict] [--allow-extra-files] [--json]
  vibepro brainbase [repo] [--sync-stories] [--publish-status] [--dry-run] [--story-id <id>]
  vibepro spec fingerprint [repo] --id <story-id> [--include-instructions] [--json]
  vibepro spec write [repo] --id <story-id> [--from-stdin] [--input <file>] [--caller <name>] [--json]
  vibepro spec show [repo] --id <story-id> [--clause <clause-id>] [--json]
  vibepro spec drift [repo] --id <story-id> [--against <git-ref>] [--json]
  vibepro report fingerprint [repo] --kind <kind> --id <story-id> [--base <ref>] [--task <id>] [--group <id>] [--include-instructions]
  vibepro report write [repo] --kind <kind> --id <story-id> [--from-stdin] [--input <file>] [--caller <name>]
  vibepro report show [repo] --kind <kind> --id <story-id>
`;

export async function runCli(argv, io = {}) {
  const stdout = io.stdout ?? null;
  const stderr = io.stderr ?? null;
  const [command, ...rest] = argv;

  try {
    if (!command || command === 'help' || command === '--help' || command === '-h') {
      write(stdout, HELP);
      return { exitCode: 0, command: 'help' };
    }

    if (command === 'version' || command === '--version' || command === '-v') {
      const version = await readPackageVersion();
      write(stdout, `${version}\n`);
      return { exitCode: 0, command: 'version', version };
    }

    if (command === 'init') {
      const repoRoot = rest[0] ?? process.cwd();
      const workspace = await initWorkspace(repoRoot);
      write(stdout, `VibePro workspace initialized: ${workspace.workspaceDir}\n`);
      const storyId = getOption(rest, '--story-id');
      if (storyId) {
        const storyOptions = {
          ...parseStoryOptions(rest),
          story_id: storyId
        };
        const story = await addStory(repoRoot, storyOptions);
        await selectStory(repoRoot, story.story_id);
        write(stdout, `Story added: ${story.story_id}\n`);
        write(stdout, `Story selected: ${story.story_id}\n`);
        return { exitCode: 0, command, workspace, story };
      }
      return { exitCode: 0, command, workspace };
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

    if (command === 'verify') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, HELP);
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
      write(stderr, `Unknown verify command: ${subcommand ?? ''}\n\n${HELP}`);
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

    if (command === 'story') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, HELP);
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
      write(stderr, `Unknown story command: ${subcommand ?? ''}\n\n${HELP}`);
      return { exitCode: 1, command };
    }

    if (command === 'task') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, HELP);
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
      write(stderr, `Unknown task command: ${subcommand ?? ''}\n\n${HELP}`);
      return { exitCode: 1, command };
    }

    if (command === 'pr') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, HELP);
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
          allowExtraFiles: hasFlag(rest, '--allow-extra-files')
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
          env: io.env
        });
        write(stdout, hasFlag(rest, '--json')
          ? `${JSON.stringify(result.execution, null, 2)}\n`
          : renderPrCreateSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, `Unknown pr command: ${subcommand ?? ''}\n\n${HELP}`);
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
        write(stdout, HELP);
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

      write(stderr, `Unknown spec command: ${subcommand ?? ''}\n\n${HELP}`);
      return { exitCode: 1, command };
    }

    if (command === 'report') {
      const subcommand = rest[0];
      const repoRoot = rest[1] && !rest[1].startsWith('--') ? rest[1] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, HELP);
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

      write(stderr, `Unknown report command: ${subcommand ?? ''}\n\n${HELP}`);
      return { exitCode: 1, command };
    }

    write(stderr, `Unknown command: ${command}\n\n${HELP}`);
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
