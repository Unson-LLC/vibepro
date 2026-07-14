import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { findStorySource } from './requirement-consistency.js';
import { extractAcceptanceCriteria } from './traceability.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';

const execFileAsync = promisify(execFile);

export const ADJUDICATION_SCHEMA_VERSION = '0.1.0';
export const ADJUDICATION_VERDICTS = ['demonstrated', 'not_demonstrated', 'not_verifiable_by_automation'];
export const JUDGMENT_ADJUDICATION_VERDICTS = ['judged_sound', 'judged_unsound', 'needs_human_judgment'];

const VERDICT_DEFINITIONS = {
  demonstrated: '紐づく証拠が、このclauseの成果が実際に起きたことを実証している。証拠の観測内容から成果へ推論の飛躍なしに到達できる場合のみ選ぶ。',
  not_demonstrated: '証拠は存在するが、このclauseの成果を実証していない。文字列・フィールドの存在確認、無関係なテストのpass、成果と接地しない観測はこの判定にする。',
  not_verifiable_by_automation: 'このclauseの成果は自動テストでは原理的に検証できず、人間の観測（実利用・実操作・目視確認）が必要。正直にこの判定を選ぶこと自体が正しい成果であり、罰ではない。'
};

const JUDGMENT_VERDICT_DEFINITIONS = {
  judged_sound: 'この項目の機械的消化（トークン照合・decision record）は、変更差分の実体に照らして判断として成立している。問いに対する答えが証拠から推論の飛躍なしに導ける場合のみ選ぶ。',
  judged_unsound: 'トークンや記録は揃っているが、変更差分の実体に照らすと判断として成立していない。証拠文言が問いに答えていない、差分が問いの前提を破っている、consequenceの検討が欠けている場合はこの判定にする。理由を具体的に書く。',
  needs_human_judgment: 'この項目はLLMでは判断しきれず、人間の判断（事業判断・運用判断・実環境の観測）が必要。正直にこの判定を選ぶこと自体が正しい成果であり、罰ではない。'
};

export function adjudicationDir(repoRoot, storyId) {
  return path.join(getWorkspaceDir(path.resolve(repoRoot)), 'adjudication', storyId);
}

export function adjudicationArtifactPath(repoRoot, storyId) {
  return path.join(adjudicationDir(repoRoot, storyId), 'adjudication.json');
}

export function adjudicationRequestPath(repoRoot, storyId) {
  return path.join(adjudicationDir(repoRoot, storyId), 'adjudication-request.md');
}

export function judgmentAdjudicationArtifactPath(repoRoot, storyId) {
  return path.join(adjudicationDir(repoRoot, storyId), 'judgment-adjudication.json');
}

export function judgmentAdjudicationRequestPath(repoRoot, storyId) {
  return path.join(adjudicationDir(repoRoot, storyId), 'judgment-adjudication-request.md');
}

export async function readJudgmentAdjudicationIfExists(repoRoot, storyId) {
  let raw = null;
  try {
    raw = await readFile(judgmentAdjudicationArtifactPath(repoRoot, storyId), 'utf8');
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `judgment-adjudication.json for ${storyId} exists but is not valid JSON (${error.message}). `
      + 'A corrupt adjudication artifact must not be silently ignored; fix or remove the file and re-record the verdicts.'
    );
  }
}

export async function readAdjudicationIfExists(repoRoot, storyId) {
  try {
    return JSON.parse(await readFile(adjudicationArtifactPath(repoRoot, storyId), 'utf8'));
  } catch {
    return null;
  }
}

async function readVerificationEvidenceEntries(repoRoot, storyId) {
  const evidencePath = path.join(getWorkspaceDir(path.resolve(repoRoot)), 'pr', storyId, 'verification-evidence.json');
  try {
    const parsed = JSON.parse(await readFile(evidencePath, 'utf8'));
    return Array.isArray(parsed?.commands) ? parsed.commands : [];
  } catch {
    return [];
  }
}

function formatEvidenceEntry(entry, index) {
  const lines = [
    `### 証拠 E-${index + 1}: kind=${entry.kind ?? 'unknown'} status=${entry.status ?? 'unknown'}`,
    '',
    `- command: \`${entry.command ?? '-'}\``,
    `- summary: ${entry.summary ?? '-'}`
  ];
  const observation = entry.observation ?? {};
  const targets = Array.isArray(observation.targets) ? observation.targets : [];
  const scenarios = Array.isArray(observation.scenarios) ? observation.scenarios : [];
  const values = observation.values && typeof observation.values === 'object' ? observation.values : {};
  if (targets.length > 0) lines.push(`- observation.targets: ${targets.join(', ')}`);
  if (scenarios.length > 0) {
    lines.push('- observation.scenarios:');
    for (const scenario of scenarios) lines.push(`  - ${scenario}`);
  }
  const valueEntries = Object.entries(values);
  if (valueEntries.length > 0) {
    lines.push(`- observation.values: ${valueEntries.map(([key, value]) => `${key}=${value}`).join(', ')}`);
  }
  if (entry.artifact) lines.push(`- artifact: ${entry.artifact}`);
  return lines.join('\n');
}

export async function prepareAdjudication(repoRoot, { storyId } = {}) {
  if (!storyId) throw new Error('adjudicate prepare requires --id <story-id>');
  const root = path.resolve(repoRoot);
  const source = await findStorySource(root, { story_id: storyId });
  if (!source?.path || !source.content) {
    throw new Error(`adjudicate prepare: story document for ${storyId} was not found`);
  }
  const clauses = extractAcceptanceCriteria(source.content);
  if (clauses.length === 0) {
    throw new Error(
      `adjudicate prepare: story ${storyId} has no acceptance criteria. `
      + 'Adjudication has nothing to judge; add acceptance criteria to the story before requesting adjudication. '
      + 'This is an explicit error, not a pass.'
    );
  }
  const evidenceEntries = await readVerificationEvidenceEntries(root, storyId);
  const lines = [
    `# Evidence Adjudication Request: ${storyId}`,
    '',
    `- story: ${source.path}`,
    `- generated_at: ${new Date().toISOString()}`,
    '',
    '## 裁定者への指示',
    '',
    'あなたはこのStoryの実装エージェントとは**独立したfresh contextの裁定者**として起動されている。',
    '実装セッションの文脈・実装者の自己申告・「テストが通った」という事実を成果の代替として受け取らないこと。',
    '',
    '- 一次コンテキストは下記のStory受け入れ基準の**原文**である。gate JSONやテスト名ではなく、clauseが記述する成果そのものを基準にする。',
    '- 各clauseについて「下記の証拠はこの成果を実証しているか」を**反証の立場**で検討する。実証していないと言える筋があれば、その筋を優先して検討する。',
    '- 文字列やフィールドの存在確認テストは、人間の理解・判断・行動に関するclauseを実証しない。',
    '- 判定に迷う場合は demonstrated を選ばない。',
    '',
    '### verdict語彙（3値）',
    '',
    ...ADJUDICATION_VERDICTS.map((verdict) => `- \`${verdict}\`: ${VERDICT_DEFINITIONS[verdict]}`),
    '',
    '### 記録方法',
    '',
    'clauseごとに以下を実行する（reasonには判断根拠を具体的に書く）:',
    '',
    '```bash',
    `vibepro adjudicate record . --id ${storyId} --clause <clause-id> --verdict <verdict> --reason "<判断根拠>" --agent-system <codex|claude_code> --agent-id <subagent-id> [--session-ref <ref>]`,
    '```',
    '',
    '## 受け入れ基準 clauses',
    ''
  ];
  for (const clause of clauses) {
    lines.push(`### ${clause.id}`, '', `> ${clause.text}`, '');
  }
  lines.push('## 記録済み検証証拠', '');
  if (evidenceEntries.length === 0) {
    lines.push('検証証拠はまだ記録されていない。証拠なしで demonstrated と判定することはできない。', '');
  } else {
    for (const [index, entry] of evidenceEntries.entries()) {
      lines.push(formatEvidenceEntry(entry, index), '');
    }
  }
  await mkdir(adjudicationDir(root, storyId), { recursive: true });
  const requestPath = adjudicationRequestPath(root, storyId);
  await writeFile(requestPath, `${lines.join('\n')}\n`, 'utf8');
  return {
    story_id: storyId,
    story_path: source.path,
    clause_count: clauses.length,
    clauses: clauses.map((clause) => ({ id: clause.id, text: clause.text })),
    evidence_count: evidenceEntries.length,
    artifact: toWorkspaceRelative(root, requestPath)
  };
}

export async function recordAdjudication(repoRoot, options = {}) {
  const storyId = requireValue(options.storyId, 'adjudicate record requires --id <story-id>');
  const clauseId = requireValue(options.clauseId, 'adjudicate record requires --clause <clause-id>');
  const verdict = requireValue(options.verdict, 'adjudicate record requires --verdict <verdict>');
  if (!ADJUDICATION_VERDICTS.includes(verdict)) {
    throw new Error(`adjudicate record --verdict must be one of: ${ADJUDICATION_VERDICTS.join(', ')}`);
  }
  const reason = requireValue(options.reason, 'adjudicate record requires --reason <text> so the verdict is auditable');
  const agentSystem = requireValue(options.agentSystem, 'adjudicate record requires --agent-system <codex|claude_code>');
  const agentId = requireValue(options.agentId, 'adjudicate record requires --agent-id <id> so adjudicator provenance is auditable');
  const root = path.resolve(repoRoot);
  const headCommit = await resolveHeadCommit(root);
  if (!headCommit) {
    throw new Error('adjudicate record could not resolve the current HEAD commit (git rev-parse HEAD failed); verdicts must be head-bound, so run this command inside the target git repository');
  }
  const existing = await readAdjudicationIfExists(root, storyId);
  const entry = {
    clause_id: clauseId,
    verdict,
    reason,
    provenance: {
      agent_system: agentSystem,
      agent_id: agentId,
      session_ref: options.sessionRef ?? null
    },
    head_commit: headCommit,
    recorded_at: new Date().toISOString()
  };
  const verdicts = [
    entry,
    ...(existing?.verdicts ?? []).filter((item) => item.clause_id !== clauseId)
  ];
  const next = {
    schema_version: ADJUDICATION_SCHEMA_VERSION,
    model: 'vibepro-evidence-adjudication-v1',
    story_id: storyId,
    updated_at: new Date().toISOString(),
    verdicts
  };
  await mkdir(adjudicationDir(root, storyId), { recursive: true });
  const artifactPath = adjudicationArtifactPath(root, storyId);
  await writeFile(artifactPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    entry,
    records: next,
    artifact: toWorkspaceRelative(root, artifactPath)
  };
}

export function isAdjudicationEnabled(config) {
  return config?.evidence_adjudication?.enabled !== false;
}

export function buildEvidenceAdjudicationGate({
  storyId,
  acceptanceCriteria = [],
  adjudication = null,
  headSha = null,
  decisions = []
} = {}) {
  const base = {
    id: 'gate:evidence_adjudication',
    type: 'evidence_adjudication_gate',
    label: 'Evidence Adjudication Gate',
    required: true,
    command: `vibepro adjudicate prepare . --id ${storyId}`,
    artifact: `.vibepro/adjudication/${storyId}/adjudication.json`
  };
  if (acceptanceCriteria.length === 0) {
    return {
      ...base,
      status: 'not_applicable',
      reason: 'Story defines no acceptance criteria clauses; adjudication has no clauses to judge. This is explicit non-applicability, not a pass.'
    };
  }
  const verdicts = Array.isArray(adjudication?.verdicts) ? adjudication.verdicts : [];
  const freshVerdictByClause = new Map();
  for (const entry of verdicts) {
    if (!entry?.clause_id) continue;
    // Fail closed on both sides of the freshness comparison: a verdict without a
    // recorded head_commit is stale, and an unknown current HEAD means freshness
    // is unverifiable, so no verdict counts as fresh.
    if (!headSha || entry.head_commit !== headSha) continue;
    freshVerdictByClause.set(entry.clause_id, entry);
  }
  const acceptedHumanClosures = new Set(
    (decisions ?? [])
      .filter((decision) => decision?.status === 'accepted' && decision?.reason && decision?.artifact)
      .map((decision) => String(decision.source ?? ''))
      .filter((source) => source.startsWith('gate:evidence_adjudication:'))
      .map((source) => source.slice('gate:evidence_adjudication:'.length))
  );
  const missing = [];
  const notDemonstrated = [];
  const needsHuman = [];
  for (const clause of acceptanceCriteria) {
    const entry = freshVerdictByClause.get(clause.id) ?? null;
    if (!entry) {
      missing.push(clause.id);
      continue;
    }
    if (entry.verdict === 'not_demonstrated') {
      notDemonstrated.push({ clause_id: clause.id, reason: entry.reason });
      continue;
    }
    if (entry.verdict === 'not_verifiable_by_automation' && !acceptedHumanClosures.has(clause.id)) {
      needsHuman.push({ clause_id: clause.id, reason: entry.reason });
    }
  }
  if (notDemonstrated.length > 0) {
    return {
      ...base,
      status: 'failed',
      not_demonstrated_clauses: notDemonstrated,
      reason: `Adjudicator judged ${notDemonstrated.length} clause(s) as not demonstrated by the recorded evidence: `
        + notDemonstrated.map((item) => `${item.clause_id} (${item.reason})`).join('; ')
        + '. Produce evidence that demonstrates the outcome, then re-run adjudication.'
    };
  }
  if (missing.length > 0 || needsHuman.length > 0) {
    const reasons = [];
    if (missing.length > 0) {
      reasons.push(`${missing.length} clause(s) have no current-head adjudication verdict: ${missing.join(', ')}. `
        + 'Run `vibepro adjudicate prepare`, dispatch an independent fresh-context subagent, and record verdicts with `vibepro adjudicate record`.');
    }
    if (needsHuman.length > 0) {
      reasons.push(`${needsHuman.length} clause(s) were judged not verifiable by automation and require human verification: `
        + needsHuman.map((item) => item.clause_id).join(', ')
        + '. Close each with a decision record: `vibepro decision record . --id <story-id> --type needs_review --source gate:evidence_adjudication:<clause-id> --status accepted --reason <human-observation> --artifact <evidence-path>`.');
    }
    return {
      ...base,
      status: 'needs_evidence',
      missing_clauses: missing,
      human_verification_clauses: needsHuman,
      reason: reasons.join(' ')
    };
  }
  return {
    ...base,
    status: 'passed',
    reason: `All ${acceptanceCriteria.length} acceptance criteria clause(s) have current-head adjudication verdicts (demonstrated, or not_verifiable_by_automation closed by an accepted human decision record).`
  };
}

export function summarizeAdjudicationForPr({ acceptanceCriteria = [], adjudication = null, headSha = null } = {}) {
  const verdicts = Array.isArray(adjudication?.verdicts) ? adjudication.verdicts : [];
  const fresh = verdicts.filter((entry) => Boolean(headSha) && entry.head_commit === headSha);
  return {
    clause_count: acceptanceCriteria.length,
    fresh_verdict_count: fresh.length,
    demonstrated_count: fresh.filter((entry) => entry.verdict === 'demonstrated').length,
    not_demonstrated_count: fresh.filter((entry) => entry.verdict === 'not_demonstrated').length,
    not_verifiable_by_automation_count: fresh.filter((entry) => entry.verdict === 'not_verifiable_by_automation').length
  };
}

async function resolveHeadCommit(root) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: root });
    return stdout.trim();
  } catch {
    return null;
  }
}

function requireValue(value, message) {
  const normalized = typeof value === 'string' ? value.trim() : value;
  if (!normalized) throw new Error(message);
  return normalized;
}

// ---------------------------------------------------------------------------
// Judgment-DAG adjudication: the senior-judgment checklist (spine subchecks,
// judgment axes, failure modes) is mechanically discharged by token matching.
// This layer hands the checklist to an independent judge who decides whether
// each mechanical discharge actually holds against the change — token
// matching stays as routing, adjudication becomes the discharge condition.
// ---------------------------------------------------------------------------

export function isJudgmentAdjudicationEnabled(config) {
  return config?.judgment_adjudication?.enabled !== false;
}

export function isJudgmentRoute({ routeType = null, changeProfile = null } = {}) {
  return routeType === 'agent_workflow' || changeProfile === 'workflow_heavy';
}

export function collectJudgmentItems({ gateDag, routeType = null, changeProfile = null } = {}) {
  if (!isJudgmentRoute({ routeType, changeProfile })) return [];
  const nodes = Array.isArray(gateDag?.nodes) ? gateDag.nodes : [];
  const items = [];
  const spine = nodes.find((node) => node.id === 'gate:common_judgment_spine');
  for (const subcheck of spine?.subchecks ?? []) {
    if (!subcheck?.id) continue;
    items.push({
      id: `spine:${subcheck.id}`,
      kind: 'spine_subcheck',
      question: `Common Judgment Spineの「${subcheck.id}」（surface: ${subcheck.surface ?? '-'}）は、この変更に対して実際に検討されているか。${subcheck.reason ?? ''}`,
      mechanical_status: subcheck.status ?? null,
      evidence_summary: summarizeMatchedEvidence(subcheck.matched_evidence)
    });
  }
  for (const node of nodes) {
    if (node?.type !== 'judgment_axis_gate' || !node.axis) continue;
    items.push({
      id: `axis:${node.axis}`,
      kind: 'judgment_axis',
      question: node.decision_question ?? node.label ?? node.axis,
      mechanical_status: node.status ?? null,
      evidence_summary: summarizeMatchedEvidence(node.matched_evidence)
    });
  }
  const failureModes = nodes.find((node) => node.id === 'gate:failure_mode_coverage');
  for (const mode of failureModes?.modes ?? []) {
    if (!mode?.id) continue;
    items.push({
      id: `failure_mode:${mode.id}`,
      kind: 'failure_mode',
      question: `Failure mode候補「${mode.id}」: ${mode.reason ?? ''} この変更で本当に起きないか、起きた場合の挙動は検証されているか。`,
      mechanical_status: mode.status ?? null,
      evidence_summary: typeof mode.evidence === 'string' ? mode.evidence : summarizeMatchedEvidence(mode.evidence)
    });
  }
  return items;
}

function summarizeMatchedEvidence(matched) {
  if (!matched) return null;
  if (typeof matched === 'string') return matched;
  if (!Array.isArray(matched)) return null;
  return matched
    .slice(0, 6)
    .map((item) => (typeof item === 'string' ? item : `${item.kind ?? item.evidence ?? '-'}: ${item.ref ?? item.summary ?? item.command ?? '-'}`))
    .join(' / ') || null;
}

export async function prepareJudgmentAdjudication(repoRoot, { storyId } = {}) {
  if (!storyId) throw new Error('adjudicate prepare --judgment requires --id <story-id>');
  const root = path.resolve(repoRoot);
  const prPreparePath = path.join(getWorkspaceDir(root), 'pr', storyId, 'pr-prepare.json');
  let prPrepareRaw = null;
  try {
    prPrepareRaw = await readFile(prPreparePath, 'utf8');
  } catch {
    throw new Error(
      `adjudicate prepare --judgment: no pr prepare artifact was found for ${storyId}. `
      + 'The judgment DAG does not exist until `vibepro pr prepare` has built it; run pr prepare first. '
      + 'This is an explicit error, not a pass.'
    );
  }
  let prPrepare = null;
  try {
    prPrepare = JSON.parse(prPrepareRaw);
  } catch (error) {
    throw new Error(
      `adjudicate prepare --judgment: the pr prepare artifact for ${storyId} exists but is not valid JSON `
      + `(${error.message}). Rerun \`vibepro pr prepare\` to regenerate it; a corrupt artifact is not treated as missing or as a pass.`
    );
  }
  const gateDag = prPrepare?.pr_context?.gate_dag ?? null;
  const routeType = prPrepare?.pr_context?.engineering_judgment?.route_type ?? null;
  const changeProfile = prPrepare?.pr_context?.change_classification?.profile ?? null;
  const items = collectJudgmentItems({ gateDag, routeType, changeProfile });
  if (items.length === 0) {
    throw new Error(
      `adjudicate prepare --judgment: story ${storyId} has no active judgment items `
      + `(route=${routeType ?? 'unknown'}, profile=${changeProfile ?? 'unknown'}). `
      + 'The judgment adjudication gate reports not_applicable for this route; nothing to adjudicate.'
    );
  }
  const changedFiles = (prPrepare?.git?.changed_files ?? prPrepare?.pr_context?.git?.changed_files ?? [])
    .map((file) => file.path ?? file)
    .slice(0, 100);
  const lines = [
    `# Judgment DAG Adjudication Request: ${storyId}`,
    '',
    `- generated_at: ${new Date().toISOString()}`,
    `- route: ${routeType ?? '-'} / profile: ${changeProfile ?? '-'}`,
    `- items: ${items.length}`,
    '',
    '## 裁定者への指示',
    '',
    'あなたはこのStoryの実装エージェントとは**独立したfresh contextの裁定者**として起動されている。',
    'これはシニアエンジニアが変更をレビューするときに歩く判断チェックリストである。各項目の',
    '「機械的消化」（証拠テキストのトークン照合やdecision record）は判断の成立を保証しない——',
    '**トークンや文言が揃っていることだけを根拠に judged_sound を選んではならない**。',
    '',
    '- 各項目について、問い原文を変更差分の実体（下記changed files、必要ならdiff/コード）に照らして**実際に検討**する。',
    '- 反証の立場をとる: 機械的消化が判断として成立していないと言える筋があれば、その筋を優先して検討する。',
    '- 判定に迷う場合は judged_sound を選ばない。',
    '',
    '### 裁定語彙（3値）',
    '',
    ...JUDGMENT_ADJUDICATION_VERDICTS.map((verdict) => `- \`${verdict}\`: ${JUDGMENT_VERDICT_DEFINITIONS[verdict]}`),
    '',
    '### 記録方法',
    '',
    '項目ごとに以下を実行する（reasonには検討の中身を具体的に書く）:',
    '',
    '```bash',
    `vibepro adjudicate record . --id ${storyId} --judgment --item <item-id> --verdict <verdict> --reason "<検討内容>" --agent-system <codex|claude_code> --agent-id <subagent-id> [--session-ref <ref>]`,
    '```',
    '',
    '## 変更ファイル',
    '',
    ...(changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`) : ['- (変更ファイル情報なし)']),
    '',
    '## 判断チェックリスト',
    ''
  ];
  for (const item of items) {
    lines.push(
      `### ${item.id}`,
      '',
      `> ${item.question}`,
      '',
      `- 機械的消化の現状: ${item.mechanical_status ?? '-'}`,
      `- 一致した証拠: ${item.evidence_summary ?? '（なし）'}`,
      ''
    );
  }
  await mkdir(adjudicationDir(root, storyId), { recursive: true });
  const requestPath = judgmentAdjudicationRequestPath(root, storyId);
  await writeFile(requestPath, `${lines.join('\n')}\n`, 'utf8');
  return {
    story_id: storyId,
    item_count: items.length,
    items: items.map((item) => ({ id: item.id, kind: item.kind })),
    route: routeType,
    profile: changeProfile,
    artifact: toWorkspaceRelative(root, requestPath)
  };
}

export async function recordJudgmentAdjudication(repoRoot, options = {}) {
  const storyId = requireValue(options.storyId, 'adjudicate record --judgment requires --id <story-id>');
  const itemId = requireValue(options.itemId, 'adjudicate record --judgment requires --item <item-id>');
  const verdict = requireValue(options.verdict, 'adjudicate record --judgment requires --verdict <verdict>');
  if (!JUDGMENT_ADJUDICATION_VERDICTS.includes(verdict)) {
    throw new Error(`adjudicate record --judgment --verdict must be one of: ${JUDGMENT_ADJUDICATION_VERDICTS.join(', ')}`);
  }
  const reason = requireValue(options.reason, 'adjudicate record --judgment requires --reason <text> so the judgment is auditable');
  const agentSystem = requireValue(options.agentSystem, 'adjudicate record --judgment requires --agent-system <codex|claude_code>');
  const agentId = requireValue(options.agentId, 'adjudicate record --judgment requires --agent-id <id> so adjudicator provenance is auditable');
  const root = path.resolve(repoRoot);
  const headCommit = await resolveHeadCommit(root);
  if (!headCommit) {
    throw new Error('adjudicate record --judgment could not resolve the current HEAD commit (git rev-parse HEAD failed); verdicts must be head-bound, so run this command inside the target git repository');
  }
  const existing = await readJudgmentAdjudicationIfExists(root, storyId);
  const entry = {
    item_id: itemId,
    verdict,
    reason,
    provenance: {
      agent_system: agentSystem,
      agent_id: agentId,
      session_ref: options.sessionRef ?? null
    },
    head_commit: headCommit,
    recorded_at: new Date().toISOString()
  };
  const verdicts = [
    entry,
    ...(existing?.verdicts ?? []).filter((item) => item.item_id !== itemId)
  ];
  const next = {
    schema_version: ADJUDICATION_SCHEMA_VERSION,
    model: 'vibepro-judgment-dag-adjudication-v1',
    story_id: storyId,
    updated_at: new Date().toISOString(),
    verdicts
  };
  await mkdir(adjudicationDir(root, storyId), { recursive: true });
  const artifactPath = judgmentAdjudicationArtifactPath(root, storyId);
  await writeFile(artifactPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return {
    entry,
    records: next,
    artifact: toWorkspaceRelative(root, artifactPath)
  };
}

export function buildJudgmentDagAdjudicationGate({
  storyId,
  items = [],
  adjudication = null,
  headSha = null,
  decisions = []
} = {}) {
  const base = {
    id: 'gate:judgment_dag_adjudication',
    type: 'judgment_dag_adjudication_gate',
    label: 'Judgment DAG Adjudication Gate',
    required: true,
    command: `vibepro adjudicate prepare . --id ${storyId} --judgment`,
    artifact: `.vibepro/adjudication/${storyId}/judgment-adjudication.json`
  };
  if (items.length === 0) {
    return {
      ...base,
      status: 'not_applicable',
      reason: 'This route does not carry active judgment items (spine/axes/failure modes are not the release decision surface here). This is explicit non-applicability, not a pass.'
    };
  }
  const verdicts = Array.isArray(adjudication?.verdicts) ? adjudication.verdicts : [];
  const freshVerdictByItem = new Map();
  for (const entry of verdicts) {
    if (!entry?.item_id) continue;
    // Fail closed: a verdict without a head_commit, or evaluated without a
    // known current HEAD, is never fresh.
    if (!headSha || entry.head_commit !== headSha) continue;
    freshVerdictByItem.set(entry.item_id, entry);
  }
  const acceptedHumanClosures = new Set(
    (decisions ?? [])
      .filter((decision) => decision?.status === 'accepted' && decision?.reason && decision?.artifact)
      .map((decision) => String(decision.source ?? ''))
      .filter((source) => source.startsWith('gate:judgment_dag_adjudication:'))
      .map((source) => source.slice('gate:judgment_dag_adjudication:'.length))
  );
  const missing = [];
  const unsound = [];
  const needsHuman = [];
  for (const item of items) {
    const entry = freshVerdictByItem.get(item.id) ?? null;
    if (!entry) {
      missing.push(item.id);
      continue;
    }
    if (entry.verdict === 'judged_unsound') {
      unsound.push({ item_id: item.id, reason: entry.reason });
      continue;
    }
    if (entry.verdict === 'needs_human_judgment' && !acceptedHumanClosures.has(item.id)) {
      needsHuman.push({ item_id: item.id, reason: entry.reason });
    }
  }
  if (unsound.length > 0) {
    return {
      ...base,
      status: 'failed',
      judged_unsound_items: unsound,
      reason: `Judge ruled ${unsound.length} judgment item(s) unsound (tokens present but the judgment does not hold): `
        + unsound.map((item) => `${item.item_id} (${item.reason})`).join('; ')
        + '. Address the judgment gap, then re-run judgment adjudication.'
    };
  }
  if (missing.length > 0 || needsHuman.length > 0) {
    const reasons = [];
    if (missing.length > 0) {
      reasons.push(`${missing.length} judgment item(s) have no current-head adjudication: ${missing.join(', ')}. `
        + 'Run `vibepro adjudicate prepare --judgment`, dispatch an independent fresh-context subagent to walk the checklist, and record verdicts with `vibepro adjudicate record --judgment`.');
    }
    if (needsHuman.length > 0) {
      reasons.push(`${needsHuman.length} item(s) require human judgment: `
        + needsHuman.map((item) => item.item_id).join(', ')
        + '. Close each with a decision record: `vibepro decision record . --id <story-id> --type needs_review --source gate:judgment_dag_adjudication:<item-id> --status accepted --reason <human-judgment> --artifact <evidence-path>`.');
    }
    return {
      ...base,
      status: 'needs_evidence',
      missing_items: missing,
      human_judgment_items: needsHuman,
      reason: reasons.join(' ')
    };
  }
  return {
    ...base,
    status: 'passed',
    reason: `All ${items.length} judgment item(s) hold under current-head adjudication (judged_sound, or needs_human_judgment closed by an accepted human decision record).`
  };
}

export function summarizeJudgmentAdjudicationForPr({ items = [], adjudication = null, headSha = null } = {}) {
  const verdicts = Array.isArray(adjudication?.verdicts) ? adjudication.verdicts : [];
  const fresh = verdicts.filter((entry) => Boolean(headSha) && entry.head_commit === headSha);
  return {
    item_count: items.length,
    fresh_verdict_count: fresh.length,
    judged_sound_count: fresh.filter((entry) => entry.verdict === 'judged_sound').length,
    judged_unsound_count: fresh.filter((entry) => entry.verdict === 'judged_unsound').length,
    needs_human_judgment_count: fresh.filter((entry) => entry.verdict === 'needs_human_judgment').length
  };
}
