# Architecture

このディレクトリは、プロジェクト全体で共通する技術設計を管理します。

機能ごとの具体的な技術差分は、各feature配下の `04_technical_delta.md` に記載します。
後から理由を知る必要がある設計判断は、`docs/adr/` に記録します。

```text
docs/features/[feature-name]/04_technical_delta.md
```

## ファイル一覧

| ファイル | 目的 |
|---|---|
| `01_system_overview.md` | システム全体の構成と主要コンポーネント |
| `02_db_design.md` | DB設計、ER図、テーブル方針 |
| `03_api_design.md` | API設計、エンドポイント、レスポンス形式 |
| `04_auth_permission.md` | 認証方式、ロール、権限設計 |
| `05_error_design.md` | エラー形式、表示方針、共通エラー設計 |
| `06_logging_monitoring.md` | ログ、監視、アラート方針 |
| `07_non_functional_requirements.md` | パフォーマンス、可用性、運用などの非機能要件 |
| `08_security_design.md` | 守るべき情報、セキュリティ要件、実装時の注意点 |
| `09_directory_structure.md` | 推奨ディレクトリ構成と責務分離 |
