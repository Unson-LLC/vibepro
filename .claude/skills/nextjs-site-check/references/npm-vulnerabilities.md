# npm パッケージ脆弱性チェック

package.json で管理されている依存パッケージの脆弱性を検出・報告する。

## 深刻度: Medium〜Critical

## 出力先: `results/nextjs-check-npm.md`

依存パッケージの脆弱性は、アプリケーション全体のセキュリティに影響する。

## チェック方法

### npm audit の実行

```bash
npm audit --json
```

**注意**:
- npm 以外（pnpm / yarn / bun）を使用している場合は、そのツールの監査コマンドを使用する

### 出力例

```
# npm audit report

next  <14.1.1
Severity: high
Server-Side Request Forgery - https://github.com/advisories/GHSA-xxxx
fix available via `npm audit fix`

lodash  <4.17.21
Severity: high
Prototype Pollution - https://github.com/advisories/GHSA-yyyy
fix available via `npm audit fix`

3 vulnerabilities (1 moderate, 2 high)
```

## 脆弱性レベル

| レベル | 説明 | 対応優先度 | 商用リリース |
|--------|------|------------|-------------|
| critical | 即時悪用可能、重大な影響 | 最優先 | 修正必須 |
| high | 悪用可能、大きな影響 | 高 | 修正必須 |
| moderate | 条件付きで悪用可能 | 中 | 推奨 |
| low | 悪用困難、影響限定的 | 低 | 任意 |

## チェック項目

### 1. 脆弱性スキャン

**実行コマンド**:
```bash
npm audit --json
```

**報告内容**:
- 検出された脆弱性の総数
- レベル別の内訳
- 影響を受けるパッケージ一覧
- 実行環境（npm / pnpm / yarn / bun）

### 2. 依存関係の種類

**判定基準**:
- `dependencies`: 本番環境で使用 → 優先度高
- `devDependencies`: 開発時のみ → 優先度低（ただしビルドに影響する場合は注意）

**報告内容**:
- 脆弱性のあるパッケージの依存関係タイプ
- 本番環境への影響有無
- 実際に到達可能なコードか（実行経路があるか）

### 3. Next.js 特有の考慮事項

**確認項目**:
- Server Components でのみ使用されるパッケージ
- Client Components にバンドルされるパッケージ
- ビルド時のみ使用されるパッケージ

**報告内容**:
- クライアントにバンドルされるパッケージの脆弱性（優先度高）
- サーバーサイドのみの脆弱性（中〜高）
- 開発時のみの脆弱性（低）
- API surface（認証・課金・ユーザーデータ）に関わるか

### 4. 未使用パッケージ

**確認方法**:
```bash
npx knip
```

**報告内容**:
- 未使用パッケージに脆弱性がある場合は参考情報として報告
- 削除を推奨

### 5. パッケージの更新状況

**確認方法**:
```bash
npm outdated
```

**報告内容**:
- メジャーバージョンの更新が利用可能なパッケージ
- セキュリティ修正を含むアップデート（advisory に紐づくものを優先）

## Next.js 関連の重要パッケージ

以下のパッケージは特に注意:

| パッケージ | 影響範囲 | 注意点 |
|-----------|----------|--------|
| next | 全体 | SSRF, XSS 等の脆弱性報告あり |
| react, react-dom | クライアント | XSS 関連 |
| @supabase/* | サーバー/クライアント | 認証・データアクセス |
| better-auth | 認証 | セッション管理 |

## チェック結果の記載例

```markdown
## npm パッケージ脆弱性

### 検出結果
- 脆弱性総数: 4件
- critical: 0件
- high: 2件
- moderate: 1件
- low: 1件

### 脆弱性詳細

| パッケージ | バージョン | レベル | 種類 | 依存元 | 影響範囲 |
|-----------|-----------|--------|------|--------|----------|
| next | 14.0.0 | high | SSRF | 直接 | サーバー |
| lodash | 4.17.15 | high | Prototype Pollution | react-query | クライアント |
| minimatch | 3.0.4 | moderate | ReDoS | glob > ... | ビルド時 |

### 影響分析

#### 本番環境に影響（要対応）
- `next`: サーバーサイドで悪用可能な SSRF 脆弱性
- `lodash`: クライアントにバンドルされ、Prototype Pollution のリスク

#### ビルド時のみ（低優先度）
- `minimatch`: devDependencies の依存、本番には影響なし

### 推奨対応

1. `npm audit fix` で自動修正可能な脆弱性を修正
2. `next` を 14.1.1 以上にアップデート
3. `lodash` を直接依存に追加し、最新版を指定

```bash
npm install next@latest
npm install lodash@latest
npm audit fix
```

### 参考: 未使用パッケージ

以下は未使用のため、削除を推奨:

| パッケージ | バージョン | 脆弱性 |
|-----------|-----------|--------|
| moment | 2.29.1 | moderate (ReDoS) |
```

## 脆弱性対応のワークフロー

```bash
# 1. 脆弱性スキャン
npm audit

# 2. 自動修正（可能な場合）
npm audit fix

# 3. 破壊的変更を含む修正（注意）
npm audit fix --force

# 4. 個別パッケージのアップデート
npm install <package>@latest

# 5. 修正後の確認
npm audit
```

## 注意事項

- `npm audit fix --force` は破壊的変更を含む可能性があるため、テスト必須
- 大きな変更を行う前にブランチ作成やロックファイルのバックアップを推奨
- 一部の脆弱性は誤検知の場合がある（実際の使用方法で影響がない）
- 修正版がない場合は、代替パッケージの検討が必要
