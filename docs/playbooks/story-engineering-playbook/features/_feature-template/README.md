# [機能名]

## 1. 概要

この機能が何をするものかを簡潔に書きます。

## 2. 関連するプロダクト資料

- [ユーザーストーリー](../../product/04_user_stories.md)
- [プロダクトスコープ](../../product/05_product_scope.md)
- [成功指標](../../product/06_success_metrics.md)
- [用語集](../../product/07_glossary.md)

## 3. 関連する全体設計

- [システム全体設計](../../architecture/01_system_overview.md)
- [DB設計](../../architecture/02_db_design.md)
- [API設計](../../architecture/03_api_design.md)
- [認証・権限設計](../../architecture/04_auth_permission.md)
- [エラー設計](../../architecture/05_error_design.md)
- [ログ・監視設計](../../architecture/06_logging_monitoring.md)
- [非機能要件](../../architecture/07_non_functional_requirements.md)
- [セキュリティ設計](../../architecture/08_security_design.md)

## 4. 関連するUI/UX設計

- [情報設計](../../design/02_information_architecture.md)
- [画面遷移](../../design/03_screen_flow.md)
- [UI/UX基本方針](../../design/01_ui_ux_policy.md)
- [状態表示方針](../../design/07_state_guidelines.md)
- [コピー・文言ルール](../../design/08_copy_guidelines.md)

## 5. 機能ドキュメント

- [振る舞い仕様](./01_behavior_spec.md)
- [機能仕様](./02_functional_spec.md)
- [UI/UX仕様](./03_ui_ux_spec.md)
- [技術差分](./04_technical_delta.md)
- [テスト計画](./05_test_plan.md)
- [タスク分解](./06_tasks.md)
- [リリース](./07_release.md)

## 6. このテンプレートの使い方

このフォルダ内の全ファイルを、すべての機能で必ず使う必要はありません。

### 原則使用するファイル

- `README.md`
- `01_behavior_spec.md`
  - PO/PM が業務意図を出し、Tech Lead / CTO や Engineer が実装可能でテスト可能な振る舞いに具体化する
- `02_functional_spec.md`
- `05_test_plan.md`
  - 受け入れ条件とテストの対応、品質ゲート、公式情報確認の要否を記載する
- `06_tasks.md`
  - 実装計画、実装順序、AI実装指示、Issue化方針、検証証跡を記載する
  - GitHub Issueへ切り出す場合も、このファイルを正本とする

### 必要な場合のみ使用するファイル

- `03_ui_ux_spec.md`
  - 画面・UI・操作がある機能で使用する
  - APIだけの機能やバッチ処理では不要

- `04_technical_delta.md`
  - API追加、DB利用、権限、ログ、外部連携など技術差分がある場合に使用する
  - 文言修正など、技術差分がない場合は不要

- `07_release.md`
  - 本番リリース・ロールバック・ステージング確認が必要な場合に使用する
  - feature flag、段階リリース、監視、ロールバック条件が必要な場合に使用する
  - 小さな内部修正では不要な場合がある

### 不要な場合

不要なファイルは削除してよいです。
ただし、判断理由を残したい場合は、以下のように記載します。

今回の扱い
この機能では [理由] のため、本ドキュメントは対象外とする。

## 7. ステータス

- [ ] 仕様作成中
- [ ] 技術レビュー中
- [ ] 実装中
- [ ] ステージング確認中
- [ ] リリース済み

## 8. 担当

| 役割 | 担当者 |
|---|---|
| Product Owner |  |
| Tech Lead |  |
| Engineer |  |
| Reviewer / QA |  |
