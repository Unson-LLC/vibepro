# 証拠付き出荷の制御ループ

VibeProは出荷を、一度だけ埋めればよいchecklistではなく、current headに結びついた契約の連鎖として扱います。

```text
Story → Architecture / Spec → Code → Verification
      → Independent Review → Adjudication → Release Guard
      → PR → CI refresh → Merge → Canonical Audit / ROI
```

## 1. 意図と設計を結ぶ

```bash
vibepro story diagnose . --id <story-id> --pre-architecture --run-graphify
vibepro architecture write . --id <story-id> --input <architecture.json> --final
vibepro spec write . --id <story-id> --input <spec.json> --final
vibepro story diagnose . --id <story-id> --phase pre-implementation --run-graphify
```

Storyは成果契約、Architectureは境界とrollback、Specは機械可読なclause、code / test reference、必要diagramを所有します。GraphとJourney contextはimpact lensであり、これらのauthorityを置き換えません。

## 2. 実装して挙動を証明する

```bash
vibepro verify record . \
  --id <story-id> \
  --kind build \
  --status pass \
  --command "npm run build" \
  --artifact <durable-status-artifact> \
  --scenario "production build completes" \
  --observed "exit_code=0"
```

statusは `pass`、`fail`、`needs_setup` です。exit code 0だけでdurable artifactや具体的観測がない記録は、完了証明ではなく補助証跡になることがあります。

## 3. 独立して検査する

[エージェントレビュー](/ja/guide/agent-review)のprepare → separate reviewer start → inspection → lifecycle close → provenance付きrecordを実行します。Spec clauseやSenior Judgment itemに独立裁定が必要なら `adjudicate prepare` / `adjudicate record` を使います。

## 4. GuardしてPRを準備する

```bash
vibepro guard check . --story-id <story-id>
vibepro pr prepare . --story-id <story-id> --base origin/main --summary-json
vibepro pr create . --story-id <story-id> --base origin/main
```

readinessの正本は `pr-prepare.json` の `gate_status` です。短いPR本文は判断briefであり、詳細証跡の代替ではありません。

## 5. CIを更新してmergeする

```bash
vibepro verify import-ci . --id <story-id> --pr <number>
vibepro pr prepare . --story-id <story-id> --base origin/main --summary-json
vibepro pr create . --story-id <story-id> --base origin/main
vibepro execute merge . --story-id <story-id> --strategy merge
```

CI importは証跡集合を変えます。merge前にprepareとPR refreshを再実行し、artifactとPR本文をcurrent headへ揃えます。

## 6. 出荷結果を残す

```bash
vibepro audit replay . --story-id <story-id>
vibepro usage report . --gate-roi --subagent-roi
```

Canonical auditは「何が出荷されたか」「正本checkoutから再生できるか」を示します。Usage reportは出荷価値と、証跡・レビューのコストを分離します。
