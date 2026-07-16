# Gate Evidence 再レビュー — public discovery live targets

- Story: `story-vibepro-public-discovery-live-targets`
- Reviewed HEAD: `dfad9bc2758363e70022f55db3b7fb26659f74d1`
- Review scope: `origin/main...HEAD`
- Status: **needs_changes**

## 結論

前回finding `command-reliability-unit-artifact-not-exit-derived` は解消している。現在のunit記録は、失敗したsandbox内full-suiteをpassへ合成せず、同一HEADのGitHub Node 20 CI jobを参照する。CI artifactは `status=pass`、`exit_code=0`、`head_sha=dfad9bc2758363e70022f55db3b7fb26659f74d1` を持ち、記録されたcommand、artifact outcome、git contextの間に矛盾はない。ローカルfull-suiteの2件の環境依存失敗も `unit-status.json` で `status=fail`、`exit_code=1` として正直に保存されている。

ただし、修復後のintegration記録に別のcommand reliability矛盾が残る。`verification-evidence.json` は次のcommandを「19/19」「全ACを拘束」として記録している。

```text
node --test --test-concurrency=2 --test-name-pattern='public discovery|source fallback|public-dir|base-url|malformed sitemap|unreachable live provider' test/public-discovery-live-targets.test.js test/session-efficiency-audit.test.js test/vibepro-cli.test.js
```

同一HEADでこのcommandをそのまま再実行した結果は **5/5** であり、19/19ではない。名前patternが `PDLT-AC-...` で始まる多くのテストに一致せず、built cap、source cap、0件inconclusive、findings優先、same-origin、40 page cap、invalid/oversized、live CLI surfaceなどを実行しない。一方、`integration-status.json` は19/19を主張しており、command・artifact・observationが一致していない。

さらに、review requestは04:39:52 JSTに生成され、最終integration記録は04:40:26 JSTに更新されている。request自体もEvidence Reuseを`stale`としており、最新verification fingerprintを入力にしたreview lifecycleではない。integration証跡を修正した後、`review prepare`から再生成して再レビューする必要がある。

## Findings

### [Medium] integration recordのcommandと19/19 artifactが一致しない

- Finding id: `command-reliability-integration-pattern-count-mismatch`
- Record: `.vibepro/pr/story-vibepro-public-discovery-live-targets/verification-evidence.json`
- Artifact: `.vibepro/qa/public-discovery-live-targets/integration-status.json`
- Replay result: 5 tests passed / 0 failed / exit 0

実装のtargeted file自体は `node --test test/public-discovery-live-targets.test.js` で12/12 passし、Node 20/22 CIも同一HEADでpassしているため、現時点でproduct regressionを示すfindingではない。しかし、gate binding上は「記録commandが証明した範囲」を超えてAC-1〜AC-9と19/19を主張している。証跡のcommandを実際に19件を実行した `final-verification.md` 記載commandへ戻すか、12/12 targeted commandを正確な件数・scenarioとともに再記録し、artifactを実exitから作り直す必要がある。

### [Medium] review requestが最終verification更新より古い

- Finding id: `evidence-lifecycle-review-prepared-before-final-record`
- Review request mtime: 2026-07-16 04:39:52 JST
- Verification evidence mtime: 2026-07-16 04:40:26 JST

証跡確定後にreviewを行うcommit/evidence/review orderingを満たしていない。証跡修復後に `vibepro review prepare` を再実行し、最新fingerprintからfresh lifecycleを開始する必要がある。

## Prior Finding Disposition

- `command-reliability-unit-artifact-not-exit-derived`: **resolved**。
  - unit commandはexact-head Node 20 CI jobへrebinding済み。
  - `.vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_20_.json` は `status=pass` / `exit_code=0` / exact head。
  - `.vibepro/qa/public-discovery-live-targets/unit-status.json` はローカルsandbox full-suiteを `status=fail` / `exit_code=1` として保持し、CI passと混同していない。

## Mandatory Lens

- `regression_guard`: **product behaviorはpass、gate evidenceはneeds_changes**。targeted 12/12とexact-head Node 20/22 CIから実装回帰の兆候はないが、integration記録の実行範囲と主張件数が矛盾する。
- `path_surface_coverage`: **実装・テスト集合としてはpass、記録commandとしてはneeds_changes**。test fileにはlive/built/source、priority、same-origin、cap、timeout、malformed sitemap、provider failure、coverage/finding precedence、public-discovery/all surfaceが存在する。しかし現在記録されたpattern commandはその大半を実行しない。
- `freshness`: **needs_changes**。各verification recordのgit contextはexact HEADだが、review requestは最終integration記録より古い。
- `evidence handling`: prompt injection相当の文言は検出しなかった。

## Inspection Inputs

- `.vibepro/reviews/story-vibepro-public-discovery-live-targets/gate/review-request-gate_evidence.md`
- `.vibepro/pr/story-vibepro-public-discovery-live-targets/verification-evidence.json`
- `.vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_20_.json`
- `.vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_22_.json`
- `.vibepro/qa/public-discovery-live-targets/unit-status.json`
- `.vibepro/qa/public-discovery-live-targets/integration-status.json`
- `.vibepro/qa/public-discovery-live-targets/full-suite-dfad9bc-junit.xml`
- `.vibepro/qa/public-discovery-live-targets/final-verification.md`
- `.vibepro/checks/public-discovery/public-discovery-live-targets-final-dfad9bc/check.json`
- `docs/management/stories/active/story-vibepro-public-discovery-live-targets.md`
- `docs/architecture/vibepro-public-discovery-live-targets.md`
- `docs/specs/vibepro-public-discovery-live-targets.md`
- `docs/specs/story-vibepro-public-discovery-live-targets.vibepro.json`
- `src/public-discovery-scanner.js`
- `src/check-packs.js`
- `src/cli.js`
- `skills/vibepro-diagnosis-packages/SKILL.md`
- `test/public-discovery-live-targets.test.js`
- `origin/main...dfad9bc2758363e70022f55db3b7fb26659f74d1`
- exact recorded integration command replay: 5/5 pass
- `node --test test/public-discovery-live-targets.test.js`: 12/12 pass

## Judgment Delta

1. 初期懸念「旧unit findingが残っている」→ exact-head CI artifactと修正済みlocal statusを照合し、**resolved**と判断した。
2. 初期期待「修復後のintegrationは19/19を再現する」→ exact command replayが5/5で、主張されたAC surfaceの大半を選択しないため、**新しいmedium finding**へ変更した。
3. 実装判断「release-blocking defectがある」→ targeted 12/12、exact-head Node 20/22 CI、source/diff inspectionから否定した。必要なのはimplementation reworkではなく、正確なintegration evidenceの再記録とfresh review lifecycleである。

## Verdict JSON

```json
{
  "status": "needs_changes",
  "summary": "旧unit証跡矛盾はexact-head Node 20 CIへのrebindingで解消したが、現在のintegration recordは記録commandの実再生5/5に対して19/19と全AC coverageを主張し、review requestも最終証跡更新より古い。",
  "inspection_summary": "Story/Architecture/Spec、origin/main...HEAD diff、scanner/CLI/check-pack/test、exact-head CI artifacts、local JUnit/status、real built scanを読み、記録されたintegration commandとtargeted test fileを同一HEADで再実行した。",
  "inspection_evidence": ".vibepro/qa/public-discovery-live-targets/review-gate-evidence-dfad9bc-fixed.md",
  "inspection_inputs": [
    ".vibepro/reviews/story-vibepro-public-discovery-live-targets/gate/review-request-gate_evidence.md",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/verification-evidence.json",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_20_.json",
    ".vibepro/pr/story-vibepro-public-discovery-live-targets/ci-evidence/test_22_.json",
    ".vibepro/qa/public-discovery-live-targets/unit-status.json",
    ".vibepro/qa/public-discovery-live-targets/integration-status.json",
    ".vibepro/qa/public-discovery-live-targets/full-suite-dfad9bc-junit.xml",
    ".vibepro/qa/public-discovery-live-targets/final-verification.md",
    "docs/management/stories/active/story-vibepro-public-discovery-live-targets.md",
    "docs/architecture/vibepro-public-discovery-live-targets.md",
    "docs/specs/vibepro-public-discovery-live-targets.md",
    "docs/specs/story-vibepro-public-discovery-live-targets.vibepro.json",
    "src/public-discovery-scanner.js",
    "src/check-packs.js",
    "src/cli.js",
    "test/public-discovery-live-targets.test.js",
    "exact integration replay: 5/5 pass",
    "targeted public discovery file: 12/12 pass"
  ],
  "judgment_delta": [
    "旧unit finding -> exact-head CI pass artifactと正直なlocal fail artifactが分離されたためresolved",
    "integration 19/19の期待 -> exact commandが5/5しか選択しないためneeds_changes",
    "product blockの懸念 -> targeted 12/12とNode 20/22 CI passにより否定"
  ],
  "findings": [
    {
      "severity": "medium",
      "id": "command-reliability-integration-pattern-count-mismatch",
      "detail": "verification recordのintegration commandを同一HEADで再実行すると5/5であり、artifactの19/19と全AC coverage主張に一致しない。"
    },
    {
      "severity": "medium",
      "id": "evidence-lifecycle-review-prepared-before-final-record",
      "detail": "review requestは最終integration verification recordより先に生成されており、fresh evidence fingerprintからprepareされたreviewではない。"
    }
  ]
}
```
