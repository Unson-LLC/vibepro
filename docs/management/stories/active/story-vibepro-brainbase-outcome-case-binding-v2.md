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

- AC-1: `brainbase-vibepro-context-handoff.v1` の入力と出力契約は従来どおり受理される。
- AC-2: `brainbase-vibepro-context-handoff.v2` 相当の成果ケースは、署名済み `brainbase-vibepro-managed-handoff.v2` でのみ受理する。署名対象の `outcome_case` は `case_id`、成果ケース参照、判断受領参照、判断ダイジェスト、利用者が観測できる成果、技術受入条件、運用確認を必須として検証する。
- AC-3: 有効なmanaged v2入力は、既存Storyを事前検査したうえで、Brainbaseコンテキスト、Storyメタデータ、PR準備メタデータに同じ成果ケース契約を保持する。非managed v2は権威あるStory/PRメタデータを投影できない。
- AC-4: PR準備は技術完了の判定と検証証跡だけを返す。OutcomeCaseの完了・close・外部更新を呼び出しも要求もしない。
- AC-5: 不足、空値、重複ID、caseと一致しない参照、未知issuer、未信頼の検証証跡は技術完了として扱わない。v2からv1への再bindは既存v2投影を残したまま成功してはならない。

## 対象外

- Brainbase側のOutcomeCaseを更新・完了するAPI呼出し
- production probeを動かすこと
- managed handoff v1の契約変更
