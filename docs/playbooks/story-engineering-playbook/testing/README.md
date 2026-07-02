# Testing

このディレクトリは、プロジェクト全体で共通するテスト方針と品質ゲートを管理します。

機能ごとの具体的なテスト計画は、各feature配下の `05_test_plan.md` に記載します。

```text
docs/features/[feature-name]/05_test_plan.md
```

チケットごとのテスト条件は、各feature配下の `06_tasks.md` に記載します。

```text
docs/features/[feature-name]/06_tasks.md
```

## ファイル一覧

| ファイル | 目的 |
|---|---|
| `01_test_policy.md` | テスト全体の方針 |
| `02_test_types.md` | テスト種別の使い分け |
| `03_e2e_policy.md` | E2Eテストの方針 |
| `04_manual_test_policy.md` | 手動確認の方針 |
| `05_regression_policy.md` | 回帰テスト・バグ再発防止の方針 |
| `06_quality_gates.md` | PR前、Issue完了前、リリース前の品質ゲート |
