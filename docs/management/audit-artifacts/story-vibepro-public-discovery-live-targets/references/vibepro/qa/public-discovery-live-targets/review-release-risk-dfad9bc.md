# Release risk review — `dfad9bc`

```json
{
  "status": "needs_changes",
  "summary": "Public Discovery本体はNode 20/22、targeted test、live/built/source境界、失敗時の明示性を満たしており、単独差分にrelease-blocking bugは確認できない。ただし改訂優先順位どおりdocs PR #333を先にmergeすると、同PRが導入する生成CLI referenceとCHANGELOGがこのHEADの新しい--base-url/--public-dir契約を含まないため、そのまま#334をmergeできない。#333後に#334をmainへ追従し、CLI reference再生成・CHANGELOG追記・design-ssot競合解消・current-head CI/evidence/review再取得が必要。",
  "inspection_summary": "exact HEAD、origin/mainとの差分、Story/Architecture/Spec、scanner/check-pack/CLI/diagnosis Skill、12件のtargeted test、exact-head Node 20/22 CI evidence、build/typecheck/E2E artifact、docs PR #333のCLI reference生成契約とmerge-treeを確認した。",
  "inspection_evidence": ".vibepro/qa/public-discovery-live-targets/review-release-risk-dfad9bc.md",
  "inspection_inputs": [
    "git rev-parse HEAD => dfad9bc2758363e70022f55db3b7fb26659f74d1",
    "git diff origin/main...HEAD -- src/public-discovery-scanner.js src/check-packs.js src/cli.js skills/vibepro-diagnosis-packages/SKILL.md",
    "docs/management/stories/active/story-vibepro-public-discovery-live-targets.md",
    "docs/architecture/vibepro-public-discovery-live-targets.md",
    "docs/specs/vibepro-public-discovery-live-targets.md",
    "docs/specs/story-vibepro-public-discovery-live-targets.vibepro.json",
    "src/public-discovery-scanner.js",
    "src/check-packs.js",
    "src/cli.js",
    "skills/vibepro-diagnosis-packages/SKILL.md",
    "test/public-discovery-live-targets.test.js",
    "node --test test/public-discovery-live-targets.test.js => 12/12 pass",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_20_.json",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_22_.json",
    ".vibepro/qa/public-discovery-live-targets/final-verification.md",
    ".vibepro/qa/public-discovery-live-targets/integration-status.json",
    ".vibepro/qa/public-discovery-live-targets/e2e-status.json",
    "codex/story-vibepro-manual-control-plane-refresh-v2:scripts/generate-cli-reference.mjs",
    "codex/story-vibepro-manual-control-plane-refresh-v2:test/cli-reference-docs.test.js",
    "codex/story-vibepro-manual-control-plane-refresh-v2:docs/reference/cli.md",
    "git merge-tree <merge-base> codex/story-vibepro-manual-control-plane-refresh-v2 HEAD"
  ],
  "judgment_delta": [
    "live network追加による無制限crawl・外部origin・redirect追従・巨大response・timeout不在を懸念 -> GETのみ、manual redirect、同一origin、40ページ、2 MiB/response、10秒/requestで制限され、timeout/redirect/non-HTML/過大response/壊れたsitemapがartifactへ残ることを実装とtestで確認した",
    "source fallbackやsuppression互換の破壊を懸念 -> base-url > public-dir > sourceを明示入力時だけ適用し、明示入力失敗はsilent fallbackせずinconclusive、引数なしsourceと既存suppressionはexact-head integration/CIで確認されている",
    "check.json/check.md間のcoverage矛盾を懸念 -> coverage独立行、discovered/selected/omitted/failed/scanned、finding優先、0件inconclusiveがCLI testとreal built scan artifactで一致した",
    "単独HEADならrelease可能と暫定判断 -> ユーザー指定のdocs-first順序では#333が同じsrc/cli.js由来の生成CLI referenceとCHANGELOG契約を先に導入するため、このHEADをそのまま後続mergeすると公開manualのUsage driftが発生する。main追従後の再生成・追記・再検証を必須と判断した"
  ],
  "findings": [
    {
      "severity": "medium",
      "id": "release-order-generated-cli-reference-drift",
      "detail": "docs PR #333はscripts/generate-cli-reference.mjs、docs/reference/cli.md、docs/ja/reference/cli.md、npm run docs:cli:checkを導入するが、同PRの生成済みUsageはこのStoryのcheck --base-url/--public-dirを含まない。#333を先にmergeする実際のrelease orderでは、#334をmainへ追従後にnpm run docs:cliを実行して両言語referenceを更新し、Public Discovery live/built対応をCHANGELOG Unreleasedへ追加する必要がある。design-ssot.jsonのupdated_at競合も同時解消し、変更後HEADでdocs:build、Node 20/22 CI、VibePro evidence/reviewを再取得すること。"
    }
  ]
}
```

## Release / rollback notes

- DB、永続データ、設定migrationはない。`scan_coverage`は新規フィールド、artifact schemaは`0.2.0`へ更新されるため、古いrun artifactは上書きせず併存できる。
- defaultは引数なしのsource modeで、明示targetのみlive/builtを有効化する。問題時は新しいflagを外せばsource modeへ戻せる。
- live modeの最大待ち時間は要求単位の10秒で、ページ取得は最大40件を逐次実行する。上限はあるが低速originでは数分かかり得るため、初回rolloutでは実行時間とfailed_countを観測する。
- PR #333先行後は#334のHEADが変わり、現在のexact-head CI/evidence/reviewはfreshではなくなる。再利用せず、更新HEADへ取り直す。
