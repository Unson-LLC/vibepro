---
title: VibePro Responsibility Authority Match Precision Spec
status: accepted
created_at: 2026-07-13
updated_at: 2026-07-13
related_stories:
  - story-vibepro-responsibility-authority-match-precision
---

# VibePro Responsibility Authority Match Precision Spec

## Invariants

- `RAR-MATCH-INV-001`: pathまたはsymbolを宣言したresponsibilityは、risk surface単独では一致してはならない。
- `RAR-MATCH-INV-002`: path/symbolを宣言しないrisk-only responsibilityは、互換性のためrisk surface単独で一致できる。
- `RAR-MATCH-INV-003`: symbolは変更されたproduction source行だけから一致させ、Story text、未変更行、test-only sourceから一致させてはならない。
- `RAR-MATCH-INV-004`: Domain Contract clauseのresponsibility参照だけでauthorityを発火させてはならない。
- `RAR-MATCH-INV-005`: Domain Contract clause自身のpath/symbol直接一致は、registry pathと異なる場合でもauthorityを解決できる。
- `RAR-MATCH-INV-006`: direct authorityがないhigh-risk surfaceは `no_registered_authority` を維持する。

## Scenarios

- `RAR-MATCH-S-001`: Given cleanup責務とbilling責務が `queue_worker` を共有し、cleanup pathだけを変更した時、Then cleanup責務だけが一致する。
- `RAR-MATCH-S-002`: Given path/symbolを持たないrisk-only責務がある時、Then対応risk surfaceだけでその責務が一致する。
- `RAR-MATCH-S-003`: Given registry pathは一致しないが関連Contract clause pathが一致する時、Then clauseの直接一致で責務が解決される。
- `RAR-MATCH-S-004`: Given production fileの未変更行だけに登録symbolがある時、Thenその責務は一致しない。
- `RAR-MATCH-S-005`: Given test-only fileだけに登録symbolがある時、Thenその責務は一致しない。
- `RAR-MATCH-S-006`: Given無関係なhigh-risk worker変更に直接authorityがない時、Thenresolverは `no_registered_authority` を出す。

## Verification

- `RAR-MATCH-V-001`: Unit fixtureで共有risk surfaceのfan-out抑止を確認する。
- `RAR-MATCH-V-002`: Unit fixtureでrisk-only互換を確認する。
- `RAR-MATCH-V-003`: Unit fixtureでContract clause path補完を確認する。
- `RAR-MATCH-V-004`: Unit fixtureでchanged-line symbol限定とtest-only除外を確認する。
- `RAR-MATCH-V-005`: Responsibility Authority suite全体とtypecheckをcurrent HEADで実行する。

## Anti-patterns

- 非識別risk surfaceのdenylistを増やして責務一致を調整する。
- Contractに責務IDが書かれていること自体を変更surfaceの証拠にする。
- StoryやSpec本文にsymbol名が出ただけでproduction責務を一致させる。
