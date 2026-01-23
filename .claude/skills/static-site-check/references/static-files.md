# 静的ファイル構成チェック

静的サイトとしての前提条件を満たしているかを検出・報告する。

## チェック項目

1. 配信物が静的ファイルのみか
2. index.html が存在するか
3. 不要なファイルが含まれていないか

## 静的サイトで許可されるファイル

```
*.html
*.css
*.js
*.json (設定/データ用)
*.svg / *.png / *.jpg / *.gif / *.webp (画像)
*.woff / *.woff2 / *.ttf (フォント)
*.ico (ファビコン)
```

## 検出対象

### 1. 静的ファイル以外

検出対象:
- サーバサイドスクリプト: `.php`, `.py`, `.rb`, `.go`, `.java` など
- テンプレートファイル: `.ejs`, `.pug`, `.hbs` など
- データベースファイル: `.sql`, `.sqlite`, `.db` など

報告内容:
- ファイル名とパス
- ファイルの種類

### 2. index.html の存在確認

検出対象:
- ルートディレクトリに `index.html` がない

報告内容:
- index.html の有無
- 代替となりそうな HTML ファイルの一覧

### 3. 配信すべきでないファイル

検出対象:
```
# 開発用
node_modules/
*.log
*.map (ソースマップ)
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

報告内容:
- ファイル名とパス
- ファイルの種類（開発用/設定/エディタ）

### 4. データ保存方式

検出対象:
- サーバへのデータ送信（fetch POST, XMLHttpRequest）
- localStorage / IndexedDB の使用

報告内容:
- データ保存方式の種類
- サーバ通信の有無

## チェック結果の記載例

```markdown
## 静的ファイル構成

### 検出結果
- 静的ファイル以外: 0件
- index.html: あり
- 配信すべきでないファイル: 3件

### 静的ファイル以外
なし

### index.html
- 存在: あり
- パス: /index.html

### 配信すべきでないファイル

| ファイル | 種類 |
|----------|------|
| node_modules/ | 開発用 |
| .env.local | 設定ファイル |
| .DS_Store | エディタ/OS |

### データ保存方式
- localStorage 使用: あり (settings.js:12)
- サーバ通信: なし
```
