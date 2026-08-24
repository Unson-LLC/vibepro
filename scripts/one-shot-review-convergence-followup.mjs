import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

await patchFile('src/agent-review.js', [
  {
    before: `  normalizeReviewRuntimeFailure,\n  updateReviewConvergenceState`,
    after: `  normalizeReviewRuntimeFailure,\n  readReviewConvergenceState,\n  updateReviewConvergenceState`
  },
  {
    before: `  const explicitRoles = Array.isArray(options.roles) && options.roles.length > 0;\n  const currentSummary = await buildStageSummary(root, storyId, stage, {\n    currentGitContext: gitContext,\n    reviewPolicy,\n    roles: configuredRoles\n  });\n  const roles = explicitRoles\n    ? configuredRoles\n    : configuredRoles.filter((role) => {\n        const current = currentSummary.roles.find((item) => item.role === role);\n        return current?.effective_status !== 'pass';\n      });`,
    after: `  const explicitRoles = Array.isArray(options.roles) && options.roles.length > 0;\n  const convergenceState = await readReviewConvergenceState(path.dirname(reviewDir));\n  const convergenceBlocked = !explicitRoles && convergenceState?.status === 'review_nonconvergent';\n  const currentSummary = await buildStageSummary(root, storyId, stage, {\n    currentGitContext: gitContext,\n    reviewPolicy,\n    roles: configuredRoles\n  });\n  const roles = convergenceBlocked\n    ? []\n    : explicitRoles\n      ? configuredRoles\n      : configuredRoles.filter((role) => {\n          const current = currentSummary.roles.find((item) => item.role === role);\n          return current?.effective_status !== 'pass';\n        });`
  },
  {
    before: `    unresolved_only: !explicitRoles,\n    roles: Object.fromEntries(roles.map((role) => {`,
    after: `    unresolved_only: !explicitRoles,\n    dispatch_allowed: !convergenceBlocked,\n    convergence_status: convergenceState?.status ?? 'not_recorded',\n    stop_reason: convergenceBlocked\n      ? convergenceState?.next_action ?? 'Review is nonconvergent; stop automatic redispatch and escalate the unresolved state.'\n      : null,\n    roles: Object.fromEntries(roles.map((role) => {`
  },
  {
    before: `    parallel_dispatch: {\n      required: true,`,
    after: `    parallel_dispatch: {\n      required: roles.length > 0,`
  },
  {
    before: `        expected: 'dispatch_parallel_subagents',`,
    after: `        expected: convergenceBlocked ? 'stop_nonconvergent' : 'dispatch_parallel_subagents',`
  },
  {
    before: `    if (result.causal_review && changedFiles.length > 0) {\n      const causalInvalidation = evaluateReviewCausalInvalidation({\n        stage: result.stage,\n        role: result.role,\n        strictHead: result.freshness_policy?.effective_mode === 'strict_head',\n        changedFiles\n      });`,
    after: `    if (result.causal_review) {\n      const causalInvalidation = evaluateReviewCausalInvalidation({\n        stage: result.stage,\n        role: result.role,\n        strictHead: result.freshness_policy?.effective_mode === 'strict_head',\n        changedFiles,\n        causalReview: result.causal_review\n      });`
  },
  {
    before: `        \`- repeat count: \${convergence.repeat_count}\`,\n        \`- head churn count: \${convergence.head_churn_count}\`,\n        \`- semantic signature: \${convergence.snapshot?.semantic_signature ?? '-'}\`,\n        \`- next action: \${convergence.next_action ?? 'none'}\``,
    after: `        \`- wave count: \${convergence.wave_count ?? 0}\`,\n        \`- no-progress count: \${convergence.no_progress_count ?? convergence.repeat_count ?? 0}\`,\n        \`- head churn count: \${convergence.head_churn_count}\`,\n        \`- event advanced: \${convergence.event_advanced ?? false}\`,\n        \`- progress detected: \${convergence.progress_detected ?? false}\`,\n        \`- progress reasons: \${(convergence.progress_reasons ?? []).join(', ') || 'none'}\`,\n        \`- event cursor: \${convergence.snapshot?.event_cursor ?? '-'}\`,\n        \`- progress signature: \${convergence.snapshot?.progress_signature ?? convergence.snapshot?.semantic_signature ?? '-'}\`,\n        \`- next action: \${convergence.next_action ?? 'none'}\``
  },
  {
    before: `    \`- convergence: \${agentReviews.convergence?.status ?? 'unavailable'} (repeat=\${agentReviews.convergence?.repeat_count ?? 0}, head_churn=\${agentReviews.convergence?.head_churn_count ?? 0})\`,`,
    after: `    \`- convergence: \${agentReviews.convergence?.status ?? 'unavailable'} (wave=\${agentReviews.convergence?.wave_count ?? 0}, no_progress=\${agentReviews.convergence?.no_progress_count ?? agentReviews.convergence?.repeat_count ?? 0}, head_churn=\${agentReviews.convergence?.head_churn_count ?? 0}, progress=\${agentReviews.convergence?.progress_detected ?? false})\`,`
  }
]);

await patchFile('src/pr-manager.js', [
  {
    before: `  lines.push(\`- convergence: \${review.convergence?.status ?? 'unavailable'} (repeat=\${review.convergence?.repeat_count ?? 0}, head_churn=\${review.convergence?.head_churn_count ?? 0})\`);`,
    after: `  lines.push(\`- convergence: \${review.convergence?.status ?? 'unavailable'} (wave=\${review.convergence?.wave_count ?? 0}, no_progress=\${review.convergence?.no_progress_count ?? review.convergence?.repeat_count ?? 0}, head_churn=\${review.convergence?.head_churn_count ?? 0}, progress=\${review.convergence?.progress_detected ?? false})\`);\n  lines.push(\`- convergence progress reasons: \${(review.convergence?.progress_reasons ?? []).join(', ') || 'none'}\`);`
  }
]);

await patchFile('skills/vibepro-workflow/SKILL.md', [
  {
    before: `   - Start with \`vibepro review status <repo> --id <story-id>\`. Dispatch only the roles listed in \`blocking_summary.items\`; never recreate a role that remains \`pass\` through \`current\`, \`reused_merge_delta\`, or \`causal_reuse\`.`,
    after: `   - Start with \`vibepro review status <repo> --id <story-id>\`. Dispatch only the roles listed in \`blocking_summary.items\`; never recreate a role that remains \`pass\` through \`current\`, \`reused_merge_delta\`, or \`causal_reuse\`.\n   - A HEAD-only change is an observation, not a completed review wave. Do not increase convergence attempts until a review record is completed.\n   - Treat finding content/disposition, inspection evidence, judgment delta, recorded invalidation surface, closure evidence, and runtime state as progress. A changed progress signature resets the no-progress counter.\n   - If changed paths are unclassified or the changed-file delta cannot be resolved, fail closed; do not claim \`causal_reuse\`.`
  },
  {
    before: `   - If \`review status\` reports \`review_nonconvergent\`, stop redispatching the same role set. Preserve the unresolved roles, split the VibePro review-contract/runtime defect into its own Story, and return control to the parent Program instead of continuing an evidence loop.`,
    after: `   - If \`review status\` reports \`review_nonconvergent\`, stop redispatching the same role set. Preserve the unresolved roles, split the VibePro review-contract/runtime defect into its own Story, and return control to the parent Program instead of continuing an evidence loop. Automatic \`review prepare\` must return no roles in this state; only an explicit human-directed role retry may continue.`
  }
]);

async function patchFile(relativePath, replacements) {
  const target = path.join(root, relativePath);
  let content = await readFile(target, 'utf8');
  for (const { before, after } of replacements) {
    if (!content.includes(before)) {
      throw new Error(`Patch anchor not found in ${relativePath}: ${before.slice(0, 120)}`);
    }
    content = content.replace(before, after);
  }
  await writeFile(target, content, 'utf8');
}
