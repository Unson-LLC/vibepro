---
story_id: story-vibepro-story-scoped-playbook-export
title: Story単位のStory Engineering Playbook形式ドキュメント出力
status: active
architecture_docs:
  - docs/architecture/vibepro-story-scoped-playbook-export.md
parent_design:
  - vibepro-story-scoped-playbook-export
---

# Story単位のStory Engineering Playbook形式ドキュメント出力

## 背景
VibeProのStoryは、Story、Spec、Architecture、PR Gate DAGを分けて扱える一方で、実装前に「今回のStoryでどの開発ブリーフ項目を埋めるべきか」を人間が毎回翻訳する必要がある。

全体設計図を常に更新する運用に寄せると重くなる。逆に固定テンプレを全Storyへ一律適用すると、Engineering Judgment DAGで判断している意味が薄くなる。

## 受け入れ基準
- `vibepro playbook export` はStory単位でStory Engineering PlaybookのMarkdown/JSON artifactを出力する。
- テンプレ選択は固定ルールではなく、Engineering Judgment / Gate DAGを優先し、存在しない場合だけStory/Spec/Architectureのfallback signalを明示する。
- 出力には選択したテンプレと省略したテンプレの根拠が含まれる。
- 出力は日本語設定のworkspaceでは日本語を既定にする。
- OSS利用者に伝わらない個人名をPlaybook名や出力契約に含めない。

## Scope
- CLI command: `playbook export`
- 出力先: `.vibepro/playbook/<story-id>/`
- 入力: Story doc、Spec、Architecture doc、PR prepare / Gate DAG

## Non-goals
- 全体設計図の自動更新
- Story実行後のArchitecture正本への自動反映
- Playbookテンプレcatalogを外部サービスから同期する機能

## 初期タスク
1. Playbook exporterを追加する
   - Story/Spec/Architecture/Gate DAGを読み、Story Engineering Playbookを生成する。
2. CLIに `vibepro playbook export` を追加する
   - JSON出力と通常サマリーを既存CLIの作法に合わせる。
3. テストを追加する
   - Engineering Judgment axisからテンプレが選ばれることを確認する。
