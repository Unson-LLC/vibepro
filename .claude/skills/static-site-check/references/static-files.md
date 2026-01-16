# 静的ファイル構成確認

静的サイトとしての前提条件を満たしているかの確認と対応方法。

## 確認項目

1. 配信物が静的ファイルのみか
2. index.html が存在するか
3. 不要なファイルが含まれていないか

## 対応方法

### 1. 静的ファイル以外が検出された場合

**問題**: サーバサイドスクリプト（`.php`, `.py`, `.rb` など）が含まれている

**対応**:
- 該当ファイルを削除
- サーバサイド処理が必要な場合は、静的サイトではなくサーバ構成を検討

```
# 静的サイトで許可されるファイル
*.html
*.css
*.js
*.json (設定/データ用)
*.svg / *.png / *.jpg / *.gif / *.webp (画像)
*.woff / *.woff2 / *.ttf (フォント)
*.ico (ファビコン)
```

### 2. index.html が存在しない場合

**問題**: ルートに `index.html` がない

**対応**:
1. エントリポイントとなる `index.html` を作成
2. または既存HTMLファイルを `index.html` にリネーム

```html
<!-- 最小限の index.html -->
<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>サイトタイトル</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- コンテンツ -->
  <script src="main.js"></script>
</body>
</html>
```

### 3. 不要なファイルが含まれている場合

**問題**: 開発用ファイルや設定ファイルが含まれている

**削除すべきファイル**:
```
# 開発用
node_modules/
*.log
*.map (ソースマップ - 必要に応じて)
.git/

# 設定ファイル
.env*
*.config.js (webpack.config.js など)
package.json / package-lock.json
tsconfig.json

# エディタ/IDE
.vscode/
.idea/
*.swp
.DS_Store
```

**対応**:
1. 該当ファイルを削除
2. デプロイ時に除外するスクリプトを作成

### 4. ユーザデータ保存が必要な場合

**問題**: データ永続化が必要だが静的サイトで実現したい

**対応（クライアントサイドストレージ）**:

```javascript
// localStorage - シンプルなキーバリュー
localStorage.setItem('key', 'value');
const value = localStorage.getItem('key');

// IndexedDB - 大量データ/複雑な構造
const request = indexedDB.open('MyDatabase', 1);
```

**注意**: クライアントサイドストレージはユーザのブラウザにのみ保存される。デバイス間同期や他ユーザとの共有が必要な場合はサーバサイド実装が必要。

## 予防策

- デプロイ前に配信ディレクトリの内容を確認
- `.gitignore` で不要ファイルを除外
- CI/CDで自動チェック
