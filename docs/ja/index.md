---
layout: home

hero:
  name: VibePro
  text: プロダクトジャーニーを可視化する
  tagline: AIエージェントの変更を、証拠付きで安全に出荷できるPRへ変えるリポジトリローカル制御基盤。人間が入口と出口を握ります。
  image:
    src: /assets/vibepro-header.png
    alt: VibePro
  actions:
    - theme: brand
      text: VibeProを理解する
      link: /ja/guide/what-is-vibepro
    - theme: alt
      text: 制御ループを見る
      link: /ja/guide/control-loop
    - theme: alt
      text: Betaを導入する
      link: /ja/guide/getting-started

features:
  - title: 意図を出荷契約に変える
    details: Story、Architecture、Specで、目的、境界、受け入れ条件、rollback前提をコードより先に確認できる形へ固定します。
  - title: リスクに応じて証跡を広げる
    details: 変更が触る面に合わせて、検証、独立レビュー、adjudication、release guardを追加します。
  - title: 出荷後まで監査できる
    details: PR準備、CI再取込、merge実行、canonical audit、ROIレポートを現在のcommitに結びつけ、チャット履歴だけに残しません。
---

## 役割から読む

- **実装者:** [インストールと初回実行](/ja/guide/getting-started) → [制御ループ](/ja/guide/control-loop) → [Managed Execution](/ja/guide/managed-execution)
- **Reviewer / adjudicator:** [エージェントレビュー](/ja/guide/agent-review) → [安全モデル](/ja/guide/safety-model)
- **Release operator:** [リリースと監査](/ja/guide/release-and-audit) → [CLIリファレンス](/ja/reference/cli)
- **Engineering manager:** [VibeProとは](/ja/guide/what-is-vibepro) → [機能マップ](/ja/guide/feature-map) → [リリースと監査](/ja/guide/release-and-audit)

このマニュアルはhosting platformに依存しません。Cloudflare Pagesは現在の公開先にすぎず、運用リファレンスに分離しています。
