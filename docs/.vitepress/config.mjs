import { execFileSync } from 'node:child_process';

const siteUrl = 'https://vibepro.pages.dev';
const sourceCommit = resolveSourceCommit();
const productDescription = 'Repository-local Story, Spec, verification, review, and PR evidence for AI coding agents';

export default {
  title: 'VibePro',
  description: productDescription,
  cleanUrls: true,
  sitemap: { hostname: siteUrl },
  srcExclude: [
    'architecture/**',
    'contracts/**',
    'features/anonymized-value-cases/**',
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
    ['meta', { property: 'og:title', content: 'VibePro — Traceable context for AI coding agents' }],
    ['meta', { property: 'og:description', content: productDescription }],
    ['meta', { property: 'og:image', content: `${siteUrl}/assets/vibepro-header.png` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'VibePro — Traceable context for AI coding agents' }],
    ['meta', { name: 'twitter:description', content: productDescription }],
    ['meta', { name: 'twitter:image', content: `${siteUrl}/assets/vibepro-header.png` }],
    ['meta', { name: 'vibepro-source-commit', content: sourceCommit }],
    ['script', { type: 'application/ld+json' }, JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'VibePro',
      applicationCategory: 'DeveloperApplication',
      operatingSystem: 'macOS, Linux, Windows',
      softwareVersion: '0.2.0-beta.12',
      url: siteUrl,
      codeRepository: 'https://github.com/Unson-LLC/vibepro',
      license: 'https://www.apache.org/licenses/LICENSE-2.0'
    })]
  ],
  themeConfig: {
    siteTitle: 'VibePro Manual',
    nav: [
      { text: 'Guide', link: '/guide/what-is-vibepro' },
      { text: "What's New", link: '/releases/' },
      { text: 'Reference', link: '/reference/cli' },
      { text: 'GitHub', link: 'https://github.com/Unson-LLC/vibepro' }
    ],
    sidebar: {
      '/guide/': guideSidebar('en'),
      '/releases/': releaseSidebar('en'),
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
      description: 'AIコーディングエージェントのためのStory、Spec、検証、レビュー、PR証跡',
      themeConfig: {
        siteTitle: 'VibeProマニュアル',
        nav: [
          { text: 'ガイド', link: '/ja/guide/what-is-vibepro' },
          { text: '事例', link: '/ja/cases/' },
          { text: '新着情報', link: '/ja/releases/' },
          { text: 'リファレンス', link: '/ja/reference/cli' },
          { text: 'GitHub', link: 'https://github.com/Unson-LLC/vibepro' }
        ],
        sidebar: {
          '/ja/guide/': guideSidebar('ja'),
          '/ja/releases/': releaseSidebar('ja'),
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
  const labels = locale === 'ja'
    ? ['現行CLI', '概要', 'VibeProとは', 'インストールと初回実行', '最小コアの流れ', 'シニアエンジニア判断', '機能マップ', 'リリース境界']
    : ['Current CLI', 'Overview', 'What VibePro Is', 'Install and First Run', 'Minimal Core Flow', 'Senior Engineering Judgment', 'Feature Map', 'Release Boundary'];

  return [
    {
      text: labels[0],
      items: [
        { text: labels[1], link: `${prefix}/` },
        { text: labels[2], link: `${prefix}/guide/what-is-vibepro` },
        { text: labels[3], link: `${prefix}/guide/getting-started` },
        { text: labels[4], link: `${prefix}/guide/control-loop` },
        { text: labels[5], link: `${prefix}/guide/senior-engineering-judgment` },
        { text: labels[6], link: `${prefix}/guide/feature-map` },
        { text: labels[7], link: `${prefix}/guide/release-and-audit` }
      ]
    }
  ];
}

function releaseSidebar(locale) {
  const prefix = locale === 'ja' ? '/ja' : '';
  const labels = locale === 'ja'
    ? ['2026年8月', '2026年7月', '2026年6月', '2026年5月', '2026年1月']
    : ['August 2026', 'July 2026', 'June 2026', 'May 2026', 'January 2026'];
  return [
    {
      text: locale === 'ja' ? 'リリースノート' : 'Release Notes',
      items: [
        { text: locale === 'ja' ? '一覧' : 'Overview', link: `${prefix}/releases/` },
        { text: labels[0], link: `${prefix}/releases/2026-08` },
        { text: labels[1], link: `${prefix}/releases/2026-07` },
        { text: labels[2], link: `${prefix}/releases/2026-06` },
        { text: labels[3], link: `${prefix}/releases/2026-05` },
        { text: labels[4], link: `${prefix}/releases/2026-01` }
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
