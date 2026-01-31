# 静的サイト公開チェック結果

診断日時: 2026-01-27 09:40
対象: target/

---

## 前提確認

- [x] 静的ファイルのみ（.php, .py 等のサーバーサイドファイルなし）
- [x] index.html あり
- [x] 秘密情報なし（APIキー等の検出なし）
- [x] ユーザデータをサーバに保存しない（localStorage / IndexedDB 等も未使用）

---

## セキュリティ

### 1.1 秘密情報混入チェック

- [x] `.env` / `*.key` / 認証情報ファイルなし
- [x] JS / HTML にAPIキー等の機密文字列なし
- [x] デバッグ用ログに機密情報なし

**結果**: OK - 秘密情報の混入は検出されませんでした。

### 1.2 XSS（HTML注入）対策

- [x] `innerHTML` の直接使用なし
- [x] `eval()` / `new Function()` の使用なし
- [x] `document.write()` の使用なし

**結果**: OK - XSS脆弱性パターンは検出されませんでした。

### 1.3 外部リソース

- [ ] 外部リソースの使用あり → 要確認

**検出された外部リソース**:

| リソース | URL | 用途 | SRI |
|----------|-----|------|-----|
| プレースホルダー画像 | `https://placehold.jp/150x150.png` | プロフィール画像 | N/A（画像） |

**備考**:
- placehold.jp は日本のプレースホルダー画像サービスで比較的信頼性が高い
- 本番公開時は実画像に差し替えることを推奨

### 1.4 外部リンク

**検出された外部リンク**:

| リンク先 | 用途 |
|----------|------|
| `https://forms.gle/dummy` | 問い合わせフォーム（Google Forms） |
| `mailto:dummy@example.com` | メール連絡先 |
| `https://github.com/dummy` | SNSリンク（GitHub） |
| `https://x.com/dummy` | SNSリンク（X） |
| `https://linkedin.com/in/dummy` | SNSリンク（LinkedIn） |

**備考**: これらはダミーURLのため、本番公開前に実際のURLに更新が必要です。

---

## npm パッケージ

### package.json 分析

- [x] `npm audit` / `pnpm audit` 実行済み
- [x] high / critical の脆弱性: 0件
- [x] 本番配信に不要なパッケージのみ（`serve` は devDependencies）

**依存関係**:
| パッケージ | バージョン | 用途 | 配信に含めるか |
|-----------|-----------|------|---------------|
| serve | ^14.0.1 | ローカル開発サーバー | 不要 |

**脆弱性チェック結果**:
```
vulnerabilities: {
  info: 0,
  low: 0,
  moderate: 0,
  high: 0,
  critical: 0
}
```

### 配信時の注意

- [ ] `node_modules/` を配信物に含めない
- [ ] `package.json` / `pnpm-lock.yaml` を配信物に含めない

**検出されたファイル（配信不要）**:
| ファイル | 理由 |
|----------|------|
| `node_modules/` | npm パッケージディレクトリ |
| `package.json` | パッケージ定義ファイル |
| `pnpm-lock.yaml` | ロックファイル |

---

## 検出された問題

### 1. 外部リソース（Medium）

| ファイル | 行 | 内容 | 対応推奨 |
|----------|-----|------|----------|
| index.html | 224 | `https://placehold.jp/150x150.png` | 本番用画像に差し替え |

### 2. ダミーURL（Low - 本番公開前に要対応）

| ファイル | 行 | 内容 | 対応推奨 |
|----------|-----|------|----------|
| index.html | 298 | `https://forms.gle/dummy` | 実際のGoogle FormのURLに更新 |
| index.html | 311 | `mailto:dummy@example.com` | 実際のメールアドレスに更新 |
| index.html | 323 | `https://github.com/dummy` | 実際のGitHubプロフィールに更新 |
| index.html | 330 | `https://x.com/dummy` | 実際のXアカウントに更新 |
| index.html | 337 | `https://linkedin.com/in/dummy` | 実際のLinkedInプロフィールに更新 |

### 3. 配信不要ファイル（Info）

| ファイル/ディレクトリ | 対応 |
|----------------------|------|
| `node_modules/` | 配信時に除外 |
| `package.json` | 配信時に除外 |
| `pnpm-lock.yaml` | 配信時に除外 |
| `.git/` | 配信時に除外 |
| `.gitignore` | 配信時に除外 |

---

## 配信対象ファイル（推奨）

本番配信時に含めるべきファイル:

| ファイル | 説明 |
|----------|------|
| `index.html` | メインページ |
| `style.css` | スタイルシート |
| `script.js` | JavaScript |
| `docs/` | ドキュメント（必要に応じて） |

---

## 総合判定

**OK（条件付き）** - 軽微な問題のみ検出

### 判定理由

1. **セキュリティ**: 重大な脆弱性なし
   - 秘密情報混入なし
   - XSS脆弱性なし
   - npm脆弱性なし

2. **要対応事項**（本番公開前）:
   - ダミーURLを実際のURLに更新
   - プレースホルダー画像を実画像に差し替え
   - 配信不要ファイル（node_modules等）の除外

---

*VibePro 静的サイト公開チェック (static-site-check)*
