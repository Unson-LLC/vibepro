---
story_id: story-vibepro-brainbase-outcome-case-binding-v2
title: Brainbase成果ケースへのv2紐付けを後方互換で保持する
status: active
---

# Brainbase成果ケースへのv2紐付けを後方互換で保持する

## 背景

BrainbaseからVibeProへ渡す判断コンテキストは、従来のv1契約を利用している。成果ケースを追跡するには、判断の受領記録、利用者が観測できる成果、技術的な受入条件、運用確認の終端証跡を、v1を壊さずに保持する必要がある。

## ユーザーストーリー

Brainbaseから引き継がれた開発担当者として、成果ケースに対するVibeProの技術証跡を確認できるようにしたい。これにより、技術検証とOutcomeCaseの完了判断を混同せずに次の判断者へ渡せる。

## 受入条件

- AC-1: `brainbase-vibepro-context-handoff.v1` の入力と出力契約は従来どおり受理される。v1 Contextだけを持つStoryのPR準備は成果ケース未連携の `none` / `not_linked` として表示し、v2の再bind/復旧を案内しない。
- AC-2: `brainbase-vibepro-context-handoff.v2` 相当の成果ケースは、署名済み `brainbase-vibepro-managed-handoff.v2` でのみ受理する。署名対象の `outcome_case` は `case_id`、成果ケース参照、判断受領参照、判断ダイジェスト、利用者が観測できる成果、技術受入条件、運用確認を必須として検証する。
- AC-3: 有効なmanaged v2入力は、既存Storyを事前検査するか、標準 `vibepro story add` の完全なStory追加契約だけが内部の非export宣言capabilityを使って同一ジャーナル取引へ含める。公開されたStory追加契約は正規化済みCLI項目だけを受け、traceabilityも作成する。公開済みmanaged v2取引のtraceability書込みだけが失敗した場合は、commit済みStory・信頼済み投影・完全一致する正規化済み宣言・traceability欠落をすべて確認できる同じ標準Story追加だけが、公開を重複せずtraceabilityを冪等に再開する。不一致・未信頼v2・v1はfail closedする。一般のbind APIと任意の事前作成Story宣言はfail closedする。config、Context、bind receipt、消費ledger、commit markerを回復可能に公開してから、StoryとPR準備へ同じ成果ケース契約を保持する。非managed v2は権威あるStory/PRメタデータを投影できない。
- AC-4: PR準備は保存済みの署名付きmanaged v2 handoffを信頼鍵で再検証し、技術完了の判定と検証証跡だけを返す。未連携の `none` と、未信頼・改ざん・期限切れ・commit marker欠落・partialの `unknown` / `untrusted` / `partial` を安全なreason codeと再bind/復旧判断とともに可視化する。`integration status`、`doctor`、Story診断レポートはこの信頼検証を実行しないため、`not_evaluated` と `pr prepare` の検証導線を表示する。OutcomeCaseの完了・close・外部更新を呼び出しも要求もしない。
- AC-5: 不足、空値、重複ID、caseと一致しない参照、未知issuer、未信頼の検証証跡は技術完了として扱わない。v2からv1への再bindは既存v2投影を残したまま成功してはならず、markerのない部分投影は権威メタデータとして利用しない。

## 対象外

- Brainbase側のOutcomeCaseを更新・完了するAPI呼出し
- production probeを動かすこと
- managed handoff v1の契約変更
