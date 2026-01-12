# VibePro

Vibe Coding商用化支援プロジェクト

## 概要

Vibe Codingで作成されたコードの商用化を支援するプロジェクトです。

## 診断コマンドの使い方

### 1. 診断対象コードの配置

`target/` ディレクトリに診断対象のソースコードを配置してください。

```bash
# 方法1: 既存プロジェクトをコピー
cp -r /path/to/your/project/* target/

# 方法2: git cloneで配置
git clone https://github.com/your/repo.git target/

# 方法3: シンボリックリンク（元のコードを直接参照）
ln -s /path/to/your/project target
```

### 2. 診断の実行

Claude Code を起動し、スラッシュコマンドで診断を実行します。

```bash
# Claude Code を起動
claude

# 全診断を実行（推奨）
> /diagnose

# 個別診断を実行する場合
> /diagnose-security      # セキュリティ診断
> /diagnose-code-quality  # コード品質診断
> /diagnose-architecture  # アーキテクチャ診断
> /diagnose-operations    # 運用準備度診断
> /diagnose-scale         # 規模判定・見積もり
```

VSCode拡張版の場合は、チャット欄に直接コマンドを入力してください。

### 3. 結果の確認

診断結果は `results/` ディレクトリに出力されます。

```text
results/
├── summary.md        # 統合サマリー（リスク台帳・移行計画・見積もり）
├── security.md       # セキュリティ診断レポート
├── code-quality.md   # コード品質診断レポート
├── architecture.md   # アーキテクチャ診断レポート
├── operations.md     # 運用準備度診断レポート
└── scale.md          # 規模判定レポート
```

## 関連リンク

- [Project Documentation](../../shared/_codex/projects/vibepro/)
