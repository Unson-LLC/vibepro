const TENANCY_MODELS = new Set(['pooled', 'dedicated', 'hybrid', 'customer_managed', 'self_hosted']);
const RESOURCE_SHARING = new Set([
  'pooled',
  'shared',
  'tenant_partitioned',
  'dedicated',
  'tenant_or_session_isolated',
  'connection_defined'
]);
const DEPLOYMENT_MODES = new Set(['managed_shared', 'managed_dedicated', 'customer_managed', 'self_hosted']);
const REQUIRED_FAILURE_SEMANTICS = {
  unknown_tenant: 'deny',
  ambiguous_tenant: 'deny',
  unavailable_connection: 'unavailable',
  no_data: 'empty',
  cross_tenant_candidate: 'deny_and_audit'
};
const REQUIRED_NEGATIVE_SCENARIOS = Object.keys(REQUIRED_FAILURE_SEMANTICS);

const STRONG_SIGNALS = [
  ['multi_tenant_term', /multi[- ]?tenant|multi[- ]?tenancy|複数テナント|マルチテナント/iu],
  ['tenant_identifier', /tenant[_ -]?(?:id|key)|テナント(?:id|識別子|キー)/iu],
  ['cross_tenant_boundary', /cross[- ]?tenant|tenant isolation|テナント(?:間|境界|分離)/iu],
  ['deployment_variant', /byoc|self[- ]?hosted|customer[- ]?managed|顧客管理|顧客環境|テナント別配備/iu]
];
const TENANT_ACTOR = /tenant|organization|workspace|account|customer|hotel|store|テナント|組織|ワークスペース|顧客|店舗|ホテル/iu;
const BOUNDARY_SURFACE = /credential|secret|endpoint|project|tool|memory|storage|database|runtime|queue|job|workflow|sandbox|container|migration|export|delet|residency|認証情報|秘密情報|保存|データベース|ランタイム|キュー|ジョブ|実行|移行|削除|データ所在/iu;
const COPY_ONLY = /文言|説明文|コピー|copy|ラベル|表示名/iu;
const LOCAL_ONLY = /単一利用者|single[- ]?user|local cli|ローカルcli/iu;

export function detectMultiTenantApplicability(storyText = '', options = {}) {
  const explicit = options.explicit ?? null;
  if (explicit === true || explicit === 'applicable') {
    return { applicable: true, reasons: ['explicit_applicability'] };
  }

  const text = String(storyText ?? '');
  const reasons = STRONG_SIGNALS.filter(([, pattern]) => pattern.test(text)).map(([reason]) => reason);
  if (TENANT_ACTOR.test(text) && BOUNDARY_SURFACE.test(text)) reasons.push('tenant_actor_and_boundary_surface');

  if (explicit === false || explicit === 'not_applicable') {
    if (reasons.length === 0) return { applicable: false, reasons: ['explicit_non_applicability'] };
    reasons.push('explicit_non_applicability_conflict');
  }

  const onlyPresentationChange = COPY_ONLY.test(text) && !BOUNDARY_SURFACE.test(text) && reasons.length <= 1;
  const explicitlyLocal = LOCAL_ONLY.test(text) && reasons.length === 0;
  if (onlyPresentationChange || explicitlyLocal) return { applicable: false, reasons: [] };
  return { applicable: reasons.length > 0, reasons: [...new Set(reasons)] };
}

export function assessMultiTenantArchitecture({ storyText = '', contract = null, mode = 'final' } = {}) {
  const applicability = detectMultiTenantApplicability(storyText, {
    explicit: contract?.applicability
  });
  if (!applicability.applicable) {
    return {
      applicable: false,
      activation_reasons: applicability.reasons,
      status: 'not_applicable',
      findings: [],
      views: {}
    };
  }

  const findings = [];
  const error = (code, path, message) => findings.push({ severity: 'error', code, path, message });
  const review = (code, path, message) => findings.push({ severity: 'review', code, path, message });

  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
    error('contract_missing', 'multi_tenancy', 'multi-tenant対象Storyにはmulti_tenancy契約が必要です');
    return buildReport(applicability, contract, findings, mode);
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
  const requiredSurfaces = requireNonEmptyArray(
    propagation.required_surfaces,
    'propagation.required_surfaces',
    'tenant_propagation_surfaces',
    error
  );
  const verifiedSurfaces = Array.isArray(propagation.verified_surfaces) ? propagation.verified_surfaces : [];
  for (const surface of requiredSurfaces) {
    if (!verifiedSurfaces.includes(surface)) {
      error(
        'tenant_propagation_unverified',
        `propagation.verified_surfaces.${surface}`,
        `必須の伝播面 ${surface} が検証済みではありません`
      );
    }
  }

  if (!Array.isArray(contract.resources) || contract.resources.length === 0) {
    error('tenant_resources', 'resources', '少なくとも1つの資源境界が必要です');
  } else {
    contract.resources.forEach((resource, index) => {
      const prefix = `resources[${index}]`;
      requireText(resource?.name, `${prefix}.name`, 'tenant_resource_name', error);
      requireAllowed(resource?.sharing, RESOURCE_SHARING, `${prefix}.sharing`, 'tenant_resource_sharing', error);
      requireText(resource?.tenant_key, `${prefix}.tenant_key`, 'tenant_resource_key', error);
      if (identity.canonical_key && resource?.tenant_key && resource.tenant_key !== identity.canonical_key) {
        error(
          'tenant_resource_key_mismatch',
          `${prefix}.tenant_key`,
          `${prefix}.tenant_key は canonical key ${identity.canonical_key} と一致する必要があります`
        );
      }
      requireText(resource?.trust_zone, `${prefix}.trust_zone`, 'tenant_resource_trust_zone', error);
      requireText(resource?.residue_policy, `${prefix}.residue_policy`, 'tenant_resource_residue_policy', error);
    });
  }

  const credentials = objectAt(contract.credentials);
  requireText(credentials.lookup_key, 'credentials.lookup_key', 'credential_lookup_key', error);
  if (identity.canonical_key && credentials.lookup_key && credentials.lookup_key !== identity.canonical_key) {
    error(
      'credential_lookup_key_mismatch',
      'credentials.lookup_key',
      `credentials.lookup_key は canonical key ${identity.canonical_key} と一致する必要があります`
    );
  }
  requireText(credentials.scope, 'credentials.scope', 'credential_scope', error);
  requireEqual(
    credentials.raw_secret_in_artifacts,
    'forbidden',
    'credentials.raw_secret_in_artifacts',
    'raw_secret_artifact_policy',
    error
  );
  requireEqual(
    credentials.cross_tenant_fallback,
    'forbidden',
    'credentials.cross_tenant_fallback',
    'cross_tenant_credential_fallback',
    error
  );

  const data = objectAt(contract.data);
  requireNonEmptyArray(data.canonical_owners, 'data.canonical_owners', 'tenant_data_owners', error);
  requireText(data.residency, 'data.residency', 'tenant_data_residency', error);
  requireText(data.migration, 'data.migration', 'tenant_data_migration', error);
  requireText(data.rollback, 'data.rollback', 'tenant_data_rollback', error);

  const failureSemantics = objectAt(contract.failure_semantics);
  for (const [key, value] of Object.entries(REQUIRED_FAILURE_SEMANTICS)) {
    requireEqual(failureSemantics[key], value, `failure_semantics.${key}`, `failure_semantics_${key}`, error);
  }

  const deploymentModes = requireNonEmptyArray(
    contract.deployment_modes,
    'deployment_modes',
    'tenant_deployment_modes',
    error
  );
  deploymentModes.forEach((deploymentMode, index) => {
    requireAllowed(deploymentMode, DEPLOYMENT_MODES, `deployment_modes[${index}]`, 'tenant_deployment_mode', error);
  });

  const negativeScenarios = Array.isArray(contract.negative_scenarios) ? contract.negative_scenarios : [];
  for (const scenario of REQUIRED_NEGATIVE_SCENARIOS) {
    if (!negativeScenarios.includes(scenario)) {
      error('tenant_negative_scenario_missing', `negative_scenarios.${scenario}`, `負のシナリオ ${scenario} が未定義です`);
    }
  }

  const graphMetadata = objectAt(contract.graph_metadata);
  requireNonEmptyArray(graphMetadata.tenant_entities, 'graph_metadata.tenant_entities', 'tenant_graph_entities', error);
  requireNonEmptyArray(graphMetadata.boundary_edges, 'graph_metadata.boundary_edges', 'tenant_graph_edges', error);

  if (contract.verification?.scanner_coverage !== 'verified') {
    review(
      'scanner_coverage_unknown',
      'verification.scanner_coverage',
      '検査範囲がverifiedではないため、境界の不存在を確認できません'
    );
  }

  return buildReport(applicability, contract, findings, mode);
}

export function projectMultiTenantViews(contract) {
  if (!contract || typeof contract !== 'object' || Array.isArray(contract)) return {};
  return {
    system_context: {
      tenancy_model: contract.tenancy_model ?? null,
      tenant_entities: contract.graph_metadata?.tenant_entities ?? [],
      canonical_owners: contract.data?.canonical_owners ?? []
    },
    tenant_resolution: {
      canonical_key: contract.tenant_identity?.canonical_key ?? null,
      resolved_from: contract.tenant_identity?.resolved_from ?? [],
      resolution_point: contract.tenant_identity?.resolution_point ?? null,
      failure: {
        missing: contract.tenant_identity?.missing_behavior ?? null,
        ambiguous: contract.tenant_identity?.ambiguity_behavior ?? null
      }
    },
    trust_data_boundary: {
      resources: contract.resources ?? [],
      credential_lookup_key: contract.credentials?.lookup_key ?? null,
      credential_scope: contract.credentials?.scope ?? null,
      residency: contract.data?.residency ?? null,
      boundary_edges: contract.graph_metadata?.boundary_edges ?? []
    },
    runtime_execution: {
      required_surfaces: contract.propagation?.required_surfaces ?? [],
      verified_surfaces: contract.propagation?.verified_surfaces ?? [],
      cross_tenant_fallback: contract.credentials?.cross_tenant_fallback ?? null
    },
    deployment_variants: {
      modes: contract.deployment_modes ?? [],
      resource_sharing: (contract.resources ?? []).map((resource) => ({
        name: resource?.name ?? null,
        sharing: resource?.sharing ?? null
      }))
    },
    migration_rollback: {
      canonical_owners: contract.data?.canonical_owners ?? [],
      migration: contract.data?.migration ?? null,
      rollback: contract.data?.rollback ?? null,
      negative_scenarios: contract.negative_scenarios ?? [],
      failure_semantics: contract.failure_semantics ?? {}
    }
  };
}

export function multiTenantReviewLenses(report) {
  if (!report?.applicable) return [];
  return [
    {
      id: 'tenant_architecture',
      question: 'tenant identityは入口から全実行面と資源境界まで一意に伝播するか'
    },
    {
      id: 'security_boundary',
      question: 'credential、secret、dataにcross-tenant fallbackまたは混線経路がないか'
    },
    {
      id: 'operations_and_migration',
      question: '各配備形態で移行・rollback・削除・接続不能の意味が維持されるか'
    }
  ];
}

function buildReport(applicability, contract, findings, mode) {
  const hasError = findings.some((finding) => finding.severity === 'error');
  const hasReview = findings.some((finding) => finding.severity === 'review');
  return {
    applicable: true,
    activation_reasons: applicability.reasons,
    mode,
    status: hasError ? 'invalid' : hasReview ? 'needs_review' : 'ready',
    findings,
    views: projectMultiTenantViews(contract)
  };
}

function objectAt(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function requireText(value, path, code, addError) {
  if (typeof value !== 'string' || value.trim() === '') addError(code, path, `${path} は空でない文字列が必要です`);
}

function requireNonEmptyArray(value, path, code, addError) {
  if (!Array.isArray(value) || value.length === 0) {
    addError(code, path, `${path} は1件以上必要です`);
    return [];
  }
  return value;
}

function requireEqual(actual, expected, path, code, addError) {
  if (actual !== expected) addError(code, path, `${path} は ${expected} である必要があります`);
}

function requireAllowed(actual, allowed, path, code, addError) {
  if (!allowed.has(actual)) addError(code, path, `${path} は ${[...allowed].join('|')} のいずれかである必要があります`);
}
