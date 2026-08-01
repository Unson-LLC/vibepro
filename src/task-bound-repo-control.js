function fail(reasonCode) {
  return {
    eligible: false,
    unsafe_for_atomic_override: true,
    reason_code: reasonCode
  };
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isExactRepositoryPath(value) {
  if (!isNonEmptyString(value)) return false;
  const candidate = value.trim();
  return candidate === value
    && !candidate.startsWith('/')
    && !candidate.startsWith('./')
    && !candidate.startsWith('../')
    && !candidate.includes('\\')
    && !/[*?[\]{}]/.test(candidate);
}

export function inspectTypedTaskGroups(targetGroups) {
  if (!Array.isArray(targetGroups)) {
    return { mode: 'invalid', reason_code: 'invalid_typed_task_groups' };
  }
  const hasTypedMarker = targetGroups.some((group) => (
    group && typeof group === 'object' && !Array.isArray(group)
      ? Object.hasOwn(group, 'classification')
      : false
  ));
  if (!hasTypedMarker) {
    return { mode: 'legacy', reason_code: 'legacy_untyped_task_groups' };
  }
  if (targetGroups.length === 0 || targetGroups.some((group) => (
    !group
    || typeof group !== 'object'
    || Array.isArray(group)
    || !isNonEmptyString(group.id)
    || !isNonEmptyString(group.classification)
    || !Array.isArray(group.target_files)
    || group.target_files.some((file) => !isNonEmptyString(file))
    || !Array.isArray(group.depends_on)
    || group.depends_on.some((dependency) => !isNonEmptyString(dependency))
  ))) {
    return { mode: 'invalid', reason_code: 'invalid_typed_task_groups' };
  }
  const groupIds = targetGroups.map((group) => group.id);
  if (new Set(groupIds).size !== groupIds.length) {
    return { mode: 'invalid', reason_code: 'duplicate_task_group_id' };
  }
  const knownIds = new Set(groupIds);
  if (targetGroups.some((group) => group.depends_on.some((dependency) => !knownIds.has(dependency)))) {
    return { mode: 'invalid', reason_code: 'unknown_task_group_dependency' };
  }
  return { mode: 'typed', groups: targetGroups };
}

export function evaluateTaskBoundRepoControl({ taskContext, repoControlFiles }) {
  if (!taskContext?.task || !isNonEmptyString(taskContext.task.id)) {
    return fail('task_context_missing');
  }
  if (!Array.isArray(repoControlFiles) || repoControlFiles.length === 0) {
    return fail('repo_control_paths_missing');
  }

  const inspection = inspectTypedTaskGroups(taskContext.task.target_groups);
  if (inspection.mode !== 'typed') {
    return fail(inspection.reason_code);
  }

  const repoControlGroups = inspection.groups.filter((group) => group.classification === 'repo_control');
  const nonRepoControlGroups = inspection.groups.filter((group) => group.classification !== 'repo_control');
  if (repoControlGroups.length === 0 || nonRepoControlGroups.length === 0) {
    return fail('repo_control_group_missing');
  }
  const nonRepoControlIds = new Set(nonRepoControlGroups.map((group) => group.id));
  const adjacency = new Map(inspection.groups.map((group) => [group.id, new Set()]));
  const dependencyEdges = [];
  for (const group of inspection.groups) {
    for (const dependency of group.depends_on) {
      adjacency.get(group.id).add(dependency);
      adjacency.get(dependency).add(group.id);
      dependencyEdges.push({ from: group.id, to: dependency });
    }
  }
  for (const group of repoControlGroups) {
    const visited = new Set([group.id]);
    const pending = [group.id];
    let connectsToNonRepoControl = false;
    while (pending.length > 0 && !connectsToNonRepoControl) {
      const current = pending.shift();
      for (const neighbor of adjacency.get(current)) {
        if (visited.has(neighbor)) continue;
        if (nonRepoControlIds.has(neighbor)) {
          connectsToNonRepoControl = true;
          break;
        }
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    if (!connectsToNonRepoControl) {
      return fail('repo_control_group_disconnected');
    }
  }

  const declaredPaths = repoControlGroups.flatMap((group) => group.target_files);
  if (
    declaredPaths.length === 0
    || declaredPaths.some((file) => !isExactRepositoryPath(file))
    || repoControlFiles.some((file) => !isExactRepositoryPath(file))
  ) {
    return fail('repo_control_path_coverage_mismatch');
  }
  const declaredPathSet = new Set(declaredPaths);
  const coveredPaths = [...new Set(repoControlFiles)].sort();
  if (coveredPaths.some((file) => !declaredPathSet.has(file))) {
    return fail('repo_control_path_coverage_mismatch');
  }

  return {
    eligible: true,
    unsafe_for_atomic_override: false,
    reason_code: 'task_bound_repo_control_connected',
    proof: {
      task_id: taskContext.task.id,
      task_state_path: taskContext.task_state_path ?? null,
      covered_repo_control_paths: coveredPaths,
      repo_control_group_ids: repoControlGroups.map((group) => group.id).sort(),
      dependency_edges: dependencyEdges.sort((left, right) => (
        left.from.localeCompare(right.from) || left.to.localeCompare(right.to)
      ))
    }
  };
}
