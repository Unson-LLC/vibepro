# エージェントレビュー

Required Agent Reviewは、現在のdiffとevidenceに対する、独立・lifecycle-boundな検査です。人間のメモやprovenanceのないsecond opinionは、required parallel-subagent reviewの代替になりません。

```bash
vibepro review prepare . --id <story-id> --stage gate --role <role>
vibepro review start . \
  --id <story-id> --stage gate --role <role> \
  --agent-system codex --agent-id <agent-id>
```

prepared request、current diff、関係するStory / Architecture / Spec、verification artifact、正確なinspection inputをreviewerへ渡します。Reviewerはimplementation identityから独立し、具体的findingを返す必要があります。

結果を受け取った後、recordより先にlifecycleをcloseします。

```bash
vibepro review close . \
  --id <story-id> --stage gate --role <role> \
  --agent-id <agent-id> --close-reason completed \
  --close-evidence <transcript-or-result>

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

`gate_evidence`と`release_risk`を含むreviewは既定でcontent-surface-boundです。record後にcommitが増えてもinspection surfaceが不変ならcurrentを維持し、inspection surfaceを変更するとstaleになります。理由付きのrole別`strict_head` policy、または `--strict-head-binding --strict-head-reason <reason>` のreviewはstrict HEAD-boundで、任意のcommit後にstaleになります。accepted findingを修正し、再検証して、final treeに対する影響reviewだけを取り直します。

Adjudicationは別の独立判断です。実装と証跡の確定後、`adjudicate prepare` / `adjudicate record` でSpec clauseのdemonstrationとSenior Judgment itemを裁定します。
