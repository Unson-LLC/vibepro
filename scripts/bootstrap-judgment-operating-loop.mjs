import { readFile, writeFile } from 'node:fs/promises';

async function replaceOnce(file, before, after) {
  const source = await readFile(file, 'utf8');
  const index = source.indexOf(before);
  if (index < 0) throw new Error(`Expected text not found in ${file}: ${before.slice(0, 120)}`);
  if (source.indexOf(before, index + before.length) >= 0) {
    throw new Error(`Expected one occurrence but found multiple in ${file}: ${before.slice(0, 120)}`);
  }
  await writeFile(file, `${source.slice(0, index)}${after}${source.slice(index + before.length)}`, 'utf8');
}

async function replaceAllExact(file, before, after, expectedCount) {
  const source = await readFile(file, 'utf8');
  const count = source.split(before).length - 1;
  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} occurrence(s) in ${file}, found ${count}: ${before.slice(0, 120)}`);
  }
  await writeFile(file, source.split(before).join(after), 'utf8');
}

async function replaceSection(file, startMarker, endMarker, replacement) {
  const source = await readFile(file, 'utf8');
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`Start marker not found in ${file}: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) throw new Error(`End marker not found in ${file}: ${endMarker}`);
  await writeFile(file, `${source.slice(0, start)}${replacement}${source.slice(end)}`, 'utf8');
}

async function appendIfMissing(file, marker, content) {
  const source = await readFile(file, 'utf8');
  if (source.includes(marker)) return;
  await writeFile(file, `${source.trimEnd()}\n\n${content.trim()}\n`, 'utf8');
}

const cliImportBefore = `import {
  evaluateJudgmentWorkflow,
  prepareJudgmentInput,
  recordJudgmentOutcome,
  renderJudgmentEvaluationSummary,
  renderJudgmentOutcomeSummary,
  renderJudgmentPrepareSummary
} from './judgment-workflow.js';`;
const cliImportAfter = `import {
  adoptJudgmentInput,
  evaluateOperationalJudgmentWorkflow,
  getJudgmentOperationalStatus,
  listPendingJudgmentWork,
  prepareOperationalJudgmentInput,
  recordJudgmentApplicability,
  recordJudgmentDisposition,
  recordOperationalJudgmentOutcome,
  renderJudgmentAdoptionSummary,
  renderJudgmentApplicabilitySummary,
  renderJudgmentDispositionSummary,
  renderJudgmentOperationalEvaluationSummary,
  renderJudgmentOperationalStatus,
  renderOperationalJudgmentOutcomeSummary,
  renderPendingJudgmentWork
} from './judgment-operations.js';`;
await replaceOnce('src/cli.js', cliImportBefore, cliImportAfter);

const oldJudgmentHelp = `  vibepro judgment prepare [repo] --id <story-id> [--run-id <id>] [--output <path>] [--json]
  vibepro judgment evaluate [repo] --id <story-id> --input <input.json> [--json]
  vibepro judgment outcome record [repo] --id <story-id> --run <run-id> --human-decision <accepted|modified|rejected> --effect <changed_plan|changed_review_focus|escalated_to_human|no_effect> --status <confirmed|mixed|falsified|unknown> --summary <text> [--evidence <ref>]... [--observed-outcome <id:observation>]... [--json]`;
const newJudgmentHelp = `  vibepro judgment applicability record [repo] --id <story-id> --applicable <yes|no> --reason <text> [--recorded-by <actor>] [--json]
  vibepro judgment prepare [repo] --id <story-id> [--run-id <id>] [--output <path>] [--json]
  vibepro judgment input adopt [repo] --id <story-id> --input <input.json> --reviewed-by <actor> --authority <source> --summary <text> [--json]
  vibepro judgment evaluate [repo] --id <story-id> --input <adopted-input.json> [--json]
  vibepro judgment status [repo] --id <story-id> [--json]
  vibepro judgment disposition record [repo] --id <story-id> --run <run-id> --human-decision <accepted|modified|rejected> --effect <changed_plan|changed_review_focus|escalated_to_human|no_effect> --summary <text> [--evidence <ref>]... [--recorded-by <actor>] [--json]
  vibepro judgment outcome record [repo] --id <story-id> --run <run-id> --status <confirmed|mixed|falsified|unknown> --summary <text> [--evidence <ref>]... [--observed-outcome <id:observation>]... [--json]
  vibepro judgment pending [repo] [--json]`;
await replaceAllExact('src/cli.js', oldJudgmentHelp, newJudgmentHelp, 2);

const judgmentCommand = `    if (command === 'judgment') {
      const subcommand = rest[0];
      const nestedCommands = new Set(['applicability', 'input', 'disposition', 'outcome']);
      const nestedAction = nestedCommands.has(subcommand) ? rest[1] : null;
      const repoIndex = nestedCommands.has(subcommand) ? 2 : 1;
      const repoRoot = rest[repoIndex] && !rest[repoIndex].startsWith('--') ? rest[repoIndex] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'applicability' && nestedAction === 'record') {
        const result = await recordJudgmentApplicability(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          applicable: getOption(rest, '--applicable'),
          reason: getOption(rest, '--reason'),
          recordedBy: getOption(rest, '--recorded-by')
        });
        write(stdout, hasFlag(rest, '--json')
          ? \`${JSON.stringify(result, null, 2)}\n\`
          : renderJudgmentApplicabilitySummary(result));
        return { exitCode: 0, command, subcommand: 'applicability-record', result };
      }
      if (subcommand === 'prepare') {
        const result = await prepareOperationalJudgmentInput(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          runId: getOption(rest, '--run-id'),
          outputPath: getOption(rest, '--output')
        });
        write(stdout, hasFlag(rest, '--json')
          ? \`${JSON.stringify(result, null, 2)}\n\`
          : renderJudgmentOperationalStatus(await getJudgmentOperationalStatus(repoRoot, result.story_id)));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'input' && nestedAction === 'adopt') {
        const result = await adoptJudgmentInput(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          inputPath: getOption(rest, '--input'),
          reviewedBy: getOption(rest, '--reviewed-by'),
          authority: getOption(rest, '--authority'),
          summary: getOption(rest, '--summary')
        });
        write(stdout, hasFlag(rest, '--json')
          ? \`${JSON.stringify(result, null, 2)}\n\`
          : renderJudgmentAdoptionSummary(result));
        return { exitCode: 0, command, subcommand: 'input-adopt', result };
      }
      if (subcommand === 'evaluate') {
        const result = await evaluateOperationalJudgmentWorkflow(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          inputPath: getOption(rest, '--input')
        });
        write(stdout, hasFlag(rest, '--json')
          ? \`${JSON.stringify(result, null, 2)}\n\`
          : renderJudgmentOperationalEvaluationSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'status') {
        const result = await getJudgmentOperationalStatus(
          repoRoot,
          getOption(rest, '--id') ?? getOption(rest, '--story-id')
        );
        write(stdout, hasFlag(rest, '--json')
          ? \`${JSON.stringify(result, null, 2)}\n\`
          : renderJudgmentOperationalStatus(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'disposition' && nestedAction === 'record') {
        const result = await recordJudgmentDisposition(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          runId: getOption(rest, '--run'),
          humanDecision: getOption(rest, '--human-decision'),
          effect: getOption(rest, '--effect'),
          summary: getOption(rest, '--summary'),
          evidenceRefs: getOptions(rest, '--evidence'),
          recordedBy: getOption(rest, '--recorded-by')
        });
        write(stdout, hasFlag(rest, '--json')
          ? \`${JSON.stringify(result, null, 2)}\n\`
          : renderJudgmentDispositionSummary(result));
        return { exitCode: 0, command, subcommand: 'disposition-record', result };
      }
      if (subcommand === 'outcome' && nestedAction === 'record') {
        const storyId = getOption(rest, '--id') ?? getOption(rest, '--story-id');
        const runId = getOption(rest, '--run');
        if (getOption(rest, '--human-decision') || getOption(rest, '--effect')) {
          await recordJudgmentDisposition(repoRoot, {
            storyId,
            runId,
            humanDecision: getOption(rest, '--human-decision'),
            effect: getOption(rest, '--effect'),
            summary: getOption(rest, '--summary'),
            evidenceRefs: getOptions(rest, '--evidence'),
            recordedBy: getOption(rest, '--recorded-by')
          });
        }
        const result = await recordOperationalJudgmentOutcome(repoRoot, {
          storyId,
          runId,
          status: getOption(rest, '--status'),
          summary: getOption(rest, '--summary'),
          evidenceRefs: getOptions(rest, '--evidence'),
          observedOutcomes: getOptions(rest, '--observed-outcome')
        });
        write(stdout, hasFlag(rest, '--json')
          ? \`${JSON.stringify(result, null, 2)}\n\`
          : renderOperationalJudgmentOutcomeSummary(result));
        return { exitCode: 0, command, subcommand: 'outcome-record', result };
      }
      if (subcommand === 'pending') {
        const result = await listPendingJudgmentWork(repoRoot);
        write(stdout, hasFlag(rest, '--json')
          ? \`${JSON.stringify(result, null, 2)}\n\`
          : renderPendingJudgmentWork(result));
        return { exitCode: 0, command, subcommand, result };
      }
      write(stderr, \`Unknown judgment command: ${subcommand ?? ''}\n\n${renderHelp()}\`);
      return { exitCode: 1, command };
    }

`;
await replaceSection('src/cli.js', "    if (command === 'judgment') {", "    if (command === 'guard') {", judgmentCommand);

await replaceOnce(
  'src/story-manager.js',
  "import { readStoryTasks } from './story-task-generator.js';",
  `import { readStoryTasks } from './story-task-generator.js';
import {
  applyDevelopmentJudgmentToPlan,
  readOperationalJudgmentProjection,
  recordDevelopmentJudgmentPlanConsumption,
  renderDevelopmentJudgmentPlanMarkdown
} from './judgment-operations.js';`
);

const createStoryPlanReplacement = `export async function createStoryPlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const config = await readConfig(root);
  const manifest = await readManifest(root);
  const { catalog, catalogPath } = await readStoryMap(root);
  const currentStoryId = config.brainbase?.current_story_id ?? null;
  const graphIndex = await readStoryPlanGraphIndex(root, currentStoryId ?? 'story-default');
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 5;
  const explicitStoryTasks = await readExplicitStoryTasks(root, catalog);
  const basePlan = buildStoryExecutionPlan(catalog, { limit, graphIndex, explicitStoryTasks });
  const judgmentProjection = currentStoryId
    ? await readOperationalJudgmentProjection(root, currentStoryId)
    : null;
  const applied = applyDevelopmentJudgmentToPlan(basePlan, judgmentProjection, { storyId: currentStoryId });
  const plan = applied.plan;
  const storyDir = path.join(getWorkspaceDir(root), 'stories');
  await mkdir(storyDir, { recursive: true });
  const planPath = path.join(storyDir, 'story-plan.json');
  const markdownPath = path.join(storyDir, 'story-plan.md');
  const planBinding = currentStoryId
    ? await recordDevelopmentJudgmentPlanConsumption(root, {
        storyId: currentStoryId,
        binding: applied.binding,
        planArtifact: toWorkspaceRelative(root, planPath),
        planMarkdown: toWorkspaceRelative(root, markdownPath)
      })
    : null;
  if (planBinding) {
    plan.development_judgment = {
      ...plan.development_judgment,
      lifecycle_after_plan: 'consumed_by_plan',
      binding_id: planBinding.binding_id,
      binding_artifact: planBinding.artifact,
      consumed_at: planBinding.consumed_at
    };
  }
  await writeFile(planPath, \`${JSON.stringify(plan, null, 2)}\n\`);
  await writeFile(markdownPath, \`${renderStoryPlan(plan)}${renderDevelopmentJudgmentPlanMarkdown(plan.development_judgment)}\`);
  manifest.artifacts = {
    ...(manifest.artifacts ?? {}),
    story_plan: toWorkspaceRelative(root, planPath),
    story_plan_markdown: toWorkspaceRelative(root, markdownPath)
  };
  manifest.story_plan = {
    generated_at: plan.generated_at,
    source_catalog: toWorkspaceRelative(root, catalogPath),
    priority_story_count: plan.priority_stories.length,
    question_count: plan.questions.length,
    development_judgment: plan.development_judgment ?? null,
    artifact: toWorkspaceRelative(root, planPath)
  };
  await writeManifest(root, manifest);
  return { plan, planPath, markdownPath, planBinding };
}

`;
await replaceSection('src/story-manager.js', 'export async function createStoryPlan(repoRoot, options = {}) {', 'async function readStoryPlanGraphIndex', createStoryPlanReplacement);

await replaceOnce(
  'src/story-manager.js',
  `| Markdown | ${toWorkspaceRelativeFromAny(result.markdownPath)} |

${renderStoryPlan(result.plan)}`,
  `| Markdown | ${toWorkspaceRelativeFromAny(result.markdownPath)} |
| Judgment lifecycle | ${result.plan.development_judgment?.lifecycle_after_plan ?? result.plan.development_judgment?.lifecycle_before_plan ?? 'not_started'} |
| Judgment plan effect | ${result.plan.development_judgment?.effect ?? 'no_effect'} |

${renderStoryPlan(result.plan)}`
);

await replaceOnce(
  'src/pr-manager.js',
  "import { readDevelopmentJudgmentProjection } from './judgment-workflow.js';",
  "import { readOperationalJudgmentProjection } from './judgment-operations.js';"
);
await replaceOnce(
  'src/pr-manager.js',
  '    readDevelopmentJudgmentProjection(root, storyId)',
  '    readOperationalJudgmentProjection(root, storyId)'
);

const prJudgmentSection = `  lines.push('### Development Judgment');
  lines.push(\`- available: ${developmentJudgment?.available ?? false}\`);
  lines.push(\`- status: ${developmentJudgment?.status ?? 'not_recorded'}\`);
  lines.push(\`- lifecycle: ${developmentJudgment?.lifecycle ?? 'not_started'}\`);
  lines.push(\`- applicable: ${developmentJudgment?.applicable === null || developmentJudgment?.applicable === undefined ? 'not_recorded' : developmentJudgment.applicable}\`);
  lines.push(\`- input adopted: ${developmentJudgment?.input_adopted ?? false}\`);
  lines.push(\`- actionable: ${developmentJudgment?.actionable ?? false}\`);
  lines.push(\`- advisory: ${developmentJudgment?.advisory ?? true}\`);
  lines.push(\`- blocking: ${developmentJudgment?.blocking ?? false}\`);
  if (developmentJudgment?.available) {
    lines.push(\`- run: ${developmentJudgment.run_id ?? '-'}\`);
    lines.push(\`- development mode: ${developmentJudgment.development_mode ?? 'not_selected'}\`);
    lines.push(\`- recommendation: ${developmentJudgment.recommendation ?? 'none'}\`);
    lines.push(\`- unknowns: ${developmentJudgment.unknown_count ?? 0}\`);
    lines.push(\`- outcome evaluations: ${developmentJudgment.outcome_count ?? 0}\`);
    lines.push(\`- latest outcome: ${developmentJudgment.latest_outcome_status ?? developmentJudgment.outcome?.status ?? 'none'}\`);
    lines.push(\`- artifact: ${developmentJudgment.artifact ?? '-'}\`);
  } else if (developmentJudgment?.error) {
    lines.push(\`- error: ${developmentJudgment.error}\`);
  }
  lines.push(\`- plan binding: ${developmentJudgment?.plan_binding?.status ?? 'none'}\`);
  lines.push(\`- plan effect: ${developmentJudgment?.plan_binding?.effect ?? 'no_effect'}\`);
  lines.push(\`- disposition: ${developmentJudgment?.disposition?.human_decision ?? 'none'}\`);
  lines.push(\`- disposition effect: ${developmentJudgment?.disposition?.effect ?? 'none'}\`);
  lines.push(\`- pending disposition: ${developmentJudgment?.pending_disposition ?? false}\`);
  lines.push(\`- pending outcome: ${developmentJudgment?.pending_outcome ?? false}\`);
  if (developmentJudgment?.outcome) {
    lines.push(\`- operational outcome: ${developmentJudgment.outcome.status} — ${developmentJudgment.outcome.summary}\`);
  }
  for (const action of developmentJudgment?.next_actions ?? []) {
    lines.push(\`- next: ${action}\`);
  }
  lines.push('');
`;
await replaceSection(
  'src/pr-manager.js',
  "  lines.push('### Development Judgment');",
  "  lines.push('### Review');",
  prJudgmentSection
);

const skillStep13 = `13. Before planning, operate the Development Judgment loop when the Story contains a meaningful engineering choice:
   - Record applicability after diagnosis/design context and before \`story plan\`:
     - Applicable: \`vibepro judgment applicability record <repo> --id <story-id> --applicable yes --reason <why judgment is needed> --recorded-by <actor>\`
     - Not applicable for a mechanical change: use the same command with \`--applicable no\` and a concrete reason. Do not silently skip the decision.
   - Judgment is normally applicable when the problem frame is uncertain, multiple implementation choices exist, VALUE/SIMPLIFY/VALIDATE would change the batch, or public contract/security/data/topology/UX/performance/scope/release semantics are involved.
   - When applicable:
     1. Run \`vibepro judgment prepare <repo> --id <story-id>\` after context collection.
     2. Review and edit the generated input. A conservative draft with \`problem_frame.status=uncertain\` and inactive axes is not a completed judgment.
     3. Adopt the reviewed meaning explicitly: \`vibepro judgment input adopt <repo> --id <story-id> --input <input.json> --reviewed-by <actor> --authority <source> --summary <text>\`.
     4. Evaluate the adopted input: \`vibepro judgment evaluate <repo> --id <story-id> --input <adopted-input.json>\`.
     5. Read \`vibepro judgment status <repo> --id <story-id>\`; resolve an unactionable problem frame or evidence gap rather than treating it as a recommendation.
   - Then run \`vibepro story plan <repo>\`. Actionable Judgment is bound into the plan as advisory guidance; it never gains PR, merge, or release authority.
   - After the plan is consumed, record human adoption and delivery effect with \`vibepro judgment disposition record\`. Do not invent the later Outcome at this stage.`;
await replaceOnce(
  'skills/vibepro-workflow/SKILL.md',
  '13. Plan work from VibePro evidence: `vibepro story plan <repo>`.',
  skillStep13
);
await replaceOnce(
  'skills/vibepro-workflow/SKILL.md',
  '26. After merge, close the audit loop when asked about traceability, cost, or ROI: `vibepro audit replay <repo> --story-id <id>`, `vibepro audit session-cost <repo> --story-id <id>`, `vibepro trace backfill <repo>` / `vibepro trace declare <repo> --story-id <id> --lifecycle <state>`, and `vibepro usage report <repo> --subagent-roi --gate-roi`.',
  '26. After merge or once outcome evidence exists, run `vibepro judgment pending <repo>` and close each pending run with `vibepro judgment outcome record <repo> --id <story-id> --run <run-id> --status confirmed|mixed|falsified|unknown --summary <text> --evidence <ref>`. Then close the audit loop when asked about traceability, cost, or ROI: `vibepro audit replay <repo> --story-id <id>`, `vibepro audit session-cost <repo> --story-id <id>`, `vibepro trace backfill <repo>` / `vibepro trace declare <repo> --story-id <id> --lifecycle <state>`, and `vibepro usage report <repo> --subagent-roi --gate-roi`.'
);
await replaceOnce(
  'skills/vibepro-workflow/SKILL.md',
  '- Do not treat VibePro diagnosis as truth by itself. Verify with code, tests, runtime logs, or product behavior.',
  '- Do not treat `judgment prepare` as a completed judgment. The generated input is conservative context; review/edit, adopt, evaluate, and bind it through `story plan`.\n- Do not auto-run Judgment from `pr prepare`; PR preparation is a read-only projection point for this advisory loop.\n- Do not treat VibePro diagnosis as truth by itself. Verify with code, tests, runtime logs, or product behavior.'
);

const workflowTestMarker = `test('judgment CLI prepares, evaluates and records outcomes while PR prepare only projects the result', async () => {
  const root = await setupRepo();`;
const workflowTestReplacement = `test('judgment CLI prepares, evaluates and records outcomes while PR prepare only projects the result', async () => {
  const root = await setupRepo();
  const applicability = await runCli([
    'judgment', 'applicability', 'record', root,
    '--id', STORY_ID,
    '--applicable', 'yes',
    '--reason', 'The test exercises the explicit Development Judgment workflow.',
    '--recorded-by', 'test-agent',
    '--json'
  ], silentIo());
  assert.equal(applicability.exitCode, 0);`;
await replaceOnce('test/judgment-workflow.test.js', workflowTestMarker, workflowTestReplacement);

const evaluateTestBefore = `  const evaluated = await runCli([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', prepared.result.artifact,
    '--json'
  ], silentIo());`;
const evaluateTestAfter = `  const adopted = await runCli([
    'judgment', 'input', 'adopt', root,
    '--id', STORY_ID,
    '--input', prepared.result.artifact,
    '--reviewed-by', 'test-agent',
    '--authority', 'test-contract',
    '--summary', 'The conservative input is explicitly reviewed for this compatibility test.',
    '--json'
  ], silentIo());
  assert.equal(adopted.exitCode, 0);

  const evaluated = await runCli([
    'judgment', 'evaluate', root,
    '--id', STORY_ID,
    '--input', adopted.result.adoption.adopted_input,
    '--json'
  ], silentIo());`;
await replaceOnce('test/judgment-workflow.test.js', evaluateTestBefore, evaluateTestAfter);

const featureMapEn = `## Development Judgment operating loop

VibePro can now operate Development Judgment as an explicit non-blocking loop rather than an optional report command:

1. record applicability,
2. prepare and explicitly adopt reviewed meaning,
3. evaluate the Development Judgment DAG,
4. bind actionable guidance into Story planning,
5. record disposition separately from later Outcome,
6. feed observed Outcome into the next judgment run.

\`pr prepare\` only projects this lifecycle. Development Judgment never changes PR readiness, merge, or release authority.`;
const featureMapJa = `## Development Judgment運用ループ

Development Judgmentは任意レポートではなく、明示的な非blockingループとして運用できます。

1. 適用要否を記録する
2. 保守的draftをレビューし、意味を明示採択する
3. Development Judgment DAGを評価する
4. actionableな判断をStory planへbindingする
5. 採否と後日のOutcomeを時間分離して記録する
6. 観測Outcomeを次回判断へfeedbackする

\`pr prepare\`はこのライフサイクルを投影するだけであり、PR readiness、merge、release権限は持ちません。`;
await appendIfMissing('docs/guide/feature-map.md', '## Development Judgment operating loop', featureMapEn);
await appendIfMissing('docs/ja/guide/feature-map.md', '## Development Judgment運用ループ', featureMapJa);

const architectureAppend = `## Operating loop completion

The advisory DAG is now activated through an explicit lifecycle: applicability -> prepare -> input adoption -> evaluation -> Story plan binding -> disposition -> Outcome -> next-run feedback. The lifecycle remains non-blocking and is never auto-run by PR preparation. See \`docs/architecture/vibepro-development-judgment-operating-loop.md\`.`;
await appendIfMissing('docs/architecture/vibepro-development-judgment-workflow.md', '## Operating loop completion', architectureAppend);

console.log('Development Judgment operating-loop source transformations applied.');
