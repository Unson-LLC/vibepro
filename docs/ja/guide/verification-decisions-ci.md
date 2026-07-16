# 検証・判断・CI証跡

Verification recordは、現在の変更に対する観測可能な結果を表す必要があります。

```bash
vibepro verify record . \
  --id <story-id> \
  --kind typecheck \
  --status pass \
  --command "npm run typecheck" \
  --artifact <status-artifact> \
  --target "src" \
  --scenario "all shipped JavaScript parses" \
  --observed "exit_code=0"
```

`--kind` は必須で、`unit`、`integration`、`e2e`、`typecheck`、`build` を受け付けます。`--status` は `pass`、`fail`、`needs_setup` です。Gateが結果を利用する場合はdurable status artifactとstructured observationを残します。

残リスクはfailをpassへ変換せず、帰属可能なdecisionとして記録します。

```bash
vibepro decision record . \
  --id <story-id> --type waiver \
  --summary "<accepted residual risk>" \
  --reason "<why>" --artifact <evidence> \
  --reviewer <identity> --status accepted
```

PRのCI完了後:

```bash
vibepro verify import-ci . --id <story-id> --pr <number>
vibepro pr prepare . --story-id <story-id> --base origin/main --summary-json
vibepro pr create . --story-id <story-id> --base origin/main
```

CIはreview対象commitに結びつき、importに成功した場合にだけ証跡です。認証失敗、check欠落、mapping不明は明示したままにし、空の成功結果へ変換しません。
