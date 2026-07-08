# 機能仕様

機能ごとの仕様は、Story から独立した自由記述ではなく、Story / Spec /
Architecture / Review evidence に接続できる粒度で管理します。

## 使い方

- 新しい機能は `_feature-template` を複製して機能名のディレクトリを作る
- `01_behavior_spec.md` でユーザーに見える振る舞いを定義する
- `03_ui_ux_spec.md` で情報設計、状態、コピー、レスポンシブ、アクセシビリティを確認する
- `04_technical_delta.md` に DB/API/権限/実装差分を書く
- `05_test_plan.md` と gate evidence で受け入れ条件を検証する

## 関連資料

- [情報設計](../design/02_information_architecture.md)
- [状態表示方針](../design/07_state_guidelines.md)
- [コピー・文言ルール](../design/08_copy_guidelines.md)
