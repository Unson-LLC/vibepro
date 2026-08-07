---
layout: home

hero:
  name: VibePro
  text: AIコーディングの文脈を追跡可能にする
  tagline: Story、Spec、検証、レビュー、判断、trace、PR証跡のための小さなリポジトリローカルCLI。
  image:
    src: /assets/vibepro-header.png
    alt: VibePro
  actions:
    - theme: brand
      text: Betaを導入する
      link: /ja/guide/getting-started
    - theme: alt
      text: 最小フローを見る
      link: /ja/guide/control-loop
    - theme: alt
      text: CLIリファレンス
      link: /ja/reference/cli

features:
  - title: プロダクト意図を確認できる
    details: StoryとSpecをリポジトリのそばに置き、エージェントの実装を意図した振る舞いまで追跡できます。
  - title: 証跡を明示的に残せる
    details: 検証、レビュー、人間の判断を記録します。ただし、その記録から安全性を自動判定しません。
  - title: PRへの引き渡しを読みやすくする
    details: 現在のリポジトリローカル証跡を、機械可読なPR contextと人間向けPR本文へ要約します。
---

## 0.2.0-beta.3の境界

VibeProは最小の証跡ワークスペースになりました。Gate DAG、readiness/blocking判定、managed merge execution、lifecycle会計、budget enforcement、自動audit bundleは提供しません。承認とmergeの責任は、人間のreviewerと対象リポジトリのpolicyに残ります。

[VibeProとは](/ja/guide/what-is-vibepro)で境界を、[バージョン履歴](/ja/reference/version-history)で公開packageと開発履歴の違いを確認できます。
