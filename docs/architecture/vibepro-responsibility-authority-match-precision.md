---
title: VibePro Responsibility Authority Match Precision Architecture
status: accepted
created_at: 2026-07-13
updated_at: 2026-07-13
related_stories:
  - story-vibepro-responsibility-authority-match-precision
---

# VibePro Responsibility Authority Match Precision Architecture

## Decision

Responsibility Authorityのsurface判定を、責務固有のanchorとPR全体の分類signalに分離する。

- `paths` と `symbols` は責務を識別するanchorである。
- `risk_surfaces` はanchor一致を補強する分類signalである。
- ただしpath/symbolを宣言していないrisk-only登録では、risk surfaceを既存どおりstandalone anchorとして扱う。
- Domain Contract clauseにも同じ判定を適用する。責務IDの参照だけでは一致させず、clause自身のsurfaceが直接一致するか、registry責務が直接一致した場合だけ関連clauseを展開する。

この境界により、共有risk surfaceの追加ごとにdenylistを更新する運用を避ける。classifierの語彙が増えても、anchorを持つ無関係責務へfan-outしない。

## Matching Flow

```text
changed paths + changed production diff lines
                 |
                 v
        registry path/symbol anchor
          | matched        | not matched
          v                v
 risk surface enrich   risk-only entry?
          |                | yes + risk matched
          v                v
 registered authority   registered authority
          |
          v
 related contract clause surface match / responsibility reference
```

## Compatibility

Registry validatorが許可しているrisk-only entryは維持する。path/symbolを持つ既存entryのrisk-only一致だけを抑止するため、schema migrationは不要である。

Symbol anchorはファイル全体やStory textではなく、merge baseからの変更行だけで評価する。merge baseがない場合はsymbol一致をfail closedとし、現在ファイル内容へfallbackしない。

## Alternatives Considered

- 共有risk surfaceごとのdenylistは、classifierの語彙追加のたびに更新が必要になり、別責務へのfan-outを構造的に防げないため採用しない。
- risk surface一致を全面的に廃止する案は、path/symbolを持たない既存risk-only registry entryを破壊するため採用しない。
- responsibility IDを参照する全Contract clauseを常時展開する案は、参照関係と変更surfaceの直接証拠を混同するため採用しない。

## Boundary and Review Ownership

変更境界は `src/responsibility-authority.js` のsurface resolverと、その振る舞いを固定する `test/responsibility-authority.test.js` に限定する。Story、Architecture、Spec、Registry documentationは同じ判断を説明する補助正本であり、実装責任者とgate-evidence reviewerがこの1 PRを一貫してレビューできる粒度とする。classifier、PR manager、既存registry schemaの変更は別判断となるため、このPRには含めない。

## Rollback Plan

回帰が確認された場合は、resolver変更だけをrevertして従来のrisk surface判定へ戻せる。永続schema、外部API、保存済みartifactのmigrationはないため、データ復旧は不要である。revert後はSalesTailor STR-146の誤fan-outが再発するため、その間は該当PRを手動waiveせずblockedとして扱う。

## Accepted Follow-ups

なし。classifier語彙やregistry schemaの見直しは本修正の完了条件ではなく、必要になった時点で別Storyとして扱う。

## Failure Modes

- direct anchorがない高risk変更は `no_registered_authority` としてfail closedする。
- merge baseが指定されたのgit diff取得に失敗した場合はsymbol一致をfail closedとし、ファイル全体の文面から責務を拡張しない。
- Contract clauseの責務参照だけでauthorityを発火させない。

## ADR判断

既存Responsibility Authority Registry境界内のbug fixであり、新しい外部依存・永続schema・サービス境界を追加しないため、個別ADRは不要である。
