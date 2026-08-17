const TENANCY_MODELS = new Set(['pooled', 'dedicated', 'hybrid', 'customer_managed', 'self_hosted']);
const RESOURCE_SHARING = new Set(['pooled', 'shared', 'tenant_partitioned', 'dedicated', 'tenant_or_session_isolated', 'connection_defined']);
const DEPLOYMENT_MODES = new Set(['managed_shared', 'managed_dedicated', 'customer_managed', 'self_hosted']);
const REQUIRED_FAILURE_SEMANTICS = {
  unknown_tenant: 'deny', ambiguous_tenant: 'deny', unavailable_connection: 'unavailable', no_data: 'empty', cross_tenant_candidate: 'deny_and_audit'
};
const REQUIRED_NEGATIVE_SCENARIOS = Object.keys(REQUIRED_FAILURE_SEMANTICS);
const REQUIRED_SCANNERS = [
  'tenant_boundary', 'tenant_key_propagation', 'cross_tenant_authorization', 'state_partitioning', 'sandbox_isolation',
  'connection_routing', 'secret_scope', 'canonical_data_owner', 'deployment_topology', 'cross_tenant_negative_evidence'
];

const STRONG_SIGNALS = [
  ['multi_tenant_term', /multi[- ]?tenant|multi[- ]?tenancy|複数テナント|マルチテナント/iu],
  ['tenant_identifier', /tenant[_ -]?(?:id|key)|テナント(?:id|識別子|キー)/iu],
  ['cross_tenant_boundary', /cross[- ]?tenant|tenant isolation|テナント(?:間|境界|分離)/iu],
  ['deployment_variant', /byoc|self[- ]?hosted|customer[- ]?managed|顧客管理|顧客環境|テナント別配備/iu]
];
const TENANT_ACTOR = /tenant|organization|workspace|account|customer|hotel|store|テナント|組織|ワークスペース|顧客|店舗|ホテル/iu;
const BOUNDARY_SURFACE = /credential|secret|endpoint|project|tool|memory|storage|database|runtime|queue|job|workflow|sandbox|container|state|migration|export|delet|residency|認証情報|秘密情報|接続|保存|データベース|ランタイム|キュー|ジョブ|実行|状態|移行|削除|データ所在/iu;
const COPY_ONLY = /文言|説明文|コピー|copy|ラベル|表示名/iu;
const LOCAL_ONLY = /単一利用者|single[- ]?user|local cli|ローカルcli|一般的なローカルcli/iu;
const MIGRATION_CHANGE = /migration|migrate|export|delete|residency|移行|エクスポート|削除|データ所在/iu;
const SAFE_RESIDUE_POLICY = /destroy|delete|expire|verified[_ -]?reset|retention|customer[_ -]?retention/iu;

export function detectMultiTenantApplicability(storyText = '', options = {}) {
  const explicit = options.explicit ?? null;
  if (explicit === true || explicit === 'applicable') return { applicable: true, status: 'applicable', reasons: ['explicit_applicability'] };

  const text = String(storyText ?? '');
  const reasons = STRONG_SIGNALS.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
  const hasActor = TENANT_ACTOR.test(text);
  const hasBoundary = BOUNDARY_SURFACE.test(text);
  if (hasActor && hasBoundary) reasons.push('tenant_actor_and_boundary_surface');
  const onlyPresentationChange = COPY_ONLY.test(text) && !hasBoundary && reasons.length <= 1;
  const explicitlyLocal = LOCAL_ONLY.test(text) && reasons.length === 0;
  if (onlyPresentationChange || explicitlyLocal) {
    return { applicable: false, status: 'not_applicable', reasons: [onlyPresentationChange ? 'presentation_only' : 'local_only'] };
  }
  if (explicit === false || explicit === 'not_applicable') {
    if (reasons.length === 0 && !(hasActor || hasBoundary)) return { applicable: false, status: 'not_applicable', reasons: ['explicit_non_applicability'] };
    return { applicable: true, status: 'needs_review', reasons: [...new Set([...reasons, 'explicit_non_applicability_conflict'])] };
  }
  if (reasons.length > 0) return { applicable: true, status: 'applicable', reasons: [...new Set(reasons)] };
  if (hasActor || hasBoundary) {
    return { applicable: true, status: 'needs_review', reasons: [hasActor ? 'tenant_actor_without_boundary' : 'boundary_without_tenant_actor'] };
  }
  return { applicable: false, status: 'not_applicable', reasons: ['no_multi_tenant_signal'] };
}

export function assessMultiTenantArchitecture({ storyText = '', contract = null, evidence = null, mode = 'final' } = {}) {
  const applicability = detectMultiTenantApplicability(storyText, { explicit: contract?.applicability });
  if (!applicability.applicable) {
    return { applicable: false, activation_reasons: applicability.reasons, status: 'not_applicable', findings: [], coverage: { status: 'not_applicable', scanners: {} }, views: {} };
  }
  const findings = [];
  const error = (code, path, message, extra = {}) => findings.push({ severity: 'error', code, path, message, ...extra });
  const review = (code, path, message, extra = {}) => findings.push({ severity: 'review', code, path, message, ...extra });
  if (applicability.status === 'needs_review') {
    review('applicability_ambiguous', 'story_context', 'マルチテナント適用要否を確定できる境界シグナルが不足しています');
    if (!contract) return buildReport(applicability, contract, null, findings, mode);
  }
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    error('contract_missing', 'multi_tenancy', 'multi-tenant対象Storyにはmulti_tenancy契約が必要です');
    return buildReport(applicability, contract, null, findings, mode);
  }

  requireEqual(contract.schema_version, '0.1.0', 'schema_version', 'contract_schema_version', error);
  requireAllowed(contract.tenancy_model, TENANCY_MODELS, 'tenancy_model', 'tenancy_model', error);
  const identity = objectAt(contract.tenant_identity);
  requireText(identity.canonical_key, 'tenant_identity.canonical_key', 'tenant_identity_key', error);
  requireNonEmptyArray(identity.resolved_from, 'tenant_identity.resolved_from', 'tenant_identity_sources', error);
  requireText(identity.resolution_point, 'tenant_identity.resolution_point', 'tenant_resolution_point', error);
  requireEqual(identity.missing_behavior, 'deny', 'tenant_identity.missing_behavior', 'tenant_missing_behavior', error);
  requireEqual(identity.ambiguity_behavior, 'deny', 'tenant_identity.ambiguity_behavior', 'tenant_ambiguity_behavior', error);

  const propagation = objectAt(contract.propagation);
  const requiredSurfaces = requireNonEmptyArray(propagation.required_surfaces, 'propagation.required_surfaces', 'tenant_propagation_surfaces', error);
  const declaredVerifiedSurfaces = arrayAt(propagation.verified_surfaces);
  for (const surface of requiredSurfaces) {
    if (!declaredVerifiedSurfaces.includes(surface)) error('tenant_propagation_unverified', `propagation.verified_surfaces.${surface}`, `必須の伝播面 ${surface} が検証済みではありません`);
  }
  if (!Array.isArray(contract.resources) || contract.resources.length === 0) error('tenant_resources', 'resources', '少なくとも1つの資源境界が必要です');
  else contract.resources.forEach((resource, index) => validateResource(resource, index, identity.canonical_key, error));

  const credentials = objectAt(contract.credentials);
  requireText(credentials.lookup_key, 'credentials.lookup_key', 'credential_lookup_key', error);
  if (identity.canonical_key && credentials.lookup_key && credentials.lookup_key !== identity.canonical_key) {
    error('credential_lookup_key_mismatch', 'credentials.lookup_key', `credentials.lookup_key は canonical key ${identity.canonical_key} と一致する必要があります`);
  }
  requireText(credentials.scope, 'credentials.scope', 'credential_scope', error);
  requireEqual(credentials.raw_secret_in_artifacts, 'forbidden', 'credentials.raw_secret_in_artifacts', 'raw_secret_artifact_policy', error);
  requireEqual(credentials.cross_tenant_fallback, 'forbidden', 'credentials.cross_tenant_fallback', 'cross_tenant_credential_fallback', error);

  const data = objectAt(contract.data);
  const canonicalOwners = requireNonEmptyArray(data.canonical_owners, 'data.canonical_owners', 'tenant_data_owners', error);
  canonicalOwners.forEach((owner, index) => requireText(owner, `data.canonical_owners[${index}]`, 'tenant_data_owner', error));
  const distinctCanonicalOwners = [...new Set(canonicalOwners.filter(nonEmptyText).map((owner) => owner.trim()))];
  if (distinctCanonicalOwners.length > 1) {
    error(
      'canonical_data_owner_conflict',
      'data.canonical_owners',
      `canonical data ownerは一意である必要があります: ${distinctCanonicalOwners.join(', ')}`,
      { owners: distinctCanonicalOwners }
    );
  }
  arrayAt(contract.resources).forEach((resource, index) => {
    if (nonEmptyText(resource?.data_owner) && distinctCanonicalOwners.length > 0 && !distinctCanonicalOwners.includes(resource.data_owner.trim())) {
      error(
        'canonical_data_owner_conflict',
        `resources[${index}].data_owner`,
        `resources[${index}].data_owner ${resource.data_owner} はcanonical data owner ${distinctCanonicalOwners.join(', ')} と一致しません`,
        { owners: distinctCanonicalOwners, actual: resource.data_owner }
      );
    }
  });
  requireText(data.residency, 'data.residency', 'tenant_data_residency', error);
  requireText(data.migration, 'data.migration', 'tenant_data_migration', error);
  requireText(nonEmptyText(data.rollback) ? data.rollback : data.operator_action, 'data.rollback', 'tenant_data_rollback', error);
  if (MIGRATION_CHANGE.test(storyText) && !nonEmptyText(data.rollback) && !nonEmptyText(data.operator_action)) {
    error('migration_recovery', 'data.rollback', '移行・export・削除・residency変更にはrollbackまたはoperator actionが必要です');
  }

  const failureSemantics = objectAt(contract.failure_semantics);
  for (const [key, value] of Object.entries(REQUIRED_FAILURE_SEMANTICS)) requireEqual(failureSemantics[key], value, `failure_semantics.${key}`, `failure_semantics_${key}`, error);
  const deploymentModes = requireNonEmptyArray(contract.deployment_modes, 'deployment_modes', 'tenant_deployment_modes', error);
  deploymentModes.forEach((deploymentMode, index) => requireAllowed(deploymentMode, DEPLOYMENT_MODES, `deployment_modes[${index}]`, 'tenant_deployment_mode', error));
  const negativeScenarios = arrayAt(contract.negative_scenarios);
  for (const scenario of REQUIRED_NEGATIVE_SCENARIOS) {
    if (!negativeScenarios.includes(scenario)) error('tenant_negative_scenario_missing', `negative_scenarios.${scenario}`, `負のシナリオ ${scenario} が未定義です`);
  }
  const graphMetadata = objectAt(contract.graph_metadata);
  requireNonEmptyArray(graphMetadata.tenant_entities, 'graph_metadata.tenant_entities', 'tenant_graph_entities', error);
  requireNonEmptyArray(graphMetadata.boundary_edges, 'graph_metadata.boundary_edges', 'tenant_graph_edges', error);

  const verification = objectAt(contract.verification);
  if (verification.scanner_coverage !== 'verified') review('scanner_coverage_unknown', 'verification.scanner_coverage', '検査範囲がverifiedではないため、境界の不存在を確認できません');
  const effectiveEvidence = evidence ?? verification.evidence ?? null;
  const scan = scanMultiTenantEvidence(contract, effectiveEvidence);
  findings.push(...scan.findings);
  return buildReport(applicability, contract, effectiveEvidence, findings, mode, scan.coverage);
}

export function scanMultiTenantEvidence(contract, evidence) {
  const findings = [];
  const add = (severity, code, path, message, extra = {}) => findings.push({ severity, code, path, message, ...extra });
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    add('review', 'evidence_missing', 'verification.evidence', 'Graph・scanner・実装の検証証拠がありません');
    return { findings, coverage: { status: 'inconclusive', scanners: {} } };
  }
  const canonicalKey = contract?.tenant_identity?.canonical_key ?? null;
  const requiredSurfaces = arrayAt(contract?.propagation?.required_surfaces);
  const verifiedSurfaces = arrayAt(evidence.propagation_surfaces);
  for (const surface of requiredSurfaces) {
    if (!verifiedSurfaces.includes(surface)) add('error', 'tenant_propagation_unverified', `verification.evidence.propagation_surfaces.${surface}`, `証拠上、必須の伝播面 ${surface} を確認できません`);
  }
  const graph = objectAt(evidence.graph);
  if (arrayAt(graph.tenant_entities).length === 0) add('error', 'tenant_graph_entities', 'verification.evidence.graph.tenant_entities', 'Graph証拠にtenant entityがありません');
  if (arrayAt(graph.boundary_edges).length === 0) add('error', 'tenant_graph_edges', 'verification.evidence.graph.boundary_edges', 'Graph証拠にboundary edgeがありません');
  validateGraphEvidence(graph, add);

  const negativeEvidence = arrayAt(evidence.negative_scenarios);
  for (const scenario of REQUIRED_NEGATIVE_SCENARIOS) {
    if (!negativeEvidence.includes(scenario)) {
      const code = scenario === 'cross_tenant_candidate' ? 'cross_tenant_negative_evidence' : 'negative_evidence_missing';
      add('error', code, `verification.evidence.negative_scenarios.${scenario}`, `負のシナリオ ${scenario} の実行証拠がありません`);
    }
  }
  const scannerResults = objectAt(evidence.scanner_results);
  const scannerSummary = {};
  for (const scanner of REQUIRED_SCANNERS) {
    const status = scannerResults[scanner] ?? 'inconclusive';
    scannerSummary[scanner] = status;
    if (status === 'fail') add('error', 'scanner_failed', `verification.evidence.scanner_results.${scanner}`, `${scanner} scannerが境界違反を検出しました`, { scanner });
    else if (status !== 'pass') add('review', 'scanner_inconclusive', `verification.evidence.scanner_results.${scanner}`, `${scanner} scannerは確認済みpassではありません`, { scanner, scanner_status: status });
  }

  const expected = {
    tenant_key: canonicalKey,
    sharing_modes: uniqueSorted(arrayAt(contract?.resources).map((resource) => resource?.sharing).filter(Boolean)),
    deployment_modes: uniqueSorted(arrayAt(contract?.deployment_modes))
  };
  for (const source of ['graph', 'spec', 'implementation']) {
    const observed = objectAt(evidence[source]);
    compareScalar(expected.tenant_key, observed.tenant_key, source, 'tenant_key', add);
    compareSet(expected.sharing_modes, observed.sharing_modes, source, 'sharing_mode', add);
    compareSet(expected.deployment_modes, observed.deployment_modes, source, 'deployment_mode', add);
  }
  const inconclusive = Object.values(scannerSummary).some((status) => status !== 'pass');
  return { findings, coverage: { status: inconclusive ? 'inconclusive' : 'verified', scanners: scannerSummary, verified_surfaces: verifiedSurfaces, negative_scenarios: negativeEvidence } };
}

export function projectMultiTenantViews(contract, evidence = contract?.verification?.evidence ?? null) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return {};
  const resources = arrayAt(contract.resources).map((resource) => ({
    ...resource,
    data_owner: resource?.data_owner ?? arrayAt(contract.data?.canonical_owners)[0] ?? null,
    credential_scope: resource?.credential_scope ?? contract.credentials?.scope ?? null
  }));
  return {
    system_context: { tenancy_model: contract.tenancy_model ?? null, tenant_entities: contract.graph_metadata?.tenant_entities ?? [], canonical_owners: contract.data?.canonical_owners ?? [], evidence: evidence?.graph ?? null },
    tenant_resolution: {
      canonical_key: contract.tenant_identity?.canonical_key ?? null,
      resolved_from: contract.tenant_identity?.resolved_from ?? [],
      resolution_point: contract.tenant_identity?.resolution_point ?? null,
      failure: { missing: contract.tenant_identity?.missing_behavior ?? null, ambiguous: contract.tenant_identity?.ambiguity_behavior ?? null },
      evidence: evidence?.graph ?? null
    },
    trust_data_boundary: {
      resources,
      credential_lookup_key: contract.credentials?.lookup_key ?? null,
      credential_scope: contract.credentials?.scope ?? null,
      canonical_owners: contract.data?.canonical_owners ?? [],
      residency: contract.data?.residency ?? null,
      boundary_edges: contract.graph_metadata?.boundary_edges ?? [],
      evidence: evidence?.graph ?? null
    },
    runtime_execution: {
      required_surfaces: contract.propagation?.required_surfaces ?? [],
      declared_verified_surfaces: contract.propagation?.verified_surfaces ?? [],
      evidence_verified_surfaces: evidence?.propagation_surfaces ?? [],
      cross_tenant_fallback: contract.credentials?.cross_tenant_fallback ?? null,
      scanner_results: evidence?.scanner_results ?? {}
    },
    deployment_variants: {
      tenancy_model: contract.tenancy_model ?? null,
      modes: contract.deployment_modes ?? [],
      connection_modes: uniqueSorted(resources.flatMap((resource) => arrayAt(resource.connection_modes))),
      resource_sharing: resources.map((resource) => ({ name: resource?.name ?? null, sharing: resource?.sharing ?? null, partition_key: resource?.partition_key ?? null })),
      evidence: { graph: evidence?.graph?.deployment_modes ?? [], spec: evidence?.spec?.deployment_modes ?? [], implementation: evidence?.implementation?.deployment_modes ?? [] }
    },
    migration_rollback: {
      canonical_owners: contract.data?.canonical_owners ?? [], migration: contract.data?.migration ?? null, rollback: contract.data?.rollback ?? null,
      operator_action: contract.data?.operator_action ?? null, negative_scenarios: contract.negative_scenarios ?? [],
      verified_negative_scenarios: evidence?.negative_scenarios ?? [], failure_semantics: contract.failure_semantics ?? {}
    }
  };
}

export function compareDeploymentVariants(contracts = []) {
  return contracts.map((contract) => ({
    tenancy_model: contract?.tenancy_model ?? null,
    deployment_modes: arrayAt(contract?.deployment_modes),
    sharing_modes: uniqueSorted(arrayAt(contract?.resources).map((resource) => resource?.sharing).filter(Boolean)),
    connection_modes: uniqueSorted(arrayAt(contract?.resources).flatMap((resource) => arrayAt(resource?.connection_modes))),
    canonical_key: contract?.tenant_identity?.canonical_key ?? null,
    credential_scope: contract?.credentials?.scope ?? null,
    data_owners: arrayAt(contract?.data?.canonical_owners)
  }));
}

export function multiTenantReviewLenses(report) {
  if (!report?.applicable) return [];
  const findings = arrayAt(report.findings);
  const unconfirmed = findings.filter((finding) => finding.severity === 'review' || finding.scanner_status === 'inconclusive').map((finding) => ({ code: finding.code, path: finding.path }));
  const lens = (id, question, codes) => ({
    id, question, status: report.status,
    findings: findings.filter((finding) => codes.some((code) => finding.code.includes(code))),
    unconfirmed
  });
  return [
    lens('tenant_architecture', 'tenant identityは入口から全実行面と資源境界まで一意に伝播するか', ['tenant_', 'propagation', 'graph', 'drift']),
    lens('security_boundary', 'credential、secret、dataにcross-tenant fallbackまたは混線経路がないか', ['credential', 'secret', 'cross_tenant', 'sandbox', 'sharing']),
    lens('operations_and_migration', '各配備形態で移行・rollback・削除・接続不能の意味が維持されるか', ['deployment', 'migration', 'rollback', 'residue'])
  ];
}

export function summarizeMultiTenantAdvisoryRun(results = []) {
  const summary = { total: results.length, applicable: 0, pass: 0, needs_review: 0, inconclusive: 0, not_applicable: 0, false_positive_candidates: 0, false_negative_candidates: 0 };
  for (const result of results) {
    if (result.status === 'ready' || result.status === 'pass') summary.pass += 1;
    else if (result.status === 'needs_review') summary.needs_review += 1;
    else if (result.status === 'inconclusive') summary.inconclusive += 1;
    else if (result.status === 'not_applicable') summary.not_applicable += 1;
    if (result.status !== 'not_applicable') summary.applicable += 1;
    if (result.false_positive_candidate) summary.false_positive_candidates += 1;
    if (result.false_negative_candidate) summary.false_negative_candidates += 1;
  }
  return summary;
}

function buildReport(applicability, contract, evidence, findings, mode, coverage = null) {
  const hasError = findings.some((finding) => finding.severity === 'error');
  const hasReview = findings.some((finding) => finding.severity === 'review');
  return {
    applicable: true, activation_reasons: applicability.reasons, mode,
    status: hasError ? 'invalid' : hasReview ? 'needs_review' : 'ready', findings,
    coverage: coverage ?? { status: hasReview ? 'inconclusive' : 'unverified', scanners: {} },
    views: projectMultiTenantViews(contract, evidence)
  };
}

function validateResource(resource, index, canonicalKey, addError) {
  const prefix = `resources[${index}]`;
  requireText(resource?.name, `${prefix}.name`, 'tenant_resource_name', addError);
  requireAllowed(resource?.sharing, RESOURCE_SHARING, `${prefix}.sharing`, 'tenant_resource_sharing', addError);
  requireText(resource?.tenant_key, `${prefix}.tenant_key`, 'tenant_resource_key', addError);
  if (canonicalKey && resource?.tenant_key && resource.tenant_key !== canonicalKey) addError('tenant_resource_key_mismatch', `${prefix}.tenant_key`, `${prefix}.tenant_key は canonical key ${canonicalKey} と一致する必要があります`);
  requireText(resource?.trust_zone, `${prefix}.trust_zone`, 'tenant_resource_trust_zone', addError);
  requireText(resource?.residue_policy, `${prefix}.residue_policy`, 'tenant_resource_residue_policy', addError);
  requireText(resource?.data_owner, `${prefix}.data_owner`, 'tenant_resource_data_owner', addError);
  requireText(resource?.credential_scope, `${prefix}.credential_scope`, 'tenant_resource_credential_scope', addError);
  if (resource?.sharing === 'tenant_partitioned') {
    requireText(resource.partition_key, `${prefix}.partition_key`, 'state_partition_key', addError);
    if (canonicalKey && nonEmptyText(resource.partition_key) && !resource.partition_key.split(/[/:.]/u).includes(canonicalKey)) addError('state_partition_key_mismatch', `${prefix}.partition_key`, `${prefix}.partition_key は canonical key ${canonicalKey} を含む必要があります`);
  }
  if (resource?.sharing === 'tenant_or_session_isolated' && !SAFE_RESIDUE_POLICY.test(String(resource?.residue_policy ?? ''))) addError('sandbox_residue_policy', `${prefix}.residue_policy`, 'sandbox residue policyはdestroy、delete、expire、verified resetのいずれかを必要とします');
  if (resource?.sharing === 'connection_defined') requireNonEmptyArray(resource.connection_modes, `${prefix}.connection_modes`, 'tenant_connection_modes', addError);
}

function validateGraphEvidence(graph, add) {
  arrayAt(graph.tenant_entities).forEach((entity, index) => {
    if (!entity || typeof entity !== 'object') {
      add('error', 'tenant_graph_entity_metadata', `verification.evidence.graph.tenant_entities[${index}]`, 'tenant entityには構造化metadataが必要です');
      return;
    }
    for (const field of ['tenant_scope', 'tenant_key_source', 'trust_zone', 'data_owner']) if (!nonEmptyText(entity[field])) add('error', 'tenant_graph_entity_metadata', `verification.evidence.graph.tenant_entities[${index}].${field}`, `${field}がありません`);
  });
  arrayAt(graph.boundary_edges).forEach((edge, index) => {
    if (!edge || typeof edge !== 'object') {
      add('error', 'tenant_graph_edge_metadata', `verification.evidence.graph.boundary_edges[${index}]`, 'boundary edgeには構造化metadataが必要です');
      return;
    }
    for (const field of ['tenant_scope', 'tenant_key_source', 'sharing_mode', 'credential_scope', 'connection_mode', 'deployment_mode']) if (!nonEmptyText(edge[field])) add('error', 'tenant_graph_edge_metadata', `verification.evidence.graph.boundary_edges[${index}].${field}`, `${field}がありません`);
  });
}

function compareScalar(expected, actual, source, kind, add) {
  if (!nonEmptyText(actual)) add('review', `${kind}_evidence_missing`, `verification.evidence.${source}.${kind}`, `${source}の${kind}証拠がありません`, { source });
  else if (actual !== expected) add('error', `${kind}_drift`, `verification.evidence.${source}.${kind}`, `${source}の${kind} ${actual} がContract ${expected} と一致しません`, { source, expected, actual });
}

function compareSet(expected, actual, source, kind, add) {
  if (!Array.isArray(actual)) {
    add('review', `${kind}_evidence_missing`, `verification.evidence.${source}.${kind}s`, `${source}の${kind}証拠がありません`, { source });
    return;
  }
  const observed = uniqueSorted(actual);
  if (JSON.stringify(expected) !== JSON.stringify(observed)) add('error', `${kind}_drift`, `verification.evidence.${source}.${kind}s`, `${source}の${kind} ${observed.join(',')} がContract ${expected.join(',')} と一致しません`, { source, expected, actual: observed });
}

function objectAt(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function arrayAt(value) { return Array.isArray(value) ? value : []; }
function uniqueSorted(values) { return [...new Set(values)].sort(); }
function nonEmptyText(value) { return typeof value === 'string' && value.trim() !== ''; }
function requireText(value, path, code, addError) { if (!nonEmptyText(value)) addError(code, path, `${path} は空でない文字列が必要です`); }
function requireNonEmptyArray(value, path, code, addError) {
  if (!Array.isArray(value) || value.length === 0) { addError(code, path, `${path} は1件以上必要です`); return []; }
  return value;
}
function requireEqual(actual, expected, path, code, addError) { if (actual !== expected) addError(code, path, `${path} は ${expected} である必要があります`); }
function requireAllowed(actual, allowed, path, code, addError) { if (!allowed.has(actual)) addError(code, path, `${path} は ${[...allowed].join('|')} のいずれかである必要があります`); }
