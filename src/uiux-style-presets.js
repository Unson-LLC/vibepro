export const STYLE_PRESET_SCHEMA_VERSION = '0.1.0';
export const DEFAULT_STYLE_PRESET_ID = 'operator_developer_cockpit';

export const UIUX_STYLE_PRESETS = [
  {
    id: DEFAULT_STYLE_PRESET_ID,
    label: 'Operator / developer cockpit',
    density: 'compact_information_dense',
    layout_posture: 'task_surface_first_with_persistent_navigation',
    color_posture: 'semantic_status_and_action_colors_over_decoration',
    typography_posture: 'small_readable_hierarchy_for_repeated_scanning',
    component_usage: ['tables', 'lists', 'toolbars', 'status badges', 'logs', 'forms'],
    motion_posture: 'minimal_feedback_only',
    anti_patterns: ['marketing hero composition', 'decorative gradients as primary structure', 'low-density cards for routine work']
  },
  {
    id: 'b2b_saas',
    label: 'B2B SaaS',
    density: 'balanced_dashboard_density',
    layout_posture: 'clear_navigation_with_actionable_dashboard_regions',
    color_posture: 'brand_restrained_with_semantic_system_states',
    typography_posture: 'business_readable_hierarchy',
    component_usage: ['navigation shells', 'dashboards', 'forms', 'tables', 'settings panels'],
    motion_posture: 'subtle_state_transitions',
    anti_patterns: ['consumer app novelty', 'unbounded accent colors', 'unclear primary action hierarchy']
  },
  {
    id: 'marketing_landing_page',
    label: 'Marketing landing page',
    density: 'editorial_but_scannable',
    layout_posture: 'first_view_offer_with_follow_on_proof_visible',
    color_posture: 'brand_forward_but_token_bounded',
    typography_posture: 'display_hierarchy_with_readable_supporting_copy',
    component_usage: ['hero', 'proof bands', 'feature sections', 'pricing', 'forms'],
    motion_posture: 'polished_but_non_blocking',
    anti_patterns: ['generic hero copy', 'dark blurred stock imagery', 'cards nested inside cards']
  },
  {
    id: 'onboarding_flow',
    label: 'Onboarding flow',
    density: 'progressive_disclosure',
    layout_posture: 'single_next_step_with_clear_progress_context',
    color_posture: 'calm_guidance_with_semantic_validation',
    typography_posture: 'instructional_hierarchy',
    component_usage: ['steppers', 'forms', 'checklists', 'empty states', 'inline validation'],
    motion_posture: 'orientation_and_completion_feedback',
    anti_patterns: ['too_many_parallel_choices', 'hidden validation', 'marketing copy in task flow']
  },
  {
    id: 'mobile_discovery',
    label: 'Mobile discovery',
    density: 'mobile_dense_scannable',
    layout_posture: 'search_filter_result_loop_with_bottom_navigation',
    color_posture: 'domain_semantics_and_action_priority',
    typography_posture: 'compact_mobile_scale_with_fast_metadata_scan',
    component_usage: ['search bars', 'chips', 'cards', 'bottom sheets', 'map pins', 'tabs'],
    motion_posture: 'spatial_context_and_reduced_motion_safe',
    anti_patterns: ['desktop_sidebar_first', 'large decorative media before task', 'unlabeled icon-only actions']
  }
];

const PRESET_BY_ID = new Map(UIUX_STYLE_PRESETS.map((preset) => [preset.id, preset]));

export function listUiuxStylePresets() {
  return UIUX_STYLE_PRESETS.map((preset) => ({ ...preset }));
}

export function getUiuxStylePreset(presetId) {
  const id = normalizeStylePresetId(presetId);
  const preset = PRESET_BY_ID.get(id);
  return preset ? { ...preset } : null;
}

export function resolveUiuxStylePreset(input = {}) {
  const explicit = extractExplicitStylePreset(input);
  if (explicit?.status === 'not_applicable') {
    const evidence = normalizeEvidence(explicit.evidence);
    const rationale = normalizeText(explicit.rationale ?? explicit.not_applicable_rationale);
    return buildStylePresetResolution({
      status: rationale && evidence.length > 0 ? 'not_applicable' : 'needs_evidence',
      selectionStatus: 'not_applicable',
      selectedPreset: null,
      confidence: 1,
      rationale: rationale || 'not_applicable coverage requires explicit rationale.',
      evidence,
      reason: 'style preset coverage was marked not_applicable'
    });
  }
  if (explicit?.preset) {
    return buildStylePresetResolution({
      status: 'pass',
      selectionStatus: 'explicit',
      selectedPreset: explicit.preset,
      confidence: explicit.confidence,
      rationale: explicit.rationale || 'Style preset selected by structured UI/UX intake.',
      evidence: explicit.evidence,
      reason: 'explicit intake style preset'
    });
  }

  const inferred = inferStylePreset(input);
  return buildStylePresetResolution({
    status: 'pass',
    selectionStatus: inferred.reason === 'default_archetype_policy' ? 'default' : 'inferred',
    selectedPreset: inferred.preset,
    confidence: inferred.confidence,
    rationale: inferred.rationale,
    evidence: inferred.evidence,
    reason: inferred.reason
  });
}

export function renderStylePresetMarkdown(stylePreset) {
  if (!stylePreset) return '- style preset: missing';
  if (stylePreset.selection.status === 'not_applicable') {
    return [
      '- style preset: not_applicable',
      `- rationale: ${stylePreset.selection.rationale}`,
      `- evidence: ${stylePreset.selection.evidence.join(', ') || '-'}`
    ].join('\n');
  }
  return [
    `- style preset: ${stylePreset.selected_preset?.id ?? 'missing'} (${stylePreset.selected_preset?.label ?? 'missing'})`,
    `- selection: ${stylePreset.selection.status}`,
    `- confidence: ${stylePreset.selection.confidence}`,
    `- density: ${stylePreset.selected_preset?.density ?? '-'}`,
    `- layout posture: ${stylePreset.selected_preset?.layout_posture ?? '-'}`,
    `- token authority: ${stylePreset.authority_boundary.token_authority}`
  ].join('\n');
}

function extractExplicitStylePreset({ intake, designSystem }) {
  const raw = firstObject([
    intake?.style_preset,
    intake?.stylePreset,
    intake?.fields?.style_preset,
    intake?.fields?.stylePreset,
    designSystem?.style_preset?.selection
  ]);
  if (!raw) return null;
  const status = normalizeText(raw.status);
  const presetId = raw.preset_id ?? raw.id ?? raw.value ?? raw.selected_preset_id ?? raw.selectedPresetId;
  if (status === 'not_applicable' || normalizeText(presetId) === 'not_applicable') {
    return {
      status: 'not_applicable',
      rationale: raw.rationale,
      not_applicable_rationale: raw.not_applicable_rationale,
      evidence: raw.evidence
    };
  }
  if (status && status !== 'explicit') return null;
  const preset = getUiuxStylePreset(presetId);
  if (!preset) return null;
  return {
    status: 'explicit',
    preset,
    confidence: clampConfidence(raw.confidence ?? 0.95),
    rationale: normalizeText(raw.rationale),
    evidence: normalizeEvidence(raw.evidence)
  };
}

function inferStylePreset({ brief, routes = [], product, semanticModel }) {
  const text = [
    product,
    brief,
    ...(Array.isArray(routes) ? routes : []),
    semanticModel?.primary_domain,
    semanticModel?.interaction_model,
    ...(semanticModel?.domain_concepts ?? [])
  ].join('\n').toLowerCase();
  const candidates = [
    {
      id: 'marketing_landing_page',
      score: score(text, [/landing|marketing|hero|pricing|lp|campaign|conversion/, /first view|offer|proof/]),
      evidence: 'marketing_or_landing_signal'
    },
    {
      id: 'onboarding_flow',
      score: score(text, [/onboarding|setup|signup|registration|wizard|初期設定|導入/, /stepper|checklist/]),
      evidence: 'onboarding_signal'
    },
    {
      id: 'mobile_discovery',
      score: score(text, [/mobile|map|discovery|search|hotel|地図|検索|現在地|bottom sheet/, /hotel_discovery/]),
      evidence: 'mobile_discovery_signal'
    },
    {
      id: 'b2b_saas',
      score: score(text, [/b2b|saas|crm|workspace|settings/, /account|team|organization/]),
      evidence: 'b2b_saas_signal'
    },
    {
      id: DEFAULT_STYLE_PRESET_ID,
      score: score(text, [/operator|developer|cockpit|ops|terminal|workflow|internal|admin|dashboard/, /log|gate|review|証跡/]),
      evidence: 'operator_cockpit_signal'
    }
  ];
  const winner = candidates.sort((a, b) => b.score - a.score)[0];
  if (!winner || winner.score === 0) {
    return {
      preset: getUiuxStylePreset(DEFAULT_STYLE_PRESET_ID),
      confidence: 0.55,
      rationale: 'No stronger product archetype signal was found, so VibePro defaults to the operator/developer cockpit preset.',
      evidence: ['default_archetype_policy'],
      reason: 'default_archetype_policy'
    };
  }
  return {
    preset: getUiuxStylePreset(winner.id),
    confidence: Math.min(0.9, 0.62 + winner.score * 0.08),
    rationale: `Product, route, or brief signals matched ${winner.id}.`,
    evidence: [winner.evidence],
    reason: winner.evidence
  };
}

function buildStylePresetResolution({ status, selectionStatus, selectedPreset, confidence, rationale, evidence, reason }) {
  return {
    schema_version: STYLE_PRESET_SCHEMA_VERSION,
    workflow: 'uiux-style-preset-selection',
    coverage: {
      status,
      reason
    },
    selection: {
      status: selectionStatus,
      confidence: clampConfidence(confidence),
      rationale: rationale || null,
      evidence: normalizeEvidence(evidence)
    },
    selected_preset: selectedPreset,
    supported_presets: UIUX_STYLE_PRESETS.map((preset) => preset.id),
    authority_boundary: {
      preset_role: 'product_archetype_style_guidance',
      token_authority: 'native_design_system_tokens_and_component_roles',
      authoritative_sources: [
        'Story',
        'Spec',
        'Architecture',
        'current route code',
        'Design System tokens',
        'VibePro gate evidence'
      ],
      conflict_policy: 'style_preset_guidance_never_overrides_native_design_system_or_verified_code'
    }
  };
}

function normalizeStylePresetId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeEvidence(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (value === undefined || value === null || value === '') return [];
  return [String(value).trim()].filter(Boolean);
}

function firstObject(values) {
  return values.find((value) => value && typeof value === 'object' && !Array.isArray(value)) ?? null;
}

function clampConfidence(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0.55;
  return Math.max(0, Math.min(1, Number(numeric.toFixed(2))));
}

function score(text, patterns) {
  return patterns.reduce((total, pattern) => total + (pattern.test(text) ? 1 : 0), 0);
}
