---
layout: home

hero:
  name: VibePro
  text: 意図したプロダクトを、そのまま作る
  tagline: AI支援開発で、プロダクト意図からStory、Spec、実装、検証、判断、PR引き渡しまでの因果関係を明示する。
  image:
    src: /assets/vibepro-header.png
    alt: VibePro
  actions:
    - theme: brand
      text: Betaを導入する
      link: /ja/guide/getting-started
    - theme: alt
      text: VibeProとは
      link: /ja/guide/what-is-vibepro
    - theme: alt
      text: CLIリファレンス
      link: /ja/reference/cli

features:
  - title: プロダクト意図を実装から切り離さない
    details: StoryとSpecを実装・テスト参照へ接続し、技術的に正しいコードでも「そもそも作るものが違う」状態をレビューできるようにします。
  - title: 意図の逸脱を確認可能にする
    details: 検証、レビュー、trace、明示的な判断を残し、実装が採択済みStoryやSpecからどこで逸脱したかを人間とAIが確認できるようにします。
  - title: 自動判定ではなく証拠を引き渡す
    details: 意図から実装までの証跡をPRレビューへ要約し、プロダクトの意味、承認、merge権限は人間とリポジトリpolicyに残します。
---

## 意図とトレーサビリティを扱う

VibeProは、主としてAIエージェントのサンドボックスやツール権限制御を行う製品ではありません。Bash、Edit、deployを使わせるかどうかは実行能力の境界です。VibeProが扱うのは別の失敗です。危険な操作を制限されたAIでも、作るもの自体を間違えることがあります。

現行の最小コアは、StoryからSpec、実装参照、検証、レビュー、判断、trace、PR引き渡しまでの因果関係をリポジトリローカルに残し、確認可能にします。プロダクトの意味を自律的に決めたり、変更が安全だと認定したりはしません。

## 最小コアの境界

VibeProは、従来の広範なGate DAG、managed execution controller、review lifecycle会計、delivery-efficiency budget enforcement、自動audit bundleを提供しません。この縮小は意図的です。コアは、プロダクト意図と「実装がまだその意図に合っているか」をレビューするための証拠を維持することに集中します。

[VibeProとは](/ja/guide/what-is-vibepro)で境界を、[バージョン履歴](/ja/reference/version-history)で公開packageと開発履歴の違いを確認できます。
