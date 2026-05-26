---
story_id: story-vibepro-design-system-bundle-ingest
title: External Design System bundleをVibePro-native DSへ安全に取り込む
view: dev
period: 2026-05
architecture_docs:
  - ../../architecture/vibepro-design-system-bundle-ingest.md
spec_docs:
  - ../../specs/vibepro-design-system-bundle-ingest.md
status: active
created_at: 2026-05-26
updated_at: 2026-05-26
---

# External Design System bundleをVibePro-native DSへ安全に取り込む

## 背景

`design-system ingest-brief` はvisual foundation briefを取り込めるが、tokens/components/guidelinesを含む外部Design System bundleをVibePro-native DSへ正規化する経路がない。既存UI modernizeでは、外部bundleを実装上の正にせず、VibeProのDS sectionsとgateへ安全に落とし込む必要がある。

## 受け入れ基準

- [ ] `vibepro design-system ingest <repo> --id <ds-id> --bundle <file>` が実行できる
- [ ] JSON bundle内のtokens/components/guidelines、およびCSS/JS文字列exportからDS要約を抽出できる
- [ ] `theme-tokens.json`, `semantic-tokens.json`, `component-roles.json`, `component-states.json`, `cta-policy.json`, `density-policy.json`, `navigation-policy.json`, `anti-patterns.json`, `design-system.json` が更新される
- [ ] DSの `authority` は `vibepro_native_design_system` のままで、外部bundleはreference evidenceとして記録される
- [ ] `ds-gate.json` は外部bundleのauthority boundaryを明示し、fallback disabledを維持する
- [ ] `design-modernize plan --design-system-bundle .vibepro/design-system/<ds-id>/design-system.json` でtoken/component summaryが0にならない
- [ ] bundle内のsecret/tokenらしい値はDS artifactへ永続化されない
- [ ] help/READMEからコマンドが発見できる
