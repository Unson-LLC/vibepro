# UI/UX仕様

## 0. このファイルを使う条件

このファイルは、画面・UI・ユーザー操作がある機能で使用します。

以下のような機能では、作成しなくて構いません。

- APIのみの機能
- バッチ処理
- 内部ロジックのみの変更
- DBマイグレーションのみ
- 文言や設定値だけの軽微な変更

UIがある場合のみ、このファイルに画面構成・操作フロー・状態表示・文言・レスポンシブ対応を書きます。

## 1. 参照する全体UI/UX設計

- [UI/UX基本方針](../../design/01_ui_ux_policy.md)
- [情報設計](../../design/02_information_architecture.md)
- [画面遷移](../../design/03_screen_flow.md)
- [レイアウトルール](../../design/04_layout_rules.md)
- [コンポーネント方針](../../design/05_component_guidelines.md)
- [フォーム設計方針](../../design/06_form_guidelines.md)
- [状態表示方針](../../design/07_state_guidelines.md)
- [コピー・文言ルール](../../design/08_copy_guidelines.md)
- [アクセシビリティ方針](../../design/09_accessibility.md)
- [UIライブラリ](../../design/10_ui_libraries.md)

## 2. 参照するUI/UXアーティファクト

以下はUI/UX検討・人間確認用の参考資料です。
本番実装の正本ではありません。

- [Design Artifacts](../../design/artifacts/README.md)
- [VibePro UI/UX structured intake](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-uiux-structured-intake.md)
- [VibePro IA flow map](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-uiux-ia-flow-map.md)
- [VibePro style preset token gate](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-uiux-style-preset-token-gate.md)
- [VibePro responsive/a11y evidence matrix](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-uiux-responsive-a11y-evidence-matrix.md)
- [VibePro UI/UX one-command cockpit](https://github.com/Unson-LLC/vibepro/blob/main/docs/management/stories/active/story-vibepro-uiux-one-command-cockpit.md)

| 画面・状態 | 画像 |
|---|---|
|  | `../../design/artifacts/[screen-name]__[state].webp` |

### 注意事項

- 画像はUIの方向性や状態表示の意図を理解するためだけに使う
- 画像を仕様の正本として扱わない
- 画像内の架空の文言、数値、UI部品をそのまま実装しない
- 画像やHTMLとMarkdown仕様が矛盾する場合は、Markdown仕様を優先する
- HTML/CSS/JavaScriptを本番実装に直接流用しない
- HTML内のclass名・style・scriptをそのまま使わない
- 実装時は `../../design/10_ui_libraries.md` に記載されたライブラリを優先する
- 既存コンポーネントがある場合は、それを優先する

## 3. 対象画面

| 画面 | パス | 説明 |
|---|---|---|
|  |  |  |

## 4. 画面ごとの目的

### [画面名]

-

## 5. 画面構成

### [画面名]

-
-
-

## 6. 操作フロー

1.
2.
3.

## 7. UI状態

共通方針は [状態表示方針](../../design/07_state_guidelines.md) を参照してください。
この機能固有の状態表示のみ、以下に記載します。

### Loading

-

### Empty

-

### Error

-

### Success

-

## 8. 入力・フィルター

フォーム・入力の共通方針は [フォーム設計方針](../../design/06_form_guidelines.md) を参照してください。

| 項目 | 種類 | 説明 |
|---|---|---|
|  |  |  |

## 9. 文言

文言の共通方針は [コピー・文言ルール](../../design/08_copy_guidelines.md) を参照してください。
この機能固有の文言のみ、以下に記載します。

| 場所 | 文言 |
|---|---|
| タイトル |  |
| ボタン |  |
| 空状態 |  |
| エラー |  |

## 10. レスポンシブ

共通方針は [レイアウトルール](../../design/04_layout_rules.md) を参照してください。
この機能固有のレスポンシブ対応のみ、以下に記載します。

- PC：
- Tablet：
- Mobile：

## 11. 実装時の注意

- このファイルは、この機能固有のUI/UX仕様の正本です
- 全体UI/UX方針は `../../design/` 配下のmdを優先します
- `../../design/artifacts/` 配下の画像は参考資料です
- 画像やHTMLを本番コードへ直接移植しないでください
- 指定されたUIライブラリ・既存コンポーネントを優先してください
- 追加ライブラリが必要な場合は、実装前に確認してください
- prompt、外部Design System、画像、HTML案はvisual hypothesisです。ready判定はStory、Spec、Architecture、現行route code、VibePro-native Design System、現在の検証証跡、Gate DAGを優先してください

## 12. 関連資料

- [機能仕様](./02_functional_spec.md)
- [技術差分](./04_technical_delta.md)
- [テスト計画](./05_test_plan.md)
- [タスク分解](./06_tasks.md)
