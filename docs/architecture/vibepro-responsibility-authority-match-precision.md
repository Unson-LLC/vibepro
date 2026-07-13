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

## Failure Modes

- direct anchorがない高risk変更は `no_registered_authority` としてfail closedする。
- merge baseが指定されたのgit diff取得に失敗した場合はsymbol一致をfail closedとし、ファイル全体の文面から責務を拡張しない。
- Contract clauseの責務参照だけでauthorityを発火させない。

## ADR判断

既存Responsibility Authority Registry境界内のbug fixであり、新しい外部依存・永続schema・サービス境界を追加しないため、個別ADRは不要である。
