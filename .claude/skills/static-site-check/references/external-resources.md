# 外部リソースチェック

外部CDN・サードパーティスクリプトの使用状況を検出・報告する。

## 検出パターン

```html
<script src="https?://
<link .* href="https?://
<iframe src="https?://
```

## リスク

- 外部CDNダウンでサイト機能停止
- サプライチェーン攻撃（外部スクリプト改ざん）
- プライバシー漏洩（外部サービスへのデータ送信）

## チェック項目

### 1. 外部CDN

検出対象:
- jQuery、Bootstrap などのライブラリ
- フォント（Google Fonts など）
- CSS フレームワーク

報告内容:
- 読み込み元ドメイン
- SRI（Subresource Integrity）の有無
- 読み込むリソースの種類（JS/CSS/フォント）

### 2. サードパーティスクリプト

検出対象:
- アナリティクス（Google Analytics, GTM など）
- 広告スクリプト
- チャットウィジェット
- SNS 埋め込み

報告内容:
- サービス名・プロバイダ
- 読み込み方法（同期/非同期）
- 読み込み元ドメイン

### 3. iframe 埋め込み

検出対象:
- YouTube / Vimeo 動画
- Google Maps
- 外部フォーム
- その他の埋め込みコンテンツ

報告内容:
- 埋め込み元ドメイン
- sandbox 属性の有無
- コンテンツの種類

## チェック結果の記載例

```markdown
## 外部リソース

### 検出結果
- 外部CDN: 3件
- サードパーティスクリプト: 2件
- iframe: 1件

### 外部CDN

| リソース | ドメイン | SRI |
|----------|----------|-----|
| jQuery 3.6.0 | cdn.jsdelivr.net | なし |
| Bootstrap 5.0 | cdn.jsdelivr.net | あり |
| Google Fonts | fonts.googleapis.com | - |

### サードパーティスクリプト

| サービス | ドメイン | 読み込み |
|----------|----------|----------|
| Google Analytics | googletagmanager.com | async |
| Intercom | widget.intercom.io | defer |

### iframe

| コンテンツ | ドメイン | sandbox |
|------------|----------|---------|
| YouTube動画 | youtube.com | なし |
```
