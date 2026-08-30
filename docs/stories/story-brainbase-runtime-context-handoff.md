---
story_id: story-brainbase-runtime-context-handoff
title: Brainbaseの判断・知識・学習をVibeProの1変更へ接続する
status: active
created_at: 2026-08-31
updated_at: 2026-08-31
architecture_docs:
  - path: docs/architecture/story-brainbase-runtime-context-handoff.md
    status: accepted
spec_docs:
  - .vibepro/spec/story-brainbase-runtime-context-handoff/spec.json
---

# Brainbaseの判断・知識・学習をVibeProの1変更へ接続する

## Story

Brainbase管理下でVibeProを使う開発者として、Hostが確定したJudgmentと実際に取得したKnowledge参照を、1つのStoryへ改変不能なdigest付きで束縛したい。実装後は、同じgit状態に対するcomputed verificationが成功した場合だけ、再利用可能な学習を`knowledge_event.v1`候補として生成したい。

これによりVibeProがBrainbaseの判断を再計算したり、Personal Knowledge本文をrepositoryへ複製したり、未検証の感想を組織知へ登録したりせずに、判断 → 実装 → 検証 → 学習の閉ループを作る。

## 受け入れ基準

- `vibepro integration brainbase bind`がmanaged/resolved/continueのJudgment receiptとそのdigestを検証する。
- required `knowledge.resolve`ごとにrouting receiptだけでなく、canonical URIとcontent digestを持つ実取得参照を要求する。
- v1はteam/organization向けのcanonical fact・team document・source documentだけを保持し、Personal Knowledge本文を永続化しない。
- 保存するcontextはBrainbaseをauthorityとして明示し、VibePro側のsnapshotを正本化しない。
- `vibepro integration brainbase event`はcontext束縛後かつcurrent git fingerprintに一致するcomputed passing verificationがなければ失敗する。
- 生成eventは`development_learning`候補で、decision authority・Graph promotion・external actionをすべてfalseにする。
- 旧`vibepro brainbase` NocoDB adapterは変更しない。

## スコープ外

- VibeProからJudgment Resolverを呼ぶこと
- Knowledge本文の検索・取得
- Personal Knowledge本文のrepository保存
- VibeProからBrainbase APIへ直接書き込むこと
- 自動Graph昇格
