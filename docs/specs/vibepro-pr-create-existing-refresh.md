# Spec: PR Create Existing PR Refresh

## Intent

`vibepro pr create` はPRを「新規作成するコマンド」ではなく、PR作成判断とその証跡をVibePro正本に残すライフサイクル操作である。

既存open PRがある場合も、最新headに対するPR作成証跡を再発行できなければ、main単体監査や別agentへのhandoffで古い判断を最新判断と誤認する。

## Invariants

- PCR-INV-001: `pr-create.json` は成功扱いで書かれるたびに、実行時点の `preparation.git.head_sha` を `current_head_sha` と `artifact_freshness.artifact_head_sha` に持つ。
- PCR-INV-002: 同一base/headの既存open PRがある場合、VibeProは重複PRを作成してはならない。
- PCR-INV-003: 既存PRを再利用する場合、remote PR head SHAが現在headと一致しない限り、成功扱いのrefresh artifactを書いてはならない。
- PCR-INV-004: 既存PR refreshは `status: updated_existing_pr` と既存PRメタデータをartifactに残す。

## Scenarios

- PCR-SCENARIO-001: `gh pr create` が既存PRを理由に失敗した場合、VibeProは同一base/headのopen PRを検索し、PR本文を最新bodyで更新し、最新headに束縛された `pr-create.json` を書く。
- PCR-SCENARIO-002: 既存PR検索結果の `headRefOid` が現在headと異なる場合、VibeProは失敗としてartifactに理由を残し、PR本文更新へ進まない。
- PCR-SCENARIO-003: 既存PRが見つからない通常経路では、従来通り `gh pr create` のURLを `pr_url` に保存する。

## Verification Clauses

- PCR-VERIFY-001: fake `gh` による既存PR refreshテストで、`status`, `pr_url`, `existing_pr.head_ref_oid`, `artifact_freshness` が現在headに一致することを確認する。
- PCR-VERIFY-002: fake `gh` によるremote head不一致テストで、CLIが失敗し、artifactが `failed` かつhead mismatch理由を持つことを確認する。
- PCR-VERIFY-003: 既存の通常PR作成テストは壊さず、初回PR作成の互換性を維持する。
