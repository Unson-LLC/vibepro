import { createHash } from 'node:crypto';

// Budget override authority (CEA-S-4).
//
// A Story-local delivery-efficiency override raises the limits that are meant
// to stop the agent that is consuming them. Until this module existed, writing
// `amendment_reason` was sufficient: the receiver of the budget was also its
// grantor, and no code ever read an approval. This module makes an override
// inert unless an accepted decision record grants it, and binds that grant to
// the exact numbers it approved via a digest the system computes.
//
// The config file itself stays writable by the agent on purpose. Preventing the
// write is bypassable (it is a plain JSON file edited with ordinary tools);
// refusing to *honour* an unapproved write at the single consumption point is
// not. Inertness, not write protection, is the enforced property.

export const BUDGET_APPROVAL_SOURCE_PREFIX = 'budget:delivery_efficiency:';

// Keys that describe the amendment rather than the limits it sets. They are
// excluded from the digest so prose can be corrected without re-approval, and
// so a reworded reason can never launder a changed number.
const NON_LIMIT_KEYS = new Set(['amendment_reason']);

const GRANTOR_KINDS = new Set(['human', 'agent']);

// Overrides that predate this gate, pinned to the digest of their exact content.
// Grandfathering the *content* and not merely the *story* means these 13 entries
// keep working exactly as merged, while any edit to one of them changes its
// digest and drops it to `unauthorized` -- a snapshot, not a licence. Extending
// this map requires a code diff that a reviewer sees; it cannot be widened by
// editing `.vibepro/config.json`.
export const GRANDFATHERED_OVERRIDE_DIGESTS = Object.freeze({
  'story-vibepro-gate-decision-outcome-ledger': '217aec79fd58e784db7528cc7a4f6cd40549d13eaacb2688a82a73a3cdf602cf',
  'story-vibepro-import-based-conformance': 'd42215d5c51d90851c2dae3cccc98c2158497acf0c1b33a155034e3192ff9307',
  'story-vibepro-autonomous-roadmap-catalog-closure': 'daa2d73b724ca354fd69d9c891ead365d026be43dcb2149fdfa9dbd16c009028',
  'story-vibepro-delivery-reconciliation-state': '9ddfc9ea5f77622f04fb3e73c6ed586221f48c63be6eb42f920f37a38d7b9d95',
  'story-vibepro-surface-aware-agent-review-freshness': 'a251cd5b7d91833c40f8a29abf0e44bc7e44d9e2a1914bd1d2d6b6377c930865',
  'story-vibepro-codex-detached-completion-inbox': 'dfbf447fb54a363c5f956ae645b30d9adfe2bff14268497216953789197e6c7e',
  'story-vibepro-merge-waiver-propagation': 'c72c581b3c3bc32dd64d7646eb80970ccb7e4b1d4daf5573319c021d5b430696',
  'story-vibepro-trusted-delivery-efficiency-guardrail': '82e9a0531ac8e17e4d71987f7e29064ef5de893ddb21b21e8963d5e7172eaca8',
  'story-vibepro-independent-review-orchestration': 'b6dcfea19182f3416d73cbe47c437888b9c46b204c247b9c9de46982d7a476a9',
  'story-vibepro-one-command-pr-ready-closure': 'ac2d9a75e90bdfeb3c40e0eab15cddf9704be13b5a0744dd06995f8601a55c7b',
  'story-vibepro-atomic-scope-review-contract': 'bd669b78216cc005ee0ec9f0e131cf131a2d6d6faebca31d181a7e7cd9b4447c',
  'story-vibepro-symlinked-bin-entrypoint': '85eb24b5275b092c54bef1907251470747af829f680105f0dbf2fa52714d43f3',
  'story-vibepro-ideal-state-inversion': '5dd26a0663ec1f562281c6664c3510bb7aeb7737853dc8331d4392a4469f2f7e',
  // Added when this branch merged origin/main. Both Stories merged while this
  // gate was still in review, so leaving them unpinned would retroactively make
  // an already-merged Story's override inert -- exactly the outcome the
  // grandfather policy exists to prevent. Pinned to their merged content, on the
  // same snapshot-not-licence terms as the original thirteen.
  'story-vibepro-task-scoped-pr-acceptance': 'c287f248c6d43a91fc4dec922e2500247ef1f41a358c07328b3dfdd2efd62ad6',
  'story-vibepro-runner-direct-evidence': 'bbcbf3cbb63d704f3dc961093b51f3a704a83fc0d6fbb6589b4556d2af702029'
});

export function budgetApprovalSource(storyId) {
  return `${BUDGET_APPROVAL_SOURCE_PREFIX}${requireText(storyId, 'story_id')}`;
}

export function parseBudgetApprovalSource(source) {
  if (typeof source !== 'string' || !source.startsWith(BUDGET_APPROVAL_SOURCE_PREFIX)) return null;
  const storyId = source.slice(BUDGET_APPROVAL_SOURCE_PREFIX.length).trim();
  return storyId ? storyId : null;
}

// The digest is computed from the override as it exists in config, never from
// agent-supplied input. Approving a budget therefore approves specific numbers.
//
// story_id is inside the digest so a grant is structurally untransplantable: two
// Stories that happen to configure identical limits still produce different
// digests, and an approval copied to another Story fails on the digest itself
// rather than only on the separate story_id equality checks.
export function computeBudgetOverrideDigest(storyId, override) {
  const scope = requireText(storyId, 'budget override story_id');
  if (!isPlainObject(override)) throw new Error('budget override must be an object');
  const limits = {};
  for (const key of Object.keys(override)) {
    if (NON_LIMIT_KEYS.has(key)) continue;
    limits[key] = override[key];
  }
  return createHash('sha256').update(canonicalJson({ story_id: scope, limits })).digest('hex');
}

export function normalizeGrantorKind(value) {
  const kind = typeof value === 'string' ? value.trim() : '';
  if (!GRANTOR_KINDS.has(kind)) {
    throw new Error(`budget approval grantor kind must be one of: ${[...GRANTOR_KINDS].join(', ')}`);
  }
  return kind;
}

// Enforces the separation the round-6 review named: the party that receives the
// budget may not be the party that grants it. The recording agent must identify
// itself and must name someone else as grantor.
export function buildBudgetApproval(input = {}) {
  const storyId = requireText(input.storyId, 'budget approval story_id');
  const grantorKind = normalizeGrantorKind(input.grantorKind);
  const grantor = requireText(input.grantor, 'budget approval requires --budget-grantor <identity>');
  const recordedBy = {
    agent_system: requireText(input.agentSystem, 'budget approval requires --agent-system <system>'),
    agent_id: requireText(input.agentId, 'budget approval requires --agent-id <id>')
  };
  if (isSelfGrant(grantor, recordedBy)) {
    throw new Error('budget approval grantor must differ from the recording agent identity: '
      + 'the session that consumes a raised budget cannot also grant it');
  }
  return {
    story_id: storyId,
    override_digest: requireText(input.overrideDigest, 'budget approval override_digest'),
    grantor_kind: grantorKind,
    grantor,
    recorded_by: recordedBy,
    config_ref: input.configRef ?? '.vibepro/config.json'
  };
}

// Resolution is intentionally non-throwing: an unauthorized override falls back
// to the base budget (the tighter one) and reports why, so the agent is stopped
// by the default limit and the reason reaches the human at PR time.
export function resolveBudgetOverrideAuthority(input = {}) {
  const storyId = typeof input.storyId === 'string' ? input.storyId.trim() : '';
  const override = input.override;
  if (!storyId || !isPlainObject(override)) {
    return { status: 'absent', story_id: storyId || null, digest: null, reasons: [], approval: null };
  }
  const digest = computeBudgetOverrideDigest(storyId, override);
  const base = { story_id: storyId, digest, approval: null };
  if (GRANDFATHERED_OVERRIDE_DIGESTS[storyId] === digest) {
    return { ...base, status: 'grandfathered', reasons: [] };
  }
  const candidates = (Array.isArray(input.decisions) ? input.decisions : [])
    .filter((decision) => parseBudgetApprovalSource(decision?.source) === storyId);
  if (candidates.length === 0) {
    return { ...base, status: 'unauthorized', reasons: ['missing_approval'] };
  }
  let bestReasons = null;
  for (const decision of candidates) {
    const reasons = disqualifyApproval(decision, digest, storyId);
    if (reasons.length === 0) {
      return { ...base, status: 'authorized', reasons: [], approval: summarizeApproval(decision) };
    }
    if (bestReasons === null || reasons.length < bestReasons.reasons.length) {
      bestReasons = { reasons, decision };
    }
  }
  return { ...base, status: 'unauthorized', reasons: bestReasons.reasons, approval: summarizeApproval(bestReasons.decision) };
}

function disqualifyApproval(decision, digest, storyId) {
  const reasons = [];
  if (decision?.status !== 'accepted') reasons.push('approval_not_accepted');
  if (decision?.story_id !== storyId) reasons.push('approval_story_mismatch');
  const approval = decision?.budget_approval;
  if (!isPlainObject(approval)) {
    reasons.push('approval_missing_budget_grant');
    return reasons;
  }
  if (approval.override_digest !== digest) reasons.push('approval_digest_mismatch');
  if (approval.grantor_kind !== 'human') reasons.push('grantor_not_human');
  if (!isText(approval.grantor)) reasons.push('grantor_missing');
  if (!isText(approval.recorded_by?.agent_system) || !isText(approval.recorded_by?.agent_id)) {
    reasons.push('recording_agent_unidentified');
  } else if (isSelfGrant(approval.grantor, approval.recorded_by)) {
    reasons.push('self_approved');
  }
  if (!isText(decision?.reason)) reasons.push('approval_missing_reason');
  return reasons;
}

function summarizeApproval(decision) {
  const approval = isPlainObject(decision?.budget_approval) ? decision.budget_approval : null;
  return {
    decision_id: decision?.decision_id ?? null,
    status: decision?.status ?? null,
    override_digest: approval?.override_digest ?? null,
    grantor_kind: approval?.grantor_kind ?? null,
    grantor: approval?.grantor ?? null,
    recorded_by: approval?.recorded_by ?? null,
    recorded_at: decision?.recorded_at ?? null
  };
}

function isSelfGrant(grantor, recordedBy) {
  const normalized = String(grantor).trim().toLowerCase();
  const agentId = String(recordedBy?.agent_id ?? '').trim().toLowerCase();
  const agentSystem = String(recordedBy?.agent_system ?? '').trim().toLowerCase();
  if (!normalized || !agentId) return false;
  return normalized === agentId
    || normalized === agentSystem
    || normalized === `${agentSystem}:${agentId}`;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function requireText(value, label) {
  if (!isText(value)) throw new Error(`${label} is required`);
  return value.trim();
}
