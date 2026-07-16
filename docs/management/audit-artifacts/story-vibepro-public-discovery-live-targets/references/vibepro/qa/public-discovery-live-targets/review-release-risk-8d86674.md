# Release risk review — `8d86674`

```json
{
  "status": "pass",
  "summary": "Release-risk roleはpass。docs先行merge後のmainを取り込んだ現HEADでは、生成CLI referenceとCHANGELOGの競合が解消され、Public Discoveryの新しいlive/built入力はopt-inのまま既存source経路を維持している。live HTTPはGETのみ、manual redirect、same-origin、最大40ページ、2 MiB/response、10秒/requestに制限され、失敗・除外・0件はsilent passせずartifactへ残る。DB・永続データ・設定migrationはない。なおこれはrole判定であり、pr-prepareに残るAgent Review／adjudication等の別Gateを飛ばしてmergeしてよいという判定ではない。",
  "inspection_summary": "exact HEAD 8d86674、origin/main差分、Story/Architecture/Spec、scanner/check-pack/CLI、generated CLI reference、live/built/sourceの全入力経路、redirect・same-origin・timeout・response/page cap、failure/inconclusiveとfinding precedence、current-head targeted/regression tests、current verification artifactを確認した。",
  "inspection_evidence": ".vibepro/qa/public-discovery-live-targets/review-release-risk-8d86674.md",
  "inspection_inputs": [
    "git rev-parse HEAD => 8d86674bfc6a059a398d9ea9a3d04a4c4b279c7c",
    "git diff --name-status origin/main...HEAD",
    "git diff origin/main...HEAD -- src/public-discovery-scanner.js src/check-packs.js src/cli.js",
    "docs/management/stories/active/story-vibepro-public-discovery-live-targets.md",
    "docs/architecture/vibepro-public-discovery-live-targets.md",
    "docs/specs/vibepro-public-discovery-live-targets.md",
    "docs/specs/story-vibepro-public-discovery-live-targets.vibepro.json",
    "src/public-discovery-scanner.js",
    "src/check-packs.js",
    "src/cli.js",
    "test/public-discovery-live-targets.test.js",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/verification-evidence.json",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/pr-prepare.json",
    "node --test --test-concurrency=2 test/public-discovery-live-targets.test.js => 12/12 pass on current HEAD",
    "node --test --test-concurrency=2 --test-name-pattern='PDLT-AC|check all leaves optional agent harness and public discovery|check public-discovery reports LLMO and public page readiness findings|public-discovery classifies private routes and inherits App Router metadata|public-discovery applies documented suppressions and reports warnings' test/public-discovery-live-targets.test.js test/vibepro-cli.test.js => 16/16 pass on current HEAD",
    "npm run docs:cli:check => pass on current HEAD",
    "git diff --check origin/main...HEAD => pass",
    "cmp -s CLAUDE.md AGENTS.md => pass"
  ],
  "judgment_delta": [
    "docs PR先行後にgenerated CLI referenceとCHANGELOGがdriftする懸念 -> origin/mainをmergeした8d86674では両言語CLI referenceが--base-url/--public-dirを含み、npm run docs:cli:checkが現HEADで成功したため解消",
    "live URL入力が外部origin追従・巨大response・無制限crawl・変更系HTTPを生む懸念 -> fetchはGETかつredirect: manual、sitemap locはURL.originで制限、stream読込を2 MiBでcancel、requestごとにAbortController 10秒、root込み40ページで固定され、negative fixtureが修正前実装を落とす具体的assertionを持つためrelease-blocking riskなし",
    "新規happy pathだけ通り既存source/suppression/check all契約が退行する懸念 -> 引数なしcheck allはPublic Discoveryを追加せず、source route分類・App Router metadata継承・suppression warningを含むcurrent-head regression 16/16で互換を確認",
    "失敗した明示targetがsourceへfallbackしてclean passになる懸念 -> missing/escaped public-dir、invalid/unreachable URL、redirect、non-HTML、timeout、oversize、malformed sitemapはerrors/omissions/failed_countへ残り、scanned_count=0はinconclusive、1件以上ではblock/review findingがcoverageとtop-levelへ優先されることを実装とtestで確認",
    "実サイト未確認をmerge blockerにするか検討 -> final live-site confirmationはStory上post-merge Cloudflare deployment auditとして明示的に分離され、今回の変更はopt-inかつrollbackがflag除去で可能なためrole判定はpass。ただし低速originでは最大40ページを逐次取得して数分かかり得るため、初回運用でdurationとfailed_countを観測する"
  ],
  "findings": []
}
```

## Release / rollback notes

- DB、永続データ、secret、runtime configのmigrationはない。artifact schemaは`0.2.0`へ追加的に更新される。
- defaultは従来どおりsource mode。問題時は`--base-url` / `--public-dir`を外せば既存経路へ戻せる。
- live modeは要求単位10秒かつ最大40ページを逐次取得するため、上限はあるが低速originでは数分かかり得る。初回rolloutでは実行時間、`failed_count`、`omission_summary`を観測する。
- 公開済みVibeProサイトに対する最終live replayは、Story記載どおりmerge後のCloudflare deployment auditで行う。
- `.vibepro/pr/.../pr-prepare.json`にはこのinspection時点で別Gateの未解消状態がある。coordinatorはrelease-risk結果を記録後、必要なreview/adjudicationを完了して`pr prepare`を再実行すること。
