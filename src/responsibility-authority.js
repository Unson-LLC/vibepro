import { readdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const DEFAULT_RESPONSIBILITY_REGISTRY_FILES = [
  'responsibility-authority.json',
  path.join('responsibility-authority', 'index.json'),
  path.join('docs', 'responsibility-authority.json'),
  path.join('docs', 'management', 'responsibility-authority.json')
];

export const DEFAULT_RESPONSIBILITY_REGISTRY_DIRS = [
  'responsibility-authority',
  path.join('docs', 'responsibility-authority'),
  path.join('docs', 'management', 'responsibility-authority')
];

export const DEFAULT_DOMAIN_CONTRACT_DIRS = [
  'contracts',
  path.join('docs', 'contracts'),
  path.join('docs', 'domain-contracts'),
  path.join('docs', 'management', 'contracts')
];

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const PASS_STATUSES = new Set(['pass', 'passed', 'success', 'ok']);
const CURRENT_BINDING_STATUSES = new Set(['current']);
const HIGH_RISK_SURFACES = new Set([
  'core_workflow_state',
  'database_state',
  'queue_worker',
  'polling_retry',
  'auth_boundary',
  'network_contract',
  'outbound_side_effect'
]);
const HIGH_RISK_PATTERNS = [
  /\bcleanup\b/i,
  /\brecovery\b/i,
  /\bworker\b/i,
  /\bqueue\b/i,
  /\bstatus\b/i,
  /\bstate\b/i,
  /\bmetadata\b/i,
  /\bauth(?:orization|entication)?\b/i,
  /\bpermission\b/i,
  /\bbilling\b/i,
  /\bpayment\b/i,
  /\bwebhook\b/i,
  /\bsend(?:er|ing)?\b/i,
  /\bemail\b/i,
  /権限/,
  /認可/,
  /課金/,
  /状態/,
  /送信/
];
const VALID_AUTHORITY_KINDS = new Set(['domain_contract', 'architecture', 'spec', 'policy', 'story']);
const READ_ONLY_AUDIT_REPORT_SOURCES = new Set([
  'src/evidence-reuse.js',
  'src/senior-gap-judgment.js',
  'src/usage-report.js',
  'src/workspace-status.js'
]);
// The exemption is deliberately content-bound. Any source change, including an
// indirect side effect through an alias or helper, fails closed until reviewed.
const WORKSPACE_STATUS_READ_ONLY_SHA256 = '80876345051ef0ed3f51993361c6810305d6ab442f3d0119c7bf75e0d3e74add';

export async function resolveResponsibilityAuthority(repoRoot, options = {}) {
  const root = path.resolve(repoRoot);
  const registryFiles = await readResponsibilityRegistryFiles(root, options);
  const contractFiles = await readDomainContractFiles(root, options);
  const responsibilities = registryFiles.flatMap((file) => normalizeResponsibilities(file));
  const contractClauses = contractFiles.flatMap((file) => normalizeContractClauses(file));
  const changedPaths = collectChangedPaths(options);
  const changedSourceText = await readChangedSourceText(root, changedPaths);
  const changedProductionSource = await readChangedProductionSource(root, changedPaths, options.git);
  const readOnlyAuditReportingChange = isReadOnlyAuditReportingChange(changedPaths, changedSourceText);
  const workspaceStatusSourceText = changedPaths.includes('src/workspace-status.js')
    ? await readChangedSourceText(root, ['src/workspace-status.js'])
    : '';
  const unregisteredExemptPaths = collectReadOnlyReportingPaths(changedPaths, workspaceStatusSourceText);
  const riskSurfaces = collectRiskSurfaces(options.changeClassification);
  const matchText = [
    extractStoryText(options.storySource),
    extractInferredSpecText(options.inferredSpec),
    changedSourceText,
    changedPaths.join('\n'),
    riskSurfaces.join('\n')
  ].filter(Boolean).join('\n').toLowerCase();

  const matchedResponsibilities = responsibilities
    .map((responsibility) => matchResponsibility(responsibility, {
      root,
      changedPaths,
      riskSurfaces,
      matchText,
      changedProductionSourceText: changedProductionSource.all,
      contractClauses,
      readOnlyAuditReportingChange,
      verificationEvidence: options.verificationEvidence
    }))
    .filter(Boolean);

  const unregisteredCandidates = collectUnregisteredCandidates({
    changedPaths,
    riskSurfaces,
    matchText,
    responsibilities,
    contractClauses,
    changedProductionSourceTextByPath: changedProductionSource.byPath,
    unregisteredExemptPaths
  });
  const status = resolveAuthorityStatus(matchedResponsibilities, unregisteredCandidates);
  const invalidRegistryEntries = matchedResponsibilities.filter((item) => item.validation_errors.length > 0);

  return {
    schema_version: '0.1.0',
    model: 'vibepro-responsibility-authority-v1',
    status,
    registry_sources: registryFiles.map((file) => file.relative_path),
    domain_contract_sources: contractFiles.map((file) => file.relative_path),
    summary: {
      registry_source_count: registryFiles.length,
      domain_contract_source_count: contractFiles.length,
      responsibility_count: responsibilities.length,
      matched_responsibility_count: matchedResponsibilities.length,
      matched_contract_clause_count: matchedResponsibilities.reduce((sum, item) => sum + item.contract_clauses.length, 0),
      missing_evidence_count: matchedResponsibilities.reduce((sum, item) => sum + item.missing_evidence.length, 0),
      stale_evidence_count: matchedResponsibilities.reduce((sum, item) => sum + item.stale_evidence.length, 0),
      unregistered_candidate_count: unregisteredCandidates.length,
      invalid_registry_entry_count: invalidRegistryEntries.length
    },
    matched_responsibilities: matchedResponsibilities,
    invalid_registry_entries: invalidRegistryEntries.map((item) => ({
      id: item.id,
      source: item.registry_source,
      validation_errors: item.validation_errors
    })),
    unregistered_candidates: unregisteredCandidates,
    risk_surfaces: riskSurfaces,
    changed_paths: changedPaths
  };
}

export function buildResponsibilityAuthorityGate(authority) {
  const status = authority?.status ?? 'not_applicable';
  const matched = authority?.matched_responsibilities ?? [];
  const unregistered = authority?.unregistered_candidates ?? [];
  const invalidRegistryEntries = authority?.invalid_registry_entries ?? [];
  const missingEvidence = matched.flatMap((item) => item.missing_evidence.map((evidence) => ({
    responsibility_id: item.id,
    evidence
  })));
  const staleEvidence = matched.flatMap((item) => item.stale_evidence.map((evidence) => ({
    responsibility_id: item.id,
    evidence
  })));
  return {
    id: 'gate:responsibility_authority',
    type: 'responsibility_authority_gate',
    label: 'Responsibility Authority Gate',
    status,
    required: status !== 'not_applicable',
    reason: buildResponsibilityAuthorityGateReason(authority),
    registry_sources: authority?.registry_sources ?? [],
    domain_contract_sources: authority?.domain_contract_sources ?? [],
    matched_responsibilities: matched.map((item) => ({
      id: item.id,
      primary_authority: item.primary_authority,
      matched_by: item.matched_by,
      evidence_status: item.evidence_status,
      required_evidence: item.required_evidence,
      validation_errors: item.validation_errors ?? [],
      contract_clauses: item.contract_clauses.map((clause) => clause.ref)
    })),
    invalid_registry_entries: invalidRegistryEntries,
    missing_evidence: missingEvidence,
    stale_evidence: staleEvidence,
    unregistered_candidates: unregistered
  };
}

export function renderResponsibilityAuthorityPrSection(authority, language = 'ja') {
  if (!authority) {
    return localized(language, {
      ja: '- Responsibility Authority未生成',
      en: '- Responsibility Authority not generated'
    });
  }
  const summary = authority.summary ?? {};
  const lines = [
    `- Responsibility Authority: ${authority.status}`,
    `- Registry Sources: ${summary.registry_source_count ?? 0}`,
    `- Domain Contract Sources: ${summary.domain_contract_source_count ?? 0}`,
    `- Matched Responsibilities: ${summary.matched_responsibility_count ?? 0}`,
    `- Matched Contract Clauses: ${summary.matched_contract_clause_count ?? 0}`,
    `- Missing Evidence: ${summary.missing_evidence_count ?? 0}`,
    `- Invalid Registry Entries: ${summary.invalid_registry_entry_count ?? 0}`,
    `- Unregistered Candidates: ${summary.unregistered_candidate_count ?? 0}`
  ];

  const matched = (authority.matched_responsibilities ?? []).slice(0, 6).flatMap((item) => [
    `- Responsibility: ${item.id} (${item.evidence_status})`,
    `  - Primary Authority: ${formatAuthorityRef(item.primary_authority)}`,
    ...(item.contract_clauses ?? []).slice(0, 4).map((clause) => `  - Contract Clause: ${clause.ref}${clause.statement ? ` - ${clause.statement}` : ''}`),
    ...(item.validation_errors ?? []).map((error) => `  - Registry Validation Error: ${error}`),
    ...(item.missing_evidence ?? []).map((evidence) => `  - Missing Evidence: ${evidence}`)
  ]);
  const unregistered = (authority.unregistered_candidates ?? []).slice(0, 6)
    .map((item) => `- no_registered_authority: ${item.reason} (${item.paths.slice(0, 4).join(', ') || item.risk_surfaces.join(', ')})`);
  return [
    ...lines,
    ...matched,
    ...unregistered
  ].join('\n');
}

async function readResponsibilityRegistryFiles(root, options) {
  const files = [];
  const explicitFiles = options.registryFiles ?? DEFAULT_RESPONSIBILITY_REGISTRY_FILES;
  for (const relativePath of explicitFiles) {
    const loaded = await readJsonFile(root, relativePath);
    if (loaded) files.push(loaded);
  }
  const dirs = options.registryDirs ?? DEFAULT_RESPONSIBILITY_REGISTRY_DIRS;
  for (const relativeDir of dirs) {
    const dir = path.join(root, relativeDir);
    const entries = await listJsonFiles(dir);
    for (const filePath of entries) {
      const relativePath = toPosix(path.relative(root, filePath));
      if (files.some((file) => file.relative_path === relativePath)) continue;
      const loaded = await readJsonFile(root, relativePath);
      if (loaded) files.push(loaded);
    }
  }
  return files;
}

async function readDomainContractFiles(root, options) {
  const files = [];
  const contractFiles = options.contractFiles ?? [];
  for (const relativePath of contractFiles) {
    const loaded = await readJsonFile(root, relativePath);
    if (loaded) files.push(loaded);
  }
  const dirs = options.contractDirs ?? DEFAULT_DOMAIN_CONTRACT_DIRS;
  for (const relativeDir of dirs) {
    const dir = path.join(root, relativeDir);
    const entries = await listJsonFiles(dir);
    for (const filePath of entries) {
      const relativePath = toPosix(path.relative(root, filePath));
      if (files.some((file) => file.relative_path === relativePath)) continue;
      const loaded = await readJsonFile(root, relativePath);
      if (loaded) files.push(loaded);
    }
  }
  return files;
}

async function readJsonFile(root, relativePath) {
  try {
    const absolutePath = path.join(root, relativePath);
    const raw = await readFile(absolutePath, 'utf8');
    return {
      relative_path: toPosix(relativePath),
      data: JSON.parse(raw)
    };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

async function listJsonFiles(dir) {
  try {
    const dirStat = await stat(dir);
    if (!dirStat.isDirectory()) return [];
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => path.join(dir, entry.name));
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return [];
    throw error;
  }
}

function normalizeResponsibilities(file) {
  const root = file.data;
  const entries = Array.isArray(root)
    ? root
    : root?.responsibilities ?? root?.entries ?? [];
  return entries
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      id: String(entry.id ?? ''),
      primary_authority: normalizeAuthority(entry.primary_authority ?? entry.primaryAuthority),
      supporting_authority: normalizeAuthorityList(entry.supporting_authority ?? entry.supportingAuthority),
      owned_surfaces: normalizeOwnedSurfaces(entry.owned_surfaces ?? entry.ownedSurfaces),
      required_evidence: normalizeStringList(entry.required_evidence ?? entry.requiredEvidence),
      unknown_policy: normalizeOptionalString(entry.unknown_policy ?? entry.unknownPolicy),
      risk_surfaces: normalizeStringList(entry.risk_surfaces ?? entry.riskSurfaces),
      source: file.relative_path,
      validation_errors: []
    }))
    .filter((entry) => entry.id)
    .map((entry) => ({
      ...entry,
      validation_errors: validateResponsibilityEntry(entry)
    }));
}

function normalizeContractClauses(file) {
  const root = file.data;
  const domain = root?.domain ?? root?.name ?? path.basename(file.relative_path, '.json');
  const clauses = Array.isArray(root?.clauses)
    ? root.clauses
    : Array.isArray(root)
      ? root
      : [];
  return clauses
    .filter((clause) => clause && typeof clause === 'object' && clause.id)
    .map((clause) => {
      const appliesTo = clause.applies_to ?? clause.appliesTo ?? {};
      return {
        id: String(clause.id),
        domain: String(clause.domain ?? domain),
        statement: String(clause.statement ?? clause.text ?? ''),
        applies_to: appliesTo,
        paths: normalizeStringList(appliesTo.paths ?? clause.paths),
        symbols: normalizeStringList(appliesTo.symbols ?? clause.symbols),
        responsibilities: normalizeStringList(appliesTo.responsibilities ?? appliesTo.responsibility ?? clause.responsibilities ?? clause.responsibility),
        risk_surfaces: normalizeStringList(appliesTo.risk_surfaces ?? appliesTo.riskSurfaces ?? clause.risk_surfaces ?? clause.riskSurfaces),
        evidence_requirements: normalizeStringList(clause.evidence_requirements ?? clause.evidenceRequirements),
        source: file.relative_path,
        ref: `${file.relative_path}#${clause.id}`
      };
    });
}

function normalizeAuthority(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    return {
      kind: inferAuthorityKind(value),
      ref: value
    };
  }
  if (typeof value === 'object') {
    const ref = String(value.ref ?? value.path ?? value.id ?? '');
    if (!ref.trim()) return null;
    return {
      kind: String(value.kind ?? inferAuthorityKind(ref)),
      ref
    };
  }
  return null;
}

function validateResponsibilityEntry(entry) {
  const errors = [];
  if (!entry.id) errors.push('id is required');
  if (!entry.primary_authority?.ref) {
    errors.push('primary_authority is required');
  } else if (!VALID_AUTHORITY_KINDS.has(entry.primary_authority.kind)) {
    errors.push(`primary_authority.kind must be one of ${[...VALID_AUTHORITY_KINDS].join(', ')}`);
  }
  const ownedSurfaces = entry.owned_surfaces ?? {};
  if (
    (ownedSurfaces.paths ?? []).length === 0 &&
    (ownedSurfaces.symbols ?? []).length === 0 &&
    (ownedSurfaces.risk_surfaces ?? []).length === 0
  ) {
    errors.push('owned_surfaces must include paths, symbols, or risk_surfaces');
  }
  if ((entry.required_evidence ?? []).length === 0) errors.push('required_evidence is required');
  if (!entry.unknown_policy) errors.push('unknown_policy is required');
  return errors;
}

function normalizeAuthorityList(value) {
  if (!value) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map(normalizeAuthority).filter(Boolean);
}

function normalizeOwnedSurfaces(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    paths: normalizeStringList(source.paths ?? source.path_patterns ?? source.pathPatterns),
    symbols: normalizeStringList(source.symbols),
    risk_surfaces: normalizeStringList(source.risk_surfaces ?? source.riskSurfaces)
  };
}

function matchResponsibility(responsibility, context) {
  const surfacePaths = responsibility.owned_surfaces.paths ?? [];
  const surfaceSymbols = responsibility.owned_surfaces.symbols ?? [];
  const surfaceRiskSurfaces = [
    ...(responsibility.owned_surfaces.risk_surfaces ?? []),
    ...(responsibility.risk_surfaces ?? [])
  ];
  const responsibilitySurfaceMatch = matchOwnedSurface({
    paths: surfacePaths,
    symbols: surfaceSymbols,
    riskSurfaces: surfaceRiskSurfaces
  }, context);
  const matchedBy = [...responsibilitySurfaceMatch.matchedBy];
  const contractClauses = collectContractClausesForResponsibility(responsibility, context)
    .filter((clause) => {
      const clauseSurfaceMatch = matchOwnedSurface({
        paths: clause.paths,
        symbols: clause.symbols,
        riskSurfaces: clause.risk_surfaces
      }, context);
      if (clauseSurfaceMatch.matched) return true;
      if (context.readOnlyAuditReportingChange) return false;
      return responsibilitySurfaceMatch.matched && clause.responsibilities.includes(responsibility.id);
    });
  if (contractClauses.length > 0) matchedBy.push('domain_contract');
  if (matchedBy.length === 0) return null;
  if ((responsibility.validation_errors ?? []).length > 0) {
    return {
      id: responsibility.id,
      primary_authority: responsibility.primary_authority,
      supporting_authority: responsibility.supporting_authority,
      owned_surfaces: responsibility.owned_surfaces,
      required_evidence: responsibility.required_evidence,
      unknown_policy: responsibility.unknown_policy,
      registry_source: responsibility.source,
      matched_by: uniqueStrings(matchedBy),
      contract_clauses: contractClauses.map((clause) => ({
        id: clause.id,
        domain: clause.domain,
        statement: clause.statement,
        source: clause.source,
        ref: clause.ref,
        evidence_requirements: clause.evidence_requirements
      })),
      evidence_status: 'invalid_registry',
      missing_evidence: [],
      stale_evidence: [],
      matched_evidence: [],
      validation_errors: responsibility.validation_errors
    };
  }
  const requiredEvidence = context.readOnlyAuditReportingChange
    ? uniqueStrings([
      'unit_regression',
      'current_head_verification',
      ...responsibility.required_evidence.filter((evidence) => evidence === 'typecheck')
    ])
    : uniqueStrings([
      ...responsibility.required_evidence,
      ...contractClauses.flatMap((clause) => clause.evidence_requirements)
    ]);
  const evidenceResolution = resolveEvidenceRequirements({
    requiredEvidence,
    contractClauseIds: contractClauses.map((clause) => clause.id),
    verificationEvidence: context.verificationEvidence,
    allowGenericCurrentEvidence: context.readOnlyAuditReportingChange
  });
  return {
    id: responsibility.id,
    primary_authority: responsibility.primary_authority,
    supporting_authority: responsibility.supporting_authority,
    owned_surfaces: responsibility.owned_surfaces,
    required_evidence: requiredEvidence,
    unknown_policy: responsibility.unknown_policy,
    registry_source: responsibility.source,
    matched_by: uniqueStrings(matchedBy),
    contract_clauses: contractClauses.map((clause) => ({
      id: clause.id,
      domain: clause.domain,
      statement: clause.statement,
      source: clause.source,
      ref: clause.ref,
      evidence_requirements: clause.evidence_requirements
    })),
    evidence_status: evidenceResolution.status,
    missing_evidence: evidenceResolution.missing,
    stale_evidence: evidenceResolution.stale,
    matched_evidence: evidenceResolution.matched,
    validation_errors: []
  };
}

function matchOwnedSurface({ paths, symbols, riskSurfaces }, context) {
  const pathMatched = paths.some((pattern) => (
    context.changedPaths.some((changedPath) => pathPatternMatches(pattern, changedPath))
  ));
  const symbolMatched = symbols.some((symbol) => (
    context.changedProductionSourceText.includes(String(symbol).toLowerCase())
  ));
  const hasIdentityAnchor = paths.length > 0 || symbols.length > 0;
  const riskMatched = riskSurfaces.some((surface) => context.riskSurfaces.includes(surface))
    && (!hasIdentityAnchor || pathMatched || symbolMatched);
  return {
    matched: pathMatched || symbolMatched || riskMatched,
    matchedBy: [
      pathMatched ? 'path' : null,
      symbolMatched ? 'symbol' : null,
      riskMatched ? 'risk_surface' : null
    ].filter(Boolean)
  };
}

function collectContractClausesForResponsibility(responsibility, context) {
  const primaryRef = responsibility.primary_authority?.ref ?? '';
  return context.contractClauses.filter((clause) => {
    if (primaryRef && referenceMatchesClause(primaryRef, clause)) return true;
    if (clause.responsibilities.includes(responsibility.id)) return true;
    return false;
  });
}

function referenceMatchesClause(ref, clause) {
  const [refPath, refAnchor] = String(ref).split('#');
  if (refAnchor && refAnchor !== clause.id) return false;
  if (!refPath) return refAnchor === clause.id;
  return toPosix(refPath) === clause.source || toPosix(refPath).endsWith(clause.source);
}

function resolveEvidenceRequirements({
  requiredEvidence,
  contractClauseIds,
  verificationEvidence,
  allowGenericCurrentEvidence = false
}) {
  if (requiredEvidence.length === 0) {
    return {
      status: 'passed',
      missing: [],
      stale: [],
      matched: []
    };
  }
  const commands = Array.isArray(verificationEvidence?.commands) ? verificationEvidence.commands : [];
  const missing = [];
  const stale = [];
  const matched = [];
  for (const evidence of requiredEvidence) {
    const currentMatch = commands.find((command) => verificationCommandMatches(command, evidence, contractClauseIds, {
      requireCurrent: true,
      allowGenericCurrentEvidence
    }));
    if (currentMatch) {
      matched.push({
        evidence,
        kind: currentMatch.kind ?? null,
        command: currentMatch.command ?? null,
        summary: currentMatch.summary ?? null
      });
      continue;
    }
    const staleMatch = commands.find((command) => verificationCommandMatches(command, evidence, contractClauseIds, {
      requireCurrent: false,
      allowGenericCurrentEvidence
    }));
    if (staleMatch) {
      stale.push(evidence);
    } else {
      missing.push(evidence);
    }
  }
  return {
    status: missing.length === 0 && stale.length === 0 ? 'passed' : stale.length > 0 ? 'stale' : 'missing',
    missing,
    stale,
    matched
  };
}

function verificationCommandMatches(command, evidence, contractClauseIds, { requireCurrent, allowGenericCurrentEvidence = false }) {
  if (!PASS_STATUSES.has(String(command?.status ?? '').toLowerCase())) return false;
  const bindingStatus = command?.binding?.status ?? command?.git_context?.binding_status ?? null;
  const current = CURRENT_BINDING_STATUSES.has(bindingStatus)
    || isCurrentGitContext(command?.git_context)
    || (!command?.binding && !command?.git_context);
  if (requireCurrent && !current) return false;
  const normalizedEvidence = normalizeEvidenceToken(evidence);
  if (normalizedEvidence === 'current_head_verification') return true;
  const haystack = [
    command?.kind,
    command?.command,
    command?.summary,
    command?.artifact,
    ...(command?.observation?.targets ?? []),
    ...(command?.observation?.scenarios ?? []),
    ...Object.entries(command?.observation?.values ?? {}).flatMap(([key, value]) => [key, value]),
    ...Object.entries(command?.observation?.observed ?? {}).flatMap(([key, value]) => [key, value])
  ].filter(Boolean).join('\n').toLowerCase();
  const tokens = normalizedEvidence.split(/[^a-z0-9]+/).filter((token) => token.length >= 3);
  if (tokens.length === 0 || !tokens.every((token) => haystack.includes(token))) return false;
  if (isGenericEvidenceRequirement(tokens)) {
    return allowGenericCurrentEvidence && requireCurrent ? true : hasContractEvidenceBinding(haystack, contractClauseIds);
  }
  return true;
}

function isCurrentGitContext(gitContext) {
  if (!gitContext) return false;
  if (gitContext.binding_status && !CURRENT_BINDING_STATUSES.has(gitContext.binding_status)) return false;
  return Boolean(gitContext.head_sha) && gitContext.dirty === false;
}

function hasContractEvidenceBinding(haystack, contractClauseIds) {
  const clauseIds = contractClauseIds
    .map((id) => String(id ?? '').toLowerCase())
    .filter(Boolean);
  if (clauseIds.length === 0) return true;
  return clauseIds.some((id) => haystack.includes(id));
}

function isGenericEvidenceRequirement(tokens) {
  const genericTokens = new Set([
    'unit',
    'integration',
    'e2e',
    'test',
    'tests',
    'regression',
    'current',
    'head',
    'verification'
  ]);
  return tokens.length > 0 && tokens.every((token) => genericTokens.has(token));
}

function collectUnregisteredCandidates({
  changedPaths,
  riskSurfaces,
  matchText,
  responsibilities,
  contractClauses,
  changedProductionSourceTextByPath = new Map(),
  unregisteredExemptPaths = []
}) {
  const riskySurfaces = riskSurfaces.filter((surface) => HIGH_RISK_SURFACES.has(surface));
  const uncoveredRiskSurfaces = riskySurfaces.filter((surface) => (
    !hasValidRiskOnlyAuthority(surface, responsibilities)
  ));
  const riskyPaths = changedPaths
    .filter((changedPath) => isProductionSourcePath(changedPath))
    .filter((changedPath) => !unregisteredExemptPaths.includes(changedPath))
    .filter((changedPath) => HIGH_RISK_PATTERNS.some((pattern) => pattern.test(changedPath)));
  const uncoveredRiskyPaths = riskySurfaces.length > 0 && uncoveredRiskSurfaces.length === 0
    ? []
    : riskyPaths;
  const candidatePaths = uncoveredRiskyPaths.length > 0
    ? uncoveredRiskyPaths
    : uncoveredRiskSurfaces.length > 0
      ? changedPaths
        .filter((changedPath) => isProductionSourcePath(changedPath))
        .filter((changedPath) => !unregisteredExemptPaths.includes(changedPath))
      : [];
  const uncoveredPaths = candidatePaths.filter((changedPath) => !pathHasValidRegisteredAuthority(
    changedPath,
    changedProductionSourceTextByPath.get(changedPath) ?? '',
    responsibilities,
    contractClauses
  ));
  const textRisk = HIGH_RISK_PATTERNS.some((pattern) => pattern.test(matchText));
  if (uncoveredPaths.length === 0 && (uncoveredRiskSurfaces.length === 0 || changedPaths.length > 0) && !(textRisk && changedPaths.length === 0)) return [];
  return [{
    id: 'no_registered_authority',
    status: 'needs_review',
    reason: 'Changed surface looks like a cross-story state, worker, permission, billing, or side-effect responsibility but no registry entry matched it.',
    paths: uncoveredPaths,
    risk_surfaces: uncoveredRiskSurfaces
  }];
}

function hasValidRiskOnlyAuthority(riskSurface, responsibilities) {
  return responsibilities
    .filter((responsibility) => (responsibility.validation_errors ?? []).length === 0)
    .some((responsibility) => {
      const paths = responsibility.owned_surfaces?.paths ?? [];
      const symbols = responsibility.owned_surfaces?.symbols ?? [];
      const riskSurfaces = [
        ...(responsibility.owned_surfaces?.risk_surfaces ?? []),
        ...(responsibility.risk_surfaces ?? [])
      ];
      return paths.length === 0 && symbols.length === 0 && riskSurfaces.includes(riskSurface);
    });
}

function resolveAuthorityStatus(matchedResponsibilities, unregisteredCandidates) {
  if (matchedResponsibilities.some((item) => item.evidence_status === 'invalid_registry')) return 'needs_review';
  if (unregisteredCandidates.length > 0) return 'needs_review';
  if (matchedResponsibilities.some((item) => item.evidence_status === 'stale')) return 'stale';
  if (matchedResponsibilities.some((item) => item.evidence_status === 'missing')) return 'needs_evidence';
  if (matchedResponsibilities.length > 0) return 'passed';
  return 'not_applicable';
}

function buildResponsibilityAuthorityGateReason(authority) {
  if (!authority) return 'Responsibility Authority was not evaluated';
  const summary = authority.summary ?? {};
  if (authority.status === 'not_applicable') {
    return 'No changed surface matched a registered responsibility authority or high-risk unknown responsibility.';
  }
  if (authority.status === 'passed') {
    return `${summary.matched_responsibility_count ?? 0} responsibility authority match(es) have current evidence.`;
  }
  if ((summary.invalid_registry_entry_count ?? 0) > 0) {
    return `${summary.invalid_registry_entry_count} matched responsibility registry entr${summary.invalid_registry_entry_count === 1 ? 'y is' : 'ies are'} invalid.`;
  }
  if (authority.status === 'stale') {
    return `${summary.stale_evidence_count ?? 0} required evidence item(s) exist but are not current-head bound.`;
  }
  if (authority.status === 'needs_evidence') {
    return `${summary.missing_evidence_count ?? 0} required evidence item(s) missing for matched responsibility contract(s).`;
  }
  if (authority.status === 'needs_review') {
    return `${summary.unregistered_candidate_count ?? 0} high-risk changed responsibility surface(s) have no registered authority.`;
  }
  return `Responsibility Authority status: ${authority.status}`;
}

function pathHasValidRegisteredAuthority(changedPath, changedSourceText, responsibilities, contractClauses) {
  return responsibilities
    .filter((responsibility) => (responsibility.validation_errors ?? []).length === 0)
    .some((responsibility) => responsibilityOwnsPath(responsibility, changedPath, changedSourceText, contractClauses));
}

function responsibilityOwnsPath(responsibility, changedPath, changedSourceText, contractClauses) {
  if ((responsibility.owned_surfaces?.paths ?? []).some((pattern) => pathPatternMatches(pattern, changedPath))) return true;
  if ((responsibility.owned_surfaces?.symbols ?? []).some((symbol) => changedSourceText.includes(String(symbol).toLowerCase()))) return true;
  return collectContractClausesForResponsibility(responsibility, { contractClauses })
    .some((clause) => (
      clause.paths.some((pattern) => pathPatternMatches(pattern, changedPath))
      || clause.symbols.some((symbol) => changedSourceText.includes(String(symbol).toLowerCase()))
    ));
}

function isProductionSourcePath(changedPath) {
  const normalizedPath = toPosix(changedPath);
  if (!SOURCE_EXTENSIONS.has(path.extname(normalizedPath))) return false;
  if (/^(test|tests|__tests__)\//.test(normalizedPath)) return false;
  if (/(^|\/)__tests__\//.test(normalizedPath)) return false;
  if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(normalizedPath)) return false;
  return true;
}

function collectChangedPaths(options) {
  const paths = [
    ...(options.git?.changed_files ?? []),
    ...Object.values(options.fileGroups ?? {}).flatMap((group) => group?.files ?? [])
  ].map((item) => typeof item === 'string' ? item : item?.path)
    .filter(Boolean)
    .map((file) => toPosix(file))
    .filter((file) => !file.startsWith('.vibepro/'));
  return uniqueStrings(paths).sort();
}

async function readChangedSourceText(root, changedPaths) {
  const chunks = [];
  for (const relativePath of changedPaths.filter((file) => SOURCE_EXTENSIONS.has(path.extname(file))).slice(0, 20)) {
    try {
      const raw = await readFile(path.join(root, relativePath), 'utf8');
      chunks.push(raw.slice(0, 12000));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return chunks.join('\n');
}

async function readChangedProductionSource(root, changedPaths, gitContext = {}) {
  const productionPaths = changedPaths.filter(isProductionSourcePath).slice(0, 20);
  const byPath = new Map();
  if (productionPaths.length === 0) return { all: '', byPath };
  const baseSha = gitContext?.merge_base_sha ?? gitContext?.base_sha ?? null;
  if (!baseSha) return { all: '', byPath };
  const includeDirty = gitContext?.includes_dirty_in_changed_files !== false;
  const headSha = includeDirty ? null : gitContext?.head_sha ?? null;
  for (const relativePath of productionPaths) {
    try {
      const diffArgs = ['diff', '--unified=0', '--no-ext-diff', String(baseSha)];
      if (headSha) diffArgs.push(String(headSha));
      diffArgs.push('--', relativePath);
      const { stdout } = await execFileAsync('git', diffArgs, {
        cwd: root,
        maxBuffer: 2 * 1024 * 1024
      });
      let changedText = extractChangedLineText(stdout);
      if (!changedText && includeDirty && await isUntrackedPath(root, relativePath)) {
        changedText = await readSourceFile(root, relativePath);
      }
      if (changedText) byPath.set(relativePath, changedText.toLowerCase());
    } catch {
      // Symbol authority fails closed when the requested diff cannot be read.
    }
  }
  return {
    all: [...byPath.values()].join('\n'),
    byPath
  };
}

function extractChangedLineText(diffText) {
  return diffText
      .split('\n')
      .filter((line) => (/^[+-]/.test(line) && !/^(---|\+\+\+)/.test(line)))
      .map((line) => line.slice(1))
      .join('\n');
}

async function isUntrackedPath(root, relativePath) {
  try {
    await execFileAsync('git', ['ls-files', '--error-unmatch', '--', relativePath], { cwd: root });
    return false;
  } catch {
    return true;
  }
}

async function readSourceFile(root, relativePath) {
  try {
    return await readFile(path.join(root, relativePath), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function collectRiskSurfaces(changeClassification) {
  return uniqueStrings(changeClassification?.risk_surfaces ?? []).sort();
}

function extractStoryText(storySource) {
  if (!storySource) return '';
  return [
    storySource.title,
    storySource.requirement_title,
    storySource.background,
    storySource.policy,
    storySource.content,
    ...(storySource.acceptance_criteria ?? [])
  ].filter(Boolean).join('\n');
}

function extractInferredSpecText(inferredSpec) {
  if (!inferredSpec) return '';
  return [
    ...(inferredSpec.clauses ?? []).map((clause) => [
      clause.id,
      clause.type,
      clause.statement,
      clause.text,
      clause.rationale
    ].filter(Boolean).join(' ')),
    ...(inferredSpec.scenarios ?? []).map((scenario) => JSON.stringify(scenario))
  ].join('\n');
}

function pathPatternMatches(pattern, changedPath) {
  const normalizedPattern = toPosix(pattern);
  const normalizedPath = toPosix(changedPath);
  if (normalizedPattern === normalizedPath) return true;
  if (!/[?*[\]{}]/.test(normalizedPattern)) {
    return normalizedPath.includes(normalizedPattern);
  }
  return globToRegExp(normalizedPattern).test(normalizedPath);
}

function isReadOnlyAuditReportingChange(changedPaths = [], changedSourceText = '') {
  const sourcePaths = changedPaths
    .map((changedPath) => toPosix(changedPath))
    .filter((changedPath) => changedPath.startsWith('src/'));
  if (sourcePaths.length === 0
    || !sourcePaths.every((changedPath) => READ_ONLY_AUDIT_REPORT_SOURCES.has(changedPath))) return false;
  if (sourcePaths.includes('src/workspace-status.js')) {
    return isReviewedWorkspaceStatusSource(changedSourceText);
  }
  return true;
}

function collectReadOnlyReportingPaths(changedPaths = [], workspaceStatusSourceText = '') {
  const sourcePaths = changedPaths
    .map((changedPath) => toPosix(changedPath))
    .filter((changedPath) => changedPath.startsWith('src/'));
  return sourcePaths.filter((changedPath) => {
    if (!READ_ONLY_AUDIT_REPORT_SOURCES.has(changedPath)) return false;
    if (changedPath !== 'src/workspace-status.js') return true;
    return isReviewedWorkspaceStatusSource(workspaceStatusSourceText);
  });
}

function isReviewedWorkspaceStatusSource(sourceText) {
  if (!sourceText) return false;
  return createHash('sha256').update(sourceText).digest('hex') === WORKSPACE_STATUS_READ_ONLY_SHA256;
}

function globToRegExp(pattern) {
  let out = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === '*' && next === '*') {
      out += '.*';
      index += 1;
    } else if (char === '*') {
      out += '[^/]*';
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += escapeRegExp(char);
    }
  }
  out += '$';
  return new RegExp(out);
}

function normalizeStringList(value) {
  if (value == null) return [];
  const items = Array.isArray(value) ? value : [value];
  return uniqueStrings(items.flatMap((item) => {
    if (item == null) return [];
    if (typeof item === 'string') return [item];
    if (typeof item === 'number' || typeof item === 'boolean') return [String(item)];
    return [item.ref, item.path, item.id].filter(Boolean).map(String);
  }));
}

function normalizeOptionalString(value) {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized : null;
}

function uniqueStrings(values) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
}

function normalizeEvidenceToken(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function inferAuthorityKind(ref) {
  if (/contract/i.test(ref)) return 'domain_contract';
  if (/architecture|adr/i.test(ref)) return 'architecture';
  if (/spec/i.test(ref)) return 'spec';
  if (/polic/i.test(ref)) return 'policy';
  if (/stor/i.test(ref)) return 'story';
  return 'unknown';
}

function formatAuthorityRef(authority) {
  if (!authority) return '-';
  return `${authority.kind}:${authority.ref}`;
}

function toPosix(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '');
}

function escapeRegExp(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function localized(language, messages) {
  return language === 'en' ? messages.en : messages.ja;
}
