# 外部リソース管理

外部CDN・サードパーティスクリプトのリスク管理と対応方法。

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

## 対応方法

### 1. 外部CDNの使用が検出された場合

**問題**: jQuery、Bootstrap などを外部CDNから読み込んでいる

**対応（推奨順）**:

1. **ローカルホスト**: ファイルをダウンロードして自サイトに配置
   ```html
   <!-- NG: 外部CDN -->
   <script src="https://cdn.example.com/jquery.min.js"></script>

   <!-- OK: ローカル配置 -->
   <script src="/js/jquery.min.js"></script>
   ```

2. **SRI（Subresource Integrity）を追加**: 外部CDN使用時の改ざん検知
   ```html
   <script
     src="https://cdn.example.com/jquery.min.js"
     integrity="sha384-xxxx..."
     crossorigin="anonymous">
   </script>
   ```

3. **フォールバック設定**: CDN障害時のローカルファイル読み込み
   ```html
   <script src="https://cdn.example.com/jquery.min.js"></script>
   <script>
     window.jQuery || document.write('<script src="/js/jquery.min.js"><\/script>');
   </script>
   ```

### 2. サードパーティスクリプトが検出された場合

**問題**: アナリティクス、広告、ウィジェットなどの外部スクリプト

**対応**:
- 必要性を再検討（本当に必要か？）
- 信頼できるプロバイダのみ使用
- 遅延読み込みで初期表示に影響させない

```html
<!-- 遅延読み込み -->
<script async src="https://www.googletagmanager.com/gtag/js"></script>
```

### 3. iframe 埋め込みが検出された場合

**問題**: 外部サイトのiframe埋め込み

**対応**:
- 信頼できるサービスのみ許可（YouTube、Google Maps など）
- `sandbox` 属性で権限制限

```html
<!-- sandbox で権限制限 -->
<iframe
  src="https://www.youtube.com/embed/xxx"
  sandbox="allow-scripts allow-same-origin">
</iframe>
```

## 予防策

- 外部依存は最小限に
- 使用する外部リソースのリストを管理
- 定期的に不要な外部リソースを棚卸し
