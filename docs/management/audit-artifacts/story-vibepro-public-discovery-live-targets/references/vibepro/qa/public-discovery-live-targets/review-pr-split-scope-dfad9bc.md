# pr_split_scope review — public discovery live targets

- Story: `story-vibepro-public-discovery-live-targets`
- Reviewed HEAD: `dfad9bc2758363e70022f55db3b7fb26659f74d1`
- Role: `pr_split_scope`
- Status: **pass**
- Split judgment: **one focused Story / PRのまま維持する**

## 結論

差分は10ファイル、追加1,187行・削除22行と数値上は大きいが、変更は一つの公開検査契約を端から端まで成立させる垂直スライスに収まっている。具体的には、`src/public-discovery-scanner.js` のlive/built/source対象解決とcoverage判定、`src/check-packs.js` / `src/cli.js` の入力伝播と出力面、診断Skillの運用契約、Story/Architecture/人間向けSpec/機械可読Spec/Design SSOT、そして同じ契約を壊すfixtureを持つテストである。無関係な機能、DB/API/UI契約、依存追加、release設定変更は含まれない。

実装を「collector」「CLI/report」「docs/spec」に分けると、いずれかの中間PRが、公開対象を入力できてもcoverageが利用者に見えない、または説明・Specだけが先行して実装がない状態になる。liveとbuiltを分けても、優先順位 `base-url > public-dir > source`、silent fallback禁止、共通`scan_coverage` schema、0件inconclusiveが分断される。したがって、PRサイズだけを理由に分割するより、一つのStoryとして同時に出荷する方がreview可能性とrollback境界を保つ。

5コミットは初期実装、coverage gap修正2件、Design SSOT登録、CodeQL指摘に対応した構造的URL assertionの順で、全コミットが同じStory intentに閉じている。別Storyへ移すべきcommitや無関係fileはない。最終HEADはcleanで、`origin/main...HEAD` の全変更がStoryのScopeまたは自己dogfoodのtraceabilityに対応する。

## Mandatory lenses

### regression_guard — pass

- 引数なしのsource modeは既存collector、route classification、metadata継承、suppression、robots/llms/header inspectionを維持する。
- `check all` は従来どおりPublic Discoveryを既定追加せず、`--base-url` / `--public-dir` または明示include時だけ追加する。
- 独立再実行で新規targeted suiteは12/12 pass、既存source fallback / optional-all / public-discovery回帰は3/3 pass。
- exact-headのunit evidenceはGitHub Node 20 CI successへ結び直されている。ローカルfull suiteは1,102件中1,100 pass、残り2件はlistenとnpm cacheのsandbox権限で、同一testの境界修正rerunとNode 20/22 CIでpassしている。これはproduct assertion failureではない。
- typecheck、docs build、Skill lint、instruction parity、JSON validation、CodeQLも同一HEADの証跡がある。

### path_surface_coverage — pass

- 入力面: live `--base-url`、built `--public-dir`、legacy source fallback、両flag時のlive優先、壊れた明示入力のno-fallbackを実装・検証している。
- 境界面: repository containment / symlink escape、HTTP(S) / same-origin / manual redirect、page cap、response-size、timeout、non-HTML、malformed sitemap、provider failureが明示される。
- 出力面: scanner artifactの`scan_coverage`、check JSON、Markdown coverage row、aggregate `inconclusive_count`、日英help、diagnosis Skillが同じ契約を公開する。
- 除外・抑止面: cap、cross-origin、duplicate、invalid URLは`omission_summary`とbounded sampleへ残り、取得・読込失敗は`errors`へ残る。suppressionは既存pipeline後のfinding statusへ反映される。
- pre-fixを落とすfixtureとして、0 page vacuum pass、nested build、pre-cap 430/405件、off-origin sitemap、40-page cap、timeout、malformed sitemap、missing/outside/symlink public-dir、finding優先、CLI JSON/Markdown面をassertしている。
- 実build replayも483 discovered / 400 selected / 397 scanned / 83 omitted / 0 failedを記録し、実findingがあるためcoverage/top-levelとも`needs_review`のままで、false passになっていない。

## Inspection inputs

- `.vibepro/reviews/story-vibepro-public-discovery-live-targets/gate/review-request-pr_split_scope.md`
- `docs/management/stories/active/story-vibepro-public-discovery-live-targets.md`
- `docs/architecture/vibepro-public-discovery-live-targets.md`
- `docs/specs/vibepro-public-discovery-live-targets.md`
- `docs/specs/story-vibepro-public-discovery-live-targets.vibepro.json`
- `design-ssot.json`
- `src/public-discovery-scanner.js`
- `src/check-packs.js`
- `src/cli.js`
- `skills/vibepro-diagnosis-packages/SKILL.md`
- `test/public-discovery-live-targets.test.js`
- `test/vibepro-cli.test.js`
- `test/session-efficiency-audit.test.js`
- `.vibepro/pr/story-vibepro-public-discovery-live-targets/verification-evidence.json`
- `.vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_20_.json`
- `.vibepro/qa/public-discovery-live-targets/final-verification.md`
- `.vibepro/qa/public-discovery-live-targets/full-suite-dfad9bc-junit.xml`
- `.vibepro/checks/public-discovery/public-discovery-live-targets-final-dfad9bc/check.json`
- `git diff --stat --name-status --numstat origin/main...HEAD`
- `git log --oneline origin/main..HEAD` と各commit stat
- `node --test test/public-discovery-live-targets.test.js` — 12/12 pass
- `node --test --test-name-pattern='source fallback|check public-discovery reports LLMO|check all leaves optional' test/session-efficiency-audit.test.js test/vibepro-cli.test.js` — 3/3 pass

## Judgment delta

- 初期懸念: 1,187行・5コミットは分割候補に見える -> 最終判断: 各変更は単一の入力/coverage/可視化契約を成立させる同一垂直スライスで、分割すると中間状態の契約が不完全になるため一つのStoryを維持する。
- 初期懸念: review requestのevidence reuseはstale -> 最終判断: reuse artifactには依存せず、current verification evidence、CI artifact、実build artifactを直接確認し、すべてexact HEAD `dfad9bc...`へ結び付いているためscope reviewの根拠はcurrent。
- 初期懸念: ローカルfull suiteの2 failureが回帰を示す可能性 -> 最終判断: 2件はsandboxのlisten/npm-cache権限でassertion failureは0、同一testのrerunとexact-head Node 20/22 CIがpassしており、変更経路のtargeted/legacy回帰も独立再実行で15/15 passした。
- 初期懸念: live/built追加がlegacy sourceやsilent omissionを壊す可能性 -> 最終判断: no-option source path、optional `check all`、suppression、各failure/omission出力面までfixtureがあり、別経路やsilent suppressionの欠落は見つからなかった。

## Findings

なし。

```json
{
  "status": "pass",
  "summary": "10-file/1,187-line delta is a cohesive vertical slice for one Public Discovery target-and-coverage contract; no unrelated files or independently shippable sub-story justify a split.",
  "inspection_summary": "Inspected the exact-head Story, Architecture, human/machine Specs, Design SSOT, full origin/main diff, all five commit stats, scanner/CLI/check-pack/Skill/test paths, current verification and CI artifacts, real built replay, and independently reran 12 targeted plus 3 legacy/optional-path tests.",
  "inspection_evidence": ".vibepro/qa/public-discovery-live-targets/review-pr-split-scope-dfad9bc.md",
  "inspection_inputs": [
    "origin/main...dfad9bc2758363e70022f55db3b7fb26659f74d1",
    "docs/management/stories/active/story-vibepro-public-discovery-live-targets.md",
    "docs/architecture/vibepro-public-discovery-live-targets.md",
    "docs/specs/vibepro-public-discovery-live-targets.md",
    "docs/specs/story-vibepro-public-discovery-live-targets.vibepro.json",
    "design-ssot.json",
    "src/public-discovery-scanner.js",
    "src/check-packs.js",
    "src/cli.js",
    "skills/vibepro-diagnosis-packages/SKILL.md",
    "test/public-discovery-live-targets.test.js",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/verification-evidence.json",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_20_.json",
    ".vibepro/checks/public-discovery/public-discovery-live-targets-final-dfad9bc/check.json",
    "node --test test/public-discovery-live-targets.test.js (12/12 pass)",
    "legacy/optional-path focused tests (3/3 pass)"
  ],
  "judgment_delta": [
    "Large diff looked splittable -> all changes form one target-selection/coverage/reporting contract and split intermediates would be incomplete.",
    "Stale reuse marker raised freshness concern -> direct exact-head evidence and CI/artifacts are current and were inspected instead.",
    "Two local suite failures raised regression concern -> they are sandbox permission failures with zero assertion failures, exact reruns and Node 20/22 CI pass."
  ],
  "findings": []
}
```
