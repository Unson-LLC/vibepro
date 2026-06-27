---
layout: home

hero:
  name: VibePro
  text: AI駆動PRを安全に進めるためのマニュアル
  tagline: CodexやClaude Codeが作る変更を、GitHub PRやリリース手順へ進める前に、意図・仕様・検証・レビュー証跡で確認するCLIです。
  image:
    src: /assets/vibepro-header.png
    alt: VibePro
  actions:
    - theme: brand
      text: マニュアルを読む
      link: /ja/guide/what-is-vibepro
    - theme: alt
      text: 初回チェックを走らせる
      link: /ja/guide/getting-started
    - theme: alt
      text: CLIの使い方
      link: /ja/reference/cli

features:
  - title: コードより先に意図を固定する
    details: AIエージェントが変更を始める前に、作業の目的、設計上の前提、満たすべき仕様を明示します。
  - title: リスクに応じてゲートを広げる
    details: 画面操作、実行環境、API契約、データ、リリース、エージェント運用に関わる変更では、確認すべき項目を増やします。
  - title: レビュー証跡を残す
    details: PR文脈、Gate状態、分割計画、検証記録、エージェントレビュー結果を `.vibepro/` に保存します。
---

## このマニュアルの位置づけ

このサイトはVibeProの入口です。VibeProの考え方、通常のPR作成手順、生成されるファイル、ゲートに止められた時に何を見るべきかを説明します。

Cloudflare Pagesは現在の公開先です。VibeProの概念そのものはホスティング環境に依存しません。公開・デプロイに関する話だけを [Cloudflare Pages](/ja/reference/cloudflare-pages) に分けています。
