import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildRuntimeDoctorCheck, collectRuntimeInfo } from './runtime-info.js';
import { getWorkspaceDir, MANIFEST_FILE, SCHEMA_VERSION, toWorkspaceRelative, writeManifest, WORKSPACE_DIR } from './workspace.js';

const REQUIRED_GITIGNORE_LINE = `${WORKSPACE_DIR}/`;

export async function runDoctor(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const workspaceDir = getWorkspaceDir(root);
  const manifestPath = path.join(workspaceDir, MANIFEST_FILE);
  const configPath = path.join(workspaceDir, 'config.json');
  const result = {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    mode: 'doctor',
    fix: Boolean(options.fix),
    workspace: {
      initialized: false,
      path: '.vibepro'
    },
    overall_status: 'pass',
    checks: [],
    repairs: [],
    next_commands: [],
    next_actions: [],
    artifacts: {},
    toolchain: await collectRuntimeInfo()
  };

  const manifest = await readJsonIfExists(manifestPath);
  if (!manifest) {
    result.overall_status = 'uninitialized';
    result.checks.push({
      id: 'VP-DOCTOR-UNINITIALIZED',
      severity: 'info',
      status: 'info',
      fixable: false,
      detail: '.vibepro workspaceが見つからない。',
      recommendation: 'vibepro init を実行してworkspaceを作成する。',
      next_actions: [buildAction({
        command: `vibepro init ${root}`,
        reason: '.vibepro workspace が存在しないため初期化する。',
        expected_after: 'vibepro status が initialized: true を返す。',
        safe_to_run: true
      })]
    });
    result.checks.push(buildRuntimeDoctorCheck(result.toolchain));
    applyNextActions(result);
    return result;
  }

  result.workspace.initialized = true;
  const config = await readJsonIfExists(configPath);
  let manifestChanged = false;
  let configChanged = false;

  if (!config) {
    result.checks.push({
      id: 'VP-DOCTOR-MISSING-CONFIG',
      severity: 'warning',
      status: 'manual',
      fixable: false,
      detail: '.vibepro/config.json が見つからない。',
      recommendation: 'vibepro init の初期化状態を確認し、必要ならconfigを復元する。',
      next_actions: [
        buildAction({
          command: `vibepro init ${root}`,
          reason: '.vibepro/config.json が欠けているため初期化状態を復元する。',
          expected_after: '.vibepro/config.json が存在する。',
          safe_to_run: true
        }),
        buildAction({
          command: `vibepro doctor ${root}`,
          reason: 'config復元後に管理情報の整合性を再点検する。',
          expected_after: 'VP-DOCTOR-MISSING-CONFIG が消える。',
          safe_to_run: true
        })
      ]
    });
  }

  const missingEvidence = await findMissingEvidenceRuns(root, manifest);
  if (missingEvidence.length > 0) {
    result.checks.push({
      id: 'VP-DOCTOR-MISSING-EVIDENCE',
      severity: 'warning',
      status: options.fix ? 'fixed' : 'fixable',
      fixable: true,
      detail: `${missingEvidence.length} 件の診断runが存在しないevidenceを参照している。`,
      recommendation: 'run成果物を復元するか、不要なrun参照をmanifestから整理する。',
      next_actions: [buildAction({
        command: `vibepro doctor ${root} --fix`,
        reason: '存在しない evidence を参照する診断runを管理目録から整理する。',
        expected_after: 'VP-DOCTOR-MISSING-EVIDENCE が消える。',
        safe_to_run: true
      })],
      items: missingEvidence
    });
  }

  if (options.fix && missingEvidence.length > 0) {
    const repair = removeMissingEvidenceRuns(manifest, missingEvidence);
    manifestChanged = true;
    result.repairs.push(repair);
  }

  if (config) {
    const missingCurrentStory = findMissingCurrentStory(config);
    if (missingCurrentStory) {
      result.checks.push({
        id: 'VP-DOCTOR-CURRENT-STORY-MISSING',
        severity: 'warning',
        status: options.fix ? 'fixed' : 'fixable',
        fixable: true,
        detail: `current_story_id が存在しないStoryを参照している: ${missingCurrentStory.story_id}`,
        recommendation: '存在するactive Storyを選択し直すか、不要なcurrent_story_idを解除する。',
        next_actions: [buildAction({
          command: `vibepro doctor ${root} --fix`,
          reason: '存在しない current_story_id を解除する。',
          expected_after: 'VP-DOCTOR-CURRENT-STORY-MISSING が消える。',
          safe_to_run: true
        })],
        items: [missingCurrentStory]
      });
      if (options.fix) {
        config.brainbase.current_story_id = null;
        configChanged = true;
        result.repairs.push({
          id: 'clear-missing-current-story',
          detail: '存在しないcurrent_story_idを解除した。',
          story_id: missingCurrentStory.story_id
        });
      }
    }
  }

  const staleLatestRunRefs = findStaleLatestRunRefs(manifest);
  if (staleLatestRunRefs.length > 0) {
    result.checks.push({
      id: 'VP-DOCTOR-STALE-LATEST-RUN-REFS',
      severity: 'warning',
      status: options.fix ? 'fixed' : 'fixable',
      fixable: true,
      detail: `${staleLatestRunRefs.length} 件のlatest run参照が存在しないrunを指している。`,
      recommendation: '不要なlatest_run参照をmanifestから整理する。',
      next_actions: [buildAction({
        command: `vibepro doctor ${root} --fix`,
        reason: '存在しないrunを指す latest_run 参照を解除する。',
        expected_after: 'VP-DOCTOR-STALE-LATEST-RUN-REFS が消える。',
        safe_to_run: true
      })],
      items: staleLatestRunRefs
    });
    if (options.fix) {
      result.repairs.push(removeStaleLatestRunRefs(manifest, staleLatestRunRefs));
      manifestChanged = true;
    }
  }

  const missingGraphifyArtifacts = await findMissingArtifactRefs(root, manifest, [
    'graphify_json',
    'graphify_report'
  ]);
  if (missingGraphifyArtifacts.length > 0) {
    result.checks.push({
      id: 'VP-DOCTOR-MISSING-GRAPHIFY-ARTIFACTS',
      severity: 'warning',
      status: options.fix ? 'fixed' : 'fixable',
      fixable: true,
      detail: `${missingGraphifyArtifacts.length} 件のgraphify成果物参照が存在しないファイルを指している。`,
      recommendation: 'vibepro graph または vibepro story derive --run-graphify を実行してGraph成果物を作り直す。',
      next_actions: [
        buildAction({
          command: `vibepro doctor ${root} --fix`,
          reason: '存在しないgraphify成果物参照を管理目録から解除する。',
          expected_after: '欠けたgraphify artifact参照がmanifestから消える。',
          safe_to_run: true
        }),
        buildAction({
          command: `vibepro story derive ${root} --run-graphify`,
          reason: 'Graphを再生成してStory Mapの根拠を更新する。',
          expected_after: '.vibepro/graphify/graph.json と story-catalog.json が更新される。',
          safe_to_run: true
        })
      ],
      items: missingGraphifyArtifacts
    });
    if (options.fix) {
      result.repairs.push(removeMissingArtifactRefs(manifest, missingGraphifyArtifacts));
      manifestChanged = true;
    }
  }

  const storyCatalogDrift = config ? await findStoryCatalogDrift(root, config) : null;
  if (storyCatalogDrift && (storyCatalogDrift.missing_in_config.length > 0 || storyCatalogDrift.stale_derived_config.length > 0)) {
    result.checks.push({
      id: 'VP-DOCTOR-STORY-CATALOG-DRIFT',
      severity: 'warning',
      status: options.fix ? 'fixed' : 'fixable',
      fixable: true,
      detail: `Story catalog と config stories に差分がある。missing=${storyCatalogDrift.missing_in_config.length}, stale=${storyCatalogDrift.stale_derived_config.length}`,
      recommendation: 'vibepro story derive を再実行するか、config storiesをcatalogに合わせて整理する。',
      next_actions: [
        buildAction({
          command: `vibepro doctor ${root} --fix`,
          reason: 'Story catalog と config stories の差分を管理情報上で整理する。',
          expected_after: 'VP-DOCTOR-STORY-CATALOG-DRIFT が消える。',
          safe_to_run: true
        }),
        buildAction({
          command: `vibepro story derive ${root}`,
          reason: 'Story Mapを再生成して派生Storyの正本を更新する。',
          expected_after: 'story-catalog.json と config stories が揃う。',
          safe_to_run: true
        })
      ],
      items: storyCatalogDrift
    });
    if (options.fix) {
      result.repairs.push(applyStoryCatalogDriftFix(config, storyCatalogDrift));
      configChanged = true;
    }
  }

  const gitignoreState = await checkGitignore(root);
  if (gitignoreState.needs_update) {
    result.checks.push({
      id: 'VP-DOCTOR-GITIGNORE-MISSING',
      severity: 'warning',
      status: options.fix ? 'fixed' : 'fixable',
      fixable: true,
      detail: gitignoreState.exists
        ? `.gitignore に ${REQUIRED_GITIGNORE_LINE} が含まれていない。`
        : '.gitignore が存在せず .vibepro/ が無視されない。',
      recommendation: 'vibepro doctor --fix または vibepro init で .gitignore に .vibepro/ を追記する。',
      next_actions: [buildAction({
        command: `vibepro doctor ${root} --fix`,
        reason: '.vibepro/ が git に含まれないように .gitignore を更新する。',
        expected_after: 'VP-DOCTOR-GITIGNORE-MISSING が消える。',
        safe_to_run: true
      })],
      items: [{ path: '.gitignore', required_line: REQUIRED_GITIGNORE_LINE }]
    });
    if (options.fix) {
      await applyGitignoreFix(root, gitignoreState);
      result.repairs.push({
        id: 'ensure-gitignore-vibepro',
        detail: `.gitignore に ${REQUIRED_GITIGNORE_LINE} を追記した。`,
        path: '.gitignore'
      });
    }
  }

  const missingTaskRefs = await findMissingTaskWorkflowRefs(root);
  if (missingTaskRefs.length > 0) {
    result.checks.push({
      id: 'VP-DOCTOR-MISSING-TASK-WORKFLOW-REFS',
      severity: 'warning',
      status: 'manual',
      fixable: false,
      detail: `${missingTaskRefs.length} 件のtask workflow成果物が存在しない参照を持っている。`,
      recommendation: '該当taskで vibepro task brief / plan / handoff / execute を再実行する。',
      next_actions: buildTaskWorkflowRepairActions(root, missingTaskRefs),
      items: missingTaskRefs
    });
  }

  if (configChanged) await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
  if (manifestChanged) await writeManifest(root, manifest);

  result.checks.push(buildRuntimeDoctorCheck(result.toolchain));
  result.overall_status = resolveDoctorStatus(result);
  applyNextActions(result);
  if (options.writeArtifacts !== false) await writeDoctorArtifact(root, result);
  return result;
}

export function renderDoctor(result) {
  const checks = result.checks.length === 0
    ? '- なし'
    : result.checks.map((check) => `- ${check.id}: ${check.status} - ${check.detail}`).join('\n');
  const repairs = result.repairs.length === 0
    ? '- なし'
    : result.repairs.map((repair) => `- ${repair.id}: ${repair.detail}`).join('\n');
  const nextCommands = result.next_commands.length === 0
    ? '- なし'
    : result.next_actions.map((action) => `- \`${action.command}\`
  - reason: ${action.reason}
  - expected: ${action.expected_after}
  - safe_to_run: ${action.safe_to_run}`).join('\n');
  return `# VibePro Doctor

| 項目 | 内容 |
|------|------|
| Initialized | ${result.workspace.initialized ? 'yes' : 'no'} |
| Overall | ${result.overall_status} |
| Fix | ${result.fix ? 'yes' : 'no'} |

## Checks

${checks}

## Repairs

${repairs}

## Next Commands

${nextCommands}
`;
}

async function checkGitignore(repoRoot) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  let content = null;
  try {
    content = await readFile(gitignorePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (content === null) {
    return { exists: false, content: '', needs_update: true };
  }
  const lines = content.split(/\r?\n/).map((line) => line.trim());
  const hasRequired = lines.includes(REQUIRED_GITIGNORE_LINE);
  return { exists: true, content, needs_update: !hasRequired };
}

async function applyGitignoreFix(repoRoot, state) {
  const gitignorePath = path.join(repoRoot, '.gitignore');
  const existing = state.content ?? '';
  const prefix = existing.trim().length > 0 ? `${existing.trimEnd()}\n` : '';
  await writeFile(gitignorePath, `${prefix}${REQUIRED_GITIGNORE_LINE}\n`);
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function findMissingEvidenceRuns(repoRoot, manifest) {
  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  const missing = [];
  for (const run of runs) {
    const evidencePath = run.artifacts?.evidence;
    if (!evidencePath) continue;
    if (!await fileExists(path.resolve(repoRoot, evidencePath))) {
      missing.push({
        run_id: run.run_id,
        story_id: run.story_id ?? null,
        path: evidencePath
      });
    }
  }
  return missing;
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function removeMissingEvidenceRuns(manifest, missingEvidence) {
  const missingIds = new Set(missingEvidence.map((item) => item.run_id));
  const beforeCount = Array.isArray(manifest.runs) ? manifest.runs.length : 0;
  manifest.runs = (manifest.runs ?? []).filter((run) => !missingIds.has(run.run_id));
  if (missingIds.has(manifest.latest_run)) {
    manifest.latest_run = manifest.runs[0]?.run_id ?? null;
  }
  if (manifest.latest_run_by_story) {
    manifest.latest_run_by_story = Object.fromEntries(Object.entries(manifest.latest_run_by_story)
      .filter(([, runId]) => !missingIds.has(runId)));
  }
  return {
    id: 'remove-missing-evidence-runs',
    detail: `${beforeCount - manifest.runs.length} 件の欠けた診断run参照をmanifestから除去した。`,
    removed_run_ids: [...missingIds]
  };
}

function findMissingCurrentStory(config) {
  const storyId = config.brainbase?.current_story_id ?? null;
  if (!storyId) return null;
  const stories = Array.isArray(config.brainbase?.stories) ? config.brainbase.stories : [];
  const exists = stories.some((story) => story.story_id === storyId && story.status !== 'archived');
  return exists ? null : { story_id: storyId };
}

function findStaleLatestRunRefs(manifest) {
  const runs = Array.isArray(manifest.runs) ? manifest.runs : [];
  const runIds = new Set(runs.map((run) => run.run_id));
  const stale = [];
  if (manifest.latest_run && !runIds.has(manifest.latest_run)) {
    stale.push({ field: 'latest_run', run_id: manifest.latest_run });
  }
  for (const [storyId, runId] of Object.entries(manifest.latest_run_by_story ?? {})) {
    if (!runIds.has(runId)) {
      stale.push({ field: 'latest_run_by_story', story_id: storyId, run_id: runId });
    }
  }
  return stale;
}

function removeStaleLatestRunRefs(manifest, staleRefs) {
  const staleLatest = staleRefs.find((item) => item.field === 'latest_run');
  if (staleLatest) manifest.latest_run = manifest.runs?.[0]?.run_id ?? null;
  const staleStories = new Set(staleRefs
    .filter((item) => item.field === 'latest_run_by_story')
    .map((item) => item.story_id));
  if (manifest.latest_run_by_story && staleStories.size > 0) {
    manifest.latest_run_by_story = Object.fromEntries(Object.entries(manifest.latest_run_by_story)
      .filter(([storyId]) => !staleStories.has(storyId)));
  }
  return {
    id: 'remove-stale-latest-run-refs',
    detail: `${staleRefs.length} 件の存在しないlatest run参照をmanifestから除去した。`,
    removed_refs: staleRefs
  };
}

async function findMissingArtifactRefs(repoRoot, manifest, artifactKeys) {
  const artifacts = manifest.artifacts ?? {};
  const missing = [];
  for (const key of artifactKeys) {
    const artifactPath = artifacts[key];
    if (!artifactPath) continue;
    if (!await fileExists(path.resolve(repoRoot, artifactPath))) {
      missing.push({ key, path: artifactPath });
    }
  }
  return missing;
}

function removeMissingArtifactRefs(manifest, missingArtifacts) {
  for (const item of missingArtifacts) {
    delete manifest.artifacts?.[item.key];
  }
  return {
    id: 'remove-missing-artifact-refs',
    detail: `${missingArtifacts.length} 件の存在しないartifact参照をmanifestから除去した。`,
    removed_artifacts: missingArtifacts
  };
}

async function findStoryCatalogDrift(repoRoot, config) {
  const catalogPath = path.join(getWorkspaceDir(repoRoot), 'stories', 'story-catalog.json');
  const catalog = await readJsonIfExists(catalogPath);
  if (!catalog) return null;
  const catalogStories = Array.isArray(catalog.stories) ? catalog.stories : [];
  const configStories = Array.isArray(config.brainbase?.stories) ? config.brainbase.stories : [];
  const configIds = new Set(configStories.map((story) => story.story_id));
  const catalogIds = new Set(catalogStories.map((story) => story.story_id));
  return {
    catalog: toWorkspaceRelative(repoRoot, catalogPath),
    missing_in_config: catalogStories
      .filter((story) => !configIds.has(story.story_id))
      .map(toConfigStory),
    stale_derived_config: configStories
      .filter((story) => story.status !== 'archived')
      .filter((story) => story.derived_by === 'vibepro-story-derive')
      .filter((story) => !catalogIds.has(story.story_id))
      .map((story) => ({ story_id: story.story_id, title: story.title }))
  };
}

function applyStoryCatalogDriftFix(config, drift) {
  const stories = Array.isArray(config.brainbase?.stories) ? config.brainbase.stories : [];
  const staleIds = new Set(drift.stale_derived_config.map((story) => story.story_id));
  for (const story of stories) {
    if (staleIds.has(story.story_id)) story.status = 'archived';
  }
  config.brainbase = {
    ...(config.brainbase ?? {}),
    stories: [...stories, ...drift.missing_in_config]
  };
  if (staleIds.has(config.brainbase.current_story_id)) {
    config.brainbase.current_story_id = null;
  }
  return {
    id: 'sync-story-catalog-config',
    detail: `catalogから ${drift.missing_in_config.length} Storyをconfigへ追加し、${drift.stale_derived_config.length} Storyをarchivedにした。`,
    added_story_ids: drift.missing_in_config.map((story) => story.story_id),
    archived_story_ids: drift.stale_derived_config.map((story) => story.story_id)
  };
}

function toConfigStory(story) {
  return {
    story_id: story.story_id,
    title: story.title,
    ssot: story.ssot ?? 'local',
    status: story.status ?? 'active',
    horizon: story.horizon ?? null,
    view: story.view ?? null,
    period: story.period ?? null,
    started_at: story.started_at ?? null,
    due_at: story.due_at ?? null,
    category: story.category ?? null,
    derived_by: 'vibepro-story-derive'
  };
}

async function findMissingTaskWorkflowRefs(repoRoot) {
  const storiesDir = path.join(getWorkspaceDir(repoRoot), 'stories');
  const storyDirs = await readDirectories(storiesDir);
  const missing = [];
  for (const storyId of storyDirs) {
    const tasksPath = path.join(storiesDir, storyId, 'tasks', 'tasks.json');
    const taskState = await readJsonIfExists(tasksPath);
    const tasks = Array.isArray(taskState?.tasks) ? taskState.tasks : [];
    for (const task of tasks) {
      const taskDir = path.join(storiesDir, storyId, 'tasks', safeSegment(task.id));
      missing.push(...await findMissingWorkflowRefsInDir(repoRoot, storyId, task.id, null, taskDir));
      const groupsDir = path.join(taskDir, 'groups');
      for (const groupId of await readDirectories(groupsDir)) {
        missing.push(...await findMissingWorkflowRefsInDir(repoRoot, storyId, task.id, groupId, path.join(groupsDir, groupId)));
      }
    }
  }
  return missing;
}

async function findMissingWorkflowRefsInDir(repoRoot, storyId, taskId, groupId, workflowDir) {
  const missing = [];
  const handoffPath = path.join(workflowDir, 'handoff.json');
  const handoff = await readJsonIfExists(handoffPath);
  if (handoff) {
    missing.push(...await findMissingReferencePaths(repoRoot, handoff.references, {
      source: toWorkspaceRelative(repoRoot, handoffPath),
      story_id: storyId,
      task_id: taskId,
      group_id: groupId,
      artifact: 'handoff',
      repair_command: buildTaskWorkflowRepairCommand(repoRoot, storyId, taskId, groupId, 'handoff')
    }));
  }
  const executionPath = path.join(workflowDir, 'execution.json');
  const execution = await readJsonIfExists(executionPath);
  if (execution) {
    missing.push(...await findMissingReferencePaths(repoRoot, execution.references, {
      source: toWorkspaceRelative(repoRoot, executionPath),
      story_id: storyId,
      task_id: taskId,
      group_id: groupId,
      artifact: 'execution',
      repair_command: buildTaskWorkflowRepairCommand(repoRoot, storyId, taskId, groupId, 'execute')
    }));
  }
  return missing;
}

async function findMissingReferencePaths(repoRoot, references = {}, context) {
  const missing = [];
  for (const [key, referencePath] of Object.entries(references ?? {})) {
    if (!referencePath || !key.endsWith('_json') && !key.endsWith('_markdown')) continue;
    if (!await fileExists(path.resolve(repoRoot, referencePath))) {
      missing.push({ ...context, key, path: referencePath });
    }
  }
  return missing;
}

async function readDirectories(dirPath) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function safeSegment(value) {
  return String(value ?? '').replace(/[\\/]/g, '_');
}

function buildTaskWorkflowRepairCommand(repoRoot, storyId, taskId, groupId, artifact) {
  const subcommand = artifact === 'execution' ? 'execute' : 'handoff';
  return [
    'vibepro task',
    subcommand,
    repoRoot,
    '--task',
    taskId,
    '--id',
    storyId,
    groupId ? `--group ${groupId}` : null
  ].filter(Boolean).join(' ');
}

function buildTaskWorkflowRepairCommands(repoRoot, missingTaskRefs) {
  const commands = uniqueStrings(missingTaskRefs.map((item) => item.repair_command).filter(Boolean));
  if (commands.length > 0) return commands;
  const fallback = missingTaskRefs[0];
  if (!fallback) return [];
  return [buildTaskWorkflowRepairCommand(repoRoot, fallback.story_id, fallback.task_id, fallback.group_id, fallback.artifact)];
}

function buildTaskWorkflowRepairActions(repoRoot, missingTaskRefs) {
  return buildTaskWorkflowRepairCommands(repoRoot, missingTaskRefs).map((command) => buildAction({
    command,
    reason: 'task workflow成果物が参照する briefing / plan / handoff が欠けている。',
    expected_after: 'VP-DOCTOR-MISSING-TASK-WORKFLOW-REFS が消える。',
    safe_to_run: true
  }));
}

function applyNextActions(result) {
  const actions = [];
  for (const check of result.checks) {
    for (const action of check.next_actions ?? []) {
      actions.push(action);
    }
  }
  if (result.workspace.initialized && result.overall_status === 'needs_maintenance' && actions.length === 0) {
    actions.push(buildAction({
      command: 'vibepro doctor <repo> --fix',
      reason: '管理情報に修復可能な不整合がある。',
      expected_after: 'doctor の fixable なチェックが消える。',
      safe_to_run: true
    }));
  }
  result.next_actions = uniqueActions(actions);
  result.next_commands = result.next_actions.map((action) => action.command);
}

function buildAction({ command, reason, expected_after, safe_to_run }) {
  return { command, reason, expected_after, safe_to_run };
}

function uniqueActions(actions) {
  const seen = new Set();
  const unique = [];
  for (const action of actions) {
    if (seen.has(action.command)) continue;
    seen.add(action.command);
    unique.push(action);
  }
  return unique;
}

function uniqueStrings(items) {
  return [...new Set(items)];
}

function resolveDoctorStatus(result) {
  if (!result.workspace.initialized) return 'uninitialized';
  if (result.checks.some((check) => check.status === 'fixable')) return 'needs_maintenance';
  if (result.checks.some((check) => check.status === 'manual')) return 'needs_maintenance';
  if (result.checks.some((check) => check.status === 'fixed')) return 'fixed';
  return 'pass';
}

async function writeDoctorArtifact(repoRoot, result) {
  if (!result.workspace.initialized) return;
  const doctorDir = path.join(getWorkspaceDir(repoRoot), 'doctor');
  await mkdir(doctorDir, { recursive: true });
  const jsonPath = path.join(doctorDir, 'doctor-result.json');
  const markdownPath = path.join(doctorDir, 'doctor-result.md');
  result.artifacts = {
    json: toWorkspaceRelative(repoRoot, jsonPath),
    markdown: toWorkspaceRelative(repoRoot, markdownPath)
  };
  await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(markdownPath, renderDoctor(result));
}
