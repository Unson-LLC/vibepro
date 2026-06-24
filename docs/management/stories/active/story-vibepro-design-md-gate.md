---
story_id: story-vibepro-design-md-gate
title: DESIGN.mdをVibePro-native DS gateへ接続する
view: dev
period: 2026-06
architecture_docs:
  - ../../../architecture/vibepro-design-md-gate.md
spec_docs:
  - ../../../specs/vibepro-design-md-gate.md
status: active
created_at: 2026-06-24
updated_at: 2026-06-24
---

# DESIGN.mdをVibePro-native DS gateへ接続する

## 背景

VibeProのDesign System workflowは、現行route/code/style evidenceからVibePro-native DSを生成し、外部bundleやvisual foundationsをreference evidenceとして扱える。一方、AI coding agentが継続的に読みやすい単一の視覚設計意図ファイルとして、DESIGN.md形式のような「YAML token + Markdown rationale」の入口がない。

Design Systemを内部JSONだけに閉じると、人間やagentが最初に読む設計意図が分散する。VibeProはDESIGN.mdを実装権威にせず、VibePro-native DS、Story/Spec/Architecture、現行code、Gate DAGへ接続されたreference evidenceとして扱う必要がある。

## 受け入れ基準

- [ ] `vibepro design-system ingest-design-md <repo> --id <ds-id> --file DESIGN.md` が実行できる
- [ ] DESIGN.mdのYAML front matterからtokens/componentsを抽出し、Markdown bodyからsection/rationale/Do-Don'tを抽出できる
- [ ] `.vibepro/design-system/<ds-id>/DESIGN.md` と `design-md.json` が保存される
- [ ] `design-system.json` は `source_evidence.design_md` と `design_md` を持ち、authorityは `vibepro_native_design_system` のまま維持する
- [ ] `ds-gate.json` はDESIGN.md authority boundary、token reference、section/prose intent、Do/Don't coverage、contrast/driftの明示checkを持ち、fallback disabledを維持する
- [ ] `vibepro design-system export-design-md <repo> --id <ds-id>` と `design-system export --format design-md` が人間/agent可読なDESIGN.mdを出力できる
- [ ] `vibepro design-system lint <repo> --id <ds-id>` が構造、token reference、section order、contrast、prose intent、Do/Don't coverageをJSON/summaryで返せる
- [ ] `vibepro design-system diff <repo> --id <ds-id> --base <base-ref>` がbase ref上のDESIGN.mdとの差分をDS gate evidenceとして返せる
- [ ] DESIGN.mdの内容はreference evidenceであり、current code、Story、Spec、Architecture、VibePro gatesを上書きしない
- [ ] help/READMEからコマンドが発見できる
