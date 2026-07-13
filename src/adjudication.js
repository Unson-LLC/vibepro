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

const VERDICT_DEFINITIONS = {
  demonstrated: '紐づく証拠が、このclauseの成果が実際に起きたことを実証している。証拠の観測内容から成果へ推論の飛躍なしに到達できる場合のみ選ぶ。',
  not_demonstrated: '証拠は存在するが、このclauseの成果を実証していない。文字列・フィールドの存在確認、無関係なテストのpass、成果と接地しない観測はこの判定にする。',
  not_verifiable_by_automation: 'このclauseの成果は自動テストでは原理的に検証できず、人間の観測（実利用・実操作・目視確認）が必要。正直にこの判定を選ぶこと自体が正しい成果であり、罰ではない。'
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
    if (headSha && entry.head_commit && entry.head_commit !== headSha) continue;
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
  const fresh = verdicts.filter((entry) => !headSha || !entry.head_commit || entry.head_commit === headSha);
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
