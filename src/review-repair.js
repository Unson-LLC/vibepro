import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getIncompleteReviewRoleReason } from './usage-report.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

export const REPAIR_ACTIONS = [
  'run_review',
  'rerun_stale_review',
  'replace_timed_out_review',
  'rerecord_with_provenance',
  'close_and_rerecord'
];

export async function buildReviewRepairPlan(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const dryRun = options.dryRun === true;
  const reviewsDir = path.join(getWorkspaceDir(root), 'reviews');
  const candidates = [];
  const plans = [];
  for (const storyDirName of await safeReaddir(reviewsDir)) {
    if (options.storyId && storyDirName !== options.storyId) continue;
    for (const stageDirName of await safeReaddir(path.join(reviewsDir, storyDirName))) {
      const stageDir = path.join(reviewsDir, storyDirName, stageDirName);
      const summary = await readJsonIfExists(path.join(stageDir, 'review-summary.json'));
      if (!summary) continue;
      const storyId = summary.story_id ?? storyDirName;
      const stage = summary.stage ?? stageDirName;
      const stageCandidates = [];
      for (const role of summary.roles ?? []) {
        const evaluation = evaluateRoleRepair(role);
        if (!evaluation) continue;
        stageCandidates.push({
          story_id: storyId,
          stage,
          role: role.role ?? null,
          effective_status: role.effective_status ?? role.status ?? null,
          reason: evaluation.reason,
          action: evaluation.action,
          next_commands: buildRepairCommands({ storyId, stage, role: role.role, action: evaluation.action })
        });
      }
      if (stageCandidates.length === 0) continue;
      candidates.push(...stageCandidates);
      const planPath = path.join(stageDir, 'repair-plan.json');
      const plan = {
        schema_version: '0.1.0',
        story_id: storyId,
        stage,
        generated_at: new Date().toISOString(),
        candidates: stageCandidates
      };
      if (!dryRun) {
        await mkdir(stageDir, { recursive: true });
        await writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`);
      }
      plans.push({ path: toWorkspaceRelative(root, planPath), written: !dryRun, candidate_count: stageCandidates.length });
    }
  }
  return {
    schema_version: '0.1.0',
    generated_at: new Date().toISOString(),
    dry_run: dryRun,
    candidates,
    plans
  };
}

export function renderReviewRepair(result) {
  const header = result.dry_run ? '# Review Repair Plan (dry-run)' : '# Review Repair Plan';
  const rows = result.candidates.length
    ? result.candidates.map((candidate) => (
        `- ${candidate.story_id} ${candidate.stage}:${candidate.role}: ${candidate.action} (${candidate.reason})`
      )).join('\n')
    : '- no repair candidates';
  const plans = result.plans.length
    ? result.plans.map((plan) => `- ${plan.path} (candidates=${plan.candidate_count}, written=${plan.written})`).join('\n')
    : '- none';
  return `${header}\n\n${rows}\n\n## Plan Artifacts\n\n${plans}\n`;
}

// Repair never rewrites review results; every action routes through a real re-review
// (prepare -> start -> close -> record) so provenance cannot be stamped onto stale verdicts.
function evaluateRoleRepair(role) {
  const roleName = role?.role ?? 'unknown';
  const effective = role?.effective_status ?? role?.status ?? 'missing';
  if (effective === 'missing') {
    return { action: 'run_review', reason: `review role ${roleName} has not been run` };
  }
  if (effective === 'stale' || role?.stale === true) {
    return { action: 'rerun_stale_review', reason: `review role ${roleName} result is stale against the current head` };
  }
  if (effective === 'timed_out') {
    return { action: 'replace_timed_out_review', reason: `review role ${roleName} lifecycle timed out without a recorded result` };
  }
  if (effective === 'unverified_agent') {
    return { action: 'rerecord_with_provenance', reason: `review role ${roleName} result lacks verified agent provenance` };
  }
  if (['block', 'needs_changes', 'running'].includes(effective)) {
    // real verdicts need fixes, and running reviews need time, not repair
    return null;
  }
  const incompleteReason = getIncompleteReviewRoleReason(role);
  if (incompleteReason) {
    const hasOpenLifecycle = role?.agent_provenance && role.agent_provenance.lifecycle?.agent_closed !== true;
    return {
      action: hasOpenLifecycle ? 'close_and_rerecord' : 'rerecord_with_provenance',
      reason: incompleteReason
    };
  }
  return null;
}

function buildRepairCommands({ storyId, stage, role, action }) {
  const commands = [];
  if (action === 'replace_timed_out_review' || action === 'close_and_rerecord') {
    commands.push(
      `vibepro review close . --id ${storyId} --stage ${stage} --role ${role} --agent-id "<previous-subagent-id>" --close-reason ${action === 'replace_timed_out_review' ? 'timeout' : 'manual_shutdown'} --close-evidence <close-evidence>`
    );
  }
  commands.push(
    `vibepro review prepare . --id ${storyId} --stage ${stage} --role ${role}`,
    `vibepro review start . --id ${storyId} --stage ${stage} --role ${role} --agent-system <codex|claude_code> --agent-id "<subagent-id>" --timeout-ms 600000`,
    `vibepro review close . --id ${storyId} --stage ${stage} --role ${role} --agent-id "<subagent-id>" --close-reason completed --close-evidence <close-evidence>`,
    [
      `vibepro review record . --id ${storyId} --stage ${stage} --role ${role}`,
      '--status <pass|needs_changes|block>',
      '--summary "<summary>"',
      '--inspection-summary "<inspection-summary>"',
      '--inspection-evidence <inspection-evidence>',
      '--inspection-input <inspection-input>',
      '--judgment-delta "<initial judgment -> final judgment because evidence>"',
      '--agent-system <codex|claude_code>',
      '--execution-mode parallel_subagent',
      '--agent-id "<subagent-id>"',
      '--agent-thread-id "<subagent-thread-id>"',
      '--agent-transcript <artifact>',
      '--agent-closed',
      '--agent-close-evidence <close-evidence>'
    ].join(' ')
  );
  return commands;
}

async function safeReaddir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  } catch {
    return [];
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}
