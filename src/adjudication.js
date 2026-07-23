import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { findStorySource } from './requirement-consistency.js';
import { extractAcceptanceCriteria } from './traceability.js';
import { getWorkspaceDir, toWorkspaceRelative } from './workspace.js';
import { resolvePrArtifactFile } from './artifact-routing.js';

const execFileAsync = promisify(execFile);

export const ADJUDICATION_SCHEMA_VERSION = '0.1.0';
export const JUDGMENT_ADJUDICATION_SCHEMA_VERSION = '0.2.0';
export const ADJUDICATION_VERDICTS = ['demonstrated', 'not_demonstrated', 'not_verifiable_by_automation'];
export const JUDGMENT_ADJUDICATION_VERDICTS = ['judged_sound', 'judged_unsound', 'needs_human_judgment'];
export const JUDGMENT_UNSOUND_CAUSES = ['implementation_unsound', 'classifier_premise_unsound'];
const ADJUDICATION_AGENT_SYSTEMS = ['codex', 'claude_code'];

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
  const evidencePath = await resolvePrArtifactFile(path.resolve(repoRoot), storyId, 'verification-evidence.json');
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

function requireCliValue(value, message) {
  const normalized = requireValue(value, message);
  if (typeof normalized === 'string' && normalized.startsWith('--')) throw new Error(message);
  return normalized;
}

function judgeIdentity(provenance = {}) {
  const value = provenance && typeof provenance === 'object' ? provenance : {};
  return `${value.agent_system ?? ''}:${value.agent_id ?? ''}`;
}

function compareEventIds(a, b) {
  return String(a?.event_id ?? '').localeCompare(String(b?.event_id ?? ''));
}

function legacyJudgmentEventId(entry, index) {
  const digest = createHash('sha256').update(JSON.stringify([index, entry])).digest('hex').slice(0, 24);
  return `legacy-verdict-${digest}`;
}

const JUDGMENT_ADJUDICATION_V1_MODEL = 'vibepro-judgment-dag-adjudication-v1';
const JUDGMENT_ADJUDICATION_V2_MODEL = 'vibepro-judgment-dag-adjudication-v2';

function isDeclaredLegacyJudgmentArtifact(source) {
  const schemaCompatible = source.schema_version == null || source.schema_version === ADJUDICATION_SCHEMA_VERSION;
  const modelCompatible = source.model == null || source.model === JUDGMENT_ADJUDICATION_V1_MODEL;
  return schemaCompatible && modelCompatible;
}

function isMaterializedLegacyJudgmentEvent(event) {
  return event?.legacy_origin?.schema_version === ADJUDICATION_SCHEMA_VERSION
    && event?.legacy_origin?.model === JUDGMENT_ADJUDICATION_V1_MODEL
    && typeof event?.event_id === 'string'
    && event.event_id.startsWith('legacy-verdict-');
}

function isLegacyBlockingJudgmentEvent(event) {
  if (event?._legacy_source !== true) return false;
  // A directly-read v1 artifact retains the compatibility contract that
  // existed before v2. Once an event is materialized into editable v2 JSON,
  // its self-declared legacy_origin only grants permission to preserve a
  // blocker; it can no longer discharge the Gate or start recovery.
  if (event._legacy_materialized !== true) return true;
  return event?.type === 'verdict'
    && event?.verdict === 'judged_unsound'
    && (event?.unsound_cause ?? 'implementation_unsound') === 'implementation_unsound';
}

function persistJudgmentEvent(event) {
  const {
    _legacy_source: legacySource,
    _legacy_materialized: legacyMaterialized,
    ...persisted
  } = event;
  if (!legacySource) return persisted;
  return {
    ...persisted,
    legacy_origin: {
      schema_version: ADJUDICATION_SCHEMA_VERSION,
      model: JUDGMENT_ADJUDICATION_V1_MODEL
    }
  };
}

export function normalizeJudgmentAdjudicationArtifact(adjudication, { storyId = null } = {}) {
  const source = adjudication && typeof adjudication === 'object' ? adjudication : {};
  const formatErrors = [];
  const hasEvents = Array.isArray(source.events);
  const hasLegacyVerdicts = Array.isArray(source.verdicts);
  let events = [];
  if (hasEvents) {
    if (source.schema_version != null && source.schema_version !== JUDGMENT_ADJUDICATION_SCHEMA_VERSION) {
      formatErrors.push(`events artifact has unsupported schema_version ${source.schema_version}`);
    }
    if (source.model != null && source.model !== JUDGMENT_ADJUDICATION_V2_MODEL) {
      formatErrors.push(`events artifact has unsupported model ${source.model}`);
    }
    events = source.events.map((event) => ({
      ...event,
      _legacy_source: isMaterializedLegacyJudgmentEvent(event),
      _legacy_materialized: isMaterializedLegacyJudgmentEvent(event)
    }));
  } else if (hasLegacyVerdicts && isDeclaredLegacyJudgmentArtifact(source)) {
    events = source.verdicts.map((entry, index) => ({
        event_id: entry.event_id ?? legacyJudgmentEventId(entry, index),
        type: 'verdict',
        item_id: entry.item_id,
        verdict: entry.verdict,
        unsound_cause: entry.verdict === 'judged_unsound'
          ? 'implementation_unsound'
          : null,
        responds_to_correction_id: entry.responds_to_correction_id ?? null,
        reason: entry.reason,
        provenance: entry.provenance ?? null,
        head_commit: entry.head_commit ?? null,
        recorded_at: entry.recorded_at ?? null,
        _legacy_source: true,
        _legacy_materialized: false
      }));
  } else if (hasLegacyVerdicts || source.schema_version != null || source.model != null) {
    formatErrors.push(
      `artifact schema/model requires an events array; legacy verdicts are accepted only for ${ADJUDICATION_SCHEMA_VERSION}/${JUDGMENT_ADJUDICATION_V1_MODEL}`
    );
  }
  return {
    schema_version: JUDGMENT_ADJUDICATION_SCHEMA_VERSION,
    model: JUDGMENT_ADJUDICATION_V2_MODEL,
    story_id: source.story_id ?? storyId,
    updated_at: source.updated_at ?? null,
    events,
    format_errors: formatErrors
  };
}

function acceptedHumanJudgmentItems(decisions = []) {
  return new Set(
    decisions
      .filter((decision) => decision?.status === 'accepted' && decision?.reason && decision?.artifact)
      .map((decision) => String(decision.source ?? ''))
      .filter((source) => source.startsWith('gate:judgment_dag_adjudication:'))
      .map((source) => source.slice('gate:judgment_dag_adjudication:'.length))
  );
}

function validateReplacementEvidence(evidence) {
  return Array.isArray(evidence)
    && evidence.length > 0
    && evidence.every((item) => typeof item?.artifact === 'string'
      && isSafeWorkspaceRelativeArtifact(item.artifact)
      && /^[a-f0-9]{64}$/.test(item.sha256 ?? ''));
}

function isSafeWorkspaceRelativeArtifact(artifact) {
  const value = typeof artifact === 'string' ? artifact.trim() : '';
  if (!value || path.isAbsolute(value) || path.win32.isAbsolute(value)) return false;
  const segments = value.replaceAll('\\', '/').split('/');
  return !segments.some((segment) => segment === '..' || segment === '');
}

function validateEventProvenance(provenance) {
  return provenance
    && typeof provenance === 'object'
    && ['codex', 'claude_code'].includes(provenance.agent_system)
    && typeof provenance.agent_id === 'string'
    && provenance.agent_id.trim().length > 0;
}

export function resolveCurrentJudgmentState({
  storyId = null,
  itemIds = [],
  adjudication = null,
  headSha = null,
  decisions = []
} = {}) {
  const normalized = normalizeJudgmentAdjudicationArtifact(adjudication, { storyId });
  const invalid = [...normalized.format_errors];
  if (storyId && normalized.story_id && normalized.story_id !== storyId) {
    invalid.push(`artifact story_id ${normalized.story_id} does not match ${storyId}`);
  }
  const eventById = new Map();
  for (const event of normalized.events) {
    if (!event?.event_id || typeof event.event_id !== 'string') {
      invalid.push('event is missing event_id');
      continue;
    }
    if (eventById.has(event.event_id)) invalid.push(`duplicate event_id ${event.event_id}`);
    eventById.set(event.event_id, event);
  }
  const activeIds = new Set(itemIds);
  const currentEvents = headSha
    ? normalized.events.filter((event) => event?.head_commit === headSha)
    : [];
  const currentById = new Map(currentEvents.filter((event) => event?.event_id).map((event) => [event.event_id, event]));
  const correctionsByVerdict = new Map();
  const responsesByCorrection = new Map();
  for (const event of currentEvents) {
    if (!event?.item_id || typeof event.item_id !== 'string') {
      invalid.push(`event ${event?.event_id ?? '(unknown)'} is missing item_id`);
      continue;
    }
    if (activeIds.size > 0 && !activeIds.has(event.item_id)) {
      invalid.push(`event ${event.event_id} targets inactive item ${event.item_id}`);
    }
    // A legacy marker may preserve an old implementation blocker, but it can
    // never discharge the Gate or enter the premise-correction recovery path.
    // Any other event must satisfy the v2 audit contract even if it claims a
    // legacy_origin marker, because that marker is stored in editable JSON.
    if (!isLegacyBlockingJudgmentEvent(event)) {
      if (typeof event.reason !== 'string' || !event.reason.trim()) {
        invalid.push(`event ${event.event_id} is missing reason`);
      }
      if (!validateEventProvenance(event.provenance)) {
        invalid.push(`event ${event.event_id} has invalid provenance`);
      }
    }
    if (event.type === 'premise_correction') {
      if (!event.corrects_verdict_id) invalid.push(`correction ${event.event_id} is missing corrects_verdict_id`);
      if (!event.wrong_premise || !event.corrected_premise || !event.reason) {
        invalid.push(`correction ${event.event_id} is missing premise or reason`);
      }
      if (!validateReplacementEvidence(event.replacement_evidence)) {
        invalid.push(`correction ${event.event_id} has invalid replacement evidence`);
      }
      const target = currentById.get(event.corrects_verdict_id);
      if (!target || target.type !== 'verdict') {
        invalid.push(`correction ${event.event_id} has a dangling or cross-HEAD verdict reference`);
      } else {
        if (target.item_id !== event.item_id) invalid.push(`correction ${event.event_id} must reference a verdict for the same item`);
        if (target.verdict !== 'judged_unsound' || (target.unsound_cause ?? 'implementation_unsound') !== 'classifier_premise_unsound') {
          invalid.push(`correction ${event.event_id} may only correct classifier_premise_unsound`);
        }
      }
      const linked = correctionsByVerdict.get(event.corrects_verdict_id) ?? [];
      linked.push(event);
      correctionsByVerdict.set(event.corrects_verdict_id, linked);
      continue;
    }
    if (event.type !== 'verdict') {
      invalid.push(`event ${event.event_id} has unknown type ${event.type ?? '(missing)'}`);
      continue;
    }
    if (!JUDGMENT_ADJUDICATION_VERDICTS.includes(event.verdict)) {
      invalid.push(`verdict ${event.event_id} has unknown verdict ${event.verdict ?? '(missing)'}`);
    }
    const cause = event.unsound_cause ?? (event.verdict === 'judged_unsound' ? 'implementation_unsound' : null);
    if (event.verdict === 'judged_unsound' && !JUDGMENT_UNSOUND_CAUSES.includes(cause)) {
      invalid.push(`verdict ${event.event_id} has unknown unsound cause ${cause}`);
    }
    if (event.verdict !== 'judged_unsound' && event.unsound_cause) {
      invalid.push(`verdict ${event.event_id} has unsound cause without judged_unsound`);
    }
    if (event.responds_to_correction_id) {
      const correction = currentById.get(event.responds_to_correction_id);
      if (!correction || correction.type !== 'premise_correction') {
        invalid.push(`verdict ${event.event_id} has a dangling or cross-HEAD correction reference`);
      } else if (correction.item_id !== event.item_id) {
        invalid.push(`verdict ${event.event_id} must respond to a correction for the same item`);
      }
      const linked = responsesByCorrection.get(event.responds_to_correction_id) ?? [];
      linked.push(event);
      responsesByCorrection.set(event.responds_to_correction_id, linked);
    }
  }

  const humanClosures = acceptedHumanJudgmentItems(decisions);
  const resolvedItems = itemIds.map((itemId) => {
    const roots = currentEvents
      .filter((event) => event.type === 'verdict' && event.item_id === itemId && !event.responds_to_correction_id)
      .sort(compareEventIds);
    if (roots.length === 0) return { item_id: itemId, status: 'missing', current_verdict: null, correction: null };
    if (roots.length > 1) {
      invalid.push(`item ${itemId} has multiple root verdicts for current HEAD`);
      return { item_id: itemId, status: 'invalid_history', current_verdict: null, correction: null };
    }
    const visited = new Set();
    let verdict = roots[0];
    let lastCorrection = null;
    while (verdict) {
      if (visited.has(verdict.event_id)) {
        invalid.push(`item ${itemId} contains a judgment correction cycle`);
        return { item_id: itemId, status: 'invalid_history', current_verdict: verdict, correction: lastCorrection };
      }
      visited.add(verdict.event_id);
      if (verdict.verdict === 'judged_sound') {
        return { item_id: itemId, status: 'resolved', current_verdict: verdict, correction: lastCorrection };
      }
      if (verdict.verdict === 'needs_human_judgment') {
        return {
          item_id: itemId,
          status: humanClosures.has(itemId) ? 'resolved' : 'needs_human_judgment',
          current_verdict: verdict,
          correction: lastCorrection
        };
      }
      const cause = verdict.unsound_cause ?? 'implementation_unsound';
      if (cause !== 'classifier_premise_unsound') {
        return { item_id: itemId, status: 'failed', current_verdict: { ...verdict, unsound_cause: cause }, correction: lastCorrection };
      }
      const corrections = (correctionsByVerdict.get(verdict.event_id) ?? []).sort(compareEventIds);
      if (corrections.length === 0) {
        return { item_id: itemId, status: 'failed', current_verdict: verdict, correction: lastCorrection };
      }
      if (corrections.length > 1) {
        invalid.push(`verdict ${verdict.event_id} has multiple premise corrections`);
        return { item_id: itemId, status: 'invalid_history', current_verdict: verdict, correction: null };
      }
      lastCorrection = corrections[0];
      const responses = (responsesByCorrection.get(lastCorrection.event_id) ?? []).sort(compareEventIds);
      if (responses.length === 0) {
        return { item_id: itemId, status: 'awaiting_re_adjudication', current_verdict: verdict, correction: lastCorrection };
      }
      if (responses.length > 1) {
        invalid.push(`correction ${lastCorrection.event_id} has multiple re-adjudication verdicts`);
        return { item_id: itemId, status: 'invalid_history', current_verdict: verdict, correction: lastCorrection };
      }
      const response = responses[0];
      if (judgeIdentity(response.provenance) === judgeIdentity(verdict.provenance)) {
        invalid.push(`correction ${lastCorrection.event_id} was re-adjudicated by the same judge`);
        return { item_id: itemId, status: 'invalid_history', current_verdict: response, correction: lastCorrection };
      }
      verdict = response;
    }
    return { item_id: itemId, status: 'invalid_history', current_verdict: null, correction: lastCorrection };
  });
  invalid.sort();
  return {
    story_id: normalized.story_id ?? storyId,
    head_commit: headSha,
    status: invalid.length > 0 ? 'invalid_history' : 'valid',
    invalid_reasons: invalid,
    items: resolvedItems
  };
}

function assertJudgmentArtifactWritable({ normalized, adjudication, storyId, headCommit }) {
  if (normalized.format_errors.length > 0) {
    throw new Error(`existing judgment adjudication artifact is invalid and was not modified: ${normalized.format_errors.join('; ')}`);
  }
  const state = resolveCurrentJudgmentState({
    storyId,
    itemIds: [],
    adjudication,
    headSha: headCommit
  });
  if (state.status === 'invalid_history') {
    throw new Error(`existing judgment adjudication history is invalid and was not modified: ${state.invalid_reasons.join('; ')}`);
  }
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
  const prPreparePath = await resolvePrArtifactFile(root, storyId);
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
  const headCommit = await resolveHeadCommit(root);
  const existing = await readJudgmentAdjudicationIfExists(root, storyId);
  const currentState = resolveCurrentJudgmentState({
    storyId,
    itemIds: items.map((item) => item.id),
    adjudication: existing,
    headSha: headCommit,
    decisions: prPrepare?.pr_context?.decision_records?.decisions ?? []
  });
  if (currentState.status === 'invalid_history') {
    throw new Error(
      `adjudicate prepare --judgment: judgment history is invalid: ${currentState.invalid_reasons.join('; ')}`
    );
  }
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
    '### judged_unsound の原因分類',
    '',
    '- `implementation_unsound`: 実装・証拠・判断そのものが成立していない。前提訂正では解決できず、実装または証拠を直して新しいHEADで裁定し直す。',
    '- `classifier_premise_unsound`: 判定器が差分について置いた前提だけが誤っている。元判定を残したまま、根拠付き前提訂正と別judgeの再裁定が必要。',
    '- 原因未記録のlegacy `judged_unsound` は安全側で `implementation_unsound` と扱う。generic waiverや設定無効化で代替してはならない。',
    '',
    '### 記録方法',
    '',
    '項目ごとに以下を実行する（reasonには検討の中身を具体的に書く）:',
    '',
    '```bash',
    `vibepro adjudicate record . --id ${storyId} --judgment --item <item-id> --verdict <verdict> [--unsound-cause <implementation_unsound|classifier_premise_unsound>] --reason "<検討内容>" --agent-system <codex|claude_code> --agent-id <subagent-id> [--session-ref <ref>]`,
    '```',
    '',
    '`classifier_premise_unsound` の前提だけを訂正する場合:',
    '',
    '```bash',
    `vibepro adjudicate correct . --id ${storyId} --judgment --item <item-id> --original-verdict-id <verdict-event-id> --incorrect-premise "<誤った前提>" --corrected-premise "<訂正後の前提>" --reason "<訂正理由>" --replacement-evidence <workspace-relative-file> --agent-system <codex|claude_code> --agent-id <operator-id>`,
    '```',
    '',
    '訂正後は、元のjudgeとは異なるfresh contextのjudgeが次を実行する:',
    '',
    '```bash',
    `vibepro adjudicate record . --id ${storyId} --judgment --item <item-id> --correction-id <correction-event-id> --verdict <verdict> [--unsound-cause <implementation_unsound|classifier_premise_unsound>] --reason "<再検討内容>" --agent-system <codex|claude_code> --agent-id <different-subagent-id>`,
    '```',
    '',
    '## 変更ファイル',
    '',
    ...(changedFiles.length > 0 ? changedFiles.map((file) => `- ${file}`) : ['- (変更ファイル情報なし)']),
    '',
    '## 判断チェックリスト',
    ''
  ];
  for (const [index, item] of items.entries()) {
    const state = currentState.items[index];
    lines.push(
      `### ${item.id}`,
      '',
      `> ${item.question}`,
      '',
      `- 機械的消化の現状: ${item.mechanical_status ?? '-'}`,
      `- 一致した証拠: ${item.evidence_summary ?? '（なし）'}`,
      `- 現在の裁定状態: ${state?.status ?? 'missing'}`,
      ...(state?.current_verdict ? [
        `- current verdict event: ${state.current_verdict.event_id}`,
        `- current verdict: ${state.current_verdict.verdict}`,
        `- unsound cause: ${state.current_verdict.unsound_cause ?? '-'}`,
        `- judge reason: ${state.current_verdict.reason ?? '-'}`
      ] : []),
      ''
    );
    if (state?.correction) {
      lines.push(
        `- correction event: ${state.correction.event_id}`,
        `- 訂正前提: ${state.correction.wrong_premise}`,
        `- 訂正後前提: ${state.correction.corrected_premise}`,
        `- replacement evidence: ${state.correction.replacement_evidence.map((entry) => `${entry.artifact} (${entry.sha256})`).join(', ')}`,
        `- 再裁定command: \`vibepro adjudicate record . --id ${storyId} --judgment --item ${item.id} --correction-id ${state.correction.event_id} --verdict <verdict> --reason "<再検討内容>" --agent-system <codex|claude_code> --agent-id <different-subagent-id>\``,
        ''
      );
    }
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
  const storyId = requireCliValue(options.storyId, 'adjudicate record --judgment requires --id <story-id>');
  const itemId = requireCliValue(options.itemId, 'adjudicate record --judgment requires --item <item-id>');
  const verdict = requireCliValue(options.verdict, 'adjudicate record --judgment requires --verdict <verdict>');
  if (!JUDGMENT_ADJUDICATION_VERDICTS.includes(verdict)) {
    throw new Error(`adjudicate record --judgment --verdict must be one of: ${JUDGMENT_ADJUDICATION_VERDICTS.join(', ')}`);
  }
  const reason = requireCliValue(options.reason, 'adjudicate record --judgment requires --reason <text> so the judgment is auditable');
  const agentSystem = requireCliValue(options.agentSystem, 'adjudicate record --judgment requires --agent-system <codex|claude_code>');
  if (!ADJUDICATION_AGENT_SYSTEMS.includes(agentSystem)) {
    throw new Error(`adjudicate record --judgment --agent-system must be one of: ${ADJUDICATION_AGENT_SYSTEMS.join(', ')}`);
  }
  const agentId = requireCliValue(options.agentId, 'adjudicate record --judgment requires --agent-id <id> so adjudicator provenance is auditable');
  const unsoundCause = options.unsoundCause == null ? null : requireCliValue(
    options.unsoundCause,
    'adjudicate record --judgment --verdict judged_unsound requires --unsound-cause <implementation_unsound|classifier_premise_unsound>'
  );
  if (verdict === 'judged_unsound' && !unsoundCause) {
    throw new Error('adjudicate record --judgment --verdict judged_unsound requires --unsound-cause <implementation_unsound|classifier_premise_unsound>');
  }
  if (verdict === 'judged_unsound' && !JUDGMENT_UNSOUND_CAUSES.includes(unsoundCause)) {
    throw new Error(`adjudicate record --judgment --unsound-cause must be one of: ${JUDGMENT_UNSOUND_CAUSES.join(', ')}`);
  }
  if (verdict !== 'judged_unsound' && unsoundCause) {
    throw new Error('adjudicate record --judgment --unsound-cause is only valid with judged_unsound');
  }
  const correctionId = options.correctionId == null ? null : requireCliValue(
    options.correctionId,
    'adjudicate record --judgment --correction-id requires an event id'
  );
  const root = path.resolve(repoRoot);
  const headCommit = await resolveHeadCommit(root);
  if (!headCommit) {
    throw new Error('adjudicate record --judgment could not resolve the current HEAD commit (git rev-parse HEAD failed); verdicts must be head-bound, so run this command inside the target git repository');
  }
  const existing = await readJudgmentAdjudicationIfExists(root, storyId);
  const normalized = normalizeJudgmentAdjudicationArtifact(existing, { storyId });
  if (normalized.story_id && normalized.story_id !== storyId) {
    throw new Error(`judgment adjudication artifact belongs to ${normalized.story_id}, not ${storyId}`);
  }
  assertJudgmentArtifactWritable({ normalized, adjudication: existing, storyId, headCommit });
  const currentEvents = normalized.events.filter((event) => event.head_commit === headCommit);
  let correction = null;
  if (correctionId) {
    correction = currentEvents.find((event) => event.event_id === correctionId && event.type === 'premise_correction') ?? null;
    if (!correction) throw new Error(`--correction-id ${correctionId} does not reference a current-HEAD premise correction`);
    if (correction.item_id !== itemId) throw new Error(`--correction-id ${correctionId} must reference a correction for the same item`);
    const original = currentEvents.find((event) => event.event_id === correction.corrects_verdict_id && event.type === 'verdict') ?? null;
    if (!original) throw new Error(`correction ${correctionId} does not reference a current-HEAD original verdict`);
    if (judgeIdentity(original.provenance) === judgeIdentity({ agent_system: agentSystem, agent_id: agentId })) {
      throw new Error('premise correction must be re-adjudicated by a different independent judge');
    }
    if (currentEvents.some((event) => event.type === 'verdict' && event.responds_to_correction_id === correctionId)) {
      throw new Error(`correction ${correctionId} already has a re-adjudication verdict; history is append-only`);
    }
  } else if (currentEvents.some((event) => event.type === 'verdict' && event.item_id === itemId && !event.responds_to_correction_id)) {
    throw new Error(`item ${itemId} already has a current-HEAD root verdict; use a linked premise correction flow instead of overwriting history`);
  }
  const entry = {
    event_id: randomUUID(),
    type: 'verdict',
    item_id: itemId,
    verdict,
    unsound_cause: verdict === 'judged_unsound' ? unsoundCause : null,
    responds_to_correction_id: correction?.event_id ?? null,
    reason,
    provenance: {
      agent_system: agentSystem,
      agent_id: agentId,
      session_ref: options.sessionRef ?? null
    },
    head_commit: headCommit,
    recorded_at: new Date().toISOString()
  };
  const next = {
    schema_version: JUDGMENT_ADJUDICATION_SCHEMA_VERSION,
    model: JUDGMENT_ADJUDICATION_V2_MODEL,
    story_id: storyId,
    updated_at: new Date().toISOString(),
    events: [...normalized.events, entry].map(persistJudgmentEvent)
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

async function resolveReplacementEvidence(root, artifacts) {
  if (!Array.isArray(artifacts) || artifacts.length === 0) {
    throw new Error('adjudicate correct requires at least one --replacement-evidence <workspace-relative-file>');
  }
  const resolved = [];
  const realRoot = await realpath(root);
  for (const rawArtifact of artifacts) {
    const artifact = requireCliValue(rawArtifact, 'adjudicate correct --replacement-evidence requires a workspace-relative file');
    if (path.isAbsolute(artifact)) throw new Error(`replacement evidence must be workspace-relative: ${artifact}`);
    const absolute = path.resolve(root, artifact);
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`replacement evidence must stay inside the workspace: ${artifact}`);
    }
    let metadata;
    let realAbsolute;
    let body;
    try {
      const lexicalMetadata = await lstat(absolute);
      if (lexicalMetadata.isSymbolicLink()) {
        throw new Error('symbolic links are not accepted');
      }
      realAbsolute = await realpath(absolute);
      const realRelative = path.relative(realRoot, realAbsolute);
      if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
        throw new Error('resolved path must stay inside the workspace');
      }
      metadata = await stat(realAbsolute);
      body = await readFile(realAbsolute);
    } catch (error) {
      throw new Error(`replacement evidence is not readable: ${artifact} (${error.message})`);
    }
    if (!metadata.isFile()) throw new Error(`replacement evidence must be a regular file: ${artifact}`);
    resolved.push({
      artifact: relative.split(path.sep).join('/'),
      sha256: createHash('sha256').update(body).digest('hex')
    });
  }
  return resolved;
}

export async function recordPremiseCorrection(repoRoot, options = {}) {
  const storyId = requireCliValue(options.storyId, 'adjudicate correct requires --id <story-id>');
  const itemId = requireCliValue(options.itemId, 'adjudicate correct requires --item <item-id>');
  const originalVerdictId = requireCliValue(options.originalVerdictId, 'adjudicate correct requires --original-verdict-id <event-id>');
  const wrongPremise = requireCliValue(options.incorrectPremise, 'adjudicate correct requires --incorrect-premise <text>');
  const correctedPremise = requireCliValue(options.correctedPremise, 'adjudicate correct requires --corrected-premise <text>');
  const reason = requireCliValue(options.reason, 'adjudicate correct requires --reason <text>');
  const agentSystem = requireCliValue(options.agentSystem, 'adjudicate correct requires --agent-system <codex|claude_code>');
  if (!ADJUDICATION_AGENT_SYSTEMS.includes(agentSystem)) {
    throw new Error(`adjudicate correct --agent-system must be one of: ${ADJUDICATION_AGENT_SYSTEMS.join(', ')}`);
  }
  const agentId = requireCliValue(options.agentId, 'adjudicate correct requires --agent-id <id>');
  const root = path.resolve(repoRoot);
  const headCommit = await resolveHeadCommit(root);
  if (!headCommit) {
    throw new Error('adjudicate correct could not resolve the current HEAD commit (git rev-parse HEAD failed); corrections must be head-bound');
  }
  const existing = await readJudgmentAdjudicationIfExists(root, storyId);
  const normalized = normalizeJudgmentAdjudicationArtifact(existing, { storyId });
  if (normalized.story_id && normalized.story_id !== storyId) {
    throw new Error(`judgment adjudication artifact belongs to ${normalized.story_id}, not ${storyId}`);
  }
  assertJudgmentArtifactWritable({ normalized, adjudication: existing, storyId, headCommit });
  const currentEvents = normalized.events.filter((event) => event.head_commit === headCommit);
  const original = currentEvents.find((event) => event.event_id === originalVerdictId && event.type === 'verdict') ?? null;
  if (!original) throw new Error(`--original-verdict-id ${originalVerdictId} does not reference a current-HEAD verdict`);
  if (original.item_id !== itemId) throw new Error(`--original-verdict-id ${originalVerdictId} must reference a verdict for the same item`);
  const cause = original.unsound_cause ?? (original.verdict === 'judged_unsound' ? 'implementation_unsound' : null);
  if (original.verdict !== 'judged_unsound' || cause !== 'classifier_premise_unsound') {
    throw new Error('only classifier_premise_unsound verdicts may receive a premise correction; implementation_unsound remains failed');
  }
  if (currentEvents.some((event) => event.type === 'premise_correction' && event.corrects_verdict_id === originalVerdictId)) {
    throw new Error(`verdict ${originalVerdictId} already has a premise correction; history is append-only`);
  }
  const replacementEvidence = await resolveReplacementEvidence(root, options.replacementEvidence);
  const entry = {
    event_id: randomUUID(),
    type: 'premise_correction',
    item_id: itemId,
    corrects_verdict_id: originalVerdictId,
    wrong_premise: wrongPremise,
    corrected_premise: correctedPremise,
    reason,
    replacement_evidence: replacementEvidence,
    provenance: {
      agent_system: agentSystem,
      agent_id: agentId,
      session_ref: options.sessionRef ?? null
    },
    head_commit: headCommit,
    recorded_at: new Date().toISOString()
  };
  const next = {
    schema_version: JUDGMENT_ADJUDICATION_SCHEMA_VERSION,
    model: JUDGMENT_ADJUDICATION_V2_MODEL,
    story_id: storyId,
    updated_at: new Date().toISOString(),
    events: [...normalized.events, entry].map(persistJudgmentEvent)
  };
  await mkdir(adjudicationDir(root, storyId), { recursive: true });
  const artifactPath = judgmentAdjudicationArtifactPath(root, storyId);
  await writeFile(artifactPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  return { entry, records: next, artifact: toWorkspaceRelative(root, artifactPath) };
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
  const state = resolveCurrentJudgmentState({
    storyId,
    itemIds: items.map((item) => item.id),
    adjudication,
    headSha,
    decisions
  });
  if (state.status === 'invalid_history') {
    return {
      ...base,
      status: 'failed',
      invalid_history: state.invalid_reasons,
      reason: `Judgment adjudication history is invalid and cannot be resolved safely: ${state.invalid_reasons.join('; ')}.`
    };
  }
  const missing = [];
  const unsound = [];
  const needsHuman = [];
  const pendingCorrections = [];
  for (const item of state.items) {
    if (item.status === 'missing') missing.push(item.item_id);
    if (item.status === 'failed') {
      unsound.push({
        item_id: item.item_id,
        reason: item.current_verdict?.reason,
        unsound_cause: item.current_verdict?.unsound_cause ?? 'implementation_unsound',
        verdict_id: item.current_verdict?.event_id ?? null
      });
    }
    if (item.status === 'needs_human_judgment') {
      needsHuman.push({ item_id: item.item_id, reason: item.current_verdict?.reason });
    }
    if (item.status === 'awaiting_re_adjudication') pendingCorrections.push(item.item_id);
  }
  if (unsound.length > 0) {
    const classifierRecovery = unsound
      .filter((item) => item.unsound_cause === 'classifier_premise_unsound')
      .map((item) => `For ${item.item_id}, record an evidence-backed premise correction with `
        + `\`vibepro adjudicate correct . --id ${storyId} --judgment --item ${item.item_id} --original-verdict-id ${item.verdict_id} ...\`.`);
    return {
      ...base,
      status: 'failed',
      judged_unsound_items: unsound,
      reason: `Judge ruled ${unsound.length} judgment item(s) unsound (tokens present but the judgment does not hold): `
        + unsound.map((item) => `${item.item_id} [${item.unsound_cause}] (${item.reason})`).join('; ')
        + '. implementation_unsound requires an implementation/evidence change and a new-HEAD adjudication. '
        + (classifierRecovery.length > 0 ? classifierRecovery.join(' ') : '')
    };
  }
  if (missing.length > 0 || needsHuman.length > 0 || pendingCorrections.length > 0) {
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
    if (pendingCorrections.length > 0) {
      reasons.push(`${pendingCorrections.length} item(s) have an accepted premise correction but still require fresh linked re-adjudication: ${pendingCorrections.join(', ')}. `
        + 'Dispatch a different independent judge and record its verdict with `vibepro adjudicate record --judgment --correction-id <correction-event-id>`.');
    }
    return {
      ...base,
      status: 'needs_evidence',
      missing_items: missing,
      human_judgment_items: needsHuman,
      pending_correction_items: pendingCorrections,
      reason: reasons.join(' ')
    };
  }
  return {
    ...base,
    status: 'passed',
    reason: `All ${items.length} judgment item(s) hold under current-head adjudication (judged_sound, or needs_human_judgment closed by an accepted human decision record).`
  };
}

export function summarizeJudgmentAdjudicationForPr({ storyId = null, items = [], adjudication = null, headSha = null, decisions = [] } = {}) {
  const state = resolveCurrentJudgmentState({
    storyId,
    itemIds: items.map((item) => item.id),
    adjudication,
    headSha,
    decisions
  });
  const current = (state.status === 'invalid_history' ? [] : state.items)
    .map((item) => item.current_verdict)
    .filter(Boolean);
  return {
    item_count: items.length,
    fresh_verdict_count: current.length,
    judged_sound_count: current.filter((entry) => entry.verdict === 'judged_sound').length,
    judged_unsound_count: current.filter((entry) => entry.verdict === 'judged_unsound').length,
    needs_human_judgment_count: current.filter((entry) => entry.verdict === 'needs_human_judgment').length,
    pending_correction_count: state.status === 'invalid_history'
      ? 0
      : state.items.filter((item) => item.status === 'awaiting_re_adjudication').length,
    invalid_history_count: state.invalid_reasons.length
  };
}
