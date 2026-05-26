const SCHEMA_VERSION = '0.1.0';

const SURFACE_ALIASES = {
  frontend_interaction: ['frontend', 'ui', 'interaction', 'screen', 'component', 'フロント', '画面'],
  server_api: ['server_api', 'api', 'endpoint', 'route', 'サーバー'],
  service_orchestration: ['service', 'orchestration', 'orchestrator', 'サービス'],
  core_workflow_state: ['workflow', 'state machine', 'orchestration', 'state', 'transition', 'ワークフロー', '状態'],
  gate_orchestration: ['gate', 'pr-manager', 'gate orchestration'],
  verification_evidence: ['verification', 'evidence', 'flow verifier'],
  review_lifecycle: ['review lifecycle', 'agent review', 'lifecycle'],
  database_state: ['database', 'db', 'schema', 'persistence'],
  queue_worker: ['queue', 'worker', 'job', 'background'],
  polling_retry: ['polling', 'poll', 'retry', 'status check'],
  auth_boundary: ['auth', 'authentication', 'authorization', 'permission', 'session', '認証'],
  legacy_v1_compatibility: ['legacy', 'v1', '互換']
};

const MATRIX = {
  light: { high: 'allow', medium: 'allow', low: 'allow', unknown: 'allow' },
  ui_interaction: { high: 'allow', medium: 'allow', low: 'require_human_review', unknown: 'require_human_review' },
  api_contract: { high: 'allow', medium: 'require_human_review', low: 'require_human_review', unknown: 'block' },
  workflow_heavy: { high: 'allow', medium: 'require_human_review', low: 'block', unknown: 'block' }
};

const KNOWN_PROFILES = new Set(Object.keys(MATRIX));

export function scoreAuthorization({ riskProfile = null, storySource = null, decisions = [] } = {}) {
  const profile = riskProfile?.profile ?? 'light';
  const riskSurfaces = Array.isArray(riskProfile?.risk_surfaces) ? riskProfile.risk_surfaces : [];
  const hasStory = isNonEmptyStory(storySource);
  const hasDecisions = Array.isArray(decisions) && decisions.length > 0;

  const signals = [];
  const acceptedSignals = collectAcceptedDecisionSignals(decisions, riskSurfaces);
  signals.push(...acceptedSignals.signals);

  const storySignals = collectStorySurfaceSignals(storySource, riskSurfaces);
  signals.push(...storySignals);

  let authorizationLevel;
  if (acceptedSignals.qualifies) {
    authorizationLevel = 'high';
  } else if (storySignals.some((signal) => signal.kind === 'acceptance_criteria_mentions_surface' || signal.kind === 'story_background_mentions_surface')) {
    authorizationLevel = 'medium';
  } else if (!hasStory && !hasDecisions) {
    authorizationLevel = 'unknown';
  } else if (riskSurfaces.length === 0) {
    authorizationLevel = 'unknown';
  } else {
    authorizationLevel = 'low';
  }

  const matrixProfile = KNOWN_PROFILES.has(profile) ? profile : null;
  const recommendation = matrixProfile
    ? MATRIX[matrixProfile][authorizationLevel]
    : 'require_human_review';

  return {
    schema_version: SCHEMA_VERSION,
    authorization_level: authorizationLevel,
    signals,
    review_outcome_recommendation: recommendation,
    matrix_cell: {
      risk_profile: profile,
      authorization_level: authorizationLevel,
      known_profile: matrixProfile !== null
    }
  };
}

function isNonEmptyStory(storySource) {
  if (!storySource || typeof storySource !== 'object') return false;
  const fields = [
    storySource.title,
    storySource.requirement_title,
    storySource.background,
    storySource.policy,
    ...(Array.isArray(storySource.acceptance_criteria) ? storySource.acceptance_criteria : [])
  ];
  return fields.some((value) => typeof value === 'string' && value.trim().length > 0);
}

function collectAcceptedDecisionSignals(decisions, riskSurfaces) {
  const signals = [];
  let qualifies = false;
  if (!Array.isArray(decisions)) return { signals, qualifies };
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object') continue;
    if (decision.status !== 'accepted') continue;
    const source = typeof decision.source === 'string' ? decision.source.trim() : '';
    if (!source) {
      signals.push({
        kind: 'decision_record_invalid_source',
        decision_id: decision.decision_id ?? null,
        reason: 'accepted decision has no source reference'
      });
      continue;
    }
    if (!isPlausibleSourceReference(source)) {
      signals.push({
        kind: 'decision_record_invalid_source',
        decision_id: decision.decision_id ?? null,
        source,
        reason: 'source does not look like a gate or finding id'
      });
      continue;
    }
    qualifies = true;
    signals.push({
      kind: 'decision_record_accepted',
      decision_id: decision.decision_id ?? null,
      source,
      addresses_risk_surface: riskSurfaces.find((surface) => source.toLowerCase().includes(surface)) ?? null
    });
  }
  return { signals, qualifies };
}

function isPlausibleSourceReference(source) {
  return /^(gate:|finding:|check:|review:|dec-|decision-)/i.test(source) || source.includes(':');
}

function collectStorySurfaceSignals(storySource, riskSurfaces) {
  if (!isNonEmptyStory(storySource) || riskSurfaces.length === 0) return [];
  const acceptance = Array.isArray(storySource.acceptance_criteria) ? storySource.acceptance_criteria : [];
  const background = [storySource.background, storySource.policy, storySource.title, storySource.requirement_title]
    .filter((value) => typeof value === 'string')
    .join('\n');
  const signals = [];
  for (const surface of riskSurfaces) {
    const aliases = SURFACE_ALIASES[surface] ?? [];
    const haystack = (str) => surfaceMatches(str, surface, aliases);
    if (acceptance.some(haystack)) {
      signals.push({ kind: 'acceptance_criteria_mentions_surface', surface });
    } else if (haystack(background)) {
      signals.push({ kind: 'story_background_mentions_surface', surface });
    }
  }
  return signals;
}

function surfaceMatches(text, surface, aliases) {
  if (typeof text !== 'string' || text.length === 0) return false;
  const lower = text.toLowerCase();
  if (lower.includes(surface.toLowerCase())) return true;
  const surfaceWords = surface.replace(/_/g, ' ').toLowerCase();
  if (lower.includes(surfaceWords)) return true;
  return aliases.some((alias) => lower.includes(alias.toLowerCase()));
}
