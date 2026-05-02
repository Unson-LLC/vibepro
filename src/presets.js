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
    patterns: [
      /^public\/modules\/core\//,
      /^public\/modules\/components\//,
      /^public\/modules\/utils\//,
      /^public\/modules\/[^/]+\.[jt]sx?$/
    ]
  },
  {
    id: 'story-code-domain-services',
    title: 'ドメインサービスの責務と契約を整える',
    category: 'product',
    patterns: [
      /^public\/modules\/domain\//,
      /^public\/modules\/(app|settings|auth|device|setup|terminal|ui)\//,
      /^lib\/services\//,
      /^server\/services\//
    ]
  },
  {
    id: 'story-code-server-routes',
    title: 'サーバ側ルートとAPI境界を整える',
    category: 'architecture',
    patterns: [
      /^server\/routes\//,
      /^server\/api\//,
      /^server\/controllers\//,
      /^server\/(middleware|lib|utils|bootstrap|mesh)\//,
      /^lib\/[^/]+\.[jt]s$/
    ]
  }
];

const MODULAR_WEB_COVERAGE_PATTERNS = {
  'story-code-cli-tooling': [
    /^cli\//
  ],
  'story-code-mcp-server': [
    /^mcp\//
  ],
  'story-code-web-core': [
    /^public\/modules\/core\//,
    /^public\/modules\/components\//,
    /^public\/modules\/utils\//,
    /^public\/modules\/[^/]+\.[jt]sx?$/
  ],
  'story-code-domain-services': [
    /^public\/modules\/domain\//,
    /^public\/modules\/(app|settings|auth|device|setup|terminal|ui)\//,
    /^lib\/services\//,
    /^server\/services\//
  ],
  'story-code-server-routes': [
    /^server\/routes\//,
    /^server\/api\//,
    /^server\/controllers\//,
    /^server\/(middleware|lib|utils|bootstrap|mesh)\//,
    /^lib\/[^/]+\.[jt]s$/
  ]
};

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
  coveragePatterns: MODULAR_WEB_COVERAGE_PATTERNS
};

const SALES_TAILOR_CODE_SURFACE_SIGNATURES = [
  {
    id: 'story-salestailor-project-planning',
    title: '営業プロジェクトとターゲット戦略を設計する',
    category: 'product',
    patterns: [
      /^src\/app\/projects\//,
      /^src\/app\/api\/projects\//,
      /^src\/app\/api\/plans\//,
      /^src\/lib\/services\/.*project/i,
      /^src\/lib\/services\/.*plan/i
    ]
  },
  {
    id: 'story-salestailor-letter-generation-review',
    title: '営業レター生成とレビューを成立させる',
    category: 'product',
    patterns: [
      /sample-review/i,
      /sample-generation/i,
      /letter/i,
      /prompt-generation/i,
      /^src\/app\/api\/.*generate/i
    ]
  },
  {
    id: 'story-salestailor-prompt-improvement-loop',
    title: 'プロンプト改善フィードバックを運用する',
    category: 'product',
    patterns: [
      /prompt-improvement/i,
      /improvement/i,
      /feedback/i
    ]
  },
  {
    id: 'story-salestailor-contact-form-automation',
    title: '問い合わせフォーム送信を自動化する',
    category: 'product',
    patterns: [
      /formSubmission/i,
      /form-automation/i,
      /contactForm/i,
      /captcha/i
    ]
  },
  {
    id: 'story-salestailor-company-product-data',
    title: '企業・商材データを営業文脈で管理する',
    category: 'product',
    patterns: [
      /^src\/app\/companies\//,
      /^src\/app\/products\//,
      /^src\/app\/api\/companies\//,
      /^src\/app\/api\/products\//,
      /companyService/i,
      /product/i
    ]
  },
  {
    id: 'story-salestailor-delivery-tracking',
    title: '送信結果と反応を追跡する',
    category: 'product',
    patterns: [
      /email-tracking/i,
      /click-tracking/i,
      /tracking/i,
      /^src\/app\/api\/webhooks\/resend\//
    ]
  },
  {
    id: 'story-salestailor-admin-operations',
    title: '管理者がテンプレート・ユーザー・LLM運用を管理する',
    category: 'ops',
    patterns: [
      /^src\/app\/admin\//,
      /^src\/app\/api\/admin\//,
      /^src\/app\/api\/templates\//,
      /^src\/lib\/services\/admin\//,
      /template/i,
      /llmJudge/i
    ]
  },
  {
    id: 'story-salestailor-integrations-scheduling',
    title: '外部連携と面談日程を接続する',
    category: 'product',
    patterns: [
      /timerex/i,
      /^src\/app\/api\/integrations\//,
      /^src\/app\/api\/webhooks\/timerex\//
    ]
  }
];

const SALES_TAILOR_STORY_DEFINITIONS = {
  'story-salestailor-project-planning': {
    who: '営業施策を設計するユーザー',
    problem: 'ターゲット、商材、訴求、実行条件が分散すると、営業プロジェクトごとの狙いと実行単位が曖昧になる。',
    want: 'プロジェクト単位でターゲット戦略と実行条件を整理し、生成・送信・分析へつなげたい。',
    outcome: '営業プロジェクトの目的、対象、進め方が一貫して管理される。',
    business_value: '営業施策の立ち上げ速度と再現性を高める。案件化率やプロジェクト作成から実行までの時間は未確認。',
    acceptance_focus: ['プロジェクトの対象企業と条件が追跡できる', 'ターゲット戦略が生成や送信に反映される', '状態遷移と権限が破綻しない']
  },
  'story-salestailor-letter-generation-review': {
    who: '営業レターを作成・確認するユーザー',
    problem: '生成結果、レビュー、再生成、承認が一貫しないと、送信前の品質担保と改善が属人的になる。',
    want: '対象企業ごとの文脈を踏まえたレターを生成し、レビューで修正してから送信に進めたい。',
    outcome: 'レター生成から承認までの品質管理がStoryとして追跡できる。',
    business_value: '商談化につながる文面品質と運用速度を支える。承認率、再生成率、返信率は未確認。',
    acceptance_focus: ['生成結果と対象企業の対応が崩れない', 'レビュー・再生成・承認の状態が追跡できる', '改善フィードバックが次の生成に接続できる']
  },
  'story-salestailor-prompt-improvement-loop': {
    who: '営業レター品質を改善する運用者',
    problem: '改善フィードバックが1件単位や全体単位に閉じると、対象パートごとの改善やプロンプト版管理に接続しづらい。',
    want: 'レビューで得た改善点をパート、重要度、適用範囲ごとに蓄積し、プロンプト改善へ反映したい。',
    outcome: 'レター品質改善が単発修正ではなく、検証可能な改善ループとして残る。',
    business_value: '生成品質の継続改善と運用品質の平準化に効く。改善反映後の品質指標は未確認。',
    acceptance_focus: ['複数改善点を同一レターに紐づけられる', '対象パートと適用範囲で分類できる', 'プロンプト版と改善結果の対応が追跡できる']
  },
  'story-salestailor-contact-form-automation': {
    who: '問い合わせフォーム送信を自動化したい営業担当者',
    problem: 'フォーム探索、入力、CAPTCHA、送信結果の扱いが不安定だと、手作業削減と送信品質を両立できない。',
    want: '企業サイトのフォームを検出し、必要項目を安全に入力して、結果を確認できる形で送信したい。',
    outcome: 'フォーム送信の自動化が運用可能な業務フローになる。',
    business_value: '営業接触数の拡張と作業時間削減につながる。成功率、失敗分類、再試行基準は未確認。',
    acceptance_focus: ['フォーム検出から送信までの状態が追跡できる', '失敗理由と再試行可否が分かる', 'CAPTCHAや外部ブラウザ依存の扱いが明確である']
  },
  'story-salestailor-company-product-data': {
    who: '営業対象企業と商材情報を管理するユーザー',
    problem: '企業情報、商材情報、インポート、更新が散らばると、生成文面やターゲティングの根拠が弱くなる。',
    want: '企業と商材の情報を営業文脈で整え、プロジェクトやレター生成に利用したい。',
    outcome: '営業文面の根拠になる企業・商材データが管理される。',
    business_value: 'パーソナライズ精度と運用効率を支える。データ鮮度と利用率は未確認。',
    acceptance_focus: ['企業・商材情報の作成、更新、取り込みが成立する', 'プロジェクトや生成処理から参照できる', '重複や不足情報の扱いが決まる']
  },
  'story-salestailor-delivery-tracking': {
    who: '送信後の反応を確認したい営業担当者と運用者',
    problem: '送信結果、開封、クリック、返信などの反応が追えないと、施策改善と次アクションにつながらない。',
    want: '送信後の状態と反応を確認し、プロジェクトや改善判断へ戻したい。',
    outcome: '営業接触の結果が可視化され、次の改善に使える。',
    business_value: '営業施策の学習速度を高める。返信率、クリック率、商談化率は未確認。',
    acceptance_focus: ['送信結果と反応イベントが保存される', '対象企業・レター・プロジェクトへ紐づく', 'webhookや外部イベントの信頼境界が明確である']
  },
  'story-salestailor-admin-operations': {
    who: 'SalesTailorを運用する管理者',
    problem: 'テンプレート、ユーザー、LLM判定、利用状況の管理が弱いと、プロダクト全体の品質と安全な運用を保てない。',
    want: '管理者がテンプレート、ユーザー、評価、利用状況を確認・調整できるようにしたい。',
    outcome: '営業生成システムを管理者が継続運用できる。',
    business_value: '運用品質、権限管理、生成品質の統制に効く。管理者作業の頻度と基準は未確認。',
    acceptance_focus: ['管理画面と管理APIの責務が整理される', '管理者権限が一貫している', 'テンプレートやLLM評価の変更履歴を追える']
  },
  'story-salestailor-integrations-scheduling': {
    who: '営業接点を面談や外部ツールへつなげたいユーザー',
    problem: '日程調整や外部連携が営業フローと分断されると、返信後の面談化や結果追跡が弱くなる。',
    want: 'Timerexなどの外部連携を通じて、営業接触から日程調整・結果確認までつなげたい。',
    outcome: '営業接触後の次アクションが外部サービスと連携して管理される。',
    business_value: '商談化までの摩擦を減らす。面談設定率や連携失敗率は未確認。',
    acceptance_focus: ['外部認証とcallbackが安全に処理される', 'tracking URLやwebhookがプロジェクトに紐づく', '失敗時の再接続や通知が決まる']
  }
};

const SALES_TAILOR_WORKFLOW_POSITIONS = {
  'story-salestailor-company-product-data': {
    stage: 'foundation',
    before: [],
    after: ['story-salestailor-project-planning', 'story-salestailor-letter-generation-review'],
    confidence: 'medium',
    rationale: '企業・商材情報はターゲット設計とレター生成の根拠になるため'
  },
  'story-salestailor-project-planning': {
    stage: 'planning',
    before: ['story-salestailor-company-product-data'],
    after: ['story-salestailor-letter-generation-review', 'story-salestailor-contact-form-automation'],
    confidence: 'medium',
    rationale: 'プロジェクト設計は生成・送信の実行単位になるため'
  },
  'story-salestailor-letter-generation-review': {
    stage: 'creation',
    before: ['story-salestailor-project-planning'],
    after: ['story-salestailor-prompt-improvement-loop', 'story-salestailor-contact-form-automation'],
    confidence: 'medium',
    rationale: '送信前に文面生成とレビューで品質を担保するため'
  },
  'story-salestailor-prompt-improvement-loop': {
    stage: 'quality_improvement',
    before: ['story-salestailor-letter-generation-review'],
    after: ['story-salestailor-letter-generation-review'],
    confidence: 'medium',
    rationale: 'レビュー結果を次の生成品質へ戻す改善ループのため'
  },
  'story-salestailor-contact-form-automation': {
    stage: 'execution',
    before: ['story-salestailor-project-planning', 'story-salestailor-letter-generation-review'],
    after: ['story-salestailor-delivery-tracking', 'story-salestailor-integrations-scheduling'],
    confidence: 'medium',
    rationale: '生成した文面を企業接点へ届ける実行段階のため'
  },
  'story-salestailor-delivery-tracking': {
    stage: 'measurement',
    before: ['story-salestailor-contact-form-automation'],
    after: ['story-salestailor-prompt-improvement-loop'],
    confidence: 'medium',
    rationale: '送信結果と反応が改善判断に戻るため'
  },
  'story-salestailor-admin-operations': {
    stage: 'operations',
    before: [],
    after: [],
    confidence: 'medium',
    rationale: '管理者運用は全体の品質と権限を支える横断機能のため'
  },
  'story-salestailor-integrations-scheduling': {
    stage: 'conversion_support',
    before: ['story-salestailor-contact-form-automation'],
    after: ['story-salestailor-delivery-tracking'],
    confidence: 'medium',
    rationale: '営業接触後の面談化や外部結果を追跡するため'
  }
};

const SALES_TAILOR_COVERAGE_PATTERNS = Object.fromEntries(
  SALES_TAILOR_CODE_SURFACE_SIGNATURES.map((signature) => [signature.id, signature.patterns])
);

const SALES_TAILOR_PRESET = {
  id: 'salestailor',
  isCodePath: (filePath) => typeof filePath === 'string' && filePath.startsWith('src/'),
  storyRelevantPatterns: NEXT_APP_RELEVANT_PATTERNS,
  classifyRole: classifyNextApp,
  codeSurfaceSignatures: SALES_TAILOR_CODE_SURFACE_SIGNATURES,
  productSurfaceSignals: [],
  documentSignalGroups: [...COMMON_DOCUMENT_SIGNAL_GROUPS],
  coveragePatterns: SALES_TAILOR_COVERAGE_PATTERNS,
  storyDefinitions: SALES_TAILOR_STORY_DEFINITIONS,
  workflowPositions: SALES_TAILOR_WORKFLOW_POSITIONS
};

const PRESETS = {
  'next-app': NEXT_APP_PRESET,
  'modular-web': MODULAR_WEB_PRESET,
  salestailor: SALES_TAILOR_PRESET
};

export const DEFAULT_PRESET_ID = 'next-app';

export function getPreset(name) {
  if (name && PRESETS[name]) return PRESETS[name];
  return PRESETS[DEFAULT_PRESET_ID];
}

export function resolvePresetId(config, explicitPreset = null) {
  return explicitPreset ?? config?.story_catalog?.preset ?? DEFAULT_PRESET_ID;
}
