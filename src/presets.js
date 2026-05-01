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

const NEXT_APP_PRESET = {
  id: 'next-app',
  isCodePath: (filePath) => typeof filePath === 'string' && filePath.startsWith('src/'),
  storyRelevantPatterns: NEXT_APP_RELEVANT_PATTERNS,
  classifyRole: classifyNextApp,
  codeSurfaceSignatures: null
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
  codeSurfaceSignatures: MODULAR_WEB_CODE_SURFACE_SIGNATURES
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

export function resolvePresetId(config) {
  return config?.story_catalog?.preset ?? DEFAULT_PRESET_ID;
}
