import { execFile } from 'node:child_process';
import { appendFile, chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { evaluateGateReadiness } from './pr-manager.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

export const GUARD_HOOK_MARKER = '# vibepro-release-surface-guard';
export const DEFAULT_PROTECTED_BRANCHES = ['main', 'master'];

// Release-surface classification is deterministic code on purpose: it never
// exercises judgment, it only routes matched commands into gate readiness.
const DEFAULT_RELEASE_PATTERNS = [
  { id: 'raw_pr_create', pattern: '(^|[\\s;&|])gh\\s+pr\\s+create\\b' },
  { id: 'raw_pr_merge', pattern: '(^|[\\s;&|])gh\\s+pr\\s+merge\\b' },
  { id: 'fly_deploy', pattern: '(^|[\\s;&|])fly(ctl)?\\s+deploy\\b' },
  { id: 'vercel_deploy', pattern: '(^|[\\s;&|])vercel\\s+(deploy|--prod)' },
  { id: 'npm_publish', pattern: '(^|[\\s;&|])npm\\s+publish\\b' }
];

export async function readGuardConfig(repoRoot) {
  const root = path.resolve(repoRoot);
  let raw = null;
  try {
    raw = JSON.parse(await readFile(path.join(getWorkspaceDir(root), 'config.json'), 'utf8'));
  } catch {
    return { workspace_initialized: false, enabled: false, protected_branches: DEFAULT_PROTECTED_BRANCHES, release_patterns: DEFAULT_RELEASE_PATTERNS };
  }
  const guard = raw.guard ?? {};
  const extraPatterns = Array.isArray(guard.release_patterns)
    ? guard.release_patterns
      .filter((item) => item && typeof item.pattern === 'string')
      .map((item, index) => ({ id: item.id ?? `custom_${index + 1}`, pattern: item.pattern }))
    : [];
  return {
    workspace_initialized: true,
    enabled: guard.enabled !== false,
    protected_branches: Array.isArray(guard.protected_branches) && guard.protected_branches.length > 0
      ? guard.protected_branches.map(String)
      : DEFAULT_PROTECTED_BRANCHES,
    release_patterns: [...DEFAULT_RELEASE_PATTERNS, ...extraPatterns]
  };
}

export function classifyReleaseSurface(command, config) {
  const normalized = String(command ?? '');
  if (!normalized.trim()) return null;
  // vibepro's own commands go through the CLI's internal throw-based
  // enforcement; the guard only covers paths that bypass vibepro.
  if (/(^|[\s;&|])(node\s+\S*vibepro(\.js)?|vibepro|npx\s+vibepro)\s/.test(normalized)) return null;
  for (const entry of config.release_patterns) {
    let regex;
    try {
      regex = new RegExp(entry.pattern, 'i');
    } catch {
      continue;
    }
    if (regex.test(normalized)) return { id: entry.id, pattern: entry.pattern };
  }
  const pushMatch = matchProtectedPush(normalized, config.protected_branches);
  if (pushMatch) return pushMatch;
  return null;
}

function matchProtectedPush(command, protectedBranches) {
  const pushRegex = /(^|[\s;&|])git\s+push\b([^;&|]*)/i;
  const match = command.match(pushRegex);
  if (!match) return null;
  const args = match[2] ?? '';
  for (const branch of protectedBranches) {
    const branchRegex = new RegExp(`(^|[\\s:])${escapeRegExp(branch)}(\\s|$)`);
    if (branchRegex.test(args)) {
      return { id: 'protected_branch_push', pattern: `git push ... ${branch}` };
    }
  }
  return null;
}

export async function checkGuard(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const config = await readGuardConfig(root);
  const command = String(options.command ?? '');
  const base = {
    command,
    enabled: config.enabled,
    workspace_initialized: config.workspace_initialized
  };
  if (!config.workspace_initialized || !config.enabled) {
    return { ...base, decision: 'allow', reason: config.workspace_initialized ? 'guard is disabled via .vibepro/config.json guard.enabled=false' : 'no VibePro workspace; guard does not apply' };
  }
  const surface = classifyReleaseSurface(command, config);
  if (!surface) {
    return { ...base, decision: 'allow', reason: 'command does not match any release surface pattern' };
  }
  const readinessEvaluator = options.readinessEvaluator ?? evaluateGateReadiness;
  let readiness;
  try {
    readiness = await readinessEvaluator(root, { storyId: options.storyId });
  } catch (error) {
    readiness = { status: 'error', ready_for_pr_create: false, error: error instanceof Error ? error.message : String(error) };
  }
  if (readiness.status === 'error' && /story|select/i.test(readiness.error ?? '')) {
    return { ...base, decision: 'allow', surface, reason: `no selected story to guard (${readiness.error})` };
  }
  if (readiness.ready_for_pr_create === true) {
    return { ...base, decision: 'allow', surface, story_id: readiness.story_id, reason: 'gate readiness is ready_for_pr_create=true' };
  }
  const blockingGates = (readiness.gates ?? []).filter((gate) => gate.blocking === true || gate.critical === true);
  const bypassReason = String(options.bypassReason ?? '').trim();
  if (bypassReason) {
    const entry = {
      reason: bypassReason,
      command,
      surface: surface.id,
      story_id: readiness.story_id ?? null,
      head_sha: await resolveHeadSha(root),
      recorded_at: new Date().toISOString()
    };
    const logPath = path.join(getWorkspaceDir(root), 'guard', 'bypass-log.jsonl');
    await mkdir(path.dirname(logPath), { recursive: true });
    await appendFile(logPath, `${JSON.stringify(entry)}\n`, 'utf8');
    return {
      ...base,
      decision: 'bypass',
      surface,
      story_id: readiness.story_id ?? null,
      bypass: entry,
      bypass_log: toWorkspaceRelative(root, logPath),
      reason: `guard bypassed with recorded reason: ${bypassReason}`
    };
  }
  return {
    ...base,
    decision: 'block',
    surface,
    story_id: readiness.story_id ?? null,
    overall_status: readiness.overall_status ?? null,
    blocking_gates: blockingGates.map((gate) => ({ id: gate.id, status: gate.status, label: gate.label })),
    reason: `release surface "${surface.id}" is blocked: story ${readiness.story_id ?? '(unknown)'} is not ready_for_pr_create`
      + (blockingGates.length > 0 ? `; blocking gates: ${blockingGates.map((gate) => `${gate.label ?? gate.id}:${gate.status}`).join(', ')}` : ''),
    next_commands: [
      `vibepro pr prepare . --story-id ${readiness.story_id ?? '<story-id>'}`,
      'vibepro pr create . (VibePro経由のPR作成・throwベースのenforcementを通す)',
      'set VIBEPRO_GUARD_BYPASS="<reason>" only for a genuine emergency; the bypass is recorded for audit'
    ]
  };
}

export function parsePreToolUseInput(rawStdin) {
  try {
    const parsed = JSON.parse(rawStdin);
    const command = parsed?.tool_input?.command ?? parsed?.command ?? '';
    return typeof command === 'string' ? command : '';
  } catch {
    return '';
  }
}

export function parsePrePushRefs(rawStdin, protectedBranches) {
  const refs = String(rawStdin ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, , remoteRef] = line.split(/\s+/);
      return { local_ref: localRef ?? '', remote_ref: remoteRef ?? '' };
    });
  const protectedRefs = refs.filter((ref) => (
    protectedBranches.some((branch) => ref.remote_ref === `refs/heads/${branch}`)
  ));
  return { refs, protected_refs: protectedRefs };
}

export async function installGuard(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const results = { hook: null, claude: null };
  if (options.prePush !== false) {
    results.hook = await installPrePushHook(root);
  }
  if (options.claude) {
    results.claude = await installClaudeHook(root);
  }
  return results;
}

async function installPrePushHook(root) {
  const gitDir = (await execFileAsync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root })).stdout.trim();
  const hooksDir = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
  const hookPath = path.join(hooksDir, 'pre-push');
  const existing = await readFile(hookPath, 'utf8').catch(() => null);
  if (existing !== null && !existing.includes(GUARD_HOOK_MARKER)) {
    throw new Error(`guard install: a non-vibepro pre-push hook already exists at ${hookPath}; refusing to overwrite. Chain it manually or remove it first.`);
  }
  const script = buildPrePushHookScript();
  await mkdir(hooksDir, { recursive: true });
  await writeFile(hookPath, script, 'utf8');
  await chmod(hookPath, 0o755);
  return { path: hookPath, status: existing === null ? 'installed' : 'reinstalled' };
}

function buildPrePushHookScript() {
  return `#!/bin/sh
${GUARD_HOOK_MARKER}
# Managed by \`vibepro guard install\`. Delegates protected-branch pushes to
# \`vibepro guard check\`; other refs pass through untouched. If the vibepro CLI
# is not on PATH the hook allows the push instead of bricking git (boundary
# documented in the release-surface-guard architecture doc).
command -v \${VIBEPRO_GUARD_BIN:-vibepro} >/dev/null 2>&1 || exit 0
exec \${VIBEPRO_GUARD_BIN:-vibepro} guard check "$(git rev-parse --show-toplevel)" --pre-push "$1" <&0
`;
}

const CLAUDE_GUARD_HOOK_COMMAND = 'vibepro guard check . --pretooluse';

async function installClaudeHook(root) {
  const settingsPath = path.join(root, '.claude', 'settings.json');
  let settings = {};
  const existing = await readFile(settingsPath, 'utf8').catch(() => null);
  if (existing !== null) {
    try {
      settings = JSON.parse(existing);
    } catch (error) {
      throw new Error(`guard install --claude: ${settingsPath} is not valid JSON: ${error.message}`);
    }
  }
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const preToolUse = Array.isArray(hooks.PreToolUse) ? hooks.PreToolUse : [];
  const alreadyInstalled = preToolUse.some((entry) => (
    (entry?.hooks ?? []).some((hook) => String(hook?.command ?? '').includes('vibepro guard check'))
  ));
  if (!alreadyInstalled) {
    preToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: CLAUDE_GUARD_HOOK_COMMAND }]
    });
  }
  const next = {
    ...settings,
    hooks: {
      ...hooks,
      PreToolUse: preToolUse
    }
  };
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { path: settingsPath, status: alreadyInstalled ? 'already_installed' : 'installed' };
}

export async function uninstallGuard(repoRoot) {
  const root = path.resolve(repoRoot);
  const gitDir = (await execFileAsync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root })).stdout.trim();
  const hooksDir = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
  const hookPath = path.join(hooksDir, 'pre-push');
  const existing = await readFile(hookPath, 'utf8').catch(() => null);
  if (existing === null) return { status: 'not_installed' };
  if (!existing.includes(GUARD_HOOK_MARKER)) {
    throw new Error('guard uninstall: pre-push hook is not managed by vibepro; refusing to remove it');
  }
  await rm(hookPath);
  return { status: 'uninstalled', path: hookPath };
}

export async function guardStatus(repoRoot) {
  const root = path.resolve(repoRoot);
  const config = await readGuardConfig(root);
  let hookStatus = 'not_installed';
  try {
    const gitDir = (await execFileAsync('git', ['rev-parse', '--git-path', 'hooks'], { cwd: root })).stdout.trim();
    const hooksDir = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
    const existing = await readFile(path.join(hooksDir, 'pre-push'), 'utf8').catch(() => null);
    if (existing !== null) hookStatus = existing.includes(GUARD_HOOK_MARKER) ? 'installed' : 'foreign_hook';
  } catch {
    hookStatus = 'no_git_repository';
  }
  let claudeHookStatus = 'not_installed';
  try {
    const settings = JSON.parse(await readFile(path.join(root, '.claude', 'settings.json'), 'utf8'));
    const preToolUse = settings?.hooks?.PreToolUse ?? [];
    if (preToolUse.some((entry) => (entry?.hooks ?? []).some((hook) => String(hook?.command ?? '').includes('vibepro guard check')))) {
      claudeHookStatus = 'installed';
    }
  } catch {
    claudeHookStatus = 'not_installed';
  }
  let bypassCount = 0;
  try {
    const log = await readFile(path.join(getWorkspaceDir(root), 'guard', 'bypass-log.jsonl'), 'utf8');
    bypassCount = log.split(/\r?\n/).filter(Boolean).length;
  } catch {
    bypassCount = 0;
  }
  return {
    enabled: config.enabled,
    workspace_initialized: config.workspace_initialized,
    protected_branches: config.protected_branches,
    release_pattern_count: config.release_patterns.length,
    pre_push_hook: hookStatus,
    claude_pretooluse_hook: claudeHookStatus,
    bypass_count: bypassCount
  };
}

async function resolveHeadSha(root) {
  try {
    return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  } catch {
    return null;
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
