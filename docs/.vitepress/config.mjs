import { execFileSync } from 'node:child_process';

const siteUrl = 'https://vibepro.pages.dev';
const sourceCommit = resolveSourceCommit();
const productDescription = 'Repository-local control plane for evidence-backed, safe AI-agent delivery';

export default {
  title: 'VibePro',
  description: productDescription,
  cleanUrls: true,
  sitemap: { hostname: siteUrl },
  srcExclude: [
    'architecture/**',
    'contracts/**',
    'frames/**',
    'management/**',
    'marketing/**',
    'playbooks/**',
    'reference/gate-tuning/**',
    'reference/vibepro-ui-journey-e2e-dogfood.md',
    'specs/**',
    'static_site/**',
    'stories/**'
  ],
  head: [
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:site_name', content: 'VibePro Manual' }],
    ['meta', { property: 'og:title', content: 'VibePro — Evidence-backed AI delivery control plane' }],
    ['meta', { property: 'og:description', content: productDescription }],
    ['meta', { property: 'og:image', content: `${siteUrl}/assets/vibepro-header.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'VibePro — Evidence-backed AI delivery control plane' }],
    ['meta', { name: 'twitter:description', content: productDescription }],
    ['meta', { name: 'twitter:image', content: `${siteUrl}/assets/vibepro-header.png` }],
    ['meta', { name: 'vibepro-source-commit', content: sourceCommit }],
    ['script', { type: 'application/ld+json' }, JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'VibePro',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Linux, Windows',
      softwareVersion: '0.1.0-beta.0',
      url: siteUrl,
      codeRepository: 'https://github.com/Unson-LLC/vibepro',
      license: 'https://www.apache.org/licenses/LICENSE-2.0'
    })]
  ],
  themeConfig: {
    siteTitle: 'VibePro Manual',
    nav: [
      { text: 'Guide', link: '/guide/what-is-vibepro' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'GitHub', link: 'https://github.com/Unson-LLC/vibepro' }
    ],
    sidebar: {
      '/guide/': guideSidebar('en'),
      '/reference/': referenceSidebar('en')
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/Unson-LLC/vibepro' }],
    search: {
      provider: 'local',
      options: {
        locales: {
          ja: {
            translations: {
              button: { buttonText: '検索', buttonAriaLabel: '検索' },
              modal: {
                displayDetails: '詳細を表示',
                resetButtonTitle: '検索をリセット',
                backButtonTitle: '検索を閉じる',
                noResultsText: '結果がありません',
                footer: {
                  selectText: '選択',
                  navigateText: '移動',
                  closeText: '閉じる'
                }
              }
            }
          }
        }
      }
    },
    editLink: {
      pattern: 'https://github.com/Unson-LLC/vibepro/edit/main/docs/:path',
      text: 'Edit this page on GitHub'
    },
    footer: {
      message: `Apache-2.0 · docs source ${sourceCommit}`,
      copyright: 'Copyright Unson LLC'
    }
  },
  locales: {
    root: {
      label: 'English',
      lang: 'en-US',
      link: '/'
    },
    ja: {
      label: '日本語',
      lang: 'ja-JP',
      link: '/ja/',
      title: 'VibePro',
      description: 'AIコーディングエージェントのための意図確認とレビュー証跡',
      themeConfig: {
        siteTitle: 'VibeProマニュアル',
        nav: [
          { text: 'ガイド', link: '/ja/guide/what-is-vibepro' },
          { text: 'リファレンス', link: '/ja/reference/cli' },
          { text: 'GitHub', link: 'https://github.com/Unson-LLC/vibepro' }
        ],
        sidebar: {
          '/ja/guide/': guideSidebar('ja'),
          '/ja/reference/': referenceSidebar('ja')
        },
        editLink: {
          pattern: 'https://github.com/Unson-LLC/vibepro/edit/main/docs/:path',
          text: 'GitHubでこのページを編集'
        },
        footer: {
          message: `Apache-2.0 · docs source ${sourceCommit}`,
          copyright: 'Copyright Unson LLC'
        },
        outline: { label: 'このページ' },
        docFooter: { prev: '前へ', next: '次へ' },
        lastUpdated: { text: '最終更新' },
        returnToTopLabel: 'トップへ戻る',
        sidebarMenuLabel: 'メニュー',
        darkModeSwitchLabel: '表示モード'
      }
    }
  }
};

function guideSidebar(locale) {
  const prefix = locale === 'ja' ? '/ja' : '';
  const labels =
    locale === 'ja'
      ? {
          start: 'はじめに',
          loop: '制御ループ',
          workflows: 'ワークフロー',
          safety: '安全と出荷',
          overview: '概要',
          what: 'VibeProとは',
          gettingStarted: 'インストールと初回実行',
          concepts: '基本概念',
          features: '機能マップ',
          controlLoop: '証拠付き出荷の制御ループ',
          workflow: 'AI PRの進め方',
          gates: 'ゲートと証跡',
          impact: 'Impact Context連携',
          traceability: 'Story / Spec / 追跡性',
          agentReview: 'エージェントレビュー',
          checks: 'Check Packs',
          verification: '検証・判断・CI証跡',
          execution: 'チェックポイントと実行',
          managed: 'Managed Execution',
          safetyModel: '安全モデル',
          releaseAudit: 'リリースと監査'
        }
      : {
          start: 'Start Here',
          loop: 'Control Loop',
          workflows: 'Workflows',
          safety: 'Safety and Shipping',
          overview: 'Overview',
          what: 'What VibePro Is',
          gettingStarted: 'Install and First Run',
          concepts: 'Core Concepts',
          features: 'Feature Map',
          controlLoop: 'Guarded Delivery Control Loop',
          workflow: 'AI PR Workflow',
          gates: 'Gates and Evidence',
          impact: 'Impact Context Integrations',
          traceability: 'Story, Spec, and Traceability',
          agentReview: 'Agent Review',
          checks: 'Check Packs',
          verification: 'Verification, Decisions, and CI',
          execution: 'Checkpoints and Execution',
          managed: 'Managed Execution',
          safetyModel: 'Safety Model',
          releaseAudit: 'Release and Audit'
        };

  return [
    {
      text: labels.start,
      items: [
        { text: labels.overview, link: `${prefix}/` },
        { text: labels.what, link: `${prefix}/guide/what-is-vibepro` },
        { text: labels.gettingStarted, link: `${prefix}/guide/getting-started` },
        { text: labels.concepts, link: `${prefix}/guide/core-concepts` },
        { text: labels.features, link: `${prefix}/guide/feature-map` }
      ]
    },
    {
      text: labels.loop,
      items: [
        { text: labels.controlLoop, link: `${prefix}/guide/control-loop` },
        { text: labels.traceability, link: `${prefix}/guide/story-spec-traceability` },
        { text: labels.verification, link: `${prefix}/guide/verification-decisions-ci` },
        { text: labels.agentReview, link: `${prefix}/guide/agent-review` },
        { text: labels.gates, link: `${prefix}/guide/gates-and-evidence` }
      ]
    },
    {
      text: labels.workflows,
      items: [
        { text: labels.workflow, link: `${prefix}/guide/ai-pr-workflow` },
        { text: labels.impact, link: `${prefix}/guide/graphify-impact` },
        { text: labels.checks, link: `${prefix}/guide/check-packs` },
        { text: labels.execution, link: `${prefix}/guide/checkpoints-and-execution` },
        { text: labels.managed, link: `${prefix}/guide/managed-execution` }
      ]
    },
    {
      text: labels.safety,
      items: [
        { text: labels.safetyModel, link: `${prefix}/guide/safety-model` },
        { text: labels.releaseAudit, link: `${prefix}/guide/release-and-audit` }
      ]
    }
  ];
}

function referenceSidebar(locale) {
  const prefix = locale === 'ja' ? '/ja' : '';
  return [
    {
      text: locale === 'ja' ? 'リファレンス' : 'Reference',
      items: [
        { text: locale === 'ja' ? 'CLIの使い方' : 'CLI Reference', link: `${prefix}/reference/cli` },
        { text: locale === 'ja' ? '生成物の対応表' : 'Artifact Map', link: `${prefix}/reference/artifact-map` },
        { text: locale === 'ja' ? 'Cloudflare Pages' : 'Cloudflare Pages', link: `${prefix}/reference/cloudflare-pages` },
        { text: locale === 'ja' ? 'バージョン履歴' : 'Version History', link: `${prefix}/reference/version-history` }
      ]
    }
  ];
}

function resolveSourceCommit() {
  const buildCommit = process.env.VIBEPRO_SOURCE_COMMIT?.trim();
  if (buildCommit) return buildCommit;
  const cloudflareCommit = process.env.CF_PAGES_COMMIT_SHA?.trim();
  if (cloudflareCommit) return cloudflareCommit.slice(0, 12);
  try {
    const head = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    return dirty ? `${head}-dirty` : head;
  } catch {
    return 'unknown';
  }
}
