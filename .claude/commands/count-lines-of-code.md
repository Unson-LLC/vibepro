---
name: count-lines-of-code
description: コードの行数を調べる
---

# コード行数、ファイル数を調査

指定したコードの基本統計（言語、ファイル数、行数）を `cloc` で収集します。

## 前提条件

`cloc` がインストールされていること。

```bash
# インストール確認
cloc --version

# 未インストールの場合
# macOS: brew install cloc
# Ubuntu: apt install cloc
```

## 実行手順

### Step 1: 対象確認

```bash
ls -la target/
```

対象がなければuserにtargetディレクトリの準備をしてもらうよう報告

### Step 2: cloc実行

結果を `results/codebase-stats.md` に保存:

```bash
mkdir -p results

{
  echo "# コード統計レポート"
  echo ""
  echo "診断日時: $(date '+%Y-%m-%d %H:%M')"
  echo "対象: target/"
  echo ""
  echo "---"
  echo ""
  cloc target/ --exclude-dir=node_modules,.git,dist,build,.next,__pycache__,.venv,vendor --md
  echo ""
  echo "---"
  echo ""
  echo "*VibePro コード統計分析 (cloc)*"
} > results/count-lines-of-code.md
```

## 出力形式

```markdown
# コード統計レポート

診断日時: YYYY-MM-DD HH:MM
対象: target/

---

| Language | files | blank | comment | code |
| :--- | ---: | ---: | ---: | ---: |
| TypeScript | 45 | 320 | 150 | 2730 |
| CSS | 12 | 80 | 20 | 700 |
| JSON | 8 | 0 | 0 | 450 |
| **SUM** | **65** | **400** | **170** | **3880** |

---

*VibePro コード統計分析 (cloc)*
```

## 完了メッセージ

```
統計分析が完了しました。結果: results/codebase-stats.md
```
