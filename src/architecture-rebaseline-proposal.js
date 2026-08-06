import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DEFAULT_TARGET_MODEL_PATH,
  assignFilesToModules,
  buildImportDependencyEdges,
  collectScopeSource,
  loadTargetModel
} from './architecture-conformance.js';
import { WORKSPACE_DIR } from './workspace.js';

export const REBASELINE_PROPOSAL_SCHEMA_VERSION = '0.1.0';

// A file's consumers say more about which module owns it than its own dependencies do: an orphan
// imported only by `review` belongs to `review` even if it happens to import three workspace-infra
// helpers (everything imports workspace-infra). Hence consumer edges are weighted above dependency
// edges. The weights are part of the artifact so a reader can audit the ranking rather than trust it.
export const CONSUMER_EDGE_WEIGHT = 2;
export const DEPENDENCY_EDGE_WEIGHT = 1;
const MAX_CANDIDATES_PER_ORPHAN = 3;
const MAX_EVIDENCE_EDGES = 5;

// Generates a rebaseline proposal for the adjudicated target model (TMG-S-4/S-5/S-6).
//
// This generator is strictly read-only with respect to docs/architecture/target-model.json. Per the
// model's own `governance` block, assigning an orphan to an existing module is machine_maintainable
// while creating a module or declaring a new allowed dependency is human_adjudicated -- so the
// generator produces candidates plus their consequences and stops there. Applying the machine
// maintainable subset, and answering the adjudication cards, happen outside this module.
export async function runRebaselineProposal(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const modelPath = path.resolve(root, options.modelPath ?? DEFAULT_TARGET_MODEL_PATH);
  const parentDesign = options.parentDesign ?? null;
  const model = await loadTargetModel(modelPath);

  const { jsFiles, allFiles } = await collectScopeSource(root, model.scope_roots);
  if (jsFiles.length === 0) {
    throw new Error(
      `scope_roots (${model.scope_roots.join(', ')}) 配下に .js/.mjs/.cjs ファイルが見つからない。rebaseline proposal を生成できない。`
    );
  }
  const assignments = assignFilesToModules(jsFiles.map((entry) => entry.file), model.modules);
  const { edges } = buildImportDependencyEdges({ jsFiles, allFiles });

  const context = buildContext({ edges, assignments, model });
  const orphanAssignments = buildOrphanAssignments(context);
  const orphanClusters = buildOrphanClusters(context);
  const dependencyTriage = buildDependencyTriage(context);

  const proposal = {
    schema_version: REBASELINE_PROPOSAL_SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    model: {
      path: toRepoRelative(root, modelPath),
      version: model.model_version,
      status: model.status,
      governance_present: model.governance != null
    },
    ranking: {
      consumer_edge_weight: CONSUMER_EDGE_WEIGHT,
      dependency_edge_weight: DEPENDENCY_EDGE_WEIGHT,
      note: '候補モジュールのスコアは (被import元モジュールのedge数 × consumer_edge_weight) + (import先モジュールのedge数 × dependency_edge_weight)。同点はモジュール名の辞書順。allowed_dependencies が "*" のdispatcherモジュールは所有シグナルにならないため候補から除外する。',
      excluded_dispatcher_modules: model.modules
        .map((module) => module.name)
        .filter((name) => isDispatcherModule(context, name))
        .sort((a, b) => a.localeCompare(b))
    },
    summary: {
      orphan_count: context.orphans.length,
      orphan_with_candidate_count: orphanAssignments.filter((entry) => entry.candidates.length > 0).length,
      orphan_without_candidate_count: orphanAssignments.filter((entry) => entry.candidates.length === 0).length,
      orphan_cluster_count: orphanClusters.length,
      undeclared_dependency_count: dependencyTriage.length,
      declare_candidate_count: dependencyTriage.filter((entry) => entry.classification === 'declare_candidate').length,
      resolve_count: dependencyTriage.filter((entry) => entry.classification === 'resolve').length
    },
    orphan_assignments: orphanAssignments,
    orphan_clusters: orphanClusters,
    dependency_triage: dependencyTriage,
    human_adjudication_required: buildAdjudicationIndex({ orphanClusters, dependencyTriage })
  };

  if (options.write !== false) {
    const outDir = path.join(root, WORKSPACE_DIR, 'architecture', 'rebaseline');
    await mkdir(outDir, { recursive: true });
    const jsonPath = path.join(outDir, 'proposal.json');
    await writeFile(jsonPath, `${JSON.stringify(proposal, null, 2)}\n`);
    const mdPath = path.join(outDir, 'proposal.md');
    await writeFile(mdPath, renderRebaselineProposalMarkdown(proposal, { parentDesign }));
    proposal.artifacts = {
      json: toRepoRelative(root, jsonPath),
      markdown: toRepoRelative(root, mdPath)
    };
    if (options.outputPath) {
      const snapshotPath = path.resolve(root, options.outputPath);
      await mkdir(path.dirname(snapshotPath), { recursive: true });
      await writeFile(snapshotPath, renderRebaselineProposalMarkdown(proposal, { parentDesign }));
      proposal.artifacts.snapshot = toRepoRelative(root, snapshotPath);
    }
  }
  return proposal;
}

function buildContext({ edges, assignments, model }) {
  const orphans = [...assignments.orphans].sort((a, b) => a.localeCompare(b));
  const orphanSet = new Set(orphans);
  const allowed = new Map(
    Object.entries(model.allowed_dependencies).map(([from, toList]) => [from, new Set(toList)])
  );
  // Module-pair edge counts for files that already have a module, used both to classify undeclared
  // dependencies and to tell "this assignment creates a brand new violating pair" apart from "this
  // assignment adds edges to a pair that already violates".
  const modulePairEdges = new Map();
  for (const edge of edges) {
    const from = assignments.moduleByFile.get(edge.source_file);
    const to = assignments.moduleByFile.get(edge.target_file);
    if (!from || !to || from === to) continue;
    const key = `${from}->${to}`;
    modulePairEdges.set(key, (modulePairEdges.get(key) ?? 0) + 1);
  }
  return {
    orphans,
    orphanSet,
    allowed,
    modulePairEdges,
    edges,
    moduleByFile: assignments.moduleByFile,
    moduleNames: model.modules.map((module) => module.name)
  };
}

function isAllowed(context, from, to) {
  const targets = context.allowed.get(from);
  return Boolean(targets && (targets.has(to) || targets.has('*')));
}

// A module declared as depending on `*` (in this repo: `cli`) is a dispatcher: it imports every
// other module by design, so "cli imports this orphan" carries no ownership information -- without
// this exclusion the entrypoint would win the ranking for nearly every orphan it wires up. A
// dispatcher is therefore never proposed as an orphan's home module; its edges still appear in
// induced_dependencies, where they are always allowed and thus harmless.
export function isDispatcherModule(context, module) {
  return Boolean(context.allowed.get(module)?.has('*'));
}

// TMG-S-4/S-5. For each orphan, rank the existing modules that already exchange imports with it and
// attach, per candidate, the module-level dependencies the assignment would make visible.
function buildOrphanAssignments(context) {
  const outgoing = new Map();
  const incoming = new Map();
  for (const file of context.orphans) {
    outgoing.set(file, []);
    incoming.set(file, []);
  }
  for (const edge of context.edges) {
    if (context.orphanSet.has(edge.source_file)) outgoing.get(edge.source_file).push(edge);
    if (context.orphanSet.has(edge.target_file)) incoming.get(edge.target_file).push(edge);
  }

  return context.orphans.map((file) => {
    const dependencyEdges = outgoing.get(file)
      .filter((edge) => context.moduleByFile.has(edge.target_file))
      .sort((a, b) => a.target_file.localeCompare(b.target_file));
    const consumerEdges = incoming.get(file)
      .filter((edge) => context.moduleByFile.has(edge.source_file))
      .sort((a, b) => a.source_file.localeCompare(b.source_file));
    const orphanNeighbours = [
      ...outgoing.get(file).filter((edge) => context.orphanSet.has(edge.target_file)).map((edge) => edge.target_file),
      ...incoming.get(file).filter((edge) => context.orphanSet.has(edge.source_file)).map((edge) => edge.source_file)
    ];

    const scores = new Map();
    for (const edge of dependencyEdges) {
      const module = context.moduleByFile.get(edge.target_file);
      if (isDispatcherModule(context, module)) continue;
      addScore(scores, module, DEPENDENCY_EDGE_WEIGHT, 'dependency', `${file} -> ${edge.target_file}`);
    }
    for (const edge of consumerEdges) {
      const module = context.moduleByFile.get(edge.source_file);
      if (isDispatcherModule(context, module)) continue;
      addScore(scores, module, CONSUMER_EDGE_WEIGHT, 'consumer', `${edge.source_file} -> ${file}`);
    }

    const candidates = [...scores.entries()]
      .map(([module, entry]) => ({
        module,
        score: entry.score,
        consumer_edge_count: entry.consumer_edge_count,
        dependency_edge_count: entry.dependency_edge_count,
        evidence: entry.evidence.slice(0, MAX_EVIDENCE_EDGES),
        induced_dependencies: buildInducedDependencies(context, { file, module, dependencyEdges, consumerEdges })
      }))
      .sort((a, b) => (b.score - a.score) || a.module.localeCompare(b.module))
      .slice(0, MAX_CANDIDATES_PER_ORPHAN);

    return {
      file,
      candidates,
      orphan_neighbours: [...new Set(orphanNeighbours)].sort((a, b) => a.localeCompare(b)),
      recommendation: buildRecommendation(candidates)
    };
  });
}

function addScore(scores, module, weight, kind, evidence) {
  if (!scores.has(module)) {
    scores.set(module, { score: 0, consumer_edge_count: 0, dependency_edge_count: 0, evidence: [] });
  }
  const entry = scores.get(module);
  entry.score += weight;
  if (kind === 'consumer') entry.consumer_edge_count += 1;
  else entry.dependency_edge_count += 1;
  entry.evidence.push(evidence);
}

// TMG-S-5: assigning an orphan is not semantically neutral. Every import the orphan exchanges with a
// module other than its new home becomes a module-level dependency edge, and may become an
// undeclared-dependency violation that did not exist while the file was invisible to the model.
export function buildInducedDependencies(context, { module, dependencyEdges, consumerEdges }) {
  const pairs = new Map();
  const record = (from, to) => {
    if (from === to) return;
    const key = `${from}->${to}`;
    if (!pairs.has(key)) {
      pairs.set(key, {
        from_module: from,
        to_module: to,
        edge_count: 0,
        allowed: isAllowed(context, from, to),
        pair_already_present: (context.modulePairEdges.get(key) ?? 0) > 0
      });
    }
    pairs.get(key).edge_count += 1;
  };
  for (const edge of dependencyEdges) record(module, context.moduleByFile.get(edge.target_file));
  for (const edge of consumerEdges) record(context.moduleByFile.get(edge.source_file), module);
  return [...pairs.values()]
    .map((entry) => ({
      ...entry,
      // A pair that is already violating stays one violation; only a brand-new disallowed pair
      // increases the undeclared_dependency count.
      creates_new_violation: !entry.allowed && !entry.pair_already_present
    }))
    .sort((a, b) => `${a.from_module}->${a.to_module}`.localeCompare(`${b.from_module}->${b.to_module}`));
}

function buildRecommendation(candidates) {
  if (candidates.length === 0) {
    return {
      action: 'human_adjudication',
      reason: 'モジュール割当済みファイルとのimportが無く、既存モジュールへの機械的な割当根拠がない'
    };
  }
  const top = candidates[0];
  const tied = candidates.filter((candidate) => candidate.score === top.score);
  if (tied.length > 1) {
    return {
      action: 'human_adjudication',
      module: null,
      reason: `最高スコアが複数モジュールで同点 (${tied.map((entry) => entry.module).join(', ')})`
    };
  }
  const newViolations = top.induced_dependencies.filter((entry) => entry.creates_new_violation);
  if (newViolations.length > 0) {
    return {
      action: 'human_adjudication',
      module: top.module,
      reason: `割当により新規の未宣言依存ペアが発生する (${newViolations.map((entry) => `${entry.from_module}->${entry.to_module}`).join(', ')})`
    };
  }
  return {
    action: 'machine_maintainable_assign',
    module: top.module,
    reason: '単独最高スコアであり、割当により新規の未宣言依存ペアが発生しない'
  };
}

// Connected components over orphan-to-orphan imports (undirected). A component is the raw material
// for a "should this become a new module?" question; naming and existence are human_adjudicated, so
// the generator deliberately stops at membership plus its module touchpoints.
function buildOrphanClusters(context) {
  const adjacency = new Map(context.orphans.map((file) => [file, new Set()]));
  const internalEdges = new Map();
  for (const edge of context.edges) {
    if (!context.orphanSet.has(edge.source_file) || !context.orphanSet.has(edge.target_file)) continue;
    adjacency.get(edge.source_file).add(edge.target_file);
    adjacency.get(edge.target_file).add(edge.source_file);
    const key = `${edge.source_file}->${edge.target_file}`;
    internalEdges.set(key, (internalEdges.get(key) ?? 0) + 1);
  }
  const seen = new Set();
  const clusters = [];
  for (const file of context.orphans) {
    if (seen.has(file)) continue;
    const members = [];
    const queue = [file];
    seen.add(file);
    while (queue.length > 0) {
      const current = queue.shift();
      members.push(current);
      for (const next of [...adjacency.get(current)].sort((a, b) => a.localeCompare(b))) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    members.sort((a, b) => a.localeCompare(b));
    const memberSet = new Set(members);
    const touchpoints = new Set();
    for (const edge of context.edges) {
      if (memberSet.has(edge.source_file) && context.moduleByFile.has(edge.target_file)) {
        touchpoints.add(context.moduleByFile.get(edge.target_file));
      }
      if (memberSet.has(edge.target_file) && context.moduleByFile.has(edge.source_file)) {
        touchpoints.add(context.moduleByFile.get(edge.source_file));
      }
    }
    clusters.push({
      // Identified by its own smallest member path, never by discovery order.
      id: `orphan_cluster:${members[0]}`,
      members,
      member_count: members.length,
      internal_edge_count: [...internalEdges.entries()]
        .filter(([key]) => key.split('->').every((endpoint) => memberSet.has(endpoint)))
        .reduce((total, [, count]) => total + count, 0),
      module_touchpoints: [...touchpoints].sort((a, b) => a.localeCompare(b)),
      new_module_candidate: members.length > 1,
      authority: members.length > 1 ? 'human_adjudicated' : 'machine_maintainable'
    });
  }
  return clusters.sort((a, b) => (b.member_count - a.member_count) || a.id.localeCompare(b.id));
}

// Splits the undeclared module dependencies into the ones that could legitimately be legalized by
// declaring them (still a human_adjudicated act under R-004) and the ones that must be resolved in
// code because declaring them would contradict an adjudicated rule or create a declared cycle.
function buildDependencyTriage(context) {
  const entries = [];
  for (const [key, edgeCount] of context.modulePairEdges.entries()) {
    const [fromModule, toModule] = key.split('->');
    if (isAllowed(context, fromModule, toModule)) continue;
    const ruleId = deriveRuleId(fromModule, toModule);
    const reverseDeclared = isAllowed(context, toModule, fromModule);
    let classification;
    let reason;
    if (ruleId === 'R-001') {
      classification = 'resolve';
      reason = 'R-001: workspace-infra は他のどのモジュールにも依存しない。宣言では解消できない逆転依存であり、コード側で解消する';
    } else if (ruleId === 'R-002') {
      classification = 'resolve';
      reason = 'R-002: cli 以外のモジュールは cli に依存しない。宣言では解消できない';
    } else if (reverseDeclared) {
      classification = 'resolve';
      reason = `逆向き (${toModule} -> ${fromModule}) が既に allowed_dependencies に宣言済みであり、この依存を宣言すると宣言済みの循環になる`;
    } else {
      classification = 'declare_candidate';
      reason = 'R-004: rules に抵触しないため宣言による合法化が可能。ただし新規依存の宣言は人間承認が必要';
    }
    entries.push({
      id: `undeclared_dependency:${fromModule}->${toModule}`,
      from_module: fromModule,
      to_module: toModule,
      edge_count: edgeCount,
      rule_id: ruleId,
      reverse_declared: reverseDeclared,
      classification,
      reason,
      authority: classification === 'declare_candidate' ? 'human_adjudicated' : 'code_change'
    });
  }
  return entries.sort((a, b) => (b.edge_count - a.edge_count) || a.id.localeCompare(b.id));
}

function deriveRuleId(fromModule, toModule) {
  if (fromModule === 'workspace-infra') return 'R-001';
  if (toModule === 'cli') return 'R-002';
  return 'R-004';
}

function buildAdjudicationIndex({ orphanClusters, dependencyTriage }) {
  return [
    ...orphanClusters
      .filter((cluster) => cluster.new_module_candidate)
      .map((cluster) => ({
        kind: 'new_module_candidate',
        id: cluster.id,
        subject: cluster.members.join(', '),
        question: 'このクラスタを新モジュールとして新設するか、既存モジュールへ吸収するか'
      })),
    ...dependencyTriage
      .filter((entry) => entry.classification === 'declare_candidate')
      .map((entry) => ({
        kind: 'new_allowed_dependency',
        id: entry.id,
        subject: `${entry.from_module} -> ${entry.to_module} (${entry.edge_count} edges)`,
        question: 'この依存を allowed_dependencies へ宣言して合法化するか、コード側で解消するか'
      })),
    ...dependencyTriage
      .filter((entry) => entry.rule_id === 'R-001' || entry.rule_id === 'R-002')
      .map((entry) => ({
        kind: 'rule_inversion',
        id: entry.id,
        subject: `${entry.from_module} -> ${entry.to_module} (${entry.edge_count} edges, ${entry.rule_id})`,
        question: '逆転依存をいつ・どの順序で解消するか（rules を緩める選択肢を含む）'
      }))
  ].sort((a, b) => (a.kind.localeCompare(b.kind)) || a.id.localeCompare(b.id));
}

// The committed snapshot is a design doc, so Design SSOT expects it to declare its parent design
// root in frontmatter. The value is supplied by the caller (--parent-design) rather than hardcoded:
// this generator is not specific to VibePro's own design tree. Frontmatter carries no timestamp, so
// regenerating an unchanged repository still produces a byte-identical file (INV-003).
export function renderRebaselineProposalMarkdown(proposal, { parentDesign = null } = {}) {
  const lines = [];
  if (parentDesign) {
    lines.push(
      '---',
      'title: Target Model Rebaseline Proposal (generated)',
      'status: active',
      `parent_design: ${parentDesign}`,
      'generated_by: vibepro architecture rebaseline-proposal',
      '---',
      ''
    );
  }
  lines.push(
    '# Target Model Rebaseline Proposal',
    '',
    `- model: ${proposal.model.path} (version=${proposal.model.version ?? 'unversioned'}, status=${proposal.model.status}, governance=${proposal.model.governance_present ? 'present' : 'absent'})`,
    `- 孤児: ${proposal.summary.orphan_count} (候補あり ${proposal.summary.orphan_with_candidate_count} / 候補なし ${proposal.summary.orphan_without_candidate_count})`,
    `- 孤児クラスタ: ${proposal.summary.orphan_cluster_count}`,
    `- 未宣言依存: ${proposal.summary.undeclared_dependency_count} (declare候補 ${proposal.summary.declare_candidate_count} / resolve ${proposal.summary.resolve_count})`,
    '',
    `> ${proposal.ranking.note}`,
    '',
    '> このartifactは提案のみ。target-model.json は書き換えない。新モジュール新設と新規依存宣言は人間裁定 (governance.human_adjudicated)。',
    '',
    '## 孤児ファイルの割当候補',
    ''
  );
  for (const entry of proposal.orphan_assignments) {
    lines.push(`### ${entry.file}`, '');
    lines.push(`- 推奨: ${entry.recommendation.action}${entry.recommendation.module ? ` (${entry.recommendation.module})` : ''} — ${entry.recommendation.reason}`);
    if (entry.orphan_neighbours.length > 0) {
      lines.push(`- 孤児同士の隣接: ${entry.orphan_neighbours.join(', ')}`);
    }
    if (entry.candidates.length === 0) {
      lines.push('- 候補なし');
    }
    for (const candidate of entry.candidates) {
      lines.push(`- 候補 \`${candidate.module}\` score=${candidate.score} (consumer=${candidate.consumer_edge_count}, dependency=${candidate.dependency_edge_count})`);
      for (const evidence of candidate.evidence) lines.push(`  - 根拠: ${evidence}`);
      for (const induced of candidate.induced_dependencies) {
        lines.push(`  - 誘発依存: ${induced.from_module} -> ${induced.to_module} (${induced.edge_count} edges, allowed=${induced.allowed}, 新規違反=${induced.creates_new_violation})`);
      }
    }
    lines.push('');
  }
  lines.push('## 孤児クラスタ (新モジュール候補の母集団)', '');
  for (const cluster of proposal.orphan_clusters) {
    lines.push(`- ${cluster.id} — members=${cluster.member_count}, touchpoints=${cluster.module_touchpoints.join('/') || 'none'}, authority=${cluster.authority}`);
    for (const member of cluster.members) lines.push(`  - ${member}`);
  }
  lines.push('', '## 未宣言依存の仕分け', '');
  for (const entry of proposal.dependency_triage) {
    lines.push(`- \`${entry.from_module} -> ${entry.to_module}\` (${entry.edge_count} edges, ${entry.rule_id}) → **${entry.classification}** [${entry.authority}]`);
    lines.push(`  - ${entry.reason}`);
  }
  lines.push('', '## 人間裁定が必要な項目', '');
  for (const item of proposal.human_adjudication_required) {
    lines.push(`- [${item.kind}] ${item.subject} — ${item.question}`);
  }
  return `${lines.join('\n')}\n`;
}

function toRepoRelative(root, absPath) {
  return path.relative(root, absPath).split(path.sep).join('/');
}
