export default {
  title: 'VibePro',
  description: 'Product-intent gates and review evidence for AI coding agents',
  cleanUrls: true,
  srcExclude: ['management/**'],
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
      message: 'Released under the Apache-2.0 License.',
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
          message: 'Apache-2.0 Licenseで公開されています。',
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
          ops: 'VibeProを運用する',
          overview: '概要',
          what: 'VibeProとは',
          gettingStarted: 'インストールと初回実行',
          concepts: '基本概念',
          features: '機能マップ',
          workflow: 'AI PRの進め方',
          gates: 'ゲートと証跡',
          impact: 'Impact Context連携',
          traceability: 'Story / Spec / 追跡性',
          agentReview: 'エージェントレビュー',
          checks: 'Check Packs',
          verification: '検証・判断・CI証跡',
          execution: 'チェックポイントと実行'
        }
      : {
          start: 'Start Here',
          ops: 'Operating VibePro',
          overview: 'Overview',
          what: 'What VibePro Is',
          gettingStarted: 'Install and First Run',
          concepts: 'Core Concepts',
          features: 'Feature Map',
          workflow: 'AI PR Workflow',
          gates: 'Gates and Evidence',
          impact: 'Impact Context Integrations',
          traceability: 'Story, Spec, and Traceability',
          agentReview: 'Agent Review',
          checks: 'Check Packs',
          verification: 'Verification, Decisions, and CI',
          execution: 'Checkpoints and Execution'
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
      text: labels.ops,
      items: [
        { text: labels.workflow, link: `${prefix}/guide/ai-pr-workflow` },
        { text: labels.gates, link: `${prefix}/guide/gates-and-evidence` },
        { text: labels.impact, link: `${prefix}/guide/graphify-impact` },
        { text: labels.traceability, link: `${prefix}/guide/story-spec-traceability` },
        { text: labels.agentReview, link: `${prefix}/guide/agent-review` },
        { text: labels.checks, link: `${prefix}/guide/check-packs` },
        { text: labels.verification, link: `${prefix}/guide/verification-decisions-ci` },
        { text: labels.execution, link: `${prefix}/guide/checkpoints-and-execution` }
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
