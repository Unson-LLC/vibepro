# 秘密情報混入対策

秘密情報（APIキー/トークン/パスワード等）の混入を防ぐための対応方法。

## 検出パターン

```
# APIキー/トークンパターン
(api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)
sk-[a-zA-Z0-9]{20,}
[a-z0-9]{32,}

# 認証情報ファイル
\.env$|\.env\.|credentials|\.key$|\.pem$
```

## 対応方法

### 1. 認証情報ファイルが検出された場合

**問題**: `.env` / `*.key` / `credentials` などのファイルがリポジトリに含まれている

**対応**:
1. 該当ファイルを削除
2. `.gitignore` に追加して再混入を防止
3. Git履歴に残っている場合は `git filter-branch` または BFG Repo-Cleaner で履歴から削除

```bash
# .gitignore に追加
echo ".env" >> .gitignore
echo "*.key" >> .gitignore
echo "*.pem" >> .gitignore
```

### 2. JSファイルにAPIキーが検出された場合

**問題**: JavaScript内にハードコードされたAPIキーがある

**対応**:
- **公開可能なキーの場合**: そのまま使用可（例: Google Maps APIキーでリファラ制限済み）
- **非公開キーの場合**:
  1. 該当コードを削除
  2. バックエンドAPI経由でアクセスする設計に変更
  3. 静的サイトでは使用不可 → サーバサイド実装が必要

### 3. デバッグログに機密情報が含まれる場合

**問題**: `console.log()` などで機密情報を出力している

**対応**:
1. 本番用ビルドでは `console.log` を削除
2. または出力内容から機密情報を除外

```javascript
// NG
console.log("API Response:", response);

// OK
console.log("API Response received");
```

## 予防策

- 開発時から秘密情報をコードに書かない習慣をつける
- pre-commit フックで秘密情報パターンをチェック
- 公開APIキーはリファラ制限/IP制限を設定
