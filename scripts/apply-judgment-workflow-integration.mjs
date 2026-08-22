import { readFile, writeFile } from 'node:fs/promises';

async function patchFile(file, transform) {
  const before = await readFile(file, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`${file}: patch made no change`);
  await writeFile(file, after, 'utf8');
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  if (first < 0) throw new Error(`missing patch anchor: ${label}`);
  if (source.indexOf(search, first + search.length) >= 0) throw new Error(`ambiguous patch anchor: ${label}`);
  return source.slice(0, first) + replacement + source.slice(first + search.length);
}

function replaceAllExpected(source, search, replacement, expected, label) {
  const count = source.split(search).length - 1;
  if (count !== expected) throw new Error(`${label}: expected ${expected} matches, found ${count}`);
  return source.split(search).join(replacement);
}

await patchFile('src/cli.js', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "import { evaluateSeniorJudgmentRun, renderSeniorJudgmentSummary } from './senior-judgment-dag.js';",
    `import {
  evaluateJudgmentWorkflow,
  prepareJudgmentInput,
  recordJudgmentOutcome,
  renderJudgmentEvaluationSummary,
  renderJudgmentOutcomeSummary,
  renderJudgmentPrepareSummary
} from './judgment-workflow.js';`,
    'judgment workflow import'
  );

  source = replaceAllExpected(
    source,
    '  vibepro judgment evaluate [repo] --id <story-id> --input <input.json> [--json]',
    `  vibepro judgment prepare [repo] --id <story-id> [--run-id <id>] [--output <path>] [--json]
  vibepro judgment evaluate [repo] --id <story-id> --input <input.json> [--json]
  vibepro judgment outcome record [repo] --id <story-id> --run <run-id> --human-decision <accepted|modified|rejected> --effect <changed_plan|changed_review_focus|escalated_to_human|no_effect> --status <confirmed|mixed|falsified|unknown> --summary <text> [--evidence <ref>]... [--observed-outcome <id:observation>]... [--json]`,
    2,
    'judgment help lines'
  );

  source = replaceOnce(
    source,
    "  decision: ['record'],\n  bug: ['diagnose-record']",
    "  decision: ['record'],\n  judgment: ['evaluate', 'outcome-record'],\n  bug: ['diagnose-record']",
    'auto snapshot judgment commands'
  );

  const handlerPattern = /    if \(command === 'judgment'\) \{[\s\S]*?\n    if \(command === 'guard'\) \{/;
  if (!handlerPattern.test(source)) throw new Error('missing judgment handler block');
  const handler = `    if (command === 'judgment') {
      const subcommand = rest[0];
      const nestedAction = subcommand === 'outcome' ? rest[1] : null;
      const repoIndex = subcommand === 'outcome' ? 2 : 1;
      const repoRoot = rest[repoIndex] && !rest[repoIndex].startsWith('--') ? rest[repoIndex] : process.cwd();
      if (!subcommand || subcommand === '--help' || subcommand === '-h' || hasFlag(rest, '--help') || hasFlag(rest, '-h')) {
        write(stdout, renderHelp(getOption(rest, '--language')));
        return { exitCode: 0, command, subcommand: subcommand ?? 'help' };
      }
      if (subcommand === 'prepare') {
        const result = await prepareJudgmentInput(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          runId: getOption(rest, '--run-id'),
          outputPath: getOption(rest, '--output')
        });
        write(stdout, hasFlag(rest, '--json')
          ? \`${'${JSON.stringify(result, null, 2)}'}\\n\`
          : renderJudgmentPrepareSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'evaluate') {
        const result = await evaluateJudgmentWorkflow(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          inputPath: getOption(rest, '--input')
        });
        write(stdout, hasFlag(rest, '--json')
          ? \`${'${JSON.stringify(result, null, 2)}'}\\n\`
          : renderJudgmentEvaluationSummary(result));
        return { exitCode: 0, command, subcommand, result };
      }
      if (subcommand === 'outcome' && nestedAction === 'record') {
        const result = await recordJudgmentOutcome(repoRoot, {
          storyId: getOption(rest, '--id') ?? getOption(rest, '--story-id'),
          runId: getOption(rest, '--run'),
          humanDecision: getOption(rest, '--human-decision'),
          effect: getOption(rest, '--effect'),
          status: getOption(rest, '--status'),
          summary: getOption(rest, '--summary'),
          evidenceRefs: getOptions(rest, '--evidence'),
          observedOutcomes: getOptions(rest, '--observed-outcome')
        });
        write(stdout, hasFlag(rest, '--json')
          ? \`${'${JSON.stringify(result, null, 2)}'}\\n\`
          : renderJudgmentOutcomeSummary(result));
        return { exitCode: 0, command, subcommand: 'outcome-record', result };
      }
      write(stderr, \`Unknown judgment command: ${'${subcommand ?? \'\'}'}\\n\\n${'${renderHelp()}'}\`);
      return { exitCode: 1, command };
    }

    if (command === 'guard') {`;
  source = source.replace(handlerPattern, handler);
  return source;
});

await patchFile('src/pr-manager.js', (input) => {
  let source = input;
  source = replaceOnce(
    source,
    "import { buildExecutionDag } from './managed-worktree.js';",
    "import { buildExecutionDag } from './managed-worktree.js';\nimport { readDevelopmentJudgmentProjection } from './judgment-workflow.js';",
    'PR manager judgment import'
  );
  source = replaceOnce(
    source,
    `  const [story, git, spec, drift, verification, review] = await Promise.all([
    readStory(root, storyId),
    collectGitState(root, options),
    readInferredSpec(root, storyId).catch(() => null),
    readDrift(root, storyId).catch(() => null),
    readVerificationSummary(root, storyId),
    readReviewSummary(root, storyId)
  ]);`,
    `  const [story, git, spec, drift, verification, review, developmentJudgment] = await Promise.all([
    readStory(root, storyId),
    collectGitState(root, options),
    readInferredSpec(root, storyId).catch(() => null),
    readDrift(root, storyId).catch(() => null),
    readVerificationSummary(root, storyId),
    readReviewSummary(root, storyId),
    readDevelopmentJudgmentProjection(root, storyId)
  ]);`,
    'PR preparation promise inputs'
  );
  source = replaceOnce(
    source,
    `    verification,
    review,
    multi_tenant_architecture: {`,
    `    verification,
    review,
    development_judgment: developmentJudgment,
    multi_tenant_architecture: {`,
    'PR preparation judgment projection'
  );
  source = replaceOnce(
    source,
    `  const { story, git, spec, spec_drift: specDrift, verification, review, story_source: storySource, traceability, task_authorities: taskAuthorities, multi_tenant_architecture: multiTenantArchitecture } = preparation;`,
    `  const { story, git, spec, spec_drift: specDrift, verification, review, development_judgment: developmentJudgment, story_source: storySource, traceability, task_authorities: taskAuthorities, multi_tenant_architecture: multiTenantArchitecture } = preparation;`,
    'PR body judgment destructuring'
  );
  source = replaceOnce(
    source,
    `  lines.push('');
  lines.push('### Review');`,
    `  lines.push('');
  lines.push('### Development Judgment');
  lines.push(\`- available: ${'${developmentJudgment?.available ?? false}'}\`);
  lines.push(\`- status: ${'${developmentJudgment?.status ?? \'not_recorded\'}'}\`);
  lines.push(\`- advisory: ${'${developmentJudgment?.advisory ?? true}'}\`);
  lines.push(\`- blocking: ${'${developmentJudgment?.blocking ?? false}'}\`);
  if (developmentJudgment?.available) {
    lines.push(\`- run: ${'${developmentJudgment.run_id ?? \'-\'}'}\`);
    lines.push(\`- development mode: ${'${developmentJudgment.development_mode ?? \'not_selected\'}'}\`);
    lines.push(\`- recommendation: ${'${developmentJudgment.recommendation ?? \'none\'}'}\`);
    lines.push(\`- unknowns: ${'${developmentJudgment.unknown_count ?? 0}'}\`);
    lines.push(\`- outcome evaluations: ${'${developmentJudgment.outcome_count ?? 0}'}\`);
    lines.push(\`- latest outcome: ${'${developmentJudgment.latest_outcome_status ?? \'none\'}'}\`);
    lines.push(\`- artifact: ${'${developmentJudgment.artifact ?? \'-\'}'}\`);
  } else if (developmentJudgment?.error) {
    lines.push(\`- error: ${'${developmentJudgment.error}'}\`);
  }
  lines.push('');
  lines.push('### Review');`,
    'PR body judgment section'
  );
  return source;
});
