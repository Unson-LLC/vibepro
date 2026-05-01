const NEXT_APP_RELEVANT_PATTERNS = [
  /^src\/app\/.+\/(page|route|client)\.[jt]sx?$/,
  /^src\/app\/.+\/_components\/.+\.[jt]sx?$/,
  /^src\/components\/(auth|hotel|layout|modals|common\/hotel_card)\/.+\.[jt]sx?$/,
  /^src\/lib\/actions\/.+\.[jt]s$/,
  /^src\/lib\/auth\/.+\.[jt]s$/,
  /^src\/lib\/article\/.+\.[jt]s$/,
  /^src\/lib\/crawlers\/.+\.[jt]s$/,
  /^src\/lib\/services\/.+\.[jt]s$/,
  /^src\/lib\/api\/.+\.[jt]s$/
];

function classifyNextApp(filePath) {
  if (/^src\/app\/.+\/route\.[jt]s$/.test(filePath)) return 'api_route';
  if (/^src\/app\//.test(filePath)) return 'app_route';
  if (/^src\/components\//.test(filePath)) return 'component';
  if (/^src\/lib\/actions\//.test(filePath)) return 'server_action';
  if (/^src\/lib\/crawlers\//.test(filePath)) return 'crawler';
  if (/^src\/lib\/auth\//.test(filePath)) return 'auth';
  if (/^src\/lib\/article\//.test(filePath)) return 'article_logic';
  if (/^src\/lib\/api\//.test(filePath)) return 'api_client';
  return 'domain_code';
}

const COMMON_DOCUMENT_SIGNAL_GROUPS = [
  { key: 'architecture', pattern: /^docs\/architecture\// },
  { key: 'managementStories', pattern: /^docs\/management\/stories\// },
  { key: 'requirements', pattern: /^docs\/requirements\// },
  { key: 'userStories', pattern: /^docs\/user_stories\// },
  { key: 'features', pattern: /^docs\/features\// }
];

const NEXT_APP_DOCUMENT_SIGNAL_GROUPS = [
  { key: 'hotelMapSearch', pattern: /(map[_-]search|map[_-]marker|search-results|REQ-001_map_search_integration|US-001_map_search_display|\/map\/)/i },
  { key: 'shadowCall', pattern: /(shadow-call|premium-ai-phone-feature)/i },
  { key: 'premiumBilling', pattern: /(stripe|premium|subscription|billing|webhook-secret)/i },
  { key: 'contentCms', pattern: /(article|cms|sanity)/i },
  { key: 'onboarding', pattern: /(onboarding|profile|preferences)/i },
  { key: 'notification', pattern: /notification/i },
  ...COMMON_DOCUMENT_SIGNAL_GROUPS
];

const NEXT_APP_PRODUCT_SURFACE_SIGNALS = [
  {
    id: 'story-product-hotel-map-search',
    title: 'ホテル検索と地図体験を安定化する',
    category: 'product',
    codePattern: /(^src\/app\/.+\/map|api\/map-search|api\/hotels\/search|search-results|mapSearchService|GoogleMapsScript|_components\/search)/,
    docKey: 'hotelMapSearch',
    evidenceTokens: ['map', 'hotels', 'hotel services']
  },
  {
    id: 'story-product-shadow-call',
    title: 'AI電話代行体験を安定化する',
    category: 'product',
    codePattern: /shadow-call/,
    docKey: 'shadowCall',
    evidenceTokens: ['shadow-call']
  },
  {
    id: 'story-product-premium-billing',
    title: 'プレミアム課金導線を安定化する',
    category: 'product',
    codePattern: /stripe|premium|subscription/,
    docKey: 'premiumBilling',
    evidenceTokens: ['stripe', 'premium', 'subscription']
  },
  {
    id: 'story-product-content-cms',
    title: '記事とCMS運用を整理する',
    category: 'product',
    codePattern: /articles|sanity|cms/,
    docKey: 'contentCms',
    evidenceTokens: ['articles', 'sanity', 'cms']
  },
  {
    id: 'story-product-onboarding',
    title: 'オンボーディング体験を安定化する',
    category: 'product',
    codePattern: /onboarding|profile-step|preferences-step/,
    docKey: 'onboarding',
    evidenceTokens: ['onboarding', 'profile', 'preferences']
  },
  {
    id: 'story-product-notification',
    title: '通知体験を安定化する',
    category: 'product',
    codePattern: /notification/,
    docKey: 'notification',
    evidenceTokens: ['notification']
  }
];

const NEXT_APP_COVERAGE_PATTERNS = {
  'story-product-hotel-map-search': [
    /^src\/app\/\(app\)\/map\//,
    /^src\/app\/\(app\)\/_components\/GoogleMapsScript\.tsx$/,
    /^src\/app\/\(app\)\/_components\/search\//,
    /^src\/app\/\(app\)\/_components\/PlanDisplay\.tsx$/,
    /^src\/app\/\(public\)\/search-results\//,
    /^src\/app\/api\/map-search\//,
    /^src\/app\/api\/hotels\/search\//,
    /^src\/lib\/services\/search\/mapSearchService\.ts$/,
    /^src\/lib\/actions\/search_actions\.ts$/,
    /^src\/lib\/constants\/map\.ts$/,
    /^src\/lib\/constants\/search\.ts$/
  ],
  'story-product-shadow-call': [
    /^src\/app\/\(app\)\/_components\/shadow_call\//,
    /^src\/app\/shadow-call\//,
    /^src\/app\/api\/twilio/,
    /^src\/app\/api\/openai\/webhook\/response\/route\.ts$/,
    /^src\/app\/api\/shadow-call\//,
    /^src\/lib\/services\/shadow-call\//,
    /^src\/components\/hotel\/HotelDetailWithShadowCall\.tsx$/,
    /^src\/components\/hotel\/PhoneMethodDialog\.tsx$/
  ],
  'story-product-premium-billing': [
    /^src\/app\/\(public\)\/premium\//,
    /^src\/app\/api\/stripe\//,
    /^src\/app\/api\/webhook\/stripe\/route\.ts$/,
    /^src\/components\/ui\/button\/ButtonCheckout\.tsx$/,
    /^src\/components\/ui\/button\/CheckoutErrorModal\.tsx$/,
    /^src\/components\/ui\/modal\/PremiumRequiredModal\.tsx$/,
    /^src\/lib\/constants\/stripe\.ts$/
  ],
  'story-product-content-cms': [
    /^src\/app\/\(public\)\/articles\//,
    /^src\/app\/api\/articles\//,
    /^src\/lib\/article/,
    /^src\/lib\/article-utils\.ts$/,
    /^src\/lib\/actions\/sanity_hotel_search\.ts$/
  ],
  'story-product-onboarding': [
    /^src\/app\/onboarding\//,
    /^src\/app\/api\/onboarding\//,
    /^src\/lib\/auth\/onboarding\.ts$/
  ],
  'story-product-notification': [
    /^src\/app\/\(app\)\/notification\//,
    /^src\/components\/ui\/UpdateNotification\.tsx$/
  ],
  'story-product-hotel-detail-actions': [
    /^src\/app\/\(app\)\/detail\//,
    /^src\/app\/\(public\)\/hotel\/\[hotel_id\]\//,
    /^src\/app\/api\/hotels\/(\[hotelId\]|detail|list-tokyo)\//,
    /^src\/components\/hotel\//,
    /^src\/components\/common\/hotel_card\//,
    /^src\/lib\/services\/hotel\//,
    /^src\/lib\/services\/search\/detailSearchService\.ts$/,
    /^src\/lib\/actions\/hotel_actions\.ts$/,
    /^src\/lib\/actions\/lead_actions\.ts$/,
    /^src\/lib\/actions\/post_actions\.ts$/
  ],
  'story-product-auth-account-access': [
    /^src\/app\/\(auth\)\//,
    /^src\/app\/\(app\)\/auth\//,
    /^src\/components\/auth\//,
    /^src\/app\/api\/auth\//,
    /^src\/app\/api\/user\//,
    /^src\/app\/api\/users\//,
    /^src\/lib\/auth/,
    /^src\/lib\/services\/user\//,
    /^src\/lib\/actions\/user_actions\.ts$/
  ],
  'story-product-profile-personalization': [
    /^src\/app\/\(app\)\/profile\//,
    /^src\/components\/modals\/HotelSelectModal\.tsx$/,
    /^src\/lib\/services\/profile\//,
    /^src\/lib\/services\/user\/user(Read|Write|Entry)Service\.ts$/,
    /^src\/lib\/actions\/profile_action\.ts$/
  ],
  'story-product-match-recommendation': [
    /^src\/app\/\(app\)\/match\//,
    /^src\/lib\/services\/search\/matchSearchService\.ts$/
  ],
  'story-product-timeline-posts': [
    /^src\/app\/\(app\)\/timeline\//,
    /^src\/app\/\(app\)\/_components\/post\//,
    /^src\/components\/modals\/PostCompleteModal\.tsx$/,
    /^src\/lib\/services\/timeline\//,
    /^src\/lib\/services\/post\//,
    /^src\/lib\/services\/reply\//,
    /^src\/lib\/services\/image\//,
    /^src\/lib\/actions\/timeline_actions\.ts$/,
    /^src\/lib\/constants\/post\.ts$/
  ],
  'story-product-public-discovery-seo': [
    /^src\/app\/\(public\)\/search-results\//,
    /^src\/app\/\(public\)\/articles\//,
    /^src\/app\/\(public\)\/_components\/landing\//,
    /^src\/app\/\(public\)\/sitemap/,
    /^src\/app\/robots\.ts$/,
    /^src\/app\/sitemap\.ts$/,
    /^src\/lib\/services\/analytics\//,
    /^src\/components\/common\/StructuredData\.tsx$/
  ],
  'story-product-waiting-list-contact': [
    /^src\/app\/\(public\)\/contact\//,
    /^src\/app\/\(public\)\/waiting-list\//
  ],
  'story-product-qr-offline-access': [
    /^src\/app\/\(app\)\/_components\/QRCodeScanner\.tsx$/,
    /^src\/app\/\(public\)\/offline\//,
    /^src\/components\/common\/ModernServiceWorkerManager\.tsx$/,
    /^src\/components\/ui\/UpdateNotification\.tsx$/
  ],
  'story-product-app-navigation-shell': [
    /^src\/app\/\(app\)\/home\//,
    /^src\/components\/layout\//
  ],
  'story-ops-hotel-data-ingestion': [
    /^src\/lib\/crawlers\//,
    /^src\/app\/api\/crawl\//,
    /^src\/app\/api\/hotels\/register\//,
    /^src\/app\/api\/regenerate-sitemap\//,
    /^src\/app\/\(app\)\/manager\//,
    /^src\/lib\/services\/vercel-blob-service\.ts$/,
    /^src\/lib\/api\/backend\.ts$/
  ],
  'story-ops-observability-health': [
    /^src\/app\/api\/health\//,
    /^src\/app\/api\/heartbeat\//,
    /^src\/app\/api\/vercel\//,
    /^src\/app\/log_viewer\//,
    /^src\/components\/common\/ConsoleLogger\.tsx$/
  ],
  'story-product-legal-trust-pages': [
    /^src\/app\/\(public\)\/privacy/,
    /^src\/app\/\(public\)\/terms\//,
    /^src\/app\/\(public\)\/tos\//,
    /^src\/app\/\(public\)\/tokusho\//,
    /^src\/app\/\(public\)\/guidelines\//
  ],
  'story-security-api-trust-boundary': [
    /^src\/app\/api\/debug\//,
    /^src\/app\/api\/test\//,
    /^src\/app\/api\/admin\//
  ]
};

const NEXT_APP_PRESET = {
  id: 'next-app',
  isCodePath: (filePath) => typeof filePath === 'string' && filePath.startsWith('src/'),
  storyRelevantPatterns: NEXT_APP_RELEVANT_PATTERNS,
  classifyRole: classifyNextApp,
  codeSurfaceSignatures: null,
  productSurfaceSignals: NEXT_APP_PRODUCT_SURFACE_SIGNALS,
  documentSignalGroups: NEXT_APP_DOCUMENT_SIGNAL_GROUPS,
  coveragePatterns: NEXT_APP_COVERAGE_PATTERNS
};

const MODULAR_WEB_RELEVANT_PATTERNS = [
  /^cli\/.+\.[jt]sx?$/,
  /^lib\/services\/.+\.[jt]s$/,
  /^lib\/auth\/.+\.[jt]s$/,
  /^lib\/[^/]+\.[jt]s$/,
  /^lib\/[^/]+\/[^/]+\.[jt]s$/,
  /^mcp\/.+\.[jt]sx?$/,
  /^public\/modules\/core\/.+\.[jt]s$/,
  /^public\/modules\/domain\/.+\.[jt]s$/,
  /^public\/modules\/.+\.[jt]s$/,
  /^server\/routes\/.+\.[jt]s$/,
  /^server\/.+\.[jt]s$/
];

function classifyModularWeb(filePath) {
  if (/^cli\//.test(filePath)) return 'cli';
  if (/^mcp\//.test(filePath)) return 'mcp_server';
  if (/^public\/modules\/core\//.test(filePath)) return 'web_core';
  if (/^public\/modules\/domain\//.test(filePath)) return 'domain_service';
  if (/^public\/modules\//.test(filePath)) return 'web_module';
  if (/^server\/routes\//.test(filePath)) return 'server_route';
  if (/^server\//.test(filePath)) return 'server_module';
  if (/^lib\/services\//.test(filePath)) return 'service';
  if (/^lib\/auth\//.test(filePath)) return 'auth';
  if (/^lib\//.test(filePath)) return 'lib_module';
  return 'domain_code';
}

const MODULAR_WEB_CODE_SURFACE_SIGNATURES = [
  {
    id: 'story-code-cli-tooling',
    title: 'CLIツールと配布インターフェースを整える',
    category: 'product',
    patterns: [/^cli\//]
  },
  {
    id: 'story-code-mcp-server',
    title: 'MCPサーバ境界と実行ライフサイクルを整える',
    category: 'architecture',
    patterns: [/^mcp\//]
  },
  {
    id: 'story-code-web-core',
    title: 'Webクライアントのコア基盤を整える',
    category: 'architecture',
    patterns: [/^public\/modules\/core\//]
  },
  {
    id: 'story-code-domain-services',
    title: 'ドメインサービスの責務と契約を整える',
    category: 'product',
    patterns: [/^public\/modules\/domain\//, /^lib\/services\//]
  },
  {
    id: 'story-code-server-routes',
    title: 'サーバ側ルートとAPI境界を整える',
    category: 'architecture',
    patterns: [/^server\/routes\//, /^server\/api\//]
  }
];

const MODULAR_WEB_PRESET = {
  id: 'modular-web',
  isCodePath: (filePath) =>
    typeof filePath === 'string' &&
    /^(cli\/|lib\/|mcp\/|public\/modules\/|server\/|src\/)/.test(filePath),
  storyRelevantPatterns: MODULAR_WEB_RELEVANT_PATTERNS,
  classifyRole: classifyModularWeb,
  codeSurfaceSignatures: MODULAR_WEB_CODE_SURFACE_SIGNATURES,
  productSurfaceSignals: [],
  documentSignalGroups: [...COMMON_DOCUMENT_SIGNAL_GROUPS],
  coveragePatterns: {}
};

const PRESETS = {
  'next-app': NEXT_APP_PRESET,
  'modular-web': MODULAR_WEB_PRESET
};

export const DEFAULT_PRESET_ID = 'next-app';

export function getPreset(name) {
  if (name && PRESETS[name]) return PRESETS[name];
  return PRESETS[DEFAULT_PRESET_ID];
}

export function resolvePresetId(config, explicitPreset = null) {
  return explicitPreset ?? config?.story_catalog?.preset ?? DEFAULT_PRESET_ID;
}
