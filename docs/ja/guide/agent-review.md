# エージェントレビュー

Required Agent Reviewは、現在のdiffとevidenceに対する、独立したparallel-subagent検査です。人間のメモやprovenanceのないsecond opinionは、required parallel-subagent reviewの代替になりません。

```bash
vibepro review prepare . --id <story-id> --stage gate --role <role>
```

prepared request、current diff、関係するStory / Architecture / Spec、verification artifact、正確なinspection inputをreviewerへ渡します。Reviewerはimplementation identityから独立し、具体的findingを返す必要があります。

結果を受け取った後、そのsubagent thread/sessionをclose/shutdownしてから記録します。

```bash
vibepro review record . \
  --id <story-id> --stage gate --role <role> \
  --status pass --summary "<summary>" \
  --agent-system codex --execution-mode parallel_subagent \
  --agent-id <agent-id> --agent-closed \
  --reviewer-identity separate_session \
  --implementation-session-id <implementation-session> \
  --inspection-summary "<what was inspected>" \
  --inspection-input <source-test-story-spec-contract-or-config> \
  --inspection-evidence <transcript-or-result> \
  --judgment-delta "<initial judgment -> final judgment because evidence>"

vibepro review status . --id <story-id> --stage gate
```

有効なstatusは `pass`、`needs_changes`、`block` です。`pass` のinspection inputには、実際に読んだ `.vibepro` 外のsource、test、Story、Spec、contract、configを指定します。生成された `.vibepro` artifactだけではinspection surfaceになりません。

`gate_evidence`と`release_risk`を含むreviewは既定でcontent-surface-boundです。record後にcommitが増えてもinspection surfaceが不変ならcurrentを維持し、inspection surfaceを変更するとstaleになります。理由付きのrole別`strict_head` policyのreviewはstrict HEAD-boundで、任意のcommit後にstaleになります。

`--strict-head-binding --strict-head-reason <reason>` は無条件のCLI overrideでは**ありません**。許可される由来は2つだけです: role policyで既に `freshness_mode: strict_head` と `freshness_reason` を明示したrole（この場合flagは冗長だが害はない）、または activeなfrozen validation sequenceの `implementation:runtime_contract` `final_review`（release candidateへのTOCTOU防止）。それ以外のstage/roleはそのroleの設定済みfreshness modeを名指しした明示的なエラーで拒否されます。通常のcontent-surface reviewをCLIからstrict化しようとしないでください。`vibepro pr prepare`は各strict bindingの由来（`role_policy` / `validation_sequence` / legacyな `cli_override`）を報告し、既存の `cli_override` artifactは自動書き換えせず移行警告として表示します。

accepted findingを修正し、再検証して、final treeに対する影響reviewだけを取り直します。
